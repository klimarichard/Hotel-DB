import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import Button from "@/components/Button";
import ConfirmModal from "@/components/ConfirmModal";
import type { Hotel } from "@/lib/hotels";
import styles from "./HandoverTab.module.css";

type ShiftType = "den" | "noc";
type DrawerKey = "kasaCZK" | "trezorCZK" | "kasaEUR" | "trezorEUR";

const CZK_DENOMS = ["5000", "2000", "1000", "500", "200", "100", "50", "20", "10", "5", "2", "1"] as const;
const EUR_DENOMS = ["500", "200", "100", "50", "20", "10", "5", "2", "1"] as const;

const AUTOSAVE_DELAY_MS = 800;

// firebase-admin's Timestamp serialises over the wire as { _seconds } (private
// field), not { seconds }. Tolerate both shapes.
type TimestampLike =
  | { seconds: number; nanoseconds?: number }
  | { _seconds: number; _nanoseconds?: number };

interface NoteItem {
  text: string;
  done: boolean;
}

interface Account {
  name: string;
  amount: number;
}

interface Handover {
  id: string;
  shiftDate: string;
  shiftType: ShiftType;
  notes?: NoteItem[] | null;
  cashCounts?: Partial<Record<DrawerKey, Record<string, number>>>;
  accounts?: Account[];
  updatedBy?: string;
  updatedAt?: TimestampLike | null;
}

type Payload = {
  notes: NoteItem[];
  cashCounts: Record<DrawerKey, Record<string, number>>;
  accounts: Account[];
};

const SHIFT_LABELS: Record<ShiftType, string> = { den: "Den", noc: "Noc" };

const DRAWER_LABELS: Record<DrawerKey, string> = {
  kasaCZK: "KASA CZK",
  trezorCZK: "TREZOR CZK",
  kasaEUR: "KASA €",
  trezorEUR: "TREZOR €",
};

const DRAWER_ORDER: DrawerKey[] = ["kasaCZK", "trezorCZK", "kasaEUR", "trezorEUR"];

function isCzkDrawer(key: DrawerKey): boolean {
  return key === "kasaCZK" || key === "trezorCZK";
}

function todayLocal(): string {
  return new Intl.DateTimeFormat("sv-SE").format(new Date());
}

function defaultShiftForNow(): ShiftType {
  const h = new Date().getHours();
  return h >= 7 && h < 19 ? "den" : "noc";
}

function previousShift(date: string, shift: ShiftType): { date: string; shift: ShiftType } {
  if (shift === "noc") return { date, shift: "den" };
  const [y, m, d] = date.split("-").map(Number);
  const prev = new Date(y, m - 1, d);
  prev.setDate(prev.getDate() - 1);
  return { date: fmtDate(prev), shift: "noc" };
}

function nextShift(date: string, shift: ShiftType): { date: string; shift: ShiftType } {
  if (shift === "den") return { date, shift: "noc" };
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(y, m - 1, d);
  next.setDate(next.getDate() + 1);
  return { date: fmtDate(next), shift: "den" };
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function timestampSeconds(ts: TimestampLike | null | undefined): number | null {
  if (!ts) return null;
  const a = ts as { seconds?: unknown };
  if (typeof a.seconds === "number") return a.seconds;
  const b = ts as { _seconds?: unknown };
  if (typeof b._seconds === "number") return b._seconds;
  return null;
}

function formatTimeOnly(ts: TimestampLike | null | undefined): string {
  const s = timestampSeconds(ts);
  if (s === null) return "";
  return new Date(s * 1000).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
}

function emptyCashCounts(): Record<DrawerKey, Record<string, number>> {
  return { kasaCZK: {}, trezorCZK: {}, kasaEUR: {}, trezorEUR: {} };
}

function drawerSubtotal(counts: Record<string, number>): number {
  let total = 0;
  for (const [denom, n] of Object.entries(counts)) total += Number(denom) * (n || 0);
  return total;
}

function coerceNotes(raw: unknown): NoteItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((n): n is { text: unknown; done?: unknown } => !!n && typeof n === "object")
    .filter((n) => typeof n.text === "string")
    .map((n) => ({ text: n.text as string, done: n.done === true }));
}

/** The exact shape sent to the server (and echoed back) — empty-named účty rows
 *  are dropped so they never trip the dirty check into an autosave loop. */
function toPayload(notes: NoteItem[], cashCounts: Record<DrawerKey, Record<string, number>>, accounts: Account[]): Payload {
  return {
    notes: notes.map((n) => ({ text: n.text, done: n.done })),
    cashCounts,
    accounts: accounts
      .filter((a) => a.name.trim() !== "")
      .map((a) => ({ name: a.name.trim(), amount: Math.round(a.amount) || 0 })),
  };
}

function payloadFromDoc(h: Handover | null): Payload {
  return toPayload(
    coerceNotes(h?.notes),
    {
      kasaCZK: h?.cashCounts?.kasaCZK ?? {},
      trezorCZK: h?.cashCounts?.trezorCZK ?? {},
      kasaEUR: h?.cashCounts?.kasaEUR ?? {},
      trezorEUR: h?.cashCounts?.trezorEUR ?? {},
    },
    h?.accounts ?? []
  );
}

// ── Inline row-action icons (feather-style) ──────────────────────────────────
function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6" />
    </svg>
  );
}

function EditActionButton({ editing, ariaLabel, onClick }: { editing: boolean; ariaLabel: string; onClick: () => void }) {
  return (
    <button type="button" className={styles.rowIconBtn} aria-label={ariaLabel} onClick={onClick}>
      {editing ? <CheckIcon /> : <PencilIcon />}
    </button>
  );
}
function TrashActionButton({ ariaLabel, onClick }: { ariaLabel: string; onClick: () => void }) {
  return (
    <button type="button" className={`${styles.rowIconBtn} ${styles.rowIconBtnTrash}`} aria-label={ariaLabel} onClick={onClick}>
      <TrashIcon />
    </button>
  );
}

interface ConfirmState {
  title: string;
  message: string;
  danger?: boolean;
  showCancel?: boolean;
  confirmLabel?: string;
  onConfirm: () => void;
}

export default function HandoverTab({ hotel }: { hotel: Hotel }) {
  const { can } = useAuth();
  const canDelete = can(hotel.protokolDeletePerm);

  const [shiftDate, setShiftDate] = useState<string>(todayLocal());
  const [shiftType, setShiftType] = useState<ShiftType>(defaultShiftForNow());

  const [loaded, setLoaded] = useState<Handover | null>(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [cashCounts, setCashCounts] = useState<Record<DrawerKey, Record<string, number>>>(emptyCashCounts());
  const [accounts, setAccounts] = useState<Account[]>([]);

  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editingNoteIdx, setEditingNoteIdx] = useState<number | null>(null);

  const [autosaving, setAutosaving] = useState(false);
  const [autosaveError, setAutosaveError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const savedPayloadRef = useRef<string>(JSON.stringify(payloadFromDoc(null)));
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingRef = useRef(false);

  const docId = `${shiftDate}_${shiftType}`;

  // ── Load on (hotel, date, shift) change ────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEditingIdx(null);
    setEditingNoteIdx(null);
    const id = `${shiftDate}_${shiftType}`;

    void (async () => {
      try {
        const data = await api.get<Handover>(`/handovers/${hotel.slug}/${id}`);
        if (cancelled) return;
        applyDoc(data);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          applyDoc(null);
        } else {
          applyDoc(null);
          setAutosaveError(err instanceof Error ? err.message : "Nepodařilo se načíst protokol.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotel.slug, shiftDate, shiftType]);

  /** Seed local state + the saved-baseline from a loaded doc (or empty). */
  function applyDoc(data: Handover | null) {
    const n = coerceNotes(data?.notes);
    const cc = {
      kasaCZK: data?.cashCounts?.kasaCZK ?? {},
      trezorCZK: data?.cashCounts?.trezorCZK ?? {},
      kasaEUR: data?.cashCounts?.kasaEUR ?? {},
      trezorEUR: data?.cashCounts?.trezorEUR ?? {},
    };
    const acc = data?.accounts ?? [];
    setLoaded(data);
    setNotes(n);
    setCashCounts(cc);
    setAccounts(acc);
    savedPayloadRef.current = JSON.stringify(toPayload(n, cc, acc));
    setAutosaveError(null);
  }

  const currentPayload = useMemo(
    () => toPayload(notes, cashCounts, accounts),
    [notes, cashCounts, accounts]
  );
  const dirty = JSON.stringify(currentPayload) !== savedPayloadRef.current;

  // ── Debounced autosave (creates the doc on first edit) ─────────────────────
  useEffect(() => {
    if (loading) return;
    if (!dirty) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => void performAutoSave(), AUTOSAVE_DELAY_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, cashCounts, accounts, loading, dirty, shiftDate, shiftType, hotel.slug]);

  async function performAutoSave() {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    setAutosaving(true);
    const payload = toPayload(notes, cashCounts, accounts);
    try {
      const saved = await api.put<Handover>(`/handovers/${hotel.slug}`, {
        shiftDate,
        shiftType,
        ...payload,
      });
      setLoaded(saved);
      savedPayloadRef.current = JSON.stringify(payload);
      setAutosaveError(null);
    } catch (err) {
      setAutosaveError(err instanceof Error ? err.message : "Chyba ukládání.");
    } finally {
      isSavingRef.current = false;
      setAutosaving(false);
    }
  }

  // ── Cash handlers ──────────────────────────────────────────────────────────
  function setDenomCount(drawer: DrawerKey, denom: string, n: number) {
    setCashCounts((prev) => {
      const next = { ...prev[drawer] };
      if (!Number.isFinite(n) || n <= 0) delete next[denom];
      else next[denom] = Math.floor(n);
      return { ...prev, [drawer]: next };
    });
  }

  const drawerTotals = useMemo(
    () => ({
      kasaCZK: drawerSubtotal(cashCounts.kasaCZK),
      trezorCZK: drawerSubtotal(cashCounts.trezorCZK),
      kasaEUR: drawerSubtotal(cashCounts.kasaEUR),
      trezorEUR: drawerSubtotal(cashCounts.trezorEUR),
    }),
    [cashCounts]
  );
  const accountsTotal = useMemo(() => accounts.reduce((s, a) => s + (a.amount || 0), 0), [accounts]);
  const totalCZK = drawerTotals.kasaCZK + drawerTotals.trezorCZK + accountsTotal;
  const totalEUR = drawerTotals.kasaEUR + drawerTotals.trezorEUR;

  // ── Účty handlers ──────────────────────────────────────────────────────────
  function addAccountRow() {
    setAccounts((prev) => [...prev, { name: "", amount: 0 }]);
    setEditingIdx(accounts.length);
  }
  function setAccountName(idx: number, name: string) {
    setAccounts((prev) => prev.map((a, i) => (i === idx ? { ...a, name } : a)));
  }
  function setAccountAmount(idx: number, amount: number) {
    setAccounts((prev) => prev.map((a, i) => (i === idx ? { ...a, amount: Number.isFinite(amount) ? amount : 0 } : a)));
  }
  function removeAccount(idx: number) {
    setAccounts((prev) => prev.filter((_, i) => i !== idx));
    setEditingIdx(null);
  }
  function requestDeleteAccount(idx: number) {
    const acc = accounts[idx];
    if (!acc || (acc.name.trim() === "" && !acc.amount)) {
      removeAccount(idx);
      return;
    }
    setConfirm({
      title: "Odstranit účet?",
      message: `Opravdu chcete odstranit účet „${acc.name || "(bez názvu)"}"?`,
      danger: true,
      onConfirm: () => {
        removeAccount(idx);
        setConfirm(null);
      },
    });
  }

  // ── Notes handlers ─────────────────────────────────────────────────────────
  function addNote() {
    setNotes((prev) => [...prev, { text: "", done: false }]);
    setEditingNoteIdx(notes.length);
  }
  function setNoteText(idx: number, text: string) {
    setNotes((prev) => prev.map((n, i) => (i === idx ? { ...n, text } : n)));
  }
  function setNoteDone(idx: number, done: boolean) {
    setNotes((prev) => prev.map((n, i) => (i === idx ? { ...n, done } : n)));
  }
  function removeNote(idx: number) {
    setNotes((prev) => prev.filter((_, i) => i !== idx));
    setEditingNoteIdx(null);
  }
  function requestDeleteNote(idx: number) {
    const n = notes[idx];
    if (!n || n.text.trim() === "") {
      removeNote(idx);
      return;
    }
    setConfirm({
      title: "Odstranit poznámku?",
      message: "Opravdu chcete odstranit tuto poznámku?",
      danger: true,
      onConfirm: () => {
        removeNote(idx);
        setConfirm(null);
      },
    });
  }

  // ── Delete the whole protocol ──────────────────────────────────────────────
  function requestDeleteProtocol() {
    setConfirm({
      title: "Smazat protokol?",
      message: "Opravdu chcete smazat celý předávací protokol pro tuto směnu? Tuto akci nelze vrátit.",
      danger: true,
      confirmLabel: "Smazat",
      onConfirm: () => void deleteProtocol(),
    });
  }
  async function deleteProtocol() {
    try {
      await api.delete<{ ok: true }>(`/handovers/${hotel.slug}/${docId}`);
      applyDoc(null);
      setConfirm(null);
    } catch (err) {
      setConfirm({
        title: "Chyba",
        message: err instanceof Error ? err.message : "Protokol se nepodařilo smazat.",
        showCancel: false,
        confirmLabel: "OK",
        onConfirm: () => setConfirm(null),
      });
    }
  }

  const statusText = autosaveError
    ? autosaveError
    : autosaving
      ? "Ukládám…"
      : dirty
        ? "Neuloženo"
        : loaded
          ? `Uloženo ${formatTimeOnly(loaded.updatedAt)}`
          : "Pro tuto směnu zatím není žádný záznam.";

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft} />
        <div className={styles.toolbarCenter}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              const p = previousShift(shiftDate, shiftType);
              setShiftDate(p.date);
              setShiftType(p.shift);
            }}
            title="Předchozí směna"
          >
            ← Předchozí
          </Button>
          <span className={styles.toolbarLabel}>Datum</span>
          <input
            type="date"
            className={styles.dateInput}
            value={shiftDate}
            onChange={(e) => setShiftDate(e.target.value)}
          />
          <span className={styles.toolbarLabel}>Směna</span>
          <div className={styles.shiftGroup}>
            {(Object.keys(SHIFT_LABELS) as ShiftType[]).map((s) => (
              <button
                key={s}
                type="button"
                className={shiftType === s ? styles.shiftBtnActive : styles.shiftBtn}
                onClick={() => setShiftType(s)}
              >
                {SHIFT_LABELS[s]}
              </button>
            ))}
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              const n = nextShift(shiftDate, shiftType);
              setShiftDate(n.date);
              setShiftType(n.shift);
            }}
            title="Následující směna"
          >
            Následující →
          </Button>
        </div>

        <div className={styles.toolbarRight}>
          {loaded && canDelete && (
            <Button variant="danger" size="sm" onClick={requestDeleteProtocol}>
              Smazat protokol
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className={styles.placeholder}>Načítám…</div>
      ) : (
        <>
          <div className={styles.protocolGrid}>
            <div className={styles.cashLayout}>
              {DRAWER_ORDER.map((drawer) => {
                const denoms = isCzkDrawer(drawer) ? CZK_DENOMS : EUR_DENOMS;
                const symbol = isCzkDrawer(drawer) ? "Kč" : "€";
                return (
                  <div key={drawer} className={`${styles.cashTable} ${styles[drawer]}`}>
                    <div className={styles.cashTableHead}>{DRAWER_LABELS[drawer]}</div>
                    <div className={styles.cashRowHeader}>
                      <span>Nominál</span>
                      <span>KS</span>
                      <span>Mezisoučet</span>
                    </div>
                    {denoms.map((d, i) => {
                      const ks = cashCounts[drawer][d] ?? 0;
                      const subtotal = Number(d) * ks;
                      return (
                        <div key={d} className={`${styles.cashRow} ${i % 2 === 1 ? styles.cashRowAlt : ""}`}>
                          <span className={styles.denom}>
                            {d} {symbol}
                          </span>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            className={styles.cashInput}
                            value={ks === 0 ? "" : ks}
                            onChange={(e) => setDenomCount(drawer, d, Number(e.target.value))}
                            placeholder="0"
                            disabled={loading}
                          />
                          <span className={styles.subtotal}>
                            {subtotal.toLocaleString("cs-CZ")} {symbol}
                          </span>
                        </div>
                      );
                    })}
                    <div className={styles.cashTotal}>
                      CELKEM&nbsp;{drawerTotals[drawer].toLocaleString("cs-CZ")} {symbol}
                    </div>
                  </div>
                );
              })}

              <div className={styles.summary}>
                <div className={styles.summaryGroup}>
                  <div className={styles.summaryRow}>
                    <span>KASA</span>
                    <strong>{drawerTotals.kasaCZK.toLocaleString("cs-CZ")} Kč</strong>
                  </div>
                  <div className={styles.summaryRow}>
                    <span>TREZOR</span>
                    <strong>{drawerTotals.trezorCZK.toLocaleString("cs-CZ")} Kč</strong>
                  </div>
                  <div className={styles.summaryRow}>
                    <span>ÚČTY</span>
                    <strong>{accountsTotal.toLocaleString("cs-CZ")} Kč</strong>
                  </div>
                  <div className={styles.summaryRowTotal}>
                    <span>TOTAL CZK</span>
                    <strong>{totalCZK.toLocaleString("cs-CZ")} Kč</strong>
                  </div>
                </div>
                <div className={styles.summaryGroup}>
                  <div className={styles.summaryRow}>
                    <span>KASA €</span>
                    <strong>{drawerTotals.kasaEUR.toLocaleString("cs-CZ")} €</strong>
                  </div>
                  <div className={styles.summaryRow}>
                    <span>TREZOR €</span>
                    <strong>{drawerTotals.trezorEUR.toLocaleString("cs-CZ")} €</strong>
                  </div>
                  <div className={styles.summaryRowTotal}>
                    <span>TOTAL €</span>
                    <strong>{totalEUR.toLocaleString("cs-CZ")} €</strong>
                  </div>
                </div>
              </div>

              <div className={styles.accountsContainer}>
                <div className={styles.accountsContainerHeader}>
                  <h3 className={styles.accountsTitle}>Účty</h3>
                  <Button variant="primary" size="sm" onClick={addAccountRow}>
                    + Přidat účet
                  </Button>
                </div>
                <div className={styles.accountsList}>
                  {accounts.length === 0 && <div className={styles.accountsEmpty}>Žádné účty.</div>}
                  {accounts.map((acc, idx) => {
                    const isEditing = editingIdx === idx;
                    const altRow = idx % 2 === 1;
                    return (
                      <Fragment key={idx}>
                        <div className={`${styles.accountRow} ${altRow ? styles.accountRowAlt : ""}`}>
                          {isEditing ? (
                            <input
                              type="text"
                              className={styles.accountName}
                              value={acc.name}
                              onChange={(e) => setAccountName(idx, e.target.value)}
                              placeholder="Název (např. Květiny)"
                              disabled={loading}
                              autoFocus
                            />
                          ) : (
                            <span className={styles.accountNameRO}>
                              {acc.name || <em className={styles.accountNameEmpty}>(bez názvu)</em>}
                            </span>
                          )}
                          {isEditing ? (
                            <input
                              type="number"
                              step={1}
                              className={styles.accountAmount}
                              value={acc.amount === 0 ? "" : acc.amount}
                              onChange={(e) => setAccountAmount(idx, Number(e.target.value))}
                              placeholder="0"
                              disabled={loading}
                            />
                          ) : (
                            <span className={styles.accountAmountRO}>{acc.amount.toLocaleString("cs-CZ")}</span>
                          )}
                          <span className={styles.accountSuffix}>Kč</span>
                          <EditActionButton
                            editing={isEditing}
                            ariaLabel={isEditing ? "Hotovo" : "Upravit"}
                            onClick={() => setEditingIdx(isEditing ? null : idx)}
                          />
                          <TrashActionButton
                            ariaLabel={`Odstranit účet ${acc.name || "(bez názvu)"}`}
                            onClick={() => requestDeleteAccount(idx)}
                          />
                        </div>
                      </Fragment>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className={styles.protocolRight}>
              <div className={styles.notesContainer}>
                <div className={styles.notesContainerHeader}>
                  <h3 className={styles.accountsTitle}>Poznámky</h3>
                  <Button variant="primary" size="sm" onClick={addNote}>
                    + Přidat poznámku
                  </Button>
                </div>
                <div className={styles.notesList}>
                  {notes.length === 0 && <div className={styles.accountsEmpty}>Žádné poznámky.</div>}
                  {notes.map((n, i) => {
                    const isEditingNote = editingNoteIdx === i;
                    return (
                      <div key={i} className={`${styles.noteRow} ${i % 2 === 1 ? styles.noteRowAlt : ""}`}>
                        <input
                          type="checkbox"
                          className={styles.noteCheck}
                          checked={n.done}
                          onChange={(e) => setNoteDone(i, e.target.checked)}
                          aria-label={n.done ? "Označit jako nevyřízené" : "Označit jako vyřízené"}
                        />
                        {isEditingNote ? (
                          <input
                            type="text"
                            className={n.done ? `${styles.noteText} ${styles.noteTextDone}` : styles.noteText}
                            value={n.text}
                            onChange={(e) => setNoteText(i, e.target.value)}
                            placeholder="Poznámka…"
                            disabled={loading}
                            autoFocus
                          />
                        ) : (
                          <span className={n.done ? `${styles.noteTextRO} ${styles.noteTextDone}` : styles.noteTextRO}>
                            {n.text || <em className={styles.accountNameEmpty}>(prázdná poznámka)</em>}
                          </span>
                        )}
                        <EditActionButton
                          editing={isEditingNote}
                          ariaLabel={isEditingNote ? "Hotovo" : "Upravit"}
                          onClick={() => setEditingNoteIdx(isEditingNote ? null : i)}
                        />
                        <TrashActionButton ariaLabel="Odstranit poznámku" onClick={() => requestDeleteNote(i)} />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className={styles.metaRow}>
            <span className={autosaveError ? `${styles.metaText} ${styles.metaError}` : styles.metaText}>
              {statusText}
            </span>
          </div>
        </>
      )}

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          danger={confirm.danger}
          showCancel={confirm.showCancel}
          confirmLabel={confirm.confirmLabel}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
