import * as admin from "firebase-admin";

const db = () => admin.firestore();

/**
 * Employee statuses that BLOCK deleting a catalogue value (company / job
 * position / education level) they reference. Terminated employees are
 * deliberately excluded: their historical rows may hold a value we want to
 * clean up, and a reactivation-time warning banner (EmployeeDetailPage) nudges
 * the admin to fix any now-missing reference if such an employee is reactivated.
 */
const BLOCKING_STATUSES = new Set<string>(["active", "before-start"]);

/**
 * True if any ACTIVE or BEFORE-START employee has `refField === value` on their
 * root doc. Used by the lookup delete guards (companies `currentCompanyId`,
 * jobPositions `currentJobTitle`, educationLevels `education`).
 *
 * Uses a single-field equality query with a `status` projection, so it relies
 * only on Firestore's automatic single-field index — no composite index needed.
 * `status` is the denormalized root field written by `applyDerivedStatus`.
 */
export async function isReferencedByLiveEmployee(
  refField: string,
  value: string
): Promise<boolean> {
  const hits = await db()
    .collection("employees")
    .where(refField, "==", value)
    .select("status")
    .get();
  return hits.docs.some((d) => BLOCKING_STATUSES.has(d.get("status") as string));
}
