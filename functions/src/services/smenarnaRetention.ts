/**
 * Směnárna snapshot retention — runs daily and deletes saved snapshots once they
 * are 6 months or older.
 *
 * Snapshots are a convenience record of a past exchange run, not an accounting
 * document: nothing else references them, and deleting one removes no business
 * data. The sweep therefore deletes the documents outright rather than aging out
 * a history subcollection the way the Recepce sweep does.
 *
 * Time comes from the test clock so the cutoff can be exercised on staging by
 * jumping the clock forward, exactly like the other daily sweeps.
 */
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import * as clock from "./clock";

const RETENTION_MONTHS = 6;
const BATCH = 400; // under Firestore's 500-write batch cap

export const SMENARNA_SNAPSHOTS = "smenarnaSnapshots";

/** The 6-month cutoff — snapshots at or before this instant are swept. */
function cutoff(): Timestamp {
  const d = clock.now();
  d.setMonth(d.getMonth() - RETENTION_MONTHS);
  return Timestamp.fromDate(d);
}

export interface SnapshotRetentionResult {
  cutoffISO: string;
  deleted: number;
}

export async function sweepSmenarnaSnapshots(): Promise<SnapshotRetentionResult> {
  const db = admin.firestore();
  const before = cutoff();
  const query = db.collection(SMENARNA_SNAPSHOTS).where("createdAt", "<=", before);

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
  return { cutoffISO: before.toDate().toISOString(), deleted };
}
