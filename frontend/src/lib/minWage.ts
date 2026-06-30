/**
 * Minimum-wage check (#2). Single source of truth shared by the contract-entry
 * warning (EmployeeDetailPage), the settings-change warning (SettingsPage) and
 * the read-only prod audit script.
 *
 * Thresholds (monthly gross), per the 2026-06-30 Q&A:
 *   • HPP → the full minimum wage.
 *   • PPP / part-time → (minWage / 40) × hoursPerWeek. A PPP row with no
 *     hoursPerWeek set is treated as 20 h/week (the legacy "poloviční úvazek").
 *   • DPP → NOT checked (paid hourly / agreed reward).
 *
 * Part A is warn-only and additive — this helper does NOT change any pay
 * computation; the part-time base-hours proration is Part B.
 */

const FULLTIME_HOURS_PER_WEEK = 40;
const DEFAULT_PPP_HOURS = 20;

/**
 * Monthly-gross minimum-wage threshold for a contract type. Returns null for
 * types that aren't checked (DPP, unknown) or when minWage is not a positive
 * number.
 */
export function minWageThreshold(
  contractType: string,
  minWage: number,
  hoursPerWeek?: number | null
): number | null {
  if (!Number.isFinite(minWage) || minWage <= 0) return null;
  if (contractType === "HPP") return Math.round(minWage);
  if (contractType === "PPP") {
    const h = hoursPerWeek && hoursPerWeek > 0 ? hoursPerWeek : DEFAULT_PPP_HOURS;
    return Math.round((minWage / FULLTIME_HOURS_PER_WEEK) * h);
  }
  return null; // DPP and anything else: not checked
}

/**
 * True when a monthly salary is strictly below the type's threshold. A null /
 * non-finite salary or an unchecked type returns false (nothing to warn about).
 */
export function isBelowMinWage(
  contractType: string,
  salary: number | null | undefined,
  minWage: number,
  hoursPerWeek?: number | null
): boolean {
  const threshold = minWageThreshold(contractType, minWage, hoursPerWeek);
  if (threshold == null) return false;
  if (salary == null || !Number.isFinite(salary)) return false;
  return salary < threshold;
}

/** "39000" → "39 000" (Czech thousands grouping with a non-breaking space). */
export function formatCzk(value: number): string {
  return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
