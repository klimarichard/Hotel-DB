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
