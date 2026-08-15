/**
 * Vacation-hour ledger — per employee, per calendar year.
 *
 * Firestore: employees/{employeeId}/vacationLedger/{year}
 *   {
 *     year: number,
 *     priorYearHours: number | null,     // Loňská — carried over from last year
 *     currentYearHours: number | null,   // Letošní — this year's entitlement (+ dodat)
 *     paidOutHours: number | null,       // proplaceno
 *     months: { "1".."12": { hours, source, updatedAt, updatedBy } },  // čerpáno per month
 *     updatedAt, updatedBy,
 *   }
 *
 * Nárok (total entitlement) = priorYearHours + currentYearHours, DERIVED on read,
 * never stored — so it can't disagree with its two parts. (The pre-split model
 * stored a single `entitlementHours`; that field is deprecated and ignored on
 * read, and the seed deletes it.)
 *
 * The ledger is NOT computed by the app — it is fed from three sources, tagged per
 * cell so the origin of every figure stays visible:
 *   - "avensio-seed"  : the one-time H1-2026 import from the payroll system export
 *   - "payroll-lock"  : written automatically when a payroll period is locked
 *   - "manual"        : hand-edited on the employee detail page (gated by
 *                       employees.vacationBalance.manage)
 *
 * Remaining hours are DERIVED on read (entitlement − Σ months − paidOut), never
 * stored, so they can't drift from their inputs.
 *
 * All amounts are in HOURS — the same unit the payroll engine computes
 * (`vacationHours`) and the AVENSIO export uses, so no day↔hour conversion.
 */
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

export type VacationSource = "avensio-seed" | "payroll-lock" | "manual";

export interface LedgerMonth {
  hours: number;
  source: VacationSource;
  updatedAt: unknown;
  updatedBy: string | null;
}

export interface VacationLedger {
  year: number;
  priorYearHours: number | null;
  currentYearHours: number | null;
  paidOutHours: number | null;
  months: Record<string, LedgerMonth>;
  updatedAt?: unknown;
  updatedBy?: string | null;
}

const db = () => admin.firestore();

export function ledgerRef(
  employeeId: string,
  year: number
): admin.firestore.DocumentReference {
  return db()
    .collection("employees")
    .doc(employeeId)
    .collection("vacationLedger")
    .doc(String(year));
}

/** Sum of the monthly čerpáno figures. */
export function sumConsumed(months: Record<string, LedgerMonth> | undefined): number {
  if (!months) return 0;
  return Object.values(months).reduce((acc, m) => acc + (Number(m?.hours) || 0), 0);
}

/**
 * Nárok (total entitlement) = Loňská + Letošní. `null` only when BOTH parts are
 * unset (so an untouched ledger shows "–"); once either is set, the other counts
 * as 0.
 */
export function entitlementHours(
  priorYearHours: number | null | undefined,
  currentYearHours: number | null | undefined
): number | null {
  if (priorYearHours == null && currentYearHours == null) return null;
  return (priorYearHours ?? 0) + (currentYearHours ?? 0);
}

/** Remaining = Nárok − Σ consumed − paidOut. null when Nárok unset. */
export function remainingHours(
  ledger: Pick<VacationLedger, "priorYearHours" | "currentYearHours" | "paidOutHours" | "months">
): number | null {
  const ent = entitlementHours(ledger.priorYearHours, ledger.currentYearHours);
  if (ent == null) return null;
  return ent - sumConsumed(ledger.months) - (ledger.paidOutHours ?? 0);
}

/**
 * One employee's ledger for one year, in the shape BOTH read endpoints return:
 * the admin `GET /employees/:id/vacation-ledger` and the self-scoped
 * `GET /me/employee/vacation-ledger`. Shared so the two can never drift — the
 * frontend renders both through the same component, so a difference in shape
 * would break one of them silently.
 *
 * Nárok / čerpáno / zůstatek are derived here and never stored, so they can't
 * disagree with their parts. Returns null when the ledger has never been written
 * for that year.
 */
export async function readLedger(
  employeeId: string,
  year: number
): Promise<Record<string, unknown> | null> {
  const snap = await ledgerRef(employeeId, year).get();
  if (!snap.exists) return null;
  return projectLedger(snap.data() as Record<string, unknown>, year);
}

/**
 * Round a derived hour figure for display. The stored parts are whatever payroll
 * and the AVENSIO import put there, so summing them surfaces float noise
 * (127.99999999999999). `projectedRemainingHours` already rounds for exactly this
 * reason; every ledger read does it too, so no caller has to remember.
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Project a raw ledger document into the shape EVERY read path returns — the
 * admin `GET /employees/:id/vacation-ledger`, the self-scoped
 * `GET /me/employee/vacation-ledger`, and the aggregate overview table. Pure:
 * takes doc data, does no I/O, so the bulk reader can call it per document.
 *
 * Kept as ONE function rather than reimplemented per endpoint. Two copies of a
 * derivation that drift apart is this codebase's most expensive recurring bug
 * (see the two session walkers behind the Ukončení-row fix), and here the
 * aggregate table splices a row refreshed from the per-employee endpoint into a
 * response built by the bulk one — they MUST be the same object shape.
 */
export function projectLedger(
  data: Record<string, unknown>,
  year: number
): Record<string, unknown> {
  const months = (data.months as Record<string, LedgerMonth>) ?? {};
  const priorYearHours = (data.priorYearHours as number | null) ?? null;
  const currentYearHours = (data.currentYearHours as number | null) ?? null;
  const paidOutHours = (data.paidOutHours as number | null) ?? null;
  const entitlement = entitlementHours(priorYearHours, currentYearHours);
  const remaining = remainingHours({ priorYearHours, currentYearHours, paidOutHours, months });
  return {
    year,
    priorYearHours,
    currentYearHours,
    entitlementHours: entitlement === null ? null : round2(entitlement),
    paidOutHours,
    months,
    consumedHours: round2(sumConsumed(months)),
    remainingHours: remaining === null ? null : round2(remaining),
    updatedAt: data.updatedAt ?? null,
    updatedBy: data.updatedBy ?? null,
  };
}

/**
 * Lock state of every payroll period in `year`, by month.
 *
 * Lives here rather than in the payroll route because it is ledger-domain
 * knowledge: a month's lock state is what tells a ledger editor whether their
 * manual value is settled or will be overwritten by `feedVacationLedgerOnLock`
 * the next time that period is locked.
 *
 * Period doc IDs are auto-generated, NOT `${year}-${month}`, so this must be a
 * field query — never a doc-id lookup.
 */
export async function periodsForYear(
  year: number
): Promise<{ month: number; locked: boolean }[]> {
  const snap = await db().collection("payrollPeriods").where("year", "==", year).get();
  return snap.docs
    .map((d) => d.data() as Record<string, unknown>)
    .filter((p) => Number.isInteger(Number(p.month)))
    .map((p) => ({ month: Number(p.month), locked: p.locked === true }))
    .sort((a, b) => a.month - b.month);
}

/**
 * Upsert a single month's vacation hours. Idempotent by (employee, year, month):
 * a deep-merge write overwrites only `months.{month}`, leaving every other month
 * — and entitlement/paidOut — untouched. So re-locking a payroll period, or a
 * lock→unlock→lock cycle, overwrites the same slot instead of accumulating.
 *
 * `hours === null` clears that month.
 */
export async function upsertLedgerMonth(params: {
  employeeId: string;
  year: number;
  month: number; // 1..12
  hours: number | null;
  source: VacationSource;
  updatedBy: string | null;
}): Promise<void> {
  const { employeeId, year, month, hours, source, updatedBy } = params;
  const ref = ledgerRef(employeeId, year);
  const now = FieldValue.serverTimestamp();
  const monthValue =
    hours == null
      ? FieldValue.delete()
      : { hours, source, updatedAt: now, updatedBy: updatedBy ?? null };
  await ref.set(
    {
      year,
      months: { [String(month)]: monthValue },
      updatedAt: now,
      updatedBy: updatedBy ?? null,
    },
    { merge: true }
  );
}

/**
 * The vacation figure a payroll entry actually reports, in the SAME precedence
 * the payroll grid renders: manual override → Nemoc auto-override → computed
 * `vacationHours`. Reading the raw field alone would misreport anyone with a
 * sick-leave cascade.
 *
 * Shared by the lock feeder (what gets WRITTEN into the ledger, routes/payroll.ts)
 * and by `projectedRemainingHours` below (what the ledger is GOING to receive).
 * That sharing is the whole point: the projected balance shown while a month is
 * still unlocked must equal the figure that lands in the ledger when it locks, or
 * the number would visibly jump on lock and read as a bug.
 */
export function effectiveEntryVacationHours(entry: {
  vacationHours?: number;
  overrides?: Record<string, number>;
  autoOverrides?: Record<string, number>;
}): number {
  return (
    entry.overrides?.vacationHours ??
    entry.autoOverrides?.vacationHours ??
    entry.vacationHours ??
    0
  );
}

export interface ProjectedRemaining {
  /** employeeId → remaining hours, or null when the year has no ledger at all. */
  values: Record<string, number | null>;
  /** Months (1–12) whose figures came from an unlocked payroll period, not the ledger. */
  projectedMonths: number[];
}

/**
 * Remaining vacation hours per employee, PROJECTED forward over the months the
 * ledger has not been fed yet.
 *
 * Why a projection is needed at all: the ledger only learns a month's čerpáno when
 * that month's payroll period is LOCKED (`feedVacationLedgerOnLock`). So in August,
 * planning September, the stored Zůstatek is still the end-of-July figure — it
 * ignores the vacation August is already consuming. This walks months 1..
 * `throughMonth` and, for every month absent from the ledger, subtracts the
 * effective vacation hours of that month's payroll period entry instead.
 *
 * Presence in `months` is the test for "already counted" — not the period's lock
 * flag — because that is exactly what `remainingHours` subtracted. A month fed by
 * hand or by the AVENSIO seed therefore also counts once, never twice.
 *
 * Vacation is not planned in the shift grid: `payrollCalculator` derives it as
 * (úvazek-prorated target − worked hours), so the payroll entry is the ONLY place
 * an unlocked month's figure exists. A month with no payroll period (plan never
 * published) contributes nothing — `projectedMonths` reports what was actually
 * folded in so the UI can say so rather than implying full coverage.
 *
 * `null` for an employee whose ledger year does not exist, or whose Nárok was never
 * set — an honest "–" beats a fabricated 0.
 */
export async function projectedRemainingHours(params: {
  employeeIds: string[];
  year: number;
  /** Inclusive upper bound, 0–12. 0 = ledger only, no projection. */
  throughMonth: number;
  /**
   * Period refs the caller already holds, by month. Lets the payroll endpoint
   * project its OWN period rather than re-resolving it by (year, month) query.
   */
  knownPeriods?: Map<number, admin.firestore.DocumentReference>;
}): Promise<ProjectedRemaining> {
  const { employeeIds, year, throughMonth, knownPeriods } = params;
  const values: Record<string, number | null> = {};
  const projectedMonths: number[] = [];
  const ids = [...new Set(employeeIds)].filter(Boolean);
  if (ids.length === 0) return { values, projectedMonths };

  // Ledger per employee. getAll is chunked — a plan can carry more employees than
  // is comfortable in a single batch read.
  const ledgerMonths = new Map<string, Record<string, LedgerMonth>>();
  const running = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const snaps = await db().getAll(...chunk.map((id) => ledgerRef(id, year)));
    snaps.forEach((snap, idx) => {
      const employeeId = chunk[idx];
      if (!snap.exists) {
        values[employeeId] = null;
        return;
      }
      const data = snap.data() as Record<string, unknown>;
      const months = (data.months as Record<string, LedgerMonth>) ?? {};
      const rem = remainingHours({
        priorYearHours: (data.priorYearHours as number | null) ?? null,
        currentYearHours: (data.currentYearHours as number | null) ?? null,
        paidOutHours: (data.paidOutHours as number | null) ?? null,
        months,
      });
      if (rem == null) {
        values[employeeId] = null;
        return;
      }
      ledgerMonths.set(employeeId, months);
      running.set(employeeId, rem);
    });
  }
  if (running.size === 0) return { values, projectedMonths };

  for (let month = 1; month <= Math.min(12, throughMonth); month++) {
    // Only employees still missing THIS month need the period read at all. In
    // practice every earlier month is locked, so this skips straight to the one
    // or two open months instead of reading a year of entries.
    const pending = new Set(
      [...running.keys()].filter((id) => !(String(month) in (ledgerMonths.get(id) ?? {})))
    );
    if (pending.size === 0) continue;

    let periodRef = knownPeriods?.get(month) ?? null;
    if (!periodRef) {
      const snap = await db()
        .collection("payrollPeriods")
        .where("year", "==", year)
        .where("month", "==", month)
        .limit(1)
        .get();
      if (snap.empty) continue;
      periodRef = snap.docs[0].ref;
    }

    const entriesSnap = await periodRef.collection("entries").get();
    let folded = false;
    for (const d of entriesSnap.docs) {
      const e = d.data() as {
        employeeId?: string;
        vacationHours?: number;
        overrides?: Record<string, number>;
        autoOverrides?: Record<string, number>;
      };
      const employeeId = e.employeeId ?? d.id;
      if (!pending.has(employeeId)) continue;
      running.set(employeeId, running.get(employeeId)! - effectiveEntryVacationHours(e));
      folded = true;
    }
    if (folded) projectedMonths.push(month);
  }

  for (const [employeeId, rem] of running) {
    // Two decimals: the inputs are hour figures, and float subtraction otherwise
    // surfaces as 127.99999999999999 in the badge.
    values[employeeId] = Math.round(rem * 100) / 100;
  }
  return { values, projectedMonths };
}

/** Set an annual field (Loňská / Letošní / proplaceno). null clears it. */
export async function setLedgerAnnual(params: {
  employeeId: string;
  year: number;
  field: "priorYearHours" | "currentYearHours" | "paidOutHours";
  hours: number | null;
  updatedBy: string | null;
}): Promise<void> {
  const { employeeId, year, field, hours, updatedBy } = params;
  await ledgerRef(employeeId, year).set(
    {
      year,
      [field]: hours,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: updatedBy ?? null,
    },
    { merge: true }
  );
}
