import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import * as clock from "@/lib/clock";
import ConfirmModal from "./ConfirmModal";
import VacationLedgerCell, { formatLedgerValue } from "./VacationLedgerCell";
import styles from "./VacationLedgerSection.module.css";

/**
 * Read/edit view of an employee's vacation-hour ledger, one calendar year at a
 * time (‹ year › switcher, like Payroll/Směny). All figures are in HOURS.
 *
 * Laid out as ONE row of the same grid the aggregate table on /dovolena draws
 * for everybody at once: Loňská · Letošní · Nárok · [1–12] · Čerpáno ·
 * (Proplaceno) · Zůstatek. Before, the annual figures sat in a separate summary
 * line above a two-row month table, so the same ledger read differently
 * depending on which page you were on and the two could not be compared by eye.
 * Keeping the column order identical is the point — see VacationLedgerTable.
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

/**
 * Earliest year the switcher offers. NOT a claim that data exists that far back
 * — a year with no ledger simply shows the empty state, which is what lets
 * earlier years be back-filled later without touching this.
 */
const MIN_YEAR = 2022;

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

type EditTarget =
  | { kind: "month"; month: number }
  | { kind: "priorYearHours" }
  | { kind: "currentYearHours" }
  | { kind: "paidOutHours" };

export default function VacationLedgerSection({
  basePath,
  canManage,
  isTerminated = false,
}: {
  /**
   * Ledger endpoint WITHOUT the year: `/employees/{id}/vacation-ledger` on the
   * detail page, `/me/employee/vacation-ledger` on Můj profil. The self route is
   * a separate endpoint because the admin one is gated on permissions a plain
   * employee lacks, and it trusts the id in the path; the self one resolves the
   * employee from the auth token. Both return the same shape (readLedger).
   */
  basePath: string;
  canManage: boolean;
  /**
   * Employee's employment has ended. Proplaceno (payout on termination) is only
   * ever filled in when someone leaves, so the field is hidden while they are
   * still employed rather than sitting there permanently empty. A value that is
   * already set stays visible regardless — it is subtracted from Zůstatek, and a
   * balance shrunk by an invisible figure reads as a bug.
   */
  isTerminated?: boolean;
}) {
  // Via clock, not `new Date()`, so the non-prod test clock moves the year too.
  // Also the ceiling: the ledger is fed by payroll locks, so a future year holds
  // nothing to look at.
  const currentYear = Number(clock.today().slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const [ledger, setLedger] = useState<Ledger | null | undefined>(undefined); // undefined = loading
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [saving, setSaving] = useState(false);
  const [errModal, setErrModal] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLedger(undefined);
    setEdit(null);
    api
      .get<Ledger | null>(`${basePath}?year=${year}`)
      .then((l) => alive && setLedger(l))
      .catch(() => alive && setLedger(null));
    return () => {
      alive = false;
    };
  }, [basePath, year]);

  function startEdit(target: EditTarget) {
    if (!canManage) return;
    setEdit(target);
  }

  /**
   * Persist one figure. Parsing/validation happens in VacationLedgerCell (the
   * copy shared with the aggregate table); this only maps the target to the
   * one-field PATCH body the server expects.
   */
  async function save(edit: EditTarget, hours: number | null) {
    const body =
      edit.kind === "month"
        ? { month: edit.month, hours }
        : edit.kind === "priorYearHours"
          ? { priorYearHours: hours }
          : edit.kind === "currentYearHours"
            ? { currentYearHours: hours }
            : { paidOutHours: hours };
    setSaving(true);
    try {
      // Only reachable with canManage (startEdit hard-returns otherwise), i.e.
      // only from the admin basePath — the self route has no PATCH counterpart.
      await api.patch(`${basePath}/${year}`, body);
      // Refetch so derived čerpáno/zůstatek stay authoritative (single source of math).
      const fresh = await api.get<Ledger | null>(`${basePath}?year=${year}`);
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
  const paidOut = ledger?.paidOutHours ?? null;
  const showPaidOut = isTerminated || paidOut != null;

  /** Shared wiring for every editable figure in this section. */
  function cellProps(target: EditTarget) {
    return {
      editing:
        edit != null &&
        edit.kind === target.kind &&
        (target.kind !== "month" || (edit.kind === "month" && edit.month === target.month)),
      canManage,
      // The annual figures may be negative — Loňská/Letošní carry a deficit
      // forward, and Proplaceno is a balancing figure that goes negative when
      // čerpáno overran the entitlement. Monthly čerpáno must be ≥ 0.
      allowNegative: target.kind !== "month",
      saving,
      editableClassName: styles.editable,
      overriddenClassName: styles.overridden,
      inputClassName: styles.input,
      onStartEdit: () => startEdit(target),
      onCommit: (hours: number | null) => void save(target, hours),
      onCancel: () => setEdit(null),
      onError: (message: string) => setErrModal(message),
    };
  }

  return (
    <div className={styles.wrap}>
      {/* ‹ rok › */}
      <div className={styles.yearNav}>
        <button
          className={styles.navBtn}
          onClick={() => setYear((y) => y - 1)}
          disabled={year <= MIN_YEAR}
          title="Předchozí rok"
        >
          ‹
        </button>
        <span className={styles.yearLabel}>{year}</span>
        <button
          className={styles.navBtn}
          onClick={() => setYear((y) => y + 1)}
          disabled={year >= currentYear}
          title="Další rok"
        >
          ›
        </button>
      </div>

      {ledger === undefined ? (
        <div className={styles.loading}>Načítám…</div>
      ) : (
        <>
          {/* No ledger for this year. A manager still gets the grid below —
              double-clicking a dash is the ONLY way a year's record is created,
              so hiding it would make a fresh year impossible to fill. There is
              nothing for a reader to do with a row of dashes, so they get the
              message alone. */}
          {ledger === null && (
            <div className={styles.empty}>
              {canManage
                ? `Pro rok ${year} nejsou žádné údaje – zadejte je dvojklikem níže.`
                : `Pro rok ${year} nejsou k dispozici žádné údaje.`}
            </div>
          )}
          {(ledger !== null || canManage) && (
            <>
          {/* One row, same column order as the aggregate table on /dovolena.
              The month block is fenced off from the annual figures on both
              sides (blockStart), so "Nárok | 1..12 | Čerpáno" reads as the sum
              it is rather than as seventeen equal columns. */}
          <div className={styles.tableScroll}>
            <table className={styles.ledgerTable}>
              <thead>
                <tr>
                  <th rowSpan={2} className={`${styles.headCell} ${styles.sumHead}`}>Loňská</th>
                  <th rowSpan={2} className={`${styles.headCell} ${styles.sumHead}`}>Letošní</th>
                  <th rowSpan={2} className={`${styles.headCell} ${styles.sumHead}`}>Nárok</th>
                  <th colSpan={12} className={`${styles.headCell} ${styles.groupHead}`}>Měsíce</th>
                  <th rowSpan={2} className={`${styles.headCell} ${styles.sumHead} ${styles.blockStart}`}>
                    Čerpáno
                  </th>
                  {/* Proplaceno keeps its place BETWEEN Čerpáno and Zůstatek —
                      the same slot it holds on /dovolena — and the same
                      show-when-relevant rule as before: a payout is only ever
                      filled in on termination, but a value that exists always
                      shows, because it is subtracted from Zůstatek and a
                      balance shrunk by an invisible figure reads as a bug. */}
                  {showPaidOut && (
                    <th rowSpan={2} className={`${styles.headCell} ${styles.sumHead}`}>Proplaceno</th>
                  )}
                  <th rowSpan={2} className={`${styles.headCell} ${styles.sumHead}`}>Zůstatek</th>
                </tr>
                <tr>
                  {MONTHS.map((m) => (
                    <th
                      key={m}
                      className={`${styles.monthHeadCell} ${m === 1 ? styles.blockStart : ""}`.trim()}
                    >
                      {m}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <VacationLedgerCell {...cellProps({ kind: "priorYearHours" })} value={prior} />
                  </td>
                  <td>
                    <VacationLedgerCell
                      {...cellProps({ kind: "currentYearHours" })}
                      value={current}
                    />
                  </td>
                  <td>
                    <span className={styles.derived} title="Loňská + Letošní">
                      {formatLedgerValue(entitlement)}
                    </span>
                  </td>
                  {MONTHS.map((m) => {
                    const cell = months[String(m)];
                    return (
                      <td key={m} className={m === 1 ? styles.blockStart : undefined}>
                        <VacationLedgerCell
                          {...cellProps({ kind: "month", month: m })}
                          value={cell?.hours}
                          isManual={cell?.source === "manual"}
                          className={cell ? undefined : styles.muted}
                        />
                      </td>
                    );
                  })}
                  <td className={styles.blockStart}>
                    <span className={styles.derived}>{formatLedgerValue(consumed)}</span>
                  </td>
                  {showPaidOut && (
                    <td>
                      <VacationLedgerCell
                        {...cellProps({ kind: "paidOutHours" })}
                        value={paidOut}
                      />
                    </td>
                  )}
                  <td>
                    <span
                      className={`${styles.derived} ${
                        remaining != null && remaining < 0 ? styles.negative : ""
                      }`}
                    >
                      {formatLedgerValue(remaining)}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* The unit used to ride on every annual figure ("160 h"); with the
              months in the same row that would have been seventeen columns of
              mixed formatting, so it is stated once here instead. */}
          <div className={styles.legend}>
            <span>Všechny hodnoty jsou v hodinách.</span>
            {canManage && <span>Dvojklikem upravíte hodnotu.</span>}
            <span>* = ručně upraveno</span>
          </div>
            </>
          )}
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
