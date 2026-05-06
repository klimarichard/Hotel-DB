import { ContractType, CHANGE_TYPE_TO_CONTRACTS } from "./contractVariables";

export interface ChangeRow {
  changeKind: string;
  value: string;
  contractText: string;
}

export interface EmploymentRow {
  id: string;
  companyId: string;
  contractType: string;
  jobTitle: string;
  department: string;
  startDate: string;
  endDate: string | null;
  changeType: string;
  salary?: number;
  hourlyRate?: number | null;
  workLocation?: string;
  probationPeriod?: string;
  agreedWorkScope?: string;
  agreedReward?: number;
  signingDate?: string;
  changes?: ChangeRow[];
}

export interface ContractRecord {
  id: string;
  type: ContractType;
  status: "unsigned" | "signed" | "archived";
  employmentRowId?: string;
  rowSnapshot?: Record<string, unknown>;
  unsignedStoragePath?: string;
  signedStoragePath?: string;
  generatedAt?: { _seconds: number; _nanoseconds: number } | null;
  signedAt?: { _seconds: number; _nanoseconds: number } | null;
  notes?: string;
  displayName?: string;
}

/**
 * Effective state of an employment session — what the contract looks like
 * "right now" after walking the Nástup row and folding any subsequent
 * Dodatek `changes[]` on top.
 */
export interface EffectiveState {
  companyId: string;
  jobTitle: string;
  department: string;
  contractType: string;
  startDate: string;
  endDate: string | null;
  salary: number | null;
  agreedReward: number | null;
}

/**
 * One employment "session": a Nástup row, all Dodatek rows that followed
 * (in chronological order), and the Ukončení row that closed it (if any).
 * Sessions are derived client-side — they aren't stored in Firestore.
 */
export interface EmploymentSession {
  nastup: EmploymentRow;
  dodatky: EmploymentRow[];
  ukonceni: EmploymentRow | null;
  /** All rows in the session in chronological order (for rendering). */
  rows: EmploymentRow[];
  effective: EffectiveState;
  terminated: boolean;
}

/**
 * Group employment rows into sessions. Walks rows in startDate-asc order;
 * each `nástup` opens a new session, `změna smlouvy` rows append to the
 * current session, and `ukončení` closes it. Returns sessions in their
 * natural (chronological) order — newest last. Caller can reverse for
 * newest-first display.
 */
export function groupBySession(rows: EmploymentRow[]): EmploymentSession[] {
  const sorted = [...rows].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const sessions: EmploymentSession[] = [];
  let current: {
    nastup: EmploymentRow;
    dodatky: EmploymentRow[];
    ukonceni: EmploymentRow | null;
  } | null = null;

  function flush() {
    if (!current) return;
    const rowsInOrder = [
      current.nastup,
      ...current.dodatky,
      ...(current.ukonceni ? [current.ukonceni] : []),
    ];
    sessions.push({
      nastup: current.nastup,
      dodatky: current.dodatky,
      ukonceni: current.ukonceni,
      rows: rowsInOrder,
      effective: computeEffectiveState(current.nastup, current.dodatky, current.ukonceni),
      terminated: !!current.ukonceni,
    });
    current = null;
  }

  for (const r of sorted) {
    if (r.changeType === "nástup") {
      flush();
      current = { nastup: r, dodatky: [], ukonceni: null };
    } else if (r.changeType === "změna smlouvy" && current) {
      current.dodatky.push(r);
    } else if (r.changeType === "ukončení" && current) {
      current.ukonceni = r;
    }
    // Orphan rows (no preceding Nástup) are silently dropped — rare in practice
    // and would indicate dirty data; the row still persists in Firestore.
  }
  flush();
  return sessions;
}

/**
 * Fold Dodatek `changes[]` onto a Nástup row to derive the effective state
 * at session end. Change kinds:
 *   - mzda           → salary (or agreedReward for DPP)
 *   - pracovní pozice → jobTitle
 *   - úvazek          → contractText only (no root field today)
 *   - délka smlouvy   → endDate
 */
export function computeEffectiveState(
  nastup: EmploymentRow,
  dodatky: EmploymentRow[],
  ukonceni: EmploymentRow | null
): EffectiveState {
  let jobTitle = nastup.jobTitle ?? "";
  let salary = nastup.salary ?? null;
  let agreedReward = nastup.agreedReward ?? null;
  let endDate = nastup.endDate ?? null;
  const contractType = nastup.contractType ?? "";

  for (const dod of dodatky) {
    for (const ch of dod.changes ?? []) {
      if (ch.changeKind === "pracovní pozice" && ch.value) {
        jobTitle = ch.value;
      } else if (ch.changeKind === "mzda" && ch.value) {
        const n = Number(ch.value);
        if (Number.isFinite(n)) {
          if (contractType === "DPP") agreedReward = n;
          else salary = n;
        }
      } else if (ch.changeKind === "délka smlouvy" && ch.value) {
        endDate = ch.value;
      }
    }
  }

  // Ukončení row's startDate is the actual end of the session.
  if (ukonceni && ukonceni.startDate) {
    endDate = ukonceni.startDate;
  }

  return {
    companyId: nastup.companyId ?? "",
    jobTitle,
    department: nastup.department ?? "",
    contractType,
    startDate: nastup.startDate,
    endDate,
    salary,
    agreedReward,
  };
}

/**
 * For each row, find the contract record that "matches" it — i.e. was
 * generated against this row id, with the right template type, and whose
 * stored snapshot still matches the row's current parameters. Returns a
 * Map keyed by row id. If multiple matches exist (e.g. regenerations),
 * returns the most recently generated one.
 */
export function mapContractsToRows(
  rows: EmploymentRow[],
  contracts: ContractRecord[]
): Map<string, ContractRecord> {
  const out = new Map<string, ContractRecord>();
  for (const row of rows) {
    const expectedTypes = expectedContractTypesForRow(row);
    const matches = contracts.filter(
      (c) => c.employmentRowId === row.id && expectedTypes.includes(c.type)
    );
    if (matches.length === 0) continue;
    matches.sort((a, b) => {
      const at = a.generatedAt?._seconds ?? 0;
      const bt = b.generatedAt?._seconds ?? 0;
      return bt - at;
    });
    out.set(row.id, matches[0]);
  }
  return out;
}

/**
 * The contract template types that could legitimately be generated for a
 * given employment row — used to filter which contracts on the employee
 * "belong" to which row.
 *   - nástup HPP → ["nastup_hpp"], etc.
 *   - ukončení   → all three termination templates
 *   - změna smlouvy → ["zmena_smlouvy"]
 */
export function expectedContractTypesForRow(row: EmploymentRow): ContractType[] {
  if (row.changeType === "nástup") {
    if (row.contractType === "HPP") return ["nastup_hpp"];
    if (row.contractType === "PPP") return ["nastup_ppp"];
    if (row.contractType === "DPP") return ["nastup_dpp"];
    return [];
  }
  return CHANGE_TYPE_TO_CONTRACTS[row.changeType] ?? [];
}
