import { useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import * as clock from "@/lib/clock";
import { employeeSurnameFirst } from "@/lib/employeeName";
import ConfirmModal from "./ConfirmModal";
import VacationLedgerCell, { formatLedgerValue } from "./VacationLedgerCell";
import styles from "./VacationLedgerTable.module.css";

/**
 * "Přehled čerpání dovolené" – every employee's vacation-hour ledger for one
 * year in a single grid, mirroring the AVENSIO "Roční přehled čerpání dovolené"
 * export so the two can be reconciled side by side.
 *
 * Fed by GET /api/vacation/ledger-overview, which is gated on
 * employees.vacationBalance.manage – the same key that makes the cells
 * editable, so this component is only ever mounted for a manager. Cells are the
 * shared VacationLedgerCell (double-click to edit), identical in behaviour to
 * the per-employee section on the employee detail page.
 *
 * Nárok / Čerpáno / Zůstatek are DERIVED server-side and never recomputed here:
 * after a PATCH the response's re-projected ledger is spliced into the row, so
 * the table can never disagree with the source of the math.
 */

type LedgerSource = "avensio-seed" | "payroll-lock" | "manual";

interface LedgerMonth {
  hours: number;
  source: LedgerSource;
}

/** The projectLedger payload, shared by the overview rows and the PATCH reply. */
interface LedgerPayload {
  year: number;
  priorYearHours: number | null;
  currentYearHours: number | null;
  entitlementHours: number | null;
  paidOutHours: number | null;
  months: Record<string, LedgerMonth>;
  consumedHours: number;
  remainingHours: number | null;
}

interface OverviewRow extends LedgerPayload {
  employeeId: string;
  firstName: string;
  lastName: string;
  status: string;
  employmentEndDate: string;
  contractType: string;
  /** The ledger doc outlived its employee doc – no name to show. */
  employeeMissing: boolean;
}

interface Overview {
  year: number;
  periods: { month: number; locked: boolean }[];
  rows: OverviewRow[];
}

type EditTarget =
  | { kind: "month"; month: number }
  | { kind: "priorYearHours" }
  | { kind: "currentYearHours" }
  | { kind: "paidOutHours" };

/** Earliest year the switcher offers (see VacationLedgerSection). */
const MIN_YEAR = 2022;

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

const collator = new Intl.Collator("cs", { sensitivity: "base", numeric: true });

function sameTarget(a: EditTarget, b: EditTarget): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "month" && b.kind === "month") return a.month === b.month;
  return true;
}

/** Sum of the non-null values, rounded away from binary-float noise. */
function sum(values: (number | null | undefined)[]): number {
  const total = values.reduce<number>((acc, v) => acc + (v ?? 0), 0);
  return Math.round(total * 100) / 100;
}

export default function VacationLedgerTable({ canManage }: { canManage: boolean }) {
  // Via clock, not `new Date()`, so the non-prod test clock moves the ceiling too.
  const currentYear = Number(clock.today().slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<OverviewRow[]>([]);
  const [periods, setPeriods] = useState<{ month: number; locked: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [edit, setEdit] = useState<{ employeeId: string; target: EditTarget } | null>(null);
  const [saving, setSaving] = useState(false);
  const [errModal, setErrModal] = useState<string | null>(null);

  // Loaded even while collapsed so the header can show how many people the
  // year covers – that count is what tells a reader whether opening it is worth
  // it, and it is one query.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(false);
    setEdit(null);
    api
      .get<Overview>(`/vacation/ledger-overview?year=${year}`)
      .then((data) => {
        if (!alive) return;
        setRows(data.rows ?? []);
        setPeriods(data.periods ?? []);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setRows([]);
        setPeriods([]);
        setLoadError(true);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [year]);

  const sorted = useMemo(() => {
    const key = (r: OverviewRow) =>
      r.employeeMissing ? r.employeeId : employeeSurnameFirst(r);
    return [...rows].sort((a, b) => {
      // Leavers sink to the bottom. They belong in the table — they hold most
      // of the Proplaceno figures — but their rows are settled history, so
      // interleaving them with current staff makes the live half harder to scan.
      const at = a.status === "terminated" ? 1 : 0;
      const bt = b.status === "terminated" ? 1 : 0;
      if (at !== bt) return at - bt;
      return collator.compare(key(a), key(b));
    });
  }, [rows]);

  /** Index of the first leaver, so only that row draws the divider. */
  const firstTerminated = useMemo(
    () => sorted.findIndex((r) => r.status === "terminated"),
    [sorted]
  );

  /** month → locked; a month absent from the map has no payroll period at all. */
  const periodMap = useMemo(
    () => new Map(periods.map((p) => [p.month, p.locked])),
    [periods]
  );

  const totals = useMemo(
    () => ({
      prior: sum(rows.map((r) => r.priorYearHours)),
      current: sum(rows.map((r) => r.currentYearHours)),
      entitlement: sum(rows.map((r) => r.entitlementHours)),
      months: MONTHS.map((m) => sum(rows.map((r) => r.months?.[String(m)]?.hours))),
      consumed: sum(rows.map((r) => r.consumedHours)),
      paidOut: sum(rows.map((r) => r.paidOutHours)),
      remaining: sum(rows.map((r) => r.remainingHours)),
    }),
    [rows]
  );

  async function save(employeeId: string, target: EditTarget, hours: number | null) {
    const body =
      target.kind === "month"
        ? { month: target.month, hours }
        : target.kind === "priorYearHours"
          ? { priorYearHours: hours }
          : target.kind === "currentYearHours"
            ? { currentYearHours: hours }
            : { paidOutHours: hours };
    setSaving(true);
    try {
      const res = await api.patch<{ success: boolean; ledger: LedgerPayload | null }>(
        `/employees/${employeeId}/vacation-ledger/${year}`,
        body
      );
      const ledger = res.ledger;
      // Splice the server's own re-projection into the row – never recompute
      // Nárok/Čerpáno/Zůstatek here. Spread ONTO the row: the PATCH reply
      // carries no name/status/contract fields.
      if (ledger) {
        setRows((rs) => rs.map((r) => (r.employeeId === employeeId ? { ...r, ...ledger } : r)));
      }
      setEdit(null);
    } catch (e) {
      setErrModal(errorMessage(e, "Uložení se nezdařilo."));
    } finally {
      setSaving(false);
    }
  }

  /** Shared wiring for every editable cell in the grid. */
  function cellProps(employeeId: string, target: EditTarget) {
    return {
      editing: edit != null && edit.employeeId === employeeId && sameTarget(edit.target, target),
      canManage,
      // Month cells are čerpáno counts and must be ≥ 0; the annual figures may
      // be negative (deficit carried forward / balancing payout).
      allowNegative: target.kind !== "month",
      saving,
      editableClassName: styles.editable,
      overriddenClassName: styles.overridden,
      inputClassName: styles.input,
      onStartEdit: () => {
        // With ~800 cells, clicking straight from an open cell into another
        // fires that cell's blur→save AND this dblclick. Let the save land
        // first rather than opening an editor over a row about to be replaced.
        if (saving) return;
        setEdit({ employeeId, target });
      },
      onCommit: (hours: number | null) => void save(employeeId, target, hours),
      onCancel: () => setEdit(null),
      onError: (message: string) => setErrModal(message),
    };
  }

  function monthHeadState(m: number): { glyph: string; title: string; locked: boolean } {
    if (!periodMap.has(m)) {
      return { glyph: "", title: "Mzdové období zatím neexistuje", locked: false };
    }
    if (periodMap.get(m)) {
      return {
        glyph: "🔒",
        title: `Mzdové období ${m}/${year} je uzamčeno`,
        locked: true,
      };
    }
    return {
      glyph: "⚠",
      title: `Období ${m}/${year} zatím není uzamčeno – při uzamčení mzdy bude ručně zadaná hodnota přepsána.`,
      locked: false,
    };
  }

  return (
    <div className={styles.section}>
      {/* The year switcher lives in the body, never in this button – nested
          interactive elements are invalid HTML. */}
      <button
        type="button"
        className={styles.collapsibleHeader}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={styles.collapsibleChevron} aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        <span>Přehled čerpání dovolené</span>
        <span className={styles.collapsibleCount}>({rows.length})</span>
      </button>

      {open && (
        <div className={styles.body}>
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

          {loading ? (
            <div className={styles.state}>Načítám…</div>
          ) : loadError ? (
            <div className={styles.state}>Přehled se nepodařilo načíst.</div>
          ) : sorted.length === 0 ? (
            <div className={styles.state}>Pro rok {year} nejsou žádné údaje.</div>
          ) : (
            <>
              <div className={styles.scroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th rowSpan={2} className={`${styles.headCell} ${styles.nameHead}`}>
                        Jméno
                      </th>
                      <th rowSpan={2} className={`${styles.headCell} ${styles.sumHead}`}>
                        Loňská
                      </th>
                      <th rowSpan={2} className={`${styles.headCell} ${styles.sumHead}`}>
                        Letošní
                      </th>
                      <th rowSpan={2} className={`${styles.headCell} ${styles.sumHead}`}>
                        Nárok
                      </th>
                      <th
                        colSpan={12}
                        className={`${styles.headCell} ${styles.groupHead}`}
                      >
                        Měsíce
                      </th>
                      <th rowSpan={2} className={`${styles.headCell} ${styles.sumHead} ${styles.blockStart}`}>
                        Čerpáno
                      </th>
                      <th rowSpan={2} className={`${styles.headCell} ${styles.sumHead}`}>
                        Proplaceno
                      </th>
                      <th rowSpan={2} className={`${styles.headCell} ${styles.sumHead}`}>
                        Zůstatek
                      </th>
                    </tr>
                    <tr>
                      {MONTHS.map((m) => {
                        const st = monthHeadState(m);
                        return (
                          <th
                            key={m}
                            title={st.title}
                            className={[
                              styles.monthHeadCell,
                              m === 1 ? styles.blockStart : "",
                              st.locked ? styles.lockedCol : "",
                              periodMap.has(m) ? "" : styles.muted,
                            ]
                              .join(" ")
                              .trim()}
                          >
                            {m}
                            {st.glyph && (
                              <span
                                aria-hidden="true"
                                className={`${styles.lockGlyph} ${st.locked ? "" : styles.lockGlyphOpen}`}
                              >
                                {st.glyph}
                              </span>
                            )}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((r, i) => {
                      const terminated = r.status === "terminated";
                      return (
                        <tr
                          key={r.employeeId}
                          className={[
                            styles.row,
                            terminated ? styles.terminatedRow : "",
                            // Only the first leaver draws the divider that
                            // separates current staff from history.
                            i === firstTerminated ? styles.terminatedFirst : "",
                          ]
                            .join(" ")
                            .trim()}
                        >
                          <td className={styles.nameCell}>
                            {r.employeeMissing ? (
                              <>
                                <span className={styles.orphanId}>{r.employeeId}</span>
                                <span
                                  className={`${styles.pill} ${styles.pillMissing}`}
                                  title="Záznam zaměstnance už neexistuje, evidence dovolené zůstala."
                                >
                                  chybí zaměstnanec
                                </span>
                              </>
                            ) : (
                              <>
                                {employeeSurnameFirst(r)}
                                {r.contractType && (
                                  <span className={styles.pill}>{r.contractType}</span>
                                )}
                                {terminated && (
                                  <span
                                    className={styles.pill}
                                    title={
                                      r.employmentEndDate
                                        ? `Ukončeno k ${r.employmentEndDate}`
                                        : undefined
                                    }
                                  >
                                    ukončeno
                                  </span>
                                )}
                              </>
                            )}
                          </td>
                          <td>
                            <VacationLedgerCell
                              {...cellProps(r.employeeId, { kind: "priorYearHours" })}
                              value={r.priorYearHours}
                            />
                          </td>
                          <td>
                            <VacationLedgerCell
                              {...cellProps(r.employeeId, { kind: "currentYearHours" })}
                              value={r.currentYearHours}
                            />
                          </td>
                          <td>
                            <span className={styles.derived} title="Loňská + Letošní">
                              {formatLedgerValue(r.entitlementHours)}
                            </span>
                          </td>
                          {MONTHS.map((m) => {
                            const cell = r.months?.[String(m)];
                            return (
                              <td
                                key={m}
                                className={[
                                  m === 1 ? styles.blockStart : "",
                                  periodMap.get(m) ? styles.lockedCol : "",
                                ]
                                  .join(" ")
                                  .trim()}
                              >
                                <VacationLedgerCell
                                  {...cellProps(r.employeeId, { kind: "month", month: m })}
                                  value={cell?.hours}
                                  isManual={cell?.source === "manual"}
                                  className={cell ? undefined : styles.muted}
                                />
                              </td>
                            );
                          })}
                          <td className={styles.blockStart}>
                            <span className={styles.derived}>
                              {formatLedgerValue(r.consumedHours)}
                            </span>
                          </td>
                          <td>
                            <VacationLedgerCell
                              {...cellProps(r.employeeId, { kind: "paidOutHours" })}
                              value={r.paidOutHours}
                            />
                          </td>
                          <td>
                            <span
                              className={`${styles.derived} ${
                                r.remainingHours != null && r.remainingHours < 0
                                  ? styles.negative
                                  : ""
                              }`}
                            >
                              {formatLedgerValue(r.remainingHours)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {/* Column sums – the first thing anyone reconciling against
                        the AVENSIO export looks for. */}
                    <tr className={styles.totalsRow}>
                      <td className={styles.nameCell}>CELKEM ({sorted.length})</td>
                      <td>{formatLedgerValue(totals.prior)}</td>
                      <td>{formatLedgerValue(totals.current)}</td>
                      <td>{formatLedgerValue(totals.entitlement)}</td>
                      {MONTHS.map((m, i) => (
                        <td key={m} className={m === 1 ? styles.blockStart : undefined}>
                          {formatLedgerValue(totals.months[i])}
                        </td>
                      ))}
                      <td className={styles.blockStart}>{formatLedgerValue(totals.consumed)}</td>
                      <td>{formatLedgerValue(totals.paidOut)}</td>
                      <td>{formatLedgerValue(totals.remaining)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className={styles.legend}>
                <span>Všechny hodnoty jsou v hodinách.</span>
                {canManage && <span>Dvojklikem upravíte hodnotu.</span>}
                <span>* = ručně upraveno</span>
                <span>🔒 = mzdové období je uzamčeno</span>
                <span>
                  ⚠ = období není uzamčeno, ruční hodnota bude při uzamčení mzdy přepsána
                </span>
                <span>měsíc bez značky = mzdové období zatím neexistuje</span>
              </div>
            </>
          )}
        </div>
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
