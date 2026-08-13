/**
 * The `changeKind` vocabulary used by Dodatek (`změna smlouvy`) rows.
 *
 * These strings are STORED IN FIRESTORE verbatim — the Dodatek form writes the
 * selected option straight into `changes[].changeKind` — so renaming a constant
 * here does not rename anything already saved. Every reader must keep handling
 * the legacy values below for as long as old Dodatky exist, which is forever.
 *
 * This module deliberately has no imports: it is pulled in by both
 * `contractVariables.ts` and `employmentSessions.ts`, and the latter already
 * imports the former, so anything with dependencies would risk a cycle.
 *
 * ⚠️ The backend folds the same vocabulary in `functions/src/services/changeKinds.ts`
 * (separate package, cannot share this file). Change one, change both.
 */

/**
 * Úvazek change: the new weekly-hours count in `value`, plus the HPP/PPP the
 * employee moves to in `contractType`.
 *
 * Introduced 2026-08-13, merging the two near-identical kinds below: "úvazek"
 * (free text, from which HPP/PPP was *guessed* by keyword) and "počet hodin"
 * (the number). Users had to add both rows to express one change, and the
 * guessing silently did nothing when the wording was unrecognised. The merged
 * kind states both facts explicitly.
 */
export const UVAZEK_KIND = "úvazek (počet hodin)";

/** Legacy free-text úvazek; HPP/PPP was inferred via `uvazekToContractType`. */
export const LEGACY_UVAZEK_KIND = "úvazek";

/** Legacy hours-only change; never touched the contract type. */
export const LEGACY_HOURS_KIND = "počet hodin";

/** Kinds offered for a NEW change row, in dropdown order. */
export const CHANGE_KINDS = [
  "mzda",
  "pracovní pozice",
  UVAZEK_KIND,
  "délka smlouvy",
] as const;

/**
 * Retired kinds, still readable and still editable when already on a row.
 * They are NOT offered for new rows, but the form adds the row's own kind to
 * its dropdown when it is one of these — otherwise opening an old Dodatek would
 * show an empty type and saving would erase it.
 */
export const LEGACY_CHANGE_KINDS: readonly string[] = [
  LEGACY_UVAZEK_KIND,
  LEGACY_HOURS_KIND,
];

/** Does this kind carry úvazek information, in any of its three spellings? */
export function isUvazekKind(kind: string | undefined): boolean {
  return (
    kind === UVAZEK_KIND || kind === LEGACY_UVAZEK_KIND || kind === LEGACY_HOURS_KIND
  );
}

/**
 * Apply an úvazek change (merged or legacy) to a running fold, returning the
 * new values rather than mutating.
 *
 * Shared by every frontend fold — the session state, and the Dodatek form's
 * minimum-wage preview — because those two disagreeing is not a type error: the
 * form would validate the new salary against the contract type the employee is
 * moving AWAY from, and either warn wrongly or stay silent when it should warn.
 *
 * `inferFromText` is a parameter so this module keeps no imports; the merged
 * kind never uses it, since it states the contract type outright.
 */
export function applyUvazekChange(
  ch: { changeKind?: string; value?: string; contractType?: string },
  current: { contractType: string; hoursPerWeek: number | null },
  inferFromText: (value: string) => "HPP" | "PPP" | null
): { contractType: string; hoursPerWeek: number | null } {
  let { contractType, hoursPerWeek } = current;
  if (ch.changeKind === UVAZEK_KIND) {
    const n = Number(ch.value);
    if (ch.value && Number.isFinite(n)) hoursPerWeek = n;
    if (ch.contractType === "HPP" || ch.contractType === "PPP") {
      contractType = ch.contractType;
    }
  } else if (ch.changeKind === LEGACY_UVAZEK_KIND && ch.value) {
    const mapped = inferFromText(ch.value);
    if (mapped) contractType = mapped;
  } else if (ch.changeKind === LEGACY_HOURS_KIND && ch.value) {
    const n = Number(ch.value);
    if (Number.isFinite(n)) hoursPerWeek = n;
  }
  return { contractType, hoursPerWeek };
}
