/**
 * Kontrola mezd — vacation balance: payslip "Zůst.dov." vs the app's ledger.
 *
 * The payslip states remaining hours at the month's end split into Letošní /
 * Loňská / Dodatková; the app stores the entitlement (Loňská + Letošní) and
 * derives the remainder. Totals are compared, not buckets: the payroll system
 * books its own consumption order across the buckets, the app does not split.
 *
 * A difference is almost always entitlement drift – DPP and part-time
 * entitlement grows with the hours worked, which the accountant's system
 * recomputes monthly – so the offered correction moves Letošní nárok by the
 * difference, which makes the app's remainder equal the payslip's. The user
 * confirms each one; nothing is written automatically.
 */
import { matchNames, round2, type Slip } from "./core";
import { appEntryName, type AppCheckEntry } from "./appCheck";

export interface VacationFinding {
  entry: AppCheckEntry;
  slip: Slip;
  /** App remaining at the month's end; null when the app has no entitlement at all. */
  appRemaining: number | null;
  pdfRemaining: number;
  /** pdfRemaining − appRemaining (app's missing entitlement counts as 0). */
  delta: number;
  currentYearHours: number | null;
  /** Letošní nárok that makes the two balances equal. */
  proposedCurrentYearHours: number;
}

export function runVacationChecks(slips: Slip[], entries: AppCheckEntry[]): VacationFinding[] {
  const { pairs } = matchNames(entries.map(appEntryName), slips.map((s) => s.name));
  const out: VacationFinding[] = [];
  for (const { left, right } of pairs) {
    const entry = entries[left], slip = slips[right];
    if (!slip.vacation) continue; // unreadable block – reported as a warning
    const v = slip.vacation;
    const pdfRemaining = round2(v.letosni + v.lonska + v.dodatkova);
    const appRemaining = entry.vacation?.remainingHours ?? null;
    // With Nárok unset the balance is "–", but hours already taken still count:
    // size the correction as if Nárok were 0.
    const base = appRemaining ?? -((entry.vacation?.consumedHours ?? 0) + (entry.vacation?.paidOutHours ?? 0));
    const delta = round2(pdfRemaining - base);
    // Equal balances are fine – also with Nárok unset when nothing is on either side.
    if (Math.abs(delta) < 0.005 && (appRemaining !== null || pdfRemaining === 0)) continue;
    const currentYearHours = entry.vacation?.currentYearHours ?? null;
    out.push({
      entry,
      slip,
      appRemaining,
      pdfRemaining,
      delta,
      currentYearHours,
      proposedCurrentYearHours: round2((currentYearHours ?? 0) + delta),
    });
  }
  return out;
}
