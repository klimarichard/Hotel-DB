import * as admin from "firebase-admin";

const db = () => admin.firestore();

/**
 * Live employee-name resolution for read paths that carry a DENORMALIZED name.
 *
 * THE PROBLEM. Several collections snapshot the employee's name at write time:
 * shiftPlans/{id}/planEmployees (frozen when the person is added to the roster),
 * payrollPeriods/*\/entries (copied from that roster), vacationRequests, and the
 * probation / document-expiry / change-request alerts. None of them are ever
 * rewritten, so editing an employee's `displayName` did not reach them — a plan
 * created before the display-name feature has no `displayName` key at all, which
 * is why old shift plans still show the legal name.
 *
 * THE FIX. Re-resolve against the live employee record when READING, and treat
 * the stored snapshot purely as a fallback for employees that no longer exist.
 * This is self-healing: the next rename propagates on its own. A Firestore
 * backfill would fix today's rows and re-break on the next edit, and it would
 * mean a bulk write over production data for what is a pure display concern.
 *
 * This generalises the pattern Recepce already got right (services/
 * recepceEmployees.ts) — but it returns the raw name PARTS rather than a
 * composed string, because callers disagree about the form they need: most of
 * the app shows "displayName else First Last", while the employee list, the
 * pickers and the payroll PDF deliberately stay surname-first on the LEGAL name.
 * Composition stays with the caller (frontend: lib/employeeName.ts).
 */
export interface EmployeeNameParts {
  firstName: string;
  lastName: string;
  /** "" when the employee has no custom display name — callers fall back. */
  displayName: string;
}

const nstr = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Read the three name fields off any name-bearing record (employee doc or snapshot). */
export function nameParts(rec: unknown): EmployeeNameParts {
  const r = (rec ?? {}) as Record<string, unknown>;
  return {
    firstName: nstr(r.firstName),
    lastName: nstr(r.lastName),
    displayName: nstr(r.displayName),
  };
}

/**
 * Batch-resolve employeeId → live name parts. Uses a single getAll, so a roster
 * of 60 people costs one round-trip, not 60. Ids that no longer exist are simply
 * absent from the map; callers fall back to their stored snapshot.
 */
export async function resolveEmployeeNameParts(
  ids: readonly (string | undefined | null)[]
): Promise<Map<string, EmployeeNameParts>> {
  const out = new Map<string, EmployeeNameParts>();
  const uniq = [...new Set(ids.filter((x): x is string => typeof x === "string" && x !== ""))];
  if (uniq.length === 0) return out;

  const snaps = await db().getAll(...uniq.map((id) => db().collection("employees").doc(id)));
  for (const s of snaps) {
    if (!s.exists) continue;
    out.set(s.id, nameParts(s.data()));
  }
  return out;
}

/**
 * Live name parts if we have them, else the snapshot's. Use when enriching a
 * stored record for a response: the caller keeps working for deleted employees
 * (whose snapshot is now the only record of who they were).
 */
export function preferLive(
  live: Map<string, EmployeeNameParts>,
  employeeId: string | undefined | null,
  snapshot: unknown
): EmployeeNameParts {
  const fromLive = employeeId ? live.get(employeeId) : undefined;
  return fromLive ?? nameParts(snapshot);
}
