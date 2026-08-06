/**
 * Formatting for the remaining-vacation badge, shared by the shift plan (ShiftGrid)
 * and the payroll grid (PayrollPage).
 *
 * One module rather than a copy per page: the two badges show the SAME figure at
 * two different boundaries, so a formatting or wording drift between them would
 * read as a data disagreement rather than a cosmetic one.
 *
 * The number itself is computed server-side by projectedRemainingHours() — the
 * frontend never recomputes a balance from parts.
 */

/** Hour figure, Czech decimal comma, no trailing ".0". */
export function fmtVacationHours(hours: number): string {
  return `${String(Math.round(hours * 100) / 100).replace(".", ",")} h`;
}

/**
 * Spelled-out variant for the payroll grid, where the badge sits in a row of
 * numbers that all mean something else — a bare "96 h" there would read as one
 * more payroll column. The shift plan keeps the bare figure: its badge stands
 * alone beside the name, and the column is narrow.
 */
export function vacationRemainingLabel(hours: number): string {
  return `zbývá ${fmtVacationHours(hours)} dovolené`;
}

/**
 * Badge tooltip. `boundary` says which side of the month the figure sits on:
 *   "before" — shift plan: the balance the employee ENTERS the month with, i.e.
 *              the budget you are spending as you fill the grid.
 *   "after"  — payroll: the balance once this month's Dovolená is deducted, which
 *              is what the ledger will hold once the period is locked.
 *
 * `projectedMonths` are the months whose figures still come from an unlocked
 * payroll period. Naming them keeps the number from being read as settled — and
 * an empty list is itself information: everything in it is locked ledger data.
 */
export function vacationRemainingTitle(params: {
  hours: number;
  projectedMonths: number[];
  year: number;
  month: number;
  boundary: "before" | "after";
}): string {
  const { hours, projectedMonths, year, month, boundary } = params;
  const when =
    boundary === "before"
      ? `na začátku ${month}/${year}`
      : `po měsíci ${month}/${year}`;
  const base = `Zbývající dovolená ${when}: ${fmtVacationHours(hours)}`;
  if (projectedMonths.length === 0) return base;
  const list = projectedMonths.map((m) => `${m}/${year}`).join(", ");
  return `${base} – včetně předpokládané dovolené za ${list} (mzdy zatím nejsou uzamčené)`;
}
