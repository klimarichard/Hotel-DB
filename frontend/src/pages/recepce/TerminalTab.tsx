import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import Button from "@/components/Button";
import IconButton from "@/components/IconButton";
import ConfirmModal from "@/components/ConfirmModal";
import type { Hotel } from "@/lib/hotels";
import styles from "./TerminalTab.module.css";

// The permanent built-in type: always available, always shown last, and the only
// type that forces a note. Every OTHER type is manager-configurable via the Typy
// plateb editor. Mirror the backend (terminalShared.ts).
const OTHER_TYPE_ID = "other";
const OTHER_TYPE_LABEL = "Jiné…";
const OTHER_TYPE: TerminalTypeItem = { id: OTHER_TYPE_ID, label: OTHER_TYPE_LABEL };

// Fallback labels for OLD payments that stored only a type id (pre-snapshot).
const LEGACY_TYPE_LABELS: Record<string, string> = {
  "late-co": "late C/O",
  laundry: "laundry",
  snidane: "snídaně",
  "extra-bed": "extra bed",
  parking: "parking",
  tour: "tour",
  other: OTHER_TYPE_LABEL,
};

interface TerminalTypeItem {
  id: string;
  label: string;
}

interface TerminalPayment {
  id: string;
  date: string;
  amount: number;
  type: string;
  typeLabel?: string;
  note: string;
  settled: boolean;
  settledBy: string | null;
  settledAt: string | null;
}

interface Range {
  from: string | null;
  to: string | null;
}

function todayLocal(): string {
  return new Intl.DateTimeFormat("sv-SE").format(new Date());
}

function formatDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Date(`${iso}T00:00:00`).toLocaleDateString("cs-CZ");
}

/** Label to display for a payment: its snapshot, else a legacy fallback, else the id. */
function typeLabelOf(p: TerminalPayment): string {
  return p.typeLabel || LEGACY_TYPE_LABELS[p.type] || p.type;
}

function genId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  }
}

// ── Inline row-action icons (feather-style, matching the other recepce tabs) ──
function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
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
function ChevronUpIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m18 15-6-6-6 6" />
    </svg>
  );
}
function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
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

export default function TerminalTab({ hotel }: { hotel: Hotel }) {
  const { can } = useAuth();
  const canManage = !!hotel.terminalManagePerm && can(hotel.terminalManagePerm);

  const [payments, setPayments] = useState<TerminalPayment[]>([]);
  const [range, setRange] = useState<Range>({ from: null, to: null });
  const [types, setTypes] = useState<TerminalTypeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editing, setEditing] = useState<TerminalPayment | "new" | null>(null);
  const [typesOpen, setTypesOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  // Range editor (manage only).
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [rangeSaving, setRangeSaving] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);

  // The Typ dropdown options: the configurable catalogue plus the built-in "Jiné…".
  const typeOptions = [...types, OTHER_TYPE];

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [list, rng, typesRes] = await Promise.all([
        api.get<TerminalPayment[]>(`/terminal/${hotel.slug}`),
        api.get<Range>(`/terminal/${hotel.slug}/range`),
        api.get<{ types: TerminalTypeItem[] }>(`/terminal/${hotel.slug}/types`),
      ]);
      setPayments(list);
      setRange(rng);
      setTypes(typesRes.types);
      setRangeFrom(rng.from ?? "");
      setRangeTo(rng.to ?? "");
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Nepodařilo se načíst platby.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotel.slug]);

  async function saveRange() {
    setRangeSaving(true);
    setRangeError(null);
    try {
      const rng = await api.put<Range>(`/terminal/${hotel.slug}/range`, {
        from: rangeFrom || null,
        to: rangeTo || null,
      });
      setRange(rng);
      await load();
    } catch (err) {
      setRangeError(err instanceof Error ? err.message : "Období se nepodařilo uložit.");
    } finally {
      setRangeSaving(false);
    }
  }

  // Toggle the "Předáno" flag optimistically; revert on error (manage only).
  async function toggleSettled(p: TerminalPayment, next: boolean) {
    setPayments((prev) => prev.map((x) => (x.id === p.id ? { ...x, settled: next } : x)));
    try {
      await api.put(`/terminal/${hotel.slug}/${p.id}/settled`, { settled: next });
    } catch (err) {
      setPayments((prev) => prev.map((x) => (x.id === p.id ? { ...x, settled: p.settled } : x)));
      setConfirm({
        title: "Chyba",
        message: err instanceof Error ? err.message : "Stav se nepodařilo změnit.",
        showCancel: false,
        confirmLabel: "OK",
        onConfirm: () => setConfirm(null),
      });
    }
  }

  function requestDelete(p: TerminalPayment) {
    setConfirm({
      title: "Smazat platbu?",
      message: `Opravdu chcete smazat platbu z ${formatDate(p.date)} (${typeLabelOf(p)}, ${p.amount.toLocaleString("cs-CZ")} Kč)?`,
      danger: true,
      confirmLabel: "Smazat",
      onConfirm: () => void doDelete(p.id),
    });
  }
  async function doDelete(id: string) {
    try {
      await api.delete<{ ok: true }>(`/terminal/${hotel.slug}/${id}`);
      setPayments((prev) => prev.filter((p) => p.id !== id));
      setConfirm(null);
    } catch (err) {
      setConfirm({
        title: "Chyba",
        message: err instanceof Error ? err.message : "Platbu se nepodařilo smazat.",
        showCancel: false,
        confirmLabel: "OK",
        onConfirm: () => setConfirm(null),
      });
    }
  }

  const hasRange = !!(range.from || range.to);
  const colCount = canManage ? 6 : 5;

  return (
    <div className={styles.panel}>
      {(canManage || hasRange) && (
        <div className={styles.header}>
          {canManage ? (
            <div className={styles.rangeEditor}>
              <span className={styles.rangeLabel}>Viditelné období:</span>
              <input
                type="date"
                className={styles.dateInput}
                value={rangeFrom}
                onChange={(e) => setRangeFrom(e.target.value)}
                aria-label="Od"
              />
              <span>–</span>
              <input
                type="date"
                className={styles.dateInput}
                value={rangeTo}
                onChange={(e) => setRangeTo(e.target.value)}
                aria-label="Do"
              />
              <Button variant="secondary" size="sm" onClick={saveRange} disabled={rangeSaving}>
                {rangeSaving ? "Ukládám…" : "Uložit období"}
              </Button>
              {rangeError && <span className={`${styles.statusText} ${styles.statusError}`}>{rangeError}</span>}
            </div>
          ) : (
            <span className={styles.rangeInfo}>
              Zobrazené období: {range.from ? formatDate(range.from) : "…"} – {range.to ? formatDate(range.to) : "…"}
            </span>
          )}
        </div>
      )}

      {loading ? (
        <div className={styles.empty}>Načítám…</div>
      ) : loadError ? (
        <div className={`${styles.empty} ${styles.statusError}`}>{loadError}</div>
      ) : (
        <div className={styles.content}>
          <div className={styles.left}>
            <div className={styles.toolbar}>
              <Button size="sm" onClick={() => setEditing("new")} data-tour="terminal-add">
                + Přidat platbu
              </Button>
            </div>
            <div className={styles.tableWrap} data-tour="terminal-table">
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Datum</th>
                    <th className={styles.numCell}>Částka</th>
                    <th>Typ</th>
                    <th>Poznámka</th>
                    {canManage && <th data-tour="terminal-settled">Předáno</th>}
                    <th aria-label="Akce" />
                  </tr>
                </thead>
                <tbody>
                  {payments.length === 0 && (
                    <tr>
                      <td colSpan={colCount} className={styles.empty}>
                        Žádné platby z terminálu.
                      </td>
                    </tr>
                  )}
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td>{formatDate(p.date)}</td>
                      <td className={styles.numCell}>{p.amount.toLocaleString("cs-CZ")} Kč</td>
                      {/* The "other" label already reads "Jiné…" — a second "jiné" tag
                          (as Taxi has next to a real route name) would just repeat it. */}
                      <td>{typeLabelOf(p)}</td>
                      <td className={p.note ? styles.noteCell : `${styles.noteCell} ${styles.noteEmpty}`} title={p.note}>
                        {p.note || "–"}
                      </td>
                      {canManage && (
                        <td className={styles.settledCell}>
                          <input
                            type="checkbox"
                            className={styles.settledCheck}
                            checked={p.settled}
                            onChange={(e) => void toggleSettled(p, e.target.checked)}
                            aria-label="Předáno"
                          />
                        </td>
                      )}
                      <td className={styles.actionsCell}>
                        <div className={styles.rowActions}>
                          <button type="button" className={styles.rowIconBtn} aria-label="Upravit" onClick={() => setEditing(p)}>
                            <PencilIcon />
                          </button>
                          <button
                            type="button"
                            className={`${styles.rowIconBtn} ${styles.rowIconBtnTrash}`}
                            aria-label="Smazat"
                            onClick={() => requestDelete(p)}
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {canManage && (
            <aside className={styles.pricelist}>
              <div className={styles.pricelistHeader}>
                <h3 className={styles.pricelistTitle}>Typy plateb</h3>
                <Button variant="secondary" size="sm" onClick={() => setTypesOpen(true)}>
                  Upravit
                </Button>
              </div>
              <div className={styles.pricelistBody}>
                <table className={styles.typeListTable}>
                  <thead>
                    <tr>
                      <th>Typ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {types.map((t) => (
                      <tr key={t.id}>
                        <td>{t.label}</td>
                      </tr>
                    ))}
                    <tr className={styles.builtinRow}>
                      <td>
                        {OTHER_TYPE_LABEL} <span className={styles.builtinHint}>(vždy, pozn. povinná)</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </aside>
          )}
        </div>
      )}

      {editing && (
        <PaymentModal
          hotel={hotel}
          canManage={canManage}
          range={range}
          typeOptions={typeOptions}
          initial={editing === "new" ? null : editing}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {typesOpen && (
        <TypesModal
          hotel={hotel}
          types={types}
          onSaved={(next) => {
            setTypes(next);
            setTypesOpen(false);
          }}
          onCancel={() => setTypesOpen(false)}
        />
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

// ─────────────────────────────────────────────────────────────────────────────
// Add / edit modal. A non-manage user's date is bounded by the visible range.
// The note is optional for every type.
// ─────────────────────────────────────────────────────────────────────────────
function PaymentModal({
  hotel,
  canManage,
  range,
  typeOptions,
  initial,
  onSaved,
  onCancel,
}: {
  hotel: Hotel;
  canManage: boolean;
  range: Range;
  typeOptions: TerminalTypeItem[];
  initial: TerminalPayment | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const isEdit = !!initial;
  const [date, setDate] = useState(initial?.date ?? todayLocal());
  const [amount, setAmount] = useState<number>(initial?.amount ?? 0);
  const [type, setType] = useState<string>(initial?.type ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const dateMin = !canManage && range.from ? range.from : undefined;
  const dateMax = !canManage && range.to ? range.to : undefined;
  // A stored payment can reference a type since deleted from the catalogue; keep
  // it selectable while editing so the dropdown still shows the current value.
  const options =
    type !== "" && !typeOptions.some((t) => t.id === type)
      ? [{ id: type, label: typeLabelOf({ type, typeLabel: initial?.typeLabel } as TerminalPayment) }, ...typeOptions]
      : typeOptions;
  // "Jiné…" carries no type of its own, so the note is the only record of what
  // the payment was — required there, optional everywhere else. Enforced on the
  // server too; this only saves a round-trip.
  const noteRequired = type === OTHER_TYPE_ID;
  const valid =
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(amount) &&
    type !== "" &&
    (!noteRequired || note.trim() !== "");

  async function submit() {
    if (!valid) return;
    setBusy(true);
    setErr(null);
    const body = { date, amount: Number(amount) || 0, type, note: note.trim() };
    try {
      if (isEdit) await api.put(`/terminal/${hotel.slug}/${initial!.id}`, body);
      else await api.post(`/terminal/${hotel.slug}`, body);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Uložení se nezdařilo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>{isEdit ? "Upravit platbu" : "Nová platba"}</h2>
          <IconButton variant="close" aria-label="Zavřít" onClick={onCancel} />
        </div>
        <div className={styles.modalBody}>
          <label className={styles.field}>
            Datum
            <input
              type="date"
              className={styles.input}
              value={date}
              min={dateMin}
              max={dateMax}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className={styles.field}>
            Částka (Kč)
            <input
              type="number"
              step="any"
              className={`${styles.input} ${styles.inputNumber}`}
              value={amount === 0 ? "" : amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              placeholder="0"
              disabled={busy}
            />
          </label>
          <label className={styles.field}>
            Typ
            <select className={styles.select} value={type} onChange={(e) => setType(e.target.value)} disabled={busy}>
              <option value="" disabled>
                {options.length === 0 ? "Žádné typy plateb" : "Vyberte typ…"}
              </option>
              {options.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            {noteRequired ? "Poznámka (povinná)" : "Poznámka (nepovinné)"}
            <input
              type="text"
              className={styles.input}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={noteRequired ? "Popište, o co šlo" : "Nepovinná poznámka"}
              disabled={busy}
            />
            {noteRequired && note.trim() === "" && (
              <span className={styles.fieldHint}>U typu „Jiné…“ popište, o jakou platbu šlo.</span>
            )}
          </label>
          {err && <div className={styles.error}>{err}</div>}
        </div>
        <div className={styles.modalFooter}>
          <Button variant="secondary" type="button" onClick={onCancel} disabled={busy}>
            Zrušit
          </Button>
          <Button type="button" onClick={submit} disabled={busy || !valid}>
            {busy ? "Ukládám…" : isEdit ? "Uložit" : "Přidat"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Payment-type catalogue editor (manage only). Mirrors lobby bar's ItemsModal:
// add/rename/remove/reorder the configurable types. The built-in "Jiné…" is
// shown as a fixed, non-editable row — it always exists and always forces a note.
// ─────────────────────────────────────────────────────────────────────────────
interface DraftType extends TerminalTypeItem {
  _key: string;
}

function TypesModal({
  hotel,
  types,
  onSaved,
  onCancel,
}: {
  hotel: Hotel;
  types: TerminalTypeItem[];
  onSaved: (next: TerminalTypeItem[]) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<DraftType[]>(types.map((t) => ({ ...t, _key: t.id || genId() })));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function update(key: string, label: string) {
    setDraft((prev) => prev.map((t) => (t._key === key ? { ...t, label } : t)));
  }
  function remove(key: string) {
    setDraft((prev) => prev.filter((t) => t._key !== key));
  }
  function add() {
    setDraft((prev) => [...prev, { _key: genId(), id: "", label: "" }]);
  }
  /** Reorder a type (order is persisted verbatim as the array position). */
  function move(key: string, dir: -1 | 1) {
    setDraft((prev) => {
      const i = prev.findIndex((t) => t._key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setErr(null);
    const payload = {
      types: draft.filter((t) => t.label.trim() !== "").map((t) => ({ id: t.id, label: t.label.trim() })),
    };
    try {
      const res = await api.put<{ types: TerminalTypeItem[] }>(`/terminal/${hotel.slug}/types`, payload);
      onSaved(res.types);
    } catch (e) {
      setErr(errorMessage(e, "Uložení se nezdařilo."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Typy plateb</h2>
          <IconButton variant="close" aria-label="Zavřít" onClick={onCancel} />
        </div>
        <div className={styles.modalBody}>
          <table className={styles.typesTable}>
            <thead>
              <tr>
                <th>Typ</th>
                <th aria-label="Akce" />
              </tr>
            </thead>
            <tbody>
              {draft.length === 0 && (
                <tr>
                  <td colSpan={2} className={styles.empty}>
                    Žádné vlastní typy.
                  </td>
                </tr>
              )}
              {draft.map((t, idx) => (
                <tr key={t._key}>
                  <td>
                    <input
                      className={styles.typeInput}
                      value={t.label}
                      onChange={(e) => update(t._key, e.target.value)}
                      placeholder="název typu"
                      disabled={busy}
                    />
                  </td>
                  <td>
                    <div className={styles.rowActions}>
                      <button type="button" className={styles.rowIconBtn} aria-label="Posunout nahoru" title="Posunout nahoru" onClick={() => move(t._key, -1)} disabled={busy || idx === 0}>
                        <ChevronUpIcon />
                      </button>
                      <button type="button" className={styles.rowIconBtn} aria-label="Posunout dolů" title="Posunout dolů" onClick={() => move(t._key, 1)} disabled={busy || idx === draft.length - 1}>
                        <ChevronDownIcon />
                      </button>
                      <button type="button" className={`${styles.rowIconBtn} ${styles.rowIconBtnTrash}`} aria-label="Odstranit typ" onClick={() => remove(t._key)} disabled={busy}>
                        <TrashIcon />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              <tr className={styles.builtinRow}>
                <td>
                  {OTHER_TYPE_LABEL} <span className={styles.builtinHint}>(vždy k dispozici, poznámka povinná)</span>
                </td>
                <td />
              </tr>
            </tbody>
          </table>
          {err && <div className={styles.error}>{err}</div>}
        </div>
        <div className={styles.modalFooter}>
          <Button variant="secondary" size="sm" type="button" onClick={add} disabled={busy} style={{ marginRight: "auto" }}>
            + Přidat typ
          </Button>
          <Button variant="secondary" type="button" onClick={onCancel} disabled={busy}>
            Zrušit
          </Button>
          <Button type="button" onClick={save} disabled={busy}>
            {busy ? "Ukládám…" : "Uložit"}
          </Button>
        </div>
      </div>
    </div>
  );
}
