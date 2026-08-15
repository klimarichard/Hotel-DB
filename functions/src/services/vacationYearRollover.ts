/**
 * Yearly vacation-entitlement rollover.
 *
 * At the turn of the calendar year every continuing employee gets a fresh
 * Letošní (this year's entitlement) written into `vacationLedger/{year}`, sized
 * by contract type. Without this the new year opens with an empty ledger: Nárok
 * is null, so Zůstatek is null too, and the whole vacation table reads as dashes
 * until somebody fills it in by hand.
 *
 * DELIBERATELY does NOT touch Loňská (`priorYearHours`). Carrying last year's
 * Zůstatek forward is a judgement call that belongs to a human — an employee who
 * overdrew would otherwise start the year silently in deficit, and the figure
 * has to be reconciled against the payroll system anyway. The rollover only ever
 * writes `currentYearHours`.
 *
 * Idempotent: an employee whose `currentYearHours` is already set is skipped, so
 * the scheduled 1 January run and any later manual re-run can both be executed
 * safely, and a value someone has since edited is never clobbered.
 */
import * as admin from "firebase-admin";
import { setLedgerAnnual } from "./vacationLedger";

const db = () => admin.firestore();

/**
 * Hours of Letošní each contract type starts a new calendar year with.
 *
 * Constants rather than a Nastavení setting: they follow from the contract
 * type's weekly hours and have never varied. Promote to a configurable setting
 * if they ever need to differ per company or per year — the shape here (a map
 * keyed by `currentContractType`) is already the shape a setting would take.
 */
export const YEARLY_ENTITLEMENT_HOURS: Record<string, number> = {
  HPP: 160,
  PPP: 80,
  DPP: 0,
};

export interface RolloverSkip {
  employeeId: string;
  name: string;
  contractType: string;
}

export interface RolloverResult {
  /** The year being seeded. */
  year: number;
  /** The year whose ledger supplies the employee list. */
  fromYear: number;
  candidates: number;
  written: number;
  skippedTerminated: number;
  skippedAlreadySet: number;
  skippedMissingEmployee: number;
  /**
   * Employees whose `currentContractType` is empty or is not one of
   * HPP/PPP/DPP. Never guessed — reported so a human can fix the record and
   * re-run. Prod has one such employee today.
   */
  skippedUnknownContract: RolloverSkip[];
  dryRun: boolean;
}

/**
 * Write the new year's entitlement for everyone carried over from `year - 1`.
 *
 * Scope is "everyone who has a ledger doc for the previous year", minus anyone
 * who had already left before the new year began. That is deliberately NOT "all
 * active employees": the previous year's ledger is the authoritative list of
 * people the vacation system was actually tracking.
 *
 * @param dryRun when true, computes and reports the plan without writing.
 */
export async function rolloverVacationEntitlement(params: {
  year: number;
  updatedBy: string | null;
  dryRun?: boolean;
}): Promise<RolloverResult> {
  const { year, updatedBy } = params;
  const dryRun = params.dryRun === true;
  const fromYear = year - 1;

  const result: RolloverResult = {
    year,
    fromYear,
    candidates: 0,
    written: 0,
    skippedTerminated: 0,
    skippedAlreadySet: 0,
    skippedMissingEmployee: 0,
    skippedUnknownContract: [],
    dryRun,
  };

  // Everyone the ledger tracked last year. Needs the vacationLedger.year
  // COLLECTION_GROUP fieldOverride in firestore.indexes.json.
  const prevSnap = await db()
    .collectionGroup("vacationLedger")
    .where("year", "==", fromYear)
    .get();

  const employeeIds: string[] = [];
  for (const d of prevSnap.docs) {
    const parent = d.ref.parent.parent;
    if (parent) employeeIds.push(parent.id);
  }
  result.candidates = employeeIds.length;
  if (employeeIds.length === 0) return result;

  // Employee records (status, contract type) and any ledger doc that already
  // exists for the target year — payroll may have locked January before this
  // ran, which creates the doc with months but no entitlement.
  const employees = new Map<string, Record<string, unknown>>();
  const existing = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < employeeIds.length; i += 100) {
    const chunk = employeeIds.slice(i, i + 100);
    const [empSnaps, ledSnaps] = await Promise.all([
      db().getAll(...chunk.map((id) => db().collection("employees").doc(id))),
      db().getAll(
        ...chunk.map((id) =>
          db().collection("employees").doc(id).collection("vacationLedger").doc(String(year))
        )
      ),
    ]);
    empSnaps.forEach((s) => {
      if (s.exists) employees.set(s.id, s.data() as Record<string, unknown>);
    });
    ledSnaps.forEach((s, idx) => {
      if (s.exists) existing.set(chunk[idx], s.data() as Record<string, unknown>);
    });
  }

  for (const employeeId of employeeIds) {
    const emp = employees.get(employeeId);
    if (!emp) {
      // Ledger doc outlived its employee doc. Nothing sensible to seed.
      result.skippedMissingEmployee++;
      continue;
    }

    // Anyone who had already left before 1 January of the new year gets no new
    // entitlement. A future-dated termination inside the new year still does —
    // they work part of it, and their payout is reconciled at that point.
    const endDate = (emp.employmentEndDate as string) ?? "";
    if (emp.status === "terminated" && endDate && endDate < `${year}-01-01`) {
      result.skippedTerminated++;
      continue;
    }

    const contractType = ((emp.currentContractType as string) ?? "").trim();
    const hours = YEARLY_ENTITLEMENT_HOURS[contractType];
    if (hours === undefined) {
      result.skippedUnknownContract.push({
        employeeId,
        name: `${(emp.lastName as string) ?? ""} ${(emp.firstName as string) ?? ""}`.trim(),
        contractType,
      });
      continue;
    }

    // Idempotence: never overwrite an entitlement that is already there, whether
    // this job wrote it on 1 January or a human corrected it on 3 January.
    const prior = existing.get(employeeId);
    if (prior && prior.currentYearHours !== null && prior.currentYearHours !== undefined) {
      result.skippedAlreadySet++;
      continue;
    }

    if (!dryRun) {
      await setLedgerAnnual({
        employeeId,
        year,
        field: "currentYearHours",
        hours,
        updatedBy,
      });
    }
    result.written++;
  }

  return result;
}
