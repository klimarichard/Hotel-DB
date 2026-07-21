/**
 * Faktury – re-typing an invoice the hotel PMS (Protel) issued but can no longer
 * display, and printing a PDF that looks like the original.
 *
 * The app is NOT the issuer: `invoiceNo` is typed in by the receptionist, nothing
 * is allocated, and a saved invoice is a freely editable DRAFT, never an
 * accounting record. That is why there is no locking, no numbering series and no
 * "posted" state anywhere on this page.
 *
 * Every type and every piece of arithmetic comes from `@/lib/faktury`, which is
 * the client mirror of the server's `services/invoiceTypes.ts` – the same maths
 * has to produce the on-screen summary here and the PDF there.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Button from "@/components/Button";
import IconButton from "@/components/IconButton";
import ConfirmModal from "@/components/ConfirmModal";
import { useAuth } from "@/hooks/useAuth";
import { api, errorMessage } from "@/lib/api";
import { openPdfBlob } from "@/lib/pdfMerge";
import {
  LINE_GROUP_LABELS,
  addressLines,
  computeTotals,
  emptyLine,
  formatDateCZ,
  formatMoney,
  lineTotal,
  matchHotelByInvoiceNo,
  newLineId,
  dueDateFrom,
  taxDateFrom,
  type Agency,
  type BillTo,
  type CatalogItem,
  type FakturyConfig,
  type InvoiceDraft,
  type InvoiceHotel,
  type InvoiceLine,
  type InvoiceSummary,
  type LineGroup,
  type PartyAddress,
  type VatRate,
} from "@/lib/faktury";
import styles from "./FakturyPage.module.css";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const EMPTY_ADDRESS: PartyAddress = {
  street1: "",
  street2: "",
  street3: "",
  zip: "",
  city: "",
  country: "",
  ic: "",
  dic: "",
};

const EMPTY_CONFIG: FakturyConfig = { vatRates: [], items: [], agencies: [], hotels: [] };

const LINE_GROUPS = Object.keys(LINE_GROUP_LABELS) as LineGroup[];

/** Czech collation – every dropdown on this page sorts through it. */
const byCs = (a: string, b: string) => a.localeCompare(b, "cs");

/**
 * Now as YYYY-MM-DDTHH:MM (what `<input type="datetime-local">` wants), built
 * from local parts. `new Date().toISOString()` would roll back a day in UTC+2
 * for anything after 22:00 – and shift the time on every invoice.
 */
function nowLocalDateTime(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(
    d.getMinutes()
  )}`;
}

function emptyDraft(issuedBy: string): InvoiceDraft {
  return {
    invoiceNo: "",
    hotelId: "",
    deposit: false,
    guestName: "",
    roomNo: "",
    arrival: "",
    departure: "",
    reservationNo: "",
    availProNo: "",
    partnerResNo: "",
    issuedAt: nowLocalDateTime(),
    billTo: { kind: "agency", agencyId: "" },
    // A brand-new invoice has no arrival yet, so the first row starts blank;
    // every row added later inherits the arrival date (see `addLine`).
    lines: [emptyLine()],
    eurRate: 0,
    issuedBy,
    note: "",
  };
}

/**
 * The raw text of a price cell → a number, or null when the text is a legitimate
 * intermediate state that must not be committed ("-", ".", "1e"). A comma is a
 * decimal point: Czech keyboards put it on the numeric block.
 */
function parsePrice(raw: string): number | null {
  const t = raw.replace(",", ".").trim();
  if (t === "") return 0;
  if (!/^-?\d*\.?\d*$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** CZK → EUR at the invoice's own rate. Never Infinity/NaN: an en dash instead. */
function toEur(value: number, rate: number): string {
  if (!rate || !Number.isFinite(rate) || rate <= 0) return "–";
  return formatMoney(value / rate);
}

function activeFirst<T extends { active: boolean }>(rows: T[], keepId: string | null, idOf: (r: T) => string): T[] {
  return rows.filter((r) => r.active || idOf(r) === keepId);
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

type ConfirmState = {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  tertiary?: { label: string; onClick: () => void; variant?: "primary" | "secondary" | "danger" };
  onConfirm: () => void;
} | null;

export default function FakturyPage() {
  // Read straight from the hook in render – never mirrored into state via an
  // effect, which would render one frame with the wrong (pre-auth) value.
  const { can, user, name } = useAuth();
  const canManage = can("faktury.manage");

  const [config, setConfig] = useState<FakturyConfig>(EMPTY_CONFIG);
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [configOpen, setConfigOpen] = useState(false);

  /** null = the invoice list is on screen; non-null = the editor. */
  const [draft, setDraft] = useState<InvoiceDraft | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  /**
   * Line ids the user switched to free text. A free-text line has no catalogue
   * entry behind it, so its VAT bucket and its type have to be chosen by hand.
   */
  const [customLines, setCustomLines] = useState<Record<string, boolean>>({});
  /**
   * Raw text of the price cells being typed, keyed by line id. The draft only
   * ever holds numbers, and a controlled number field would snap "-" back to 0
   * before the digits arrive – payments are always negative, so the minus has to
   * survive. Cleared whenever a line goes away or another invoice is opened, so
   * a recycled id can never inherit someone else's text.
   */
  const [priceText, setPriceText] = useState<Record<string, string>>({});
  /**
   * Only set by Uložit. Validation must never paint a field red before the user
   * has acted – a fresh invoice is empty by definition.
   */
  const [showErrors, setShowErrors] = useState(false);
  /**
   * Manual hotel / deposit choice wins over the number decode from that point on.
   * The decode is a convenience; once the user overrules it, retyping the number
   * must not silently take the hotel back.
   */
  const manualHotelRef = useRef(false);

  // Remembered halves of the Odběratel switch, so flipping the radio back and
  // forth doesn't discard what was already typed on the other side.
  const lastAgencyRef = useRef<BillTo>({ kind: "agency", agencyId: "" });
  const lastPersonRef = useRef<BillTo>({ kind: "person", name: "", ...EMPTY_ADDRESS });

  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [cfg, list] = await Promise.all([
        api.get<FakturyConfig>("/faktury/config"),
        api.get<{ invoices: InvoiceSummary[] }>("/faktury"),
      ]);
      setConfig({
        vatRates: cfg.vatRates ?? [],
        items: cfg.items ?? [],
        agencies: cfg.agencies ?? [],
        hotels: cfg.hotels ?? [],
      });
      setInvoices(list.invoices ?? []);
    } catch (e) {
      setErrorModal(errorMessage(e, "Faktury se nepodařilo načíst."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const hotelName = useCallback(
    (id: string) => config.hotels.find((h) => h.id === id)?.name ?? "",
    [config.hotels]
  );

  /* ---------------------------------------------------------------- */
  /* Draft plumbing                                                    */
  /* ---------------------------------------------------------------- */

  function patchDraft(patch: Partial<InvoiceDraft>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
  }

  /** Which lines came from the catalogue, derived once when a draft is opened. */
  function deriveCustomLines(lines: InvoiceLine[], items: CatalogItem[]): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    for (const l of lines) {
      if (!l.description.trim()) continue;
      out[l.id] = !items.some((it) => it.description === l.description);
    }
    return out;
  }

  function startNew() {
    manualHotelRef.current = false;
    lastAgencyRef.current = { kind: "agency", agencyId: "" };
    lastPersonRef.current = { kind: "person", name: "", ...EMPTY_ADDRESS };
    const d = emptyDraft(name ?? "");
    setDraft(d);
    setDraftId(null);
    setCustomLines({});
    setPriceText({});
    setShowErrors(false);
    setDirty(false);
    setSaveMsg(null);
  }

  async function openInvoice(id: string) {
    setBusy(true);
    try {
      const loaded = await api.get<InvoiceDraft>(`/faktury/${id}`);
      manualHotelRef.current = true; // a stored invoice already has its hotel decided
      lastAgencyRef.current =
        loaded.billTo.kind === "agency" ? loaded.billTo : { kind: "agency", agencyId: "" };
      lastPersonRef.current =
        loaded.billTo.kind === "person" ? loaded.billTo : { kind: "person", name: "", ...EMPTY_ADDRESS };
      setDraft({ ...loaded, lines: loaded.lines ?? [] });
      setDraftId(id);
      setCustomLines(deriveCustomLines(loaded.lines ?? [], config.items));
      setPriceText({});
      setShowErrors(false);
      setDirty(false);
      setSaveMsg(null);
    } catch (e) {
      setErrorModal(errorMessage(e, "Fakturu se nepodařilo načíst."));
    } finally {
      setBusy(false);
    }
  }

  function closeEditor() {
    setDraft(null);
    setDraftId(null);
    setCustomLines({});
    setPriceText({});
    setDirty(false);
    setSaveMsg(null);
  }

  /** Leaving the editor with unsaved edits asks first (save / discard / stay). */
  function requestCloseEditor() {
    if (!dirty) {
      closeEditor();
      return;
    }
    setConfirmState({
      title: "Neuložené změny",
      message: "Faktura má neuložené změny. Chcete ji před zavřením uložit?",
      confirmLabel: "Uložit a zavřít",
      tertiary: {
        label: "Zahodit změny",
        variant: "danger",
        onClick: () => {
          setConfirmState(null);
          closeEditor();
        },
      },
      onConfirm: async () => {
        setConfirmState(null);
        const ok = await handleSave();
        if (ok) closeEditor();
      },
    });
  }

  /* ---------------------------------------------------------------- */
  /* Invoice number → hotel + deposit decode                           */
  /* ---------------------------------------------------------------- */

  function setInvoiceNo(value: string) {
    setDraft((d) => {
      if (!d) return d;
      const next: InvoiceDraft = { ...d, invoiceNo: value };
      if (!manualHotelRef.current) {
        const match = matchHotelByInvoiceNo(value, config.hotels);
        if (match) {
          next.hotelId = match.hotel.id;
          next.deposit = match.deposit;
        }
      }
      return next;
    });
    setDirty(true);
  }

  const decoded = useMemo(
    () => (draft ? matchHotelByInvoiceNo(draft.invoiceNo, config.hotels) : null),
    [draft, config.hotels]
  );

  /* ---------------------------------------------------------------- */
  /* Lines                                                             */
  /* ---------------------------------------------------------------- */

  function patchLine(id: string, patch: Partial<InvoiceLine>) {
    setDraft((d) => (d ? { ...d, lines: d.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) } : d));
    setDirty(true);
  }

  /**
   * A new row starts on the reservation's arrival date – that is what the
   * receptionist is retyping in practice. `emptyLine()` stays date-less on
   * purpose; the arrival is only known here.
   */
  /**
   * Arrival doubles as the default date for item rows. A new invoice starts
   * with one empty row BEFORE arrival is known, so setting arrival backfills
   * any row whose date is still blank — that is what makes the default apply
   * to the first row too, not just to rows added afterwards. Rows that already
   * carry a date are left alone: the user set those deliberately.
   */
  function setArrival(arrival: string) {
    setDraft((d) =>
      d
        ? {
            ...d,
            arrival,
            lines: d.lines.map((l) => (l.date ? l : { ...l, date: arrival })),
          }
        : d
    );
    setDirty(true);
  }

  function addLine() {
    setDraft((d) => (d ? { ...d, lines: [...d.lines, { ...emptyLine(), date: d.arrival || "" }] } : d));
    setDirty(true);
  }

  function removeLine(id: string) {
    setDraft((d) => (d ? { ...d, lines: d.lines.filter((l) => l.id !== id) } : d));
    setCustomLines((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setPriceText((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setDirty(true);
  }

  /** Typing in a price cell: show the raw text, commit only what parses. */
  function changePrice(id: string, raw: string) {
    setPriceText((prev) => ({ ...prev, [id]: raw }));
    const parsed = parsePrice(raw);
    if (parsed !== null) patchLine(id, { unitPrice: parsed });
  }

  /** Leaving a price cell drops the raw text, so the number is shown normalised. */
  function blurPrice(id: string) {
    const raw = priceText[id];
    if (raw !== undefined && parsePrice(raw) === null) patchLine(id, { unitPrice: 0 });
    setPriceText((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function moveLine(id: string, dir: -1 | 1) {
    setDraft((d) => {
      if (!d) return d;
      const i = d.lines.findIndex((l) => l.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= d.lines.length) return d;
      const lines = [...d.lines];
      [lines[i], lines[j]] = [lines[j], lines[i]];
      return { ...d, lines };
    });
    setDirty(true);
  }

  /**
   * The description cell is a combo. Picking a catalogue entry fills the text AND
   * carries its VAT bucket + line type across; "Vlastní text…" clears the text and
   * hands both of those back to the user.
   */
  function pickCatalogItem(line: InvoiceLine, value: string) {
    if (value === "__custom__") {
      setCustomLines((prev) => ({ ...prev, [line.id]: true }));
      patchLine(line.id, { description: "" });
      return;
    }
    const item = config.items.find((it) => it.id === value);
    if (!item) {
      setCustomLines((prev) => ({ ...prev, [line.id]: false }));
      patchLine(line.id, { description: "" });
      return;
    }
    setCustomLines((prev) => ({ ...prev, [line.id]: false }));
    patchLine(line.id, {
      description: item.description,
      vatRateId: item.vatRateId,
      group: item.group,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Odběratel                                                          */
  /* ---------------------------------------------------------------- */

  function setBillKind(kind: "agency" | "person") {
    setDraft((d) => {
      if (!d) return d;
      if (d.billTo.kind === kind) return d;
      if (d.billTo.kind === "agency") lastAgencyRef.current = d.billTo;
      else lastPersonRef.current = d.billTo;
      return { ...d, billTo: kind === "agency" ? lastAgencyRef.current : lastPersonRef.current };
    });
    setDirty(true);
  }

  function patchPerson(patch: Partial<PartyAddress & { name: string }>) {
    setDraft((d) => {
      if (!d || d.billTo.kind !== "person") return d;
      return { ...d, billTo: { ...d.billTo, ...patch } };
    });
    setDirty(true);
  }

  const selectedAgency: Agency | null = useMemo(() => {
    if (!draft || draft.billTo.kind !== "agency") return null;
    const id = draft.billTo.agencyId;
    return config.agencies.find((a) => a.id === id) ?? null;
  }, [draft, config.agencies]);

  /* ---------------------------------------------------------------- */
  /* Save / print / delete                                             */
  /* ---------------------------------------------------------------- */

  function validate(d: InvoiceDraft): string[] {
    const errs: string[] = [];
    if (!d.invoiceNo.trim()) errs.push("Zadejte číslo faktury.");
    if (!d.hotelId) errs.push("Vyberte hotel.");
    if (d.billTo.kind === "agency" && !d.billTo.agencyId) errs.push("Vyberte cestovní kancelář.");
    if (d.billTo.kind === "person" && !d.billTo.name.trim()) errs.push("Zadejte jméno odběratele.");
    if (d.lines.some((l) => !l.description.trim())) errs.push("Každý řádek musí mít popis.");
    if (d.lines.some((l) => l.group === "item" && !l.vatRateId))
      errs.push("U každé položky vyberte sazbu DPH.");
    return errs;
  }

  async function handleSave(): Promise<boolean> {
    if (!draft) return false;
    setShowErrors(true);
    const errs = validate(draft);
    if (errs.length > 0) {
      setErrorModal(errs.join("\n"));
      return false;
    }
    setBusy(true);
    try {
      if (draftId) {
        await api.put(`/faktury/${draftId}`, draft);
      } else {
        const created = await api.post<{ id: string }>("/faktury", draft);
        setDraftId(created.id);
      }
      setDirty(false);
      setSaveMsg("Uloženo");
      setTimeout(() => setSaveMsg(null), 3000);
      const list = await api.get<{ invoices: InvoiceSummary[] }>("/faktury");
      setInvoices(list.invoices ?? []);
      return true;
    } catch (e) {
      setErrorModal(errorMessage(e, "Fakturu se nepodařilo uložit."));
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** Prints the CURRENT in-memory draft, so an unsaved edit still comes out. */
  async function handlePrint() {
    if (!draft || !user) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const resp = await fetch("/api/faktury/render-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ draft }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(text || "Tisk se nezdařil.");
      }
      openPdfBlob(await resp.blob());
    } catch (e) {
      setErrorModal(errorMessage(e, "Fakturu se nepodařilo vytisknout."));
    } finally {
      setBusy(false);
    }
  }

  async function doDelete(id: string) {
    setConfirmState(null);
    setBusy(true);
    try {
      await api.delete(`/faktury/${id}`);
      if (draftId === id) closeEditor();
      const list = await api.get<{ invoices: InvoiceSummary[] }>("/faktury");
      setInvoices(list.invoices ?? []);
    } catch (e) {
      setErrorModal(errorMessage(e, "Fakturu se nepodařilo smazat."));
    } finally {
      setBusy(false);
    }
  }

  function requestDelete(id: string, label: string) {
    setConfirmState({
      title: "Smazat fakturu",
      message: `Opravdu chcete smazat fakturu ${label || "bez čísla"}? Tato akce je nevratná. Faktura vystavená v Protelu tím nijak nezmizí – maže se pouze tento koncept.`,
      confirmLabel: "Smazat",
      danger: true,
      onConfirm: () => doDelete(id),
    });
  }

  /* ---------------------------------------------------------------- */
  /* Live summary                                                      */
  /* ---------------------------------------------------------------- */

  const totals = useMemo(
    () => computeTotals(draft?.lines ?? [], config.vatRates),
    [draft, config.vatRates]
  );

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  const agencyOptions = useMemo(() => {
    const keep = draft && draft.billTo.kind === "agency" ? draft.billTo.agencyId : null;
    return activeFirst(config.agencies, keep, (a) => a.id).sort((a, b) => byCs(a.name, b.name));
  }, [config.agencies, draft]);

  const hotelOptions = useMemo(
    () =>
      activeFirst(config.hotels, draft?.hotelId ?? null, (h) => h.id).sort((a, b) =>
        byCs(a.name, b.name)
      ),
    [config.hotels, draft]
  );

  const itemOptions = useMemo(
    () => config.items.filter((i) => i.active).sort((a, b) => byCs(a.description, b.description)),
    [config.items]
  );

  const vatOptions = useMemo(
    () => config.vatRates.filter((v) => v.active).sort((a, b) => byCs(a.label, b.label)),
    [config.vatRates]
  );

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Faktury</h1>
          {!draft && (
            <Button variant="primary" data-tour="faktury-new" onClick={startNew} disabled={loading}>
              + Nová faktura
            </Button>
          )}
        </div>
        <div className={styles.headerActions}>
          {saveMsg && <span className={styles.saveMsg}>{saveMsg}</span>}
          {canManage && (
            <Button
              variant="secondary"
              data-tour="faktury-ciselniky"
              onClick={() => setConfigOpen(true)}
            >
              Číselníky
            </Button>
          )}
          {draft && (
            <>
              <Button variant="ghost" onClick={requestCloseEditor} disabled={busy}>
                Zpět na seznam
              </Button>
              <Button variant="secondary" onClick={handlePrint} disabled={busy}>
                Vytisknout
              </Button>
              {draftId && (
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() => requestDelete(draftId, draft.invoiceNo)}
                >
                  Smazat
                </Button>
              )}
              <Button variant="primary" onClick={handleSave} disabled={busy}>
                {busy ? "Ukládám…" : "Uložit"}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className={styles.body}>
        {loading ? (
          <p className={styles.muted}>Načítám…</p>
        ) : !draft ? (
          <InvoiceList
            invoices={invoices}
            hotelName={hotelName}
            busy={busy}
            onOpen={openInvoice}
            onDelete={requestDelete}
          />
        ) : (
          <div className={styles.editor}>
            {/* ── Hlavička faktury ───────────────────────────────────── */}
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>Faktura</h2>
              <div className={styles.grid}>
                <label className={styles.field}>
                  <span>Číslo faktury</span>
                  <input
                    className={`${styles.input} ${
                      showErrors && !draft.invoiceNo.trim() ? styles.inputError : ""
                    }`}
                    value={draft.invoiceNo}
                    onChange={(e) => setInvoiceNo(e.target.value)}
                    placeholder="např. 264505337"
                  />
                </label>
                <label className={styles.field}>
                  <span>Hotel</span>
                  <select
                    className={`${styles.input} ${
                      showErrors && !draft.hotelId ? styles.inputError : ""
                    }`}
                    value={draft.hotelId}
                    onChange={(e) => {
                      manualHotelRef.current = true;
                      patchDraft({ hotelId: e.target.value });
                    }}
                  >
                    <option value="">– vyberte –</option>
                    {hotelOptions.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={`${styles.field} ${styles.fieldCheck}`}>
                  <input
                    type="checkbox"
                    checked={draft.deposit}
                    onChange={(e) => {
                      manualHotelRef.current = true;
                      patchDraft({ deposit: e.target.checked });
                    }}
                  />
                  <span>Zálohová faktura</span>
                </label>
              </div>
              {/* A quiet hint, never a validation error: the number is typed in
                  digit by digit and only decodes once it is long enough. */}
              {draft.invoiceNo.trim().length >= 4 && (
                <p className={styles.hint}>
                  {decoded
                    ? `Rozpoznáno: ${decoded.hotel.name}, ${
                        decoded.deposit ? "zálohová faktura" : "běžná faktura"
                      }.`
                    : "Z čísla se nepodařilo rozpoznat hotel – vyberte jej ručně."}
                </p>
              )}
              <label className={`${styles.field} ${styles.noteField}`}>
                <span>Poznámka (nepovinné)</span>
                <input
                  className={styles.input}
                  value={draft.note}
                  onChange={(e) => patchDraft({ note: e.target.value })}
                />
              </label>
              <p className={styles.hint}>Poznámka bude zobrazena pod číslem faktury.</p>
            </section>

            {/* ── Host ───────────────────────────────────────────────── */}
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>Host</h2>
              <div className={styles.grid}>
                <label className={styles.field}>
                  <span>Jméno hosta</span>
                  <input
                    className={styles.input}
                    value={draft.guestName}
                    onChange={(e) => patchDraft({ guestName: e.target.value })}
                  />
                </label>
                <label className={styles.field}>
                  <span>Pokoj</span>
                  <input
                    className={styles.input}
                    value={draft.roomNo}
                    onChange={(e) => patchDraft({ roomNo: e.target.value })}
                  />
                </label>
                <label className={styles.field}>
                  <span>Příjezd</span>
                  <input
                    type="date"
                    className={styles.input}
                    value={draft.arrival}
                    onChange={(e) => setArrival(e.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  <span>Odjezd</span>
                  <input
                    type="date"
                    className={styles.input}
                    value={draft.departure}
                    onChange={(e) => patchDraft({ departure: e.target.value })}
                  />
                </label>
                <label className={styles.field}>
                  <span>Číslo rezervace v Protelu</span>
                  <input
                    className={styles.input}
                    value={draft.reservationNo}
                    onChange={(e) => patchDraft({ reservationNo: e.target.value })}
                  />
                </label>
                <label className={styles.field}>
                  <span>Číslo v AvailPro (nepovinné)</span>
                  <input
                    className={styles.input}
                    value={draft.availProNo}
                    onChange={(e) => patchDraft({ availProNo: e.target.value })}
                  />
                </label>
                <label className={styles.field}>
                  <span>Číslo rezervace partnera</span>
                  <input
                    className={styles.input}
                    value={draft.partnerResNo}
                    onChange={(e) => patchDraft({ partnerResNo: e.target.value })}
                  />
                </label>
                <label className={styles.field}>
                  <span>Vystaveno</span>
                  <input
                    type="datetime-local"
                    className={styles.input}
                    value={draft.issuedAt}
                    onChange={(e) => patchDraft({ issuedAt: e.target.value })}
                  />
                </label>
                {/* Derived, never stored: the tax point is the issue date and
                    payment is due seven days later. Read-only text rather than a
                    disabled input – there is nothing here to interact with. */}
                <div className={styles.field}>
                  <span>Datum zdanitelného plnění</span>
                  <div className={styles.readonlyValue}>
                    {formatDateCZ(taxDateFrom(draft.issuedAt)) || "–"}
                  </div>
                </div>
                <div className={styles.field}>
                  <span>Datum splatnosti</span>
                  <div className={styles.readonlyValue}>
                    {formatDateCZ(dueDateFrom(draft.issuedAt)) || "–"}
                  </div>
                </div>
                <label className={styles.field}>
                  <span>Vystavil</span>
                  <input
                    className={styles.input}
                    value={draft.issuedBy}
                    onChange={(e) => patchDraft({ issuedBy: e.target.value })}
                  />
                </label>
              </div>
              <p className={styles.hint}>
                Datum zdanitelného plnění a datum splatnosti se doplňují automaticky podle data
                vystavení (splatnost je o 7 dní později).
              </p>
            </section>

            {/* ── Odběratel ──────────────────────────────────────────── */}
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>Odběratel</h2>
              <div className={styles.radioRow}>
                <label className={styles.radio}>
                  <input
                    type="radio"
                    name="billToKind"
                    checked={draft.billTo.kind === "agency"}
                    onChange={() => setBillKind("agency")}
                  />
                  <span>Cestovní kancelář</span>
                </label>
                <label className={styles.radio}>
                  <input
                    type="radio"
                    name="billToKind"
                    checked={draft.billTo.kind === "person"}
                    onChange={() => setBillKind("person")}
                  />
                  <span>Soukromá osoba</span>
                </label>
              </div>

              {draft.billTo.kind === "agency" ? (
                <>
                  <label className={styles.field}>
                    <span>Cestovní kancelář</span>
                    <select
                      className={`${styles.input} ${
                        showErrors && !draft.billTo.agencyId ? styles.inputError : ""
                      }`}
                      value={draft.billTo.agencyId}
                      onChange={(e) =>
                        patchDraft({ billTo: { kind: "agency", agencyId: e.target.value } })
                      }
                    >
                      <option value="">– vyberte –</option>
                      {agencyOptions.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedAgency && (
                    <div className={styles.readonlyAddress}>
                      <strong>{selectedAgency.name}</strong>
                      {addressLines(selectedAgency).map((l, i) => (
                        <div key={i}>{l}</div>
                      ))}
                      {(selectedAgency.ic || selectedAgency.dic) && (
                        <div className={styles.muted}>
                          {selectedAgency.ic && `IČ: ${selectedAgency.ic}`}
                          {selectedAgency.ic && selectedAgency.dic && "  "}
                          {selectedAgency.dic && `DIČ: ${selectedAgency.dic}`}
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className={styles.grid}>
                  <label className={styles.field}>
                    <span>Jméno</span>
                    <input
                      className={`${styles.input} ${
                        showErrors && !draft.billTo.name.trim() ? styles.inputError : ""
                      }`}
                      value={draft.billTo.name}
                      onChange={(e) => patchPerson({ name: e.target.value })}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Ulice</span>
                    <input
                      className={styles.input}
                      value={draft.billTo.street1}
                      onChange={(e) => patchPerson({ street1: e.target.value })}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Ulice 2</span>
                    <input
                      className={styles.input}
                      value={draft.billTo.street2}
                      onChange={(e) => patchPerson({ street2: e.target.value })}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Ulice 3</span>
                    <input
                      className={styles.input}
                      value={draft.billTo.street3}
                      onChange={(e) => patchPerson({ street3: e.target.value })}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>PSČ</span>
                    <input
                      className={styles.input}
                      value={draft.billTo.zip}
                      onChange={(e) => patchPerson({ zip: e.target.value })}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Město</span>
                    <input
                      className={styles.input}
                      value={draft.billTo.city}
                      onChange={(e) => patchPerson({ city: e.target.value })}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Země</span>
                    <input
                      className={styles.input}
                      value={draft.billTo.country}
                      onChange={(e) => patchPerson({ country: e.target.value })}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>IČ</span>
                    <input
                      className={styles.input}
                      value={draft.billTo.ic}
                      onChange={(e) => patchPerson({ ic: e.target.value })}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>DIČ</span>
                    <input
                      className={styles.input}
                      value={draft.billTo.dic}
                      onChange={(e) => patchPerson({ dic: e.target.value })}
                    />
                  </label>
                </div>
              )}
            </section>

            {/* ── Položky ────────────────────────────────────────────── */}
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>Položky</h2>
              <div className={styles.tableScroll}>
                <table className={styles.linesTable}>
                  <thead>
                    <tr>
                      <th>Datum</th>
                      <th>Počet</th>
                      <th>Popis</th>
                      <th>Detail</th>
                      <th>Cena/jedn.</th>
                      <th>Typ</th>
                      <th>Sazba DPH</th>
                      <th className={styles.numCol}>Součet</th>
                      <th aria-label="Akce" />
                    </tr>
                  </thead>
                  <tbody>
                    {draft.lines.length === 0 && (
                      <tr>
                        <td colSpan={9} className={styles.muted}>
                          Faktura zatím nemá žádný řádek.
                        </td>
                      </tr>
                    )}
                    {draft.lines.map((line, idx) => {
                      const isCustom = customLines[line.id] === true;
                      const catalogValue = isCustom
                        ? "__custom__"
                        : config.items.find((it) => it.description === line.description)?.id ?? "";
                      const vatMissing = showErrors && line.group === "item" && !line.vatRateId;
                      return (
                        <tr key={line.id}>
                          <td>
                            <input
                              type="date"
                              className={styles.cellInput}
                              value={line.date}
                              onChange={(e) => patchLine(line.id, { date: e.target.value })}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              step="any"
                              className={`${styles.cellInput} ${styles.cellNum}`}
                              value={line.units}
                              onChange={(e) =>
                                patchLine(line.id, { units: Number(e.target.value) || 0 })
                              }
                            />
                          </td>
                          <td className={styles.descCell}>
                            <select
                              className={styles.cellInput}
                              value={catalogValue}
                              onChange={(e) => pickCatalogItem(line, e.target.value)}
                            >
                              <option value="">– vyberte –</option>
                              {itemOptions.map((it) => (
                                <option key={it.id} value={it.id}>
                                  {it.description}
                                </option>
                              ))}
                              <option value="__custom__">Vlastní text…</option>
                            </select>
                            {isCustom && (
                              <input
                                className={`${styles.cellInput} ${
                                  showErrors && !line.description.trim() ? styles.inputError : ""
                                }`}
                                value={line.description}
                                placeholder="Vlastní popis"
                                onChange={(e) =>
                                  patchLine(line.id, { description: e.target.value })
                                }
                              />
                            )}
                          </td>
                          <td>
                            <input
                              className={styles.cellInput}
                              value={line.detail}
                              onChange={(e) => patchLine(line.id, { detail: e.target.value })}
                            />
                          </td>
                          <td>
                            {/* Deliberately a text field: a number input cannot
                                hold "-" or "1." while it is being typed, so a
                                negative payment could never be entered. */}
                            <input
                              type="text"
                              inputMode="decimal"
                              className={`${styles.cellInput} ${styles.cellNum}`}
                              value={priceText[line.id] ?? String(line.unitPrice)}
                              onChange={(e) => changePrice(line.id, e.target.value)}
                              onBlur={() => blurPrice(line.id)}
                            />
                          </td>
                          <td>
                            {/* A free-text line has no catalogue entry to inherit
                                from, so type and VAT are the user's to pick. */}
                            <select
                              className={`${styles.cellInput} ${
                                isCustom ? styles.cellRequired : ""
                              }`}
                              value={line.group}
                              onChange={(e) =>
                                patchLine(line.id, { group: e.target.value as LineGroup })
                              }
                            >
                              {LINE_GROUPS.map((g) => (
                                <option key={g} value={g}>
                                  {LINE_GROUP_LABELS[g]}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <select
                              className={`${styles.cellInput} ${
                                isCustom ? styles.cellRequired : ""
                              } ${vatMissing ? styles.inputError : ""}`}
                              value={line.vatRateId ?? ""}
                              onChange={(e) =>
                                patchLine(line.id, { vatRateId: e.target.value || null })
                              }
                            >
                              <option value="">– vyberte –</option>
                              {vatOptions.map((v) => (
                                <option key={v.id} value={v.id}>
                                  {v.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className={styles.numCol}>{formatMoney(lineTotal(line))}</td>
                          <td>
                            <div className={styles.rowActions}>
                              <button
                                type="button"
                                className={styles.rowIconBtn}
                                aria-label="Posunout nahoru"
                                title="Posunout nahoru"
                                disabled={idx === 0}
                                onClick={() => moveLine(line.id, -1)}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                className={styles.rowIconBtn}
                                aria-label="Posunout dolů"
                                title="Posunout dolů"
                                disabled={idx === draft.lines.length - 1}
                                onClick={() => moveLine(line.id, 1)}
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                className={`${styles.rowIconBtn} ${styles.rowIconDanger}`}
                                aria-label="Odebrat řádek"
                                title="Odebrat řádek"
                                onClick={() => removeLine(line.id)}
                              >
                                ✕
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className={styles.linesFooter}>
                <Button variant="secondary" size="sm" onClick={addLine}>
                  + Přidat řádek
                </Button>
              </div>
            </section>

            {/* ── Živý souhrn ────────────────────────────────────────── */}
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>Souhrn</h2>
              <label className={`${styles.field} ${styles.rateField}`}>
                <span>Kurz (CZK/EUR)</span>
                <input
                  type="number"
                  step="any"
                  className={styles.input}
                  value={draft.eurRate === 0 ? "" : draft.eurRate}
                  placeholder="0"
                  onChange={(e) => patchDraft({ eurRate: Number(e.target.value) || 0 })}
                />
              </label>

              <table className={styles.summaryTable}>
                <thead>
                  <tr>
                    <th />
                    <th className={styles.numCol}>CZK</th>
                    <th className={styles.numCol}>EUR</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Celkem</td>
                    <td className={styles.numCol}>{formatMoney(totals.total)}</td>
                    <td className={styles.numCol}>{toEur(totals.total, draft.eurRate)}</td>
                  </tr>
                  <tr>
                    <td>Uhrazeno</td>
                    <td className={styles.numCol}>{formatMoney(totals.payments)}</td>
                    <td className={styles.numCol}>{toEur(totals.payments, draft.eurRate)}</td>
                  </tr>
                  <tr className={styles.summaryStrong}>
                    <td>K úhradě</td>
                    <td className={styles.numCol}>{formatMoney(totals.open)}</td>
                    <td className={styles.numCol}>{toEur(totals.open, draft.eurRate)}</td>
                  </tr>
                </tbody>
              </table>

              <h3 className={styles.subTitle}>Rekapitulace DPH</h3>
              {totals.recap.length === 0 ? (
                <p className={styles.muted}>Zatím není co rekapitulovat.</p>
              ) : (
                <div className={styles.tableScroll}>
                  <table className={styles.summaryTable}>
                    <thead>
                      <tr>
                        <th>Sazba</th>
                        <th>Blok</th>
                        <th className={styles.numCol}>Základ</th>
                        <th className={styles.numCol}>DPH</th>
                        <th className={styles.numCol}>Celkem</th>
                        <th className={styles.numCol}>Celkem EUR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {totals.recap.map((r) => (
                        <tr key={r.rateId}>
                          <td>
                            {r.label} ({r.percent} %)
                          </td>
                          <td>{r.block === "advance" ? "Záloha" : "Běžná"}</td>
                          <td className={styles.numCol}>{formatMoney(r.base)}</td>
                          <td className={styles.numCol}>{formatMoney(r.vat)}</td>
                          <td className={styles.numCol}>{formatMoney(r.total)}</td>
                          <td className={styles.numCol}>{toEur(r.total, draft.eurRate)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className={styles.summaryStrong}>
                        <td colSpan={2}>Celkem</td>
                        <td className={styles.numCol}>{formatMoney(totals.recapBase)}</td>
                        <td className={styles.numCol}>{formatMoney(totals.recapVat)}</td>
                        <td className={styles.numCol}>{formatMoney(totals.recapTotal)}</td>
                        <td className={styles.numCol}>{toEur(totals.recapTotal, draft.eurRate)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      {configOpen && canManage && (
        <ConfigPanel
          config={config}
          onSaved={(next) => {
            setConfig(next);
            setConfigOpen(false);
          }}
          onClose={() => setConfigOpen(false)}
          onError={setErrorModal}
        />
      )}

      {errorModal && (
        <ConfirmModal
          title="Chyba"
          message={errorModal}
          confirmLabel="OK"
          showCancel={false}
          onConfirm={() => setErrorModal(null)}
          onCancel={() => setErrorModal(null)}
        />
      )}

      {confirmState && (
        <ConfirmModal
          title={confirmState.title}
          message={confirmState.message}
          confirmLabel={confirmState.confirmLabel}
          danger={confirmState.danger}
          tertiary={confirmState.tertiary}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Invoice list                                                        */
/* ------------------------------------------------------------------ */

function InvoiceList({
  invoices,
  hotelName,
  busy,
  onOpen,
  onDelete,
}: {
  invoices: InvoiceSummary[];
  hotelName: (id: string) => string;
  busy: boolean;
  onOpen: (id: string) => void;
  onDelete: (id: string, label: string) => void;
}) {
  if (invoices.length === 0) {
    return (
      <p className={styles.muted}>
        Zatím tu není žádná faktura. Novou vytvoříte tlačítkem + Nová faktura.
      </p>
    );
  }
  return (
    <div className={styles.tableScroll}>
      <table className={styles.listTable}>
        <thead>
          <tr>
            <th>Číslo faktury</th>
            <th>Hotel</th>
            <th>Host</th>
            <th>Odběratel</th>
            <th className={styles.numCol}>Celkem</th>
            <th>Poslední úprava</th>
            <th aria-label="Akce" />
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.id}>
              <td>
                <button type="button" className={styles.linkBtn} onClick={() => onOpen(inv.id)}>
                  {inv.invoiceNo || "(bez čísla)"}
                </button>
                {inv.deposit && <span className={styles.badge}>Záloha</span>}
              </td>
              <td>{hotelName(inv.hotelId)}</td>
              <td>{inv.guestName}</td>
              <td>{inv.billToName}</td>
              <td className={styles.numCol}>{formatMoney(inv.total)}</td>
              <td className={styles.muted}>
                {inv.updatedAt ? formatDateCZ(inv.updatedAt) : "–"}
                {inv.updatedBy ? ` · ${inv.updatedBy}` : ""}
              </td>
              <td>
                <div className={styles.rowActions}>
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => onOpen(inv.id)}>
                    Otevřít
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={busy}
                    onClick={() => onDelete(inv.id, inv.invoiceNo)}
                  >
                    Smazat
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Číselníky                                                           */
/* ------------------------------------------------------------------ */

const MAX_LOGO_CHARS = 150_000;
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];

function readFileAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Soubor se nepodařilo přečíst."));
    reader.readAsDataURL(file);
  });
}

/** Re-encode a data URI through a canvas at `maxWidth`. Returns null on failure. */
function downscaleDataUri(
  dataUri: string,
  maxWidth: number,
  mime: string,
  quality: number
): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / (img.naturalWidth || maxWidth));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round((img.naturalWidth || maxWidth) * scale));
      canvas.height = Math.max(1, Math.round((img.naturalHeight || maxWidth) * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      try {
        resolve(canvas.toDataURL(mime, quality));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUri;
  });
}

/**
 * A logo has to fit the ONE Firestore document the whole config lives in (1 MiB
 * ceiling, five hotels), so anything that stays over 150 000 characters after
 * two downscale attempts is refused outright rather than silently truncated.
 */
async function prepareLogo(file: File): Promise<{ ok: true; dataUri: string } | { ok: false; message: string }> {
  if (!LOGO_TYPES.includes(file.type)) {
    return { ok: false, message: "Logo musí být obrázek ve formátu PNG, JPEG nebo WEBP." };
  }
  const original = await readFileAsDataUri(file);
  if (original.length <= MAX_LOGO_CHARS) return { ok: true, dataUri: original };

  const attempts: { width: number; mime: string; quality: number }[] = [
    { width: 600, mime: "image/png", quality: 1 },
    { width: 500, mime: "image/jpeg", quality: 0.85 },
    { width: 360, mime: "image/jpeg", quality: 0.75 },
  ];
  for (const a of attempts) {
    const shrunk = await downscaleDataUri(original, a.width, a.mime, a.quality);
    if (shrunk && shrunk.length <= MAX_LOGO_CHARS) return { ok: true, dataUri: shrunk };
  }
  return {
    ok: false,
    message:
      "Logo je i po zmenšení příliš velké. Použijte prosím menší obrázek – ideálně PNG nebo JPEG o šířce do 600 bodů.",
  };
}

function emptyBank() {
  return { account: "", swift: "", iban: "" };
}

function ConfigPanel({
  config,
  onSaved,
  onClose,
  onError,
}: {
  config: FakturyConfig;
  onSaved: (next: FakturyConfig) => void;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  // Whole-array edit, then ONE PUT – the same shape as the taxi ceník editor.
  const [vatRates, setVatRates] = useState<VatRate[]>(config.vatRates);
  const [items, setItems] = useState<CatalogItem[]>(config.items);
  const [agencies, setAgencies] = useState<Agency[]>(config.agencies);
  const [hotels, setHotels] = useState<InvoiceHotel[]>(config.hotels);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<{ id: string; name: string }[]>("/companies")
      .then((list) => setCompanies([...list].sort((a, b) => byCs(a.name, b.name))))
      .catch(() => undefined);
  }, []);

  async function save() {
    setSaving(true);
    try {
      const payload: FakturyConfig = { vatRates, items, agencies, hotels };
      await api.put("/faktury/config", payload);
      onSaved(payload);
    } catch (e) {
      onError(errorMessage(e, "Číselníky se nepodařilo uložit."));
    } finally {
      setSaving(false);
    }
  }

  async function handleLogo(hotelId: string, file: File | undefined) {
    if (!file) return;
    const result = await prepareLogo(file);
    if (!result.ok) {
      onError(result.message);
      return;
    }
    setHotels((prev) =>
      prev.map((h) => (h.id === hotelId ? { ...h, logoDataUri: result.dataUri } : h))
    );
  }

  const vatSorted = useMemo(() => [...vatRates].sort((a, b) => byCs(a.label, b.label)), [vatRates]);

  /* The overlay deliberately has NO onClick – this panel holds half-edited
     číselníky and must close only through its own buttons. */
  return (
    <div className={styles.overlay}>
      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Číselníky faktur</h2>
          <IconButton variant="close" aria-label="Zavřít číselníky" onClick={onClose}>
            ✕
          </IconButton>
        </div>

        <div className={styles.panelBody}>
          {/* ── Sazby DPH ──────────────────────────────────────────── */}
          <section className={styles.card}>
            <h3 className={styles.cardTitle}>Sazby DPH</h3>
            <p className={styles.hint}>
              Sazba zařazená do bloku „Záloha" se v rekapitulaci DPH vykazuje zvlášť od běžných
              sazeb, jak vyžadují česká pravidla pro zálohové faktury.
            </p>
            <div className={styles.tableScroll}>
              <table className={styles.configTable}>
                <thead>
                  <tr>
                    <th>Popis</th>
                    <th>Procento</th>
                    <th>Blok</th>
                    <th>Aktivní</th>
                    <th aria-label="Akce" />
                  </tr>
                </thead>
                <tbody>
                  {vatRates.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <input
                          className={styles.cellInput}
                          value={r.label}
                          onChange={(e) =>
                            setVatRates((prev) =>
                              prev.map((x) => (x.id === r.id ? { ...x, label: e.target.value } : x))
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="any"
                          className={`${styles.cellInput} ${styles.cellNum}`}
                          value={r.percent}
                          onChange={(e) =>
                            setVatRates((prev) =>
                              prev.map((x) =>
                                x.id === r.id ? { ...x, percent: Number(e.target.value) || 0 } : x
                              )
                            )
                          }
                        />
                      </td>
                      <td>
                        <select
                          className={styles.cellInput}
                          value={r.block}
                          onChange={(e) =>
                            setVatRates((prev) =>
                              prev.map((x) =>
                                x.id === r.id
                                  ? { ...x, block: e.target.value as VatRate["block"] }
                                  : x
                              )
                            )
                          }
                        >
                          <option value="normal">Běžná</option>
                          <option value="advance">Záloha</option>
                        </select>
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={r.active}
                          aria-label="Aktivní"
                          onChange={(e) =>
                            setVatRates((prev) =>
                              prev.map((x) => (x.id === r.id ? { ...x, active: e.target.checked } : x))
                            )
                          }
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className={`${styles.rowIconBtn} ${styles.rowIconDanger}`}
                          aria-label="Odebrat sazbu"
                          onClick={() => setVatRates((prev) => prev.filter((x) => x.id !== r.id))}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setVatRates((prev) => [
                  ...prev,
                  { id: newLineId(), label: "", percent: 0, block: "normal", active: true },
                ])
              }
            >
              + Přidat sazbu
            </Button>
          </section>

          {/* ── Katalog položek ────────────────────────────────────── */}
          <section className={styles.card}>
            <h3 className={styles.cardTitle}>Katalog položek</h3>
            <p className={styles.hint}>
              Z tohoto seznamu vybírá rozbalovací nabídka v popisu řádku faktury. Vybraná položka
              zároveň doplní svou sazbu DPH a typ řádku.
            </p>
            <div className={styles.tableScroll}>
              <table className={styles.configTable}>
                <thead>
                  <tr>
                    <th>Popis</th>
                    <th>Sazba DPH</th>
                    <th>Typ</th>
                    <th>Aktivní</th>
                    <th aria-label="Akce" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id}>
                      <td>
                        <input
                          className={styles.cellInput}
                          value={it.description}
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((x) =>
                                x.id === it.id ? { ...x, description: e.target.value } : x
                              )
                            )
                          }
                        />
                      </td>
                      <td>
                        <select
                          className={styles.cellInput}
                          value={it.vatRateId ?? ""}
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((x) =>
                                x.id === it.id ? { ...x, vatRateId: e.target.value || null } : x
                              )
                            )
                          }
                        >
                          <option value="">– žádná –</option>
                          {vatSorted.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          className={styles.cellInput}
                          value={it.group}
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((x) =>
                                x.id === it.id ? { ...x, group: e.target.value as LineGroup } : x
                              )
                            )
                          }
                        >
                          {LINE_GROUPS.map((g) => (
                            <option key={g} value={g}>
                              {LINE_GROUP_LABELS[g]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={it.active}
                          aria-label="Aktivní"
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((x) => (x.id === it.id ? { ...x, active: e.target.checked } : x))
                            )
                          }
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className={`${styles.rowIconBtn} ${styles.rowIconDanger}`}
                          aria-label="Odebrat položku"
                          onClick={() => setItems((prev) => prev.filter((x) => x.id !== it.id))}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setItems((prev) => [
                  ...prev,
                  { id: newLineId(), description: "", vatRateId: null, group: "item", active: true },
                ])
              }
            >
              + Přidat položku
            </Button>
          </section>

          {/* ── Cestovní kanceláře ─────────────────────────────────── */}
          <section className={styles.card}>
            <h3 className={styles.cardTitle}>Cestovní kanceláře</h3>
            {agencies.map((a) => {
              const patch = (p: Partial<Agency>) =>
                setAgencies((prev) => prev.map((x) => (x.id === a.id ? { ...x, ...p } : x)));
              return (
                <div key={a.id} className={styles.subCard}>
                  <div className={styles.subCardHeader}>
                    <strong>{a.name || "Nová kancelář"}</strong>
                    <label className={styles.inlineCheck}>
                      <input
                        type="checkbox"
                        checked={a.active}
                        onChange={(e) => patch({ active: e.target.checked })}
                      />
                      <span>Aktivní</span>
                    </label>
                    <button
                      type="button"
                      className={`${styles.rowIconBtn} ${styles.rowIconDanger}`}
                      aria-label="Odebrat kancelář"
                      onClick={() => setAgencies((prev) => prev.filter((x) => x.id !== a.id))}
                    >
                      ✕
                    </button>
                  </div>
                  <div className={styles.grid}>
                    <label className={styles.field}>
                      <span>Název</span>
                      <input
                        className={styles.input}
                        value={a.name}
                        onChange={(e) => patch({ name: e.target.value })}
                      />
                    </label>
                    <label className={styles.field}>
                      <span>Ulice</span>
                      <input
                        className={styles.input}
                        value={a.street1}
                        onChange={(e) => patch({ street1: e.target.value })}
                      />
                    </label>
                    <label className={styles.field}>
                      <span>Ulice 2</span>
                      <input
                        className={styles.input}
                        value={a.street2}
                        onChange={(e) => patch({ street2: e.target.value })}
                      />
                    </label>
                    <label className={styles.field}>
                      <span>Ulice 3</span>
                      <input
                        className={styles.input}
                        value={a.street3}
                        onChange={(e) => patch({ street3: e.target.value })}
                      />
                    </label>
                    <label className={styles.field}>
                      <span>PSČ</span>
                      <input
                        className={styles.input}
                        value={a.zip}
                        onChange={(e) => patch({ zip: e.target.value })}
                      />
                    </label>
                    <label className={styles.field}>
                      <span>Město</span>
                      <input
                        className={styles.input}
                        value={a.city}
                        onChange={(e) => patch({ city: e.target.value })}
                      />
                    </label>
                    <label className={styles.field}>
                      <span>Země</span>
                      <input
                        className={styles.input}
                        value={a.country}
                        onChange={(e) => patch({ country: e.target.value })}
                      />
                    </label>
                    <label className={styles.field}>
                      <span>IČ</span>
                      <input
                        className={styles.input}
                        value={a.ic}
                        onChange={(e) => patch({ ic: e.target.value })}
                      />
                    </label>
                    <label className={styles.field}>
                      <span>DIČ</span>
                      <input
                        className={styles.input}
                        value={a.dic}
                        onChange={(e) => patch({ dic: e.target.value })}
                      />
                    </label>
                  </div>
                </div>
              );
            })}
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setAgencies((prev) => [
                  ...prev,
                  { id: newLineId(), name: "", active: true, ...EMPTY_ADDRESS },
                ])
              }
            >
              + Přidat kancelář
            </Button>
          </section>

          {/* ── Hotely ─────────────────────────────────────────────── */}
          <section className={styles.card}>
            <h3 className={styles.cardTitle}>Hotely</h3>
            <p className={styles.hint}>
              Číslo knihy a číslo knihy záloh rozhodují, který hotel se rozpozná z čísla faktury.
            </p>
            {hotels.map((h) => {
              const patch = (p: Partial<InvoiceHotel>) =>
                setHotels((prev) => prev.map((x) => (x.id === h.id ? { ...x, ...p } : x)));
              return (
                <div key={h.id} className={styles.subCard}>
                  <div className={styles.subCardHeader}>
                    <strong>{h.name || "Nový hotel"}</strong>
                    <label className={styles.inlineCheck}>
                      <input
                        type="checkbox"
                        checked={h.active}
                        onChange={(e) => patch({ active: e.target.checked })}
                      />
                      <span>Aktivní</span>
                    </label>
                    <button
                      type="button"
                      className={`${styles.rowIconBtn} ${styles.rowIconDanger}`}
                      aria-label="Odebrat hotel"
                      onClick={() => setHotels((prev) => prev.filter((x) => x.id !== h.id))}
                    >
                      ✕
                    </button>
                  </div>
                  <div className={styles.grid}>
                    <label className={styles.field}>
                      <span>Název</span>
                      <input
                        className={styles.input}
                        value={h.name}
                        onChange={(e) => patch({ name: e.target.value })}
                      />
                    </label>
                    <label className={styles.field}>
                      <span>Číslo knihy</span>
                      <input
                        type="number"
                        className={styles.input}
                        value={h.bookNo ?? ""}
                        onChange={(e) =>
                          patch({ bookNo: e.target.value === "" ? null : Number(e.target.value) })
                        }
                      />
                    </label>
                    <label className={styles.field}>
                      <span>Číslo knihy záloh</span>
                      <input
                        type="number"
                        className={styles.input}
                        value={h.depositBookNo ?? ""}
                        onChange={(e) =>
                          patch({
                            depositBookNo: e.target.value === "" ? null : Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label className={styles.field}>
                      <span>Firma</span>
                      <select
                        className={styles.input}
                        value={h.companyId ?? ""}
                        onChange={(e) => patch({ companyId: e.target.value || null })}
                      >
                        <option value="">– žádná –</option>
                        {companies.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={styles.field}>
                      <span>Banka</span>
                      <input
                        className={styles.input}
                        value={h.bankName}
                        onChange={(e) => patch({ bankName: e.target.value })}
                      />
                    </label>
                  </div>

                  <div className={styles.logoRow}>
                    <div>
                      <span className={styles.fieldLabel}>Logo</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className={styles.fileInput}
                        onChange={(e) => {
                          handleLogo(h.id, e.target.files?.[0]);
                          e.target.value = "";
                        }}
                      />
                      <p className={styles.hint}>PNG, JPEG nebo WEBP. Velké obrázky se zmenší.</p>
                    </div>
                    {h.logoDataUri && (
                      <div className={styles.logoPreview}>
                        <img src={h.logoDataUri} alt={`Logo – ${h.name}`} />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => patch({ logoDataUri: "" })}
                        >
                          Odebrat logo
                        </Button>
                      </div>
                    )}
                  </div>

                  <label className={styles.field}>
                    <span>Patička</span>
                    <textarea
                      className={styles.textarea}
                      rows={3}
                      value={h.footer}
                      onChange={(e) => patch({ footer: e.target.value })}
                    />
                  </label>

                  <div className={styles.bankGrid}>
                    <BankFields
                      title="Účet EUR"
                      block={h.bankEur}
                      onChange={(b) => patch({ bankEur: b })}
                    />
                    <BankFields
                      title="Účet CZK"
                      block={h.bankCzk}
                      onChange={(b) => patch({ bankCzk: b })}
                    />
                  </div>
                </div>
              );
            })}
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setHotels((prev) => [
                  ...prev,
                  {
                    id: newLineId(),
                    name: "",
                    bookNo: null,
                    depositBookNo: null,
                    companyId: null,
                    logoDataUri: "",
                    footer: "",
                    bankName: "",
                    bankEur: emptyBank(),
                    bankCzk: emptyBank(),
                    active: true,
                  },
                ])
              }
            >
              + Přidat hotel
            </Button>
          </section>
        </div>

        <div className={styles.panelFooter}>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Zrušit
          </Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? "Ukládám…" : "Uložit číselníky"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function BankFields({
  title,
  block,
  onChange,
}: {
  title: string;
  block: InvoiceHotel["bankEur"];
  onChange: (next: InvoiceHotel["bankEur"]) => void;
}) {
  return (
    <div>
      <span className={styles.fieldLabel}>{title}</span>
      <label className={styles.field}>
        <span>Číslo účtu</span>
        <input
          className={styles.input}
          value={block.account}
          onChange={(e) => onChange({ ...block, account: e.target.value })}
        />
      </label>
      <label className={styles.field}>
        <span>SWIFT</span>
        <input
          className={styles.input}
          value={block.swift}
          onChange={(e) => onChange({ ...block, swift: e.target.value })}
        />
      </label>
      <label className={styles.field}>
        <span>IBAN</span>
        <input
          className={styles.input}
          value={block.iban}
          onChange={(e) => onChange({ ...block, iban: e.target.value })}
        />
      </label>
    </div>
  );
}
