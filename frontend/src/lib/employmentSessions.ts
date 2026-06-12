import { ContractType, CHANGE_TYPE_TO_CONTRACTS } from "./contractVariables";
import * as clock from "./clock";

export interface ChangeRow {
  changeKind: string;
  value: string;
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
  generatedAt?: { seconds?: number; _seconds?: number } | null;
  signedAt?: { seconds?: number; _seconds?: number } | null;
  notes?: string;
  displayName?: string;
  // Ad-hoc rows are created PDF-less; the signing date entered up-front is
  // displayed on the row (instead of the generation date) and reused when
  // the PDF is generated later. requestedAt/validFrom are Multisport-only.
  signingDate?: string;
  requestedAt?: string;
  validFrom?: string;
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
  /**
   * Session has ended — either an explicit Ukončení row exists, or the
   * effective endDate is in the past (a fixed-term Nástup that ran out
   * without anyone filing the termination paperwork). The UI treats the
   * two cases identically: no "+ Dodatek" / "Ukončit smlouvu" buttons,
   * dimmed card styling.
   */
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

  // Today as YYYY-MM-DD in local time — both startDate / endDate are
  // stored in this same form, so a lex comparison is correct.
  const today = clock.today();

  function flush() {
    if (!current) return;
    const rowsInOrder = [
      current.nastup,
      ...current.dodatky,
      ...(current.ukonceni ? [current.ukonceni] : []),
    ];
    const effective = computeEffectiveState(current.nastup, current.dodatky, current.ukonceni);
    const expired = !!effective.endDate && effective.endDate < today;
    sessions.push({
      nastup: current.nastup,
      dodatky: current.dodatky,
      ukonceni: current.ukonceni,
      rows: rowsInOrder,
      effective,
      terminated: !!current.ukonceni || expired,
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
 *   - úvazek          → contractType (HPP ↔ PPP based on the chosen text)
 *   - délka smlouvy   → endDate
 */
export function computeEffectiveState(
  nastup: EmploymentRow,
  dodatky: EmploymentRow[],
  ukonceni: EmploymentRow | null,
  asOfDate: string = clock.today()
): EffectiveState {
  let jobTitle = nastup.jobTitle ?? "";
  let salary = nastup.salary ?? null;
  let agreedReward = nastup.agreedReward ?? null;
  let endDate = nastup.endDate ?? null;
  let contractType = nastup.contractType ?? "";

  // Only fold Dodatky whose validity (startDate) has arrived — a future-dated
  // Dodatek must not change the effective salary/position/úvazek until its day.
  const applicable = dodatky.filter((d) => (d.startDate ?? "") <= asOfDate);
  for (const dod of applicable) {
    for (const ch of dod.changes ?? []) {
      if (ch.changeKind === "pracovní pozice" && ch.value) {
        jobTitle = ch.value;
      } else if (ch.changeKind === "mzda" && ch.value) {
        const n = Number(ch.value);
        if (Number.isFinite(n)) {
          if (contractType === "DPP") agreedReward = n;
          else salary = n;
        }
      } else if (ch.changeKind === "úvazek" && ch.value) {
        const mapped = uvazekToContractType(ch.value);
        if (mapped) contractType = mapped;
      } else if (ch.changeKind === "délka smlouvy") {
        // Empty value = "změna na dobu neurčitou": a Dodatek can clear a fixed
        // end date. The falsy guard used to drop this, leaving the original end
        // date (employee wrongly shown as terminated).
        endDate = ch.value || null;
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
 * Map an úvazek-change value (free text from the Dodatek form, e.g.
 * "poloviční pracovní úvazek, tj. 20 hod./týdně") to the HPP/PPP
 * contract-type code. Returns null when the wording isn't recognisable
 * — in that case the previous contractType is preserved.
 */
export function uvazekToContractType(value: string): "HPP" | "PPP" | null {
  const v = value.toLowerCase();
  if (v.includes("polovič") || v.includes("zkrácen") || v.includes("částečn")) return "PPP";
  if (v.includes("plný") || v.includes("plny")) return "HPP";
  return null;
}

/**
 * Build the chronological chain of distinct values a session's `field`
 * has held: the Nástup's initial value, then one entry per Dodatek that
 * actually changed it (consecutive duplicates collapsed). When the
 * chain has length ≤ 1 the field never changed during the session.
 *
 * For `jobTitle`, "pracovní pozice" Dodatek changes feed the chain.
 * For `contractType`, "úvazek" Dodatek changes are mapped through
 * uvazekToContractType — values that don't map (unrecognised wording)
 * are skipped rather than terminating the chain.
 */
export function collectFieldChain(
  session: EmploymentSession,
  field: "jobTitle" | "contractType",
  asOfDate: string = clock.today()
): string[] {
  const chain: string[] = [];
  const initial = (session.nastup[field] as string | undefined) ?? "";
  if (initial) chain.push(initial);

  const applicable = session.dodatky.filter((d) => (d.startDate ?? "") <= asOfDate);
  for (const dod of applicable) {
    for (const ch of dod.changes ?? []) {
      let next: string | null = null;
      if (field === "jobTitle" && ch.changeKind === "pracovní pozice" && ch.value) {
        next = ch.value;
      } else if (field === "contractType" && ch.changeKind === "úvazek" && ch.value) {
        next = uvazekToContractType(ch.value);
      }
      if (next && next !== chain[chain.length - 1]) chain.push(next);
    }
  }
  return chain;
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
      const at = a.generatedAt?.seconds ?? a.generatedAt?._seconds ?? 0;
      const bt = b.generatedAt?.seconds ?? b.generatedAt?._seconds ?? 0;
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
