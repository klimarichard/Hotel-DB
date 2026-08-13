/**
 * Backend mirror of `frontend/src/lib/changeKinds.ts`.
 *
 * The two packages cannot share a module, so this file exists to keep the
 * duplication in ONE place per side rather than scattered across the three
 * routes/services that fold `changes[]`. If you add or rename a kind, change
 * both files — a mismatch does not fail the build, it just makes payroll and
 * the UI disagree about what an employee's contract says.
 *
 * The strings are stored in Firestore verbatim, so the legacy values must keep
 * working indefinitely.
 */

/** Merged úvazek change: hours in `value`, HPP/PPP in `contractType`. */
export const UVAZEK_KIND = "úvazek (počet hodin)";

/** Legacy free-text úvazek; HPP/PPP inferred from the wording. */
export const LEGACY_UVAZEK_KIND = "úvazek";

/** Legacy hours-only change; never touched the contract type. */
export const LEGACY_HOURS_KIND = "počet hodin";

/** Does this kind carry úvazek information, in any of its three spellings? */
export function isUvazekKind(kind: string | undefined): boolean {
  return (
    kind === UVAZEK_KIND || kind === LEGACY_UVAZEK_KIND || kind === LEGACY_HOURS_KIND
  );
}

/** One `changes[]` entry as stored. */
export interface StoredChange {
  changeKind?: string;
  value?: string;
  contractType?: string;
}

/**
 * Apply an úvazek change (merged or legacy) to a running fold.
 *
 * Returns the new values rather than mutating, so each caller keeps its own
 * variable names. Anything the change does not state is returned unchanged —
 * in particular the merged kind never *guesses* a contract type, unlike
 * `uvazekToContractType` which has to, because free text is all a legacy row
 * carries.
 */
export function applyUvazekChange(
  ch: StoredChange,
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
