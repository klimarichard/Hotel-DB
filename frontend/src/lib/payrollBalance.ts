/**
 * Payroll balance — Výkaz + Dovolená + Nemoc = target (HPP: base, PPP: base/2).
 *
 * MIRROR: keep in exact sync with the balance block in
 * functions/src/services/payrollCalculator.ts → calculateEntry().
 *
 * Pure + idempotent: always recomputed from the CLEAN (pre-Nemoc, pre-override)
 * worked total, so re-editing Nemoc never compounds (the bug where lowering
 * Nemoc left Dovolená stuck). Nemoc fills Dovolená first, then pushes worked
 * hours out of Výkaz; worked hours not in Výkaz (overtime + Nemoc-displaced)
 * spill to SVÁTEK first (up to maxHolidayHours), the remainder to NAVÍC.
 */

export type BalanceField =
  | "reportHours" | "vacationHours" | "holidayHours" | "extraPay";

export interface BalanceInput {
  /** Clean worked total = entry.reportHours + entry.extraHours (base-independent). */
  workedTotal: number;
  /** Clean worked-holiday hours = entry.holidayHours. */
  cleanHoliday: number;
  contractType: string;
  hourlyRate: number | null;
  base: number;
  nemoc: number;
  maxHolidayHours: number;
  /** User-pinned Výkaz (overrides.reportHours), if any. */
  reportOverride?: number;
  /** User-pinned Svátek / Navíc — when set, the balance won't auto-fill them. */
  holidayOverride?: number;
  extraPayOverride?: number;
}

export interface BalanceResult {
  vykaz: number;
  dovolena: number;
  holiday: number;        // SVÁTEK after spill transfer
  navicHours: number;
  navicPay: number;       // raw net NAVÍC
  transferToSvatek: number;
  vacTarget: number;      // base (HPP) or base/2 (PPP)
  sum: number;            // vykaz + dovolena + nemoc
  /** Výkaz with no manual override — for the dialog's "follow auto" behaviour. */
  naturalVykaz: number;
  autoOverrides: Partial<Record<BalanceField, number>>;
  // Clean (pre-Nemoc, pre-override) values for the resolved base — let callers
  // keep local entry state consistent after a Základ override.
  cleanReport: number;
  cleanVacation: number;
  cleanExtra: number;
}

export function computeBalance(inp: BalanceInput): BalanceResult {
  const isDpp = inp.contractType === "DPP";
  const isPpp = inp.contractType === "PPP";
  const W = inp.workedTotal;
  const B = inp.base;
  const N = inp.nemoc;
  const rate = inp.hourlyRate ?? 0;

  const cleanReport = Math.min(B, W);
  const cleanExtra = Math.max(0, W - B);
  const vacTarget = isDpp ? 0 : (isPpp ? B / 2 : B);
  const cleanVacation = Math.max(0, vacTarget - cleanReport);
  const cleanExtraPay = (!isDpp && cleanExtra > 0 && rate > 0) ? rate * cleanExtra : 0;
  const cleanHoliday = inp.cleanHoliday;

  // Výkaz with no override, for the "follow auto" UX.
  const vacAtClean = Math.max(0, vacTarget - cleanReport);
  const naturalVykaz = Math.max(0, cleanReport - Math.max(0, N - vacAtClean));

  const hasVykazOv = inp.reportOverride !== undefined;
  const V0 = hasVykazOv ? (inp.reportOverride as number) : cleanReport;
  const vacAtV0 = Math.max(0, vacTarget - V0);
  const nemocIntoVykaz = hasVykazOv ? 0 : Math.max(0, N - vacAtV0);
  const V = isDpp ? 0 : Math.max(0, V0 - nemocIntoVykaz);
  const D = isDpp ? 0 : Math.max(0, vacTarget - V - N);
  const spill = isDpp ? 0 : Math.max(0, W - V);

  const availHol = Math.max(0, inp.maxHolidayHours - cleanHoliday);
  const transferH = Math.min(spill, availHol);
  const holiday = cleanHoliday + transferH;
  const navicHours = spill - transferH;
  const navicPay = rate > 0 ? rate * navicHours : 0;

  const autoOverrides: Partial<Record<BalanceField, number>> = {};
  if (!isDpp) {
    if (!hasVykazOv && V !== cleanReport) autoOverrides.reportHours = V;
    if (D !== cleanVacation) autoOverrides.vacationHours = D;
    if (inp.holidayOverride === undefined && holiday !== cleanHoliday) autoOverrides.holidayHours = holiday;
    if (inp.extraPayOverride === undefined && navicPay !== cleanExtraPay) autoOverrides.extraPay = navicPay;
  }

  return {
    vykaz: V,
    dovolena: D,
    holiday,
    navicHours,
    navicPay,
    transferToSvatek: transferH,
    vacTarget,
    sum: V + D + N,
    naturalVykaz,
    autoOverrides,
    cleanReport,
    cleanVacation,
    cleanExtra,
  };
}
