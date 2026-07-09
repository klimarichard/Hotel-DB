import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import Button from "@/components/Button";
import IconButton from "@/components/IconButton";
import ConfirmModal from "@/components/ConfirmModal";
import type { Hotel } from "@/lib/hotels";
import styles from "./WalkinsTab.module.css";

type Currency = "CZK" | "EUR";

interface Walkin {
  id: string;
  date: string;
  employeeId: string;
  employeeName: string;
  resNo: string;
  amount: number;
  currency: Currency;
}

interface Range {
  from: string | null;
  to: string | null;
}

interface EmployeeOption {
  employeeId: string;
  name: string;
}

function todayLocal(): string {
  return new Intl.DateTimeFormat("sv-SE").format(new Date());
}

function formatDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Date(`${iso}T00:00:00`).toLocaleDateString("cs-CZ");
}

function currencySymbol(c: Currency): string {
  return c === "CZK" ? "Kč" : "€";
}

// ── Inline row-action icons (feather-style, matching the protokol tab) ────────
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

export default function WalkinsTab({ hotel }: { hotel: Hotel }) {
  const { can } = useAuth();
  const canManage = can(hotel.walkinyManagePerm);

  const [entries, setEntries] = useState<Walkin[]>([]);
  const [range, setRange] = useState<Range>({ from: null, to: null });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editing, setEditing] = useState<Walkin | "new" | null>(null);
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
        api.get<Walkin[]>(`/walkins/${hotel.slug}`),
        api.get<Range>(`/walkins/${hotel.slug}/range`),
      ]);
      setEntries(list);
      setRange(rng);
      setRangeFrom(rng.from ?? "");
      setRangeTo(rng.to ?? "");
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Nepodařilo se načíst walk-iny.");
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
      const rng = await api.put<Range>(`/walkins/${hotel.slug}/range`, {
        from: rangeFrom || null,
        to: rangeTo || null,
      });
      setRange(rng);
      // Manage users see everything regardless, but reload keeps the list fresh.
      await load();
    } catch (err) {
      setRangeError(err instanceof Error ? err.message : "Období se nepodařilo uložit.");
    } finally {
      setRangeSaving(false);
    }
  }

  function requestDelete(entry: Walkin) {
    setConfirm({
      title: "Smazat walk-in?",
      message: `Opravdu chcete smazat záznam z ${formatDate(entry.date)} (${entry.employeeName || "?"}, ${entry.amount.toLocaleString("cs-CZ")} ${currencySymbol(entry.currency)})?`,
      danger: true,
      confirmLabel: "Smazat",
      onConfirm: () => void doDelete(entry.id),
    });
  }
  async function doDelete(id: string) {
    try {
      await api.delete<{ ok: true }>(`/walkins/${hotel.slug}/${id}`);
      setEntries((prev) => prev.filter((e) => e.id !== id));
      setConfirm(null);
    } catch (err) {
      setConfirm({
        title: "Chyba",
        message: err instanceof Error ? err.message : "Záznam se nepodařilo smazat.",
        showCancel: false,
        confirmLabel: "OK",
        onConfirm: () => setConfirm(null),
      });
    }
  }

  const hasRange = !!(range.from || range.to);

  return (
    <div className={styles.panel}>
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
        ) : hasRange ? (
          <span className={styles.rangeInfo}>
            Zobrazené období: {range.from ? formatDate(range.from) : "…"} – {range.to ? formatDate(range.to) : "…"}
          </span>
        ) : (
          <span />
        )}
        <Button size="sm" onClick={() => setEditing("new")} data-tour="walkiny-add">
          + Přidat walk-in
        </Button>
      </div>

      {loading ? (
        <div className={styles.empty}>Načítám…</div>
      ) : loadError ? (
        <div className={`${styles.empty} ${styles.statusError}`}>{loadError}</div>
      ) : (
        <div className={styles.tableWrap} data-tour="walkiny-table">
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Datum</th>
                <th>Zaměstnanec</th>
                <th>č. rez. v Protelu</th>
                <th className={styles.amountCell}>Částka</th>
                <th aria-label="Akce" />
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 && (
                <tr>
                  <td colSpan={5} className={styles.empty}>
                    Žádné walk-in záznamy.
                  </td>
                </tr>
              )}
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{formatDate(e.date)}</td>
                  <td>{e.employeeName}</td>
                  <td>{e.resNo}</td>
                  <td className={styles.amountCell}>
                    {e.amount.toLocaleString("cs-CZ")} {currencySymbol(e.currency)}
                  </td>
                  <td className={styles.actionsCell}>
                    <div className={styles.rowActions}>
                      <button type="button" className={styles.rowIconBtn} aria-label="Upravit" onClick={() => setEditing(e)}>
                        <PencilIcon />
                      </button>
                      <button
                        type="button"
                        className={`${styles.rowIconBtn} ${styles.rowIconBtnTrash}`}
                        aria-label="Smazat"
                        onClick={() => requestDelete(e)}
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
        <WalkinModal
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
// Add / edit modal. The employee dropdown is loaded from the selected date's
// month shift plan and refetches when the month changes; a non-manage user's
// date is bounded by the visible range.
// ─────────────────────────────────────────────────────────────────────────────
function WalkinModal({
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
  initial: Walkin | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const isEdit = !!initial;
  const [date, setDate] = useState(initial?.date ?? todayLocal());
  const [employeeId, setEmployeeId] = useState(initial?.employeeId ?? "");
  const [employeeName, setEmployeeName] = useState(initial?.employeeName ?? "");
  const [resNo, setResNo] = useState(initial?.resNo ?? "");
  const [amount, setAmount] = useState<number>(initial?.amount ?? 0);
  const [currency, setCurrency] = useState<Currency>(initial?.currency ?? "CZK");
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const month = date.slice(0, 7);

  // Load the employee pool for the selected date's month (refetch on month change).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await api.get<EmployeeOption[]>(
          `/walkins/${hotel.slug}/employees?date=${encodeURIComponent(date)}`
        );
        if (!cancelled) setEmployees(list);
      } catch {
        if (!cancelled) setEmployees([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, hotel.slug]);

  // Keep the currently-selected employee selectable even if they're not in this
  // month's plan (e.g. editing an old entry).
  const options = useMemo(() => {
    const list = [...employees];
    if (employeeId && !list.some((e) => e.employeeId === employeeId)) {
      list.unshift({ employeeId, name: employeeName || employeeId });
    }
    return list;
  }, [employees, employeeId, employeeName]);

  function selectEmployee(id: string) {
    setEmployeeId(id);
    const found = employees.find((e) => e.employeeId === id);
    if (found) setEmployeeName(found.name);
  }

  const dateMin = !canManage && range.from ? range.from : undefined;
  const dateMax = !canManage && range.to ? range.to : undefined;
  const valid = employeeId !== "" && Number.isFinite(amount);

  async function submit() {
    if (!valid) return;
    setBusy(true);
    setErr(null);
    const body = { date, employeeId, employeeName, resNo: resNo.trim(), amount: Number(amount) || 0, currency };
    try {
      if (isEdit) await api.put(`/walkins/${hotel.slug}/${initial!.id}`, body);
      else await api.post(`/walkins/${hotel.slug}`, body);
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
          <h2 className={styles.modalTitle}>{isEdit ? "Upravit walk-in" : "Nový walk-in"}</h2>
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
            Zaměstnanec
            <select
              className={styles.select}
              value={employeeId}
              onChange={(e) => selectEmployee(e.target.value)}
              disabled={busy}
            >
              <option value="" disabled>
                {options.length === 0 ? "Žádní zaměstnanci v plánu" : "Vyberte zaměstnance…"}
              </option>
              {options.map((o) => (
                <option key={o.employeeId} value={o.employeeId}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            č. rez. v Protelu
            <input
              type="text"
              className={styles.input}
              value={resNo}
              onChange={(e) => setResNo(e.target.value)}
              placeholder="např. 1465199"
              disabled={busy}
            />
          </label>
          <div className={styles.amountRow}>
            <label className={styles.field}>
              Částka
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
              Měna
              <select
                className={styles.select}
                value={currency}
                onChange={(e) => setCurrency(e.target.value as Currency)}
                disabled={busy}
              >
                <option value="CZK">CZK</option>
                <option value="EUR">EUR</option>
              </select>
            </label>
          </div>
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
