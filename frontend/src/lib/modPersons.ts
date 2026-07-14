/**
 * MOD (Manager on Duty) letter resolution — the single source of truth.
 *
 * A plan stores `modPersons` as letter → employeeId. This inverts it to
 * employeeId → letter, which is what every consumer actually wants.
 *
 * WHY THIS EXISTS. Until v4.7.1 the letters were seeded from MOD_PERSONS, a
 * hardcoded table of six real employees' names in the source, matched by string
 * equality against the plan roster. That was wrong in three separate ways:
 *
 *   1. The matching logic was reimplemented at four call sites and they DISAGREED.
 *      The CSV export compared surname-first ("Novák Jan") while the table stored
 *      first-name-first ("Jan Novák"), so its static pass never matched anything.
 *   2. That masked a second bug in the same export: it seeded overrides by
 *      employeeId and then let the static pass run for anyone not yet assigned, so
 *      reassigning a letter left the originally-named person holding it too - two
 *      employees, same letter.
 *   3. Matching on the name at all is brittle. Since v4.6.0 plan rows carry the
 *      LIVE employee name, so correcting a typo in someone's legal name would
 *      silently drop their MOD letter.
 *
 * Now the letter lives only in `modPersons` (keyed by employeeId, which is stable),
 * so none of the above can happen. Existing plans were backfilled; `copy-employees`
 * carries the assignments into the next month.
 */

/** employeeId → MOD letter, from a plan's stored `modPersons` (letter → employeeId). */
export function modLettersByEmployeeId(
  modPersons: Record<string, string> | undefined | null
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [letter, employeeId] of Object.entries(modPersons ?? {})) {
    // A letter with no assignee (or a malformed entry) simply isn't assigned.
    if (typeof employeeId === "string" && employeeId !== "") out.set(employeeId, letter);
  }
  return out;
}

/** The employee holding `letter` in this plan, or undefined when unassigned. */
export function modEmployeeIdForLetter(
  modPersons: Record<string, string> | undefined | null,
  letter: string
): string | undefined {
  if (!letter) return undefined;
  const id = (modPersons ?? {})[letter];
  return typeof id === "string" && id !== "" ? id : undefined;
}
