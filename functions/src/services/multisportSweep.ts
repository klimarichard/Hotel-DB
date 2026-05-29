/**
 * Re-derive the `multisport` "active today" flag on every benefits doc from its
 * `multisportPeriods` (bidirectional): a period that has ended flips the flag
 * off, a period that has started flips it on. The periods themselves are never
 * touched — only the denormalized boolean used by CSV / quick display.
 *
 * Runs daily. "Today" is Europe/Prague (honouring the non-prod test clock via
 * clock.today()) so behaviour is stable regardless of where the function runs.
 * Legacy single-window docs (multisport + multisportFrom/To, not yet migrated)
 * are handled via readMultisport's fallback.
 */

import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import * as clock from "./clock";
import { readMultisport, anyPeriodActiveOn } from "./multisport";

const db = () => admin.firestore();

export async function sweepExpiredMultisport(): Promise<{ unticked: number }> {
  const today = clock.today();
  const snap = await db().collectionGroup("benefits").get();

  let unticked = 0;
  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const { periods } = readMultisport(data);
    const desired = anyPeriodActiveOn(periods, today);
    if ((data.multisport === true) !== desired) {
      await doc.ref.update({
        multisport: desired,
        updatedAt: FieldValue.serverTimestamp(),
      });
      unticked++;
    }
  }
  return { unticked };
}
