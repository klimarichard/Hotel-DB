/**
 * Auto-untick Multisport once the employee's multisportTo has passed.
 *
 * Runs daily. Today's date is evaluated in Europe/Prague so the behavior is
 * stable regardless of where Cloud Functions is executing. Keeps
 * multisportFrom / multisportTo intact for historical reference — only the
 * boolean flag is flipped off.
 */

import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

const db = () => admin.firestore();

function todayPrague(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Prague" }).format(new Date());
}

export async function sweepExpiredMultisport(): Promise<{ unticked: number }> {
  const today = todayPrague();
  const snap = await db()
    .collectionGroup("benefits")
    .where("multisport", "==", true)
    .get();

  let unticked = 0;
  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const to = (data.multisportTo as string | null | undefined) ?? null;
    if (to && to < today) {
      await doc.ref.update({
        multisport: false,
        updatedAt: FieldValue.serverTimestamp(),
      });
      unticked++;
    }
  }
  return { unticked };
}
