import * as admin from "firebase-admin";
import { resolveEmployeeDisplays } from "./recepceEmployees";

/**
 * Password-verified pickers (handover Předat/Převzít, signature revert, shared-
 * terminal logout) all list PEOPLE, while the credential check runs against an
 * ACCOUNT. Nothing stops several user accounts being linked to the same employee
 * (an admin's test account re-linked for testing is the real-world case), and the
 * pickers used to keep only the FIRST such account — so the employee's entry could
 * silently carry someone else's login email, and their own correct password was
 * rejected as "wrong" (the Oksana Smolyak incident, 2026-10).
 *
 * The fix is to group, not pick: one entry per employee carrying EVERY qualifying
 * account's login email. The client tries the password against each in turn and
 * signs with whichever matches; the server then records the account that actually
 * proved the password. Comparisons of "is this the same person" go through
 * {@link samePerson}, so two accounts of one employee can never satisfy a
 * two-person rule.
 */

export interface PoolCandidate {
  uid: string;
  /** users/{uid}.name — metadata, and the label fallback. */
  name: string;
  /** Real login email (already checked non-empty by the caller). */
  email: string;
  employeeId: string | null;
}

export interface PoolEntry {
  /** The entry's representative account (first qualifying one, in doc order). */
  uid: string;
  name: string;
  /** First email — kept for older clients that read a single `email`. */
  email: string;
  /** Every qualifying login email for this person; the client tries each. */
  emails: string[];
  /** Every account uid behind this entry (server-side matching only). */
  uids: string[];
  employeeId: string | null;
  label: string;
  sortKey: string;
}

/**
 * Fold qualifying accounts into one entry per employee (accounts with no linked
 * employee stay one entry each), with live employee-name labels sorted
 * surname-first. `fallback` supplies a name/sort key for an employee whose live
 * record is gone (e.g. the shift-plan snapshot).
 */
export async function groupSignerPool(
  candidates: readonly PoolCandidate[],
  fallback?: (employeeId: string) => { name: string; sortKey: string } | undefined
): Promise<PoolEntry[]> {
  const byEmp = new Map<string, PoolEntry>();
  const entries: PoolEntry[] = [];
  for (const c of candidates) {
    const existing = c.employeeId ? byEmp.get(c.employeeId) : undefined;
    if (existing) {
      if (!existing.emails.includes(c.email)) existing.emails.push(c.email);
      existing.uids.push(c.uid);
      continue;
    }
    const entry: PoolEntry = {
      uid: c.uid,
      name: c.name,
      email: c.email,
      emails: [c.email],
      uids: [c.uid],
      employeeId: c.employeeId,
      label: "",
      sortKey: "",
    };
    entries.push(entry);
    if (c.employeeId) byEmp.set(c.employeeId, entry);
  }

  const displays = await resolveEmployeeDisplays(entries.map((e) => e.employeeId ?? ""));
  for (const e of entries) {
    const disp = e.employeeId ? displays.get(e.employeeId) ?? fallback?.(e.employeeId) : undefined;
    e.label = disp?.name || e.name || e.email;
    e.sortKey = disp?.sortKey || e.label.toLowerCase();
  }
  entries.sort((a, b) => a.sortKey.localeCompare(b.sortKey, "cs"));
  return entries;
}

/** The public shape of a pool entry (what the pickers receive). */
export function publicEntry(e: PoolEntry): { uid: string; name: string; email: string; emails: string[]; label: string } {
  return { uid: e.uid, name: e.name, email: e.email, emails: e.emails, label: e.label };
}

/** The employee linked to an account, or null (missing account / no link). */
export async function employeeOfUid(uid: string): Promise<string | null> {
  try {
    const snap = await admin.firestore().collection("users").doc(uid).get();
    const empId = snap.exists ? (snap.data() as { employeeId?: unknown }).employeeId : undefined;
    return typeof empId === "string" && empId !== "" ? empId : null;
  } catch {
    return null;
  }
}

/**
 * Do two accounts belong to the same person? True for the same uid, or for two
 * accounts linked to the same employee. Used by the two-person rule (Předal ≠
 * Převzal) and the self-unsign right, which would otherwise be bypassable — or
 * wrongly refused — through a second account of the same employee.
 */
export async function samePerson(uidA: string, uidB: string): Promise<boolean> {
  if (uidA === uidB) return true;
  const [a, b] = await Promise.all([employeeOfUid(uidA), employeeOfUid(uidB)]);
  return a !== null && a === b;
}
