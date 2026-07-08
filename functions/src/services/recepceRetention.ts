/**
 * Recepce retention sweep — runs daily (00:00 Europe/Prague) and deletes the
 * *change history* of the reception features once it is 6 months or older:
 *
 *   • auditLog entries for the recepce collections (shiftHandovers / walkins /
 *     taxiRides) — the compact per-save summaries and money/signature entries.
 *   • the per-protocol `history` subcollections (collection-group), which back
 *     the in-protocol history panel + undo/redo.
 *
 * It NEVER touches the live business records themselves — the taxi rides, the
 * walk-in sales, or the protocol documents. Only history/audit is aged out; the
 * tables persist. Selection is by timestamp only against the 6-month cutoff, and
 * the auditLog side is additionally constrained to the three recepce collections
 * so unrelated audit entries (employees, payroll, …) are left untouched.
 *
 * Time comes from the test clock so the cutoff can be exercised on staging by
 * jumping the clock forward, exactly like the other daily sweeps.
 */
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import * as clock from "./clock";

const RETENTION_MONTHS = 6;

// The auditLog `collection` tags written by the recepce routes. Kept in sync
// with routes/{handovers,walkins,taxi}.ts.
const RECEPCE_AUDIT_COLLECTIONS = ["shiftHandovers", "walkins", "taxiRides"] as const;

const BATCH = 400; // under Firestore's 500-write batch cap

/** Delete every doc a query returns, in batches, and report the count. */
async function deleteAll(query: admin.firestore.Query): Promise<number> {
  const db = admin.firestore();
  let deleted = 0;
  // Bounded loop: each pass removes up to BATCH docs. The guard is a backstop
  // against an unexpected non-terminating condition, not an expected limit.
  for (let pass = 0; pass < 10_000; pass++) {
    const snap = await query.limit(BATCH).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += snap.size;
    if (snap.size < BATCH) break;
  }
  return deleted;
}

export interface RetentionResult {
  cutoffISO: string;
  auditDeleted: number;
  historyDeleted: number;
}

/** The 6-month cutoff — records at or before this instant are swept. */
function cutoff(): Timestamp {
  const d = clock.now();
  d.setMonth(d.getMonth() - RETENTION_MONTHS);
  return Timestamp.fromDate(d);
}

export async function sweepRecepceRetention(): Promise<RetentionResult> {
  const db = admin.firestore();
  const before = cutoff();

  // auditLog — one query per recepce collection (collection == X && timestamp <=
  // cutoff). Composite index (collection, timestamp) in firestore.indexes.json.
  let auditDeleted = 0;
  for (const collection of RECEPCE_AUDIT_COLLECTIONS) {
    auditDeleted += await deleteAll(
      db.collection("auditLog").where("collection", "==", collection).where("timestamp", "<=", before)
    );
  }

  // Per-protocol history subcollections, across all hotels, by entry age.
  const historyDeleted = await deleteAll(
    db.collectionGroup("history").where("at", "<=", before)
  );

  return { cutoffISO: before.toDate().toISOString(), auditDeleted, historyDeleted };
}
