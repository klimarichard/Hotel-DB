import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import Button from "@/components/Button";
import IconButton from "@/components/IconButton";
import ConfirmModal from "@/components/ConfirmModal";
import type { Hotel } from "@/lib/hotels";
import styles from "./TerminalTab.module.css";

// Transaction types – id → Czech label. Mirror the backend exactly.
const TERMINAL_TYPES = [
  { id: "late-co", label: "late C/O" },
  { id: "laundry", label: "laundry" },
  { id: "snidane", label: "snídaně" },
  { id: "extra-bed", label: "extra bed" },
  { id: "parking", label: "parking" },
  { id: "tour", label: "tour" },
  { id: "other", label: "Jiné…" },
] as const;

const TYPE_LABELS: Record<string, string> = Object.fromEntries(TERMINAL_TYPES.map((t) => [t.id, t.label]));

interface TerminalPayment {
  id: string;
  date: string;
  amount: number;
  type: string;
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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editing, setEditing] = useState<TerminalPayment | "new" | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  // Range editor (manage only).
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [rangeSaving, setRangeSaving] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [list, rng] = await Promise.all([
        api.get<TerminalPayment[]>(`/terminal/${hotel.slug}`),
        api.get<Range>(`/terminal/${hotel.slug}/range`),
      ]);
      setPayments(list);
      setRange(rng);
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
      message: `Opravdu chcete smazat platbu z ${formatDate(p.date)} (${TYPE_LABELS[p.type] ?? p.type}, ${p.amount.toLocaleString("cs-CZ")} Kč)?`,
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

      <div className={styles.toolbar}>
        <Button size="sm" onClick={() => setEditing("new")} data-tour="terminal-add">
          + Přidat platbu
        </Button>
      </div>

      {loading ? (
        <div className={styles.empty}>Načítám…</div>
      ) : loadError ? (
        <div className={`${styles.empty} ${styles.statusError}`}>{loadError}</div>
      ) : (
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
                  <td>{TYPE_LABELS[p.type] ?? p.type}</td>
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
      )}

      {editing && (
        <PaymentModal
          hotel={hotel}
          canManage={canManage}
          range={range}
          initial={editing === "new" ? null : editing}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
          onCancel={() => setEditing(null)}
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
  initial,
  onSaved,
  onCancel,
}: {
  hotel: Hotel;
  canManage: boolean;
  range: Range;
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
  // "Jiné…" carries no type of its own, so the note is the only record of what
  // the payment was — required there, optional everywhere else. Enforced on the
  // server too; this only saves a round-trip.
  const noteRequired = type === "other";
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
                Vyberte typ…
              </option>
              {TERMINAL_TYPES.map((t) => (
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
