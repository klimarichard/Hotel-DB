import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import ConfirmModal from "./ConfirmModal";
import styles from "./VacationLedgerSection.module.css";

/**
 * Read/edit view of an employee's vacation-hour ledger, one calendar year at a
 * time (‹ year › switcher, like Payroll/Směny). All figures are in HOURS. The
 * summary line shows Nárok (entitlement, editable), Čerpáno (derived) and
 * Zůstatek (derived; red when negative). Below it a compact two-row table lists
 * the hours taken in each month 1–12.
 *
 * Editing is gated by the caller (`canManage` ← employees.vacationBalance.manage).
 * A manually-edited month value (source "manual") is marked exactly like a manual
 * override in Payroll (warning background + "*"); AVENSIO-seeded and payroll-fed
 * values render plain. Editing = double-click; empty input clears the value.
 */

type LedgerSource = "avensio-seed" | "payroll-lock" | "manual";

interface LedgerMonth {
  hours: number;
  source: LedgerSource;
}

interface Ledger {
  year: number;
  priorYearHours: number | null;   // Loňská (editable)
  currentYearHours: number | null; // Letošní (editable)
  entitlementHours: number | null; // Nárok = prior + current (derived server-side)
  paidOutHours: number | null;
  months: Record<string, LedgerMonth>;
  consumedHours: number;
  remainingHours: number | null;
}

const FIRST_YEAR = 2026; // earliest year we hold data for (AVENSIO H1 seed)

/** Format an hour figure: drop trailing .0, Czech decimal comma. */
function fmtH(n: number | null | undefined): string {
  if (n == null) return "–";
  return `${String(n).replace(".", ",")} h`;
}

type EditTarget =
  | { kind: "month"; month: number }
  | { kind: "priorYearHours" }
  | { kind: "currentYearHours" };

export default function VacationLedgerSection({
  employeeId,
  canManage,
}: {
  employeeId: string;
  canManage: boolean;
}) {
  const [year, setYear] = useState(FIRST_YEAR);
  const [ledger, setLedger] = useState<Ledger | null | undefined>(undefined); // undefined = loading
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [errModal, setErrModal] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLedger(undefined);
    setEdit(null);
    api
      .get<Ledger | null>(`/employees/${employeeId}/vacation-ledger?year=${year}`)
      .then((l) => alive && setLedger(l))
      .catch(() => alive && setLedger(null));
    return () => {
      alive = false;
    };
  }, [employeeId, year]);

  function startEdit(target: EditTarget, current: number | null | undefined) {
    if (!canManage) return;
    setEdit(target);
    setDraft(current == null ? "" : String(current).replace(".", ","));
  }

  async function save() {
    if (!edit) return;
    const raw = draft.trim().replace(",", ".");
    // Loňská/Letošní may be negative (carried-over deficit); months must be ≥ 0.
    const allowNegative = edit.kind === "priorYearHours" || edit.kind === "currentYearHours";
    let hours: number | null;
    if (raw === "") {
      hours = null; // clear
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || (!allowNegative && n < 0)) {
        setErrModal(
          allowNegative
            ? "Zadejte číslo (počet hodin), nebo nechte prázdné pro smazání."
            : "Zadejte nezáporné číslo (počet hodin), nebo nechte prázdné pro smazání."
        );
        return;
      }
      hours = n;
    }
    const body =
      edit.kind === "month"
        ? { month: edit.month, hours }
        : edit.kind === "priorYearHours"
          ? { priorYearHours: hours }
          : { currentYearHours: hours };
    setSaving(true);
    try {
      await api.patch(`/employees/${employeeId}/vacation-ledger/${year}`, body);
      // Refetch so derived čerpáno/zůstatek stay authoritative (single source of math).
      const fresh = await api.get<Ledger | null>(
        `/employees/${employeeId}/vacation-ledger?year=${year}`
      );
      setLedger(fresh);
      setEdit(null);
    } catch (e) {
      setErrModal((e as Error).message || "Uložení se nezdařilo.");
    } finally {
      setSaving(false);
    }
  }

  const prior = ledger?.priorYearHours ?? null;
  const current = ledger?.currentYearHours ?? null;
  const entitlement = ledger?.entitlementHours ?? null;
  const consumed = ledger?.consumedHours ?? 0;
  const remaining = ledger?.remainingHours ?? null;
  const months = ledger?.months ?? {};

  const editInput = (
    <input
      className={styles.input}
      type="text"
      inputMode="decimal"
      value={draft}
      autoFocus
      disabled={saving}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void save()}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); void save(); }
        if (e.key === "Escape") { e.preventDefault(); setEdit(null); }
      }}
    />
  );

  return (
    <div className={styles.wrap}>
      {/* ‹ rok › */}
      <div className={styles.yearNav}>
        <button
          className={styles.navBtn}
          onClick={() => setYear((y) => y - 1)}
          disabled={year <= FIRST_YEAR}
          title="Předchozí rok"
        >
          ‹
        </button>
        <span className={styles.yearLabel}>{year}</span>
        <button className={styles.navBtn} onClick={() => setYear((y) => y + 1)} title="Další rok">
          ›
        </button>
      </div>

      {ledger === undefined ? (
        <div className={styles.loading}>Načítám…</div>
      ) : (
        <>
          {/* Loňská + Letošní (editable) / Nárok (=součet, jen ke čtení) / Čerpáno / Zůstatek */}
          <div className={styles.summary}>
            <span className={styles.sumItem}>
              <span className={styles.sumLabel}>Loňská</span>
              {edit?.kind === "priorYearHours" ? (
                editInput
              ) : (
                <span
                  className={canManage ? styles.editable : undefined}
                  onDoubleClick={() => startEdit({ kind: "priorYearHours" }, prior)}
                  title={canManage ? "Dvojklik pro úpravu" : undefined}
                >
                  {fmtH(prior)}
                </span>
              )}
            </span>
            <span className={styles.sumItem}>
              <span className={styles.sumLabel}>Letošní</span>
              {edit?.kind === "currentYearHours" ? (
                editInput
              ) : (
                <span
                  className={canManage ? styles.editable : undefined}
                  onDoubleClick={() => startEdit({ kind: "currentYearHours" }, current)}
                  title={canManage ? "Dvojklik pro úpravu" : undefined}
                >
                  {fmtH(current)}
                </span>
              )}
            </span>
            <span className={styles.sumItem}>
              <span className={styles.sumLabel}>Nárok</span>
              <span className={styles.derived} title="Loňská + Letošní">{fmtH(entitlement)}</span>
            </span>
            <span className={styles.sumItem}>
              <span className={styles.sumLabel}>Čerpáno</span>
              <span>{fmtH(consumed)}</span>
            </span>
            <span className={styles.sumItem}>
              <span className={styles.sumLabel}>Zůstatek</span>
              <span className={`${styles.remaining} ${remaining != null && remaining < 0 ? styles.negative : ""}`}>
                {fmtH(remaining)}
              </span>
            </span>
          </div>

          {/* Two-row month table */}
          <div className={styles.tableScroll}>
            <table className={styles.monthTable}>
              <tbody>
                <tr className={styles.monthHeadRow}>
                  {Array.from({ length: 12 }, (_, i) => (
                    <th key={i + 1} className={styles.monthHead}>{i + 1}</th>
                  ))}
                  <th className={`${styles.monthHead} ${styles.totalHead}`}>CELKEM</th>
                </tr>
                <tr>
                  {Array.from({ length: 12 }, (_, i) => {
                    const month = i + 1;
                    const cell = months[String(month)];
                    const isManual = cell?.source === "manual";
                    const isEditing = edit?.kind === "month" && edit.month === month;
                    return (
                      <td key={month} className={styles.monthCell}>
                        {isEditing ? (
                          editInput
                        ) : (
                          <span
                            className={[
                              canManage ? styles.editable : "",
                              isManual ? styles.overridden : "",
                            ].join(" ").trim()}
                            onDoubleClick={() => startEdit({ kind: "month", month }, cell?.hours)}
                            title={
                              isManual
                                ? `Ručně upraveno${canManage ? " · dvojklik upraví" : ""}`
                                : canManage ? "Dvojklik pro úpravu" : undefined
                            }
                          >
                            {cell ? String(cell.hours).replace(".", ",") : "–"}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className={`${styles.monthCell} ${styles.totalCell}`}>
                    {String(consumed).replace(".", ",")}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      {errModal && (
        <ConfirmModal
          title="Chyba"
          message={errModal}
          confirmLabel="OK"
          showCancel={false}
          onConfirm={() => setErrModal(null)}
          onCancel={() => setErrModal(null)}
        />
      )}
    </div>
  );
}
