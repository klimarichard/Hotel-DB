/**
 * Canonical employee display name used everywhere a person's name is rendered
 * (shift plan, payroll, overview, lists, dropdowns, …). When the employee has a
 * custom "Zobrazované jméno" it is used verbatim; otherwise it falls back to
 * "Jméno Příjmení" (first name then surname).
 *
 * Accepts either the standard { firstName, lastName } shape or the denormalised
 * alert shape { employeeFirstName, employeeLastName } via the second helper.
 */
export function employeeDisplayName(e: {
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): string {
  const custom = (e.displayName ?? "").trim();
  if (custom) return custom;
  return `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim();
}
