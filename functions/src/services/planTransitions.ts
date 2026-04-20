/**
 * Plan deadline transition helpers.
 * Shared between the Express route handler and the scheduled Cloud Function.
 */

import * as admin from "firebase-admin";

const db = () => admin.firestore();

// ─── Batch-delete a sub-collection ────────────────────────────────────────────

export async function deleteCollection(
  colRef: admin.firestore.CollectionReference
): Promise<void> {
  const BATCH_SIZE = 400;
  let snap = await colRef.limit(BATCH_SIZE).get();
  while (!snap.empty) {
    const batch = db().batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    snap = await colRef.limit(BATCH_SIZE).get();
  }
}

// ─── Copy shifts into shiftsSnapshot ──────────────────────────────────────────

export async function snapshotShifts(
  planRef: admin.firestore.DocumentReference
): Promise<void> {
  const shiftsSnap = await planRef.collection("shifts").get();
  if (shiftsSnap.empty) return;
  const docs = shiftsSnap.docs;
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db().batch();
    for (const doc of docs.slice(i, i + 400)) {
      batch.set(planRef.collection("shiftsSnapshot").doc(doc.id), doc.data());
    }
    await batch.commit();
  }
}

// ─── Check all plans and apply deadline transitions ───────────────────────────

export async function transitionPlanDeadlines(): Promise<{ transitioned: string[] }> {
  const now = Date.now();
  const transitioned: string[] = [];

  // Only query plans that can still transition
  const snap = await db()
    .collection("shiftPlans")
    .where("status", "in", ["created", "opened", "closed"])
    .get();

  for (const doc of snap.docs) {
    const data = doc.data();
    const planRef = doc.ref;

    // created → opened
    if (
      data.status === "created" &&
      data.openedAt &&
      new Date(data.openedAt).getTime() <= now
    ) {
      await planRef.update({ status: "opened", updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      transitioned.push(`${doc.id}: created → opened`);
      continue;
    }

    // opened → closed
    if (
      data.status === "opened" &&
      data.closedAt &&
      new Date(data.closedAt).getTime() <= now
    ) {
      await snapshotShifts(planRef);
      await planRef.update({ status: "closed", updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      transitioned.push(`${doc.id}: opened → closed`);
      continue;
    }

    // closed → published
    if (
      data.status === "closed" &&
      data.publishedAt &&
      new Date(data.publishedAt).getTime() <= now
    ) {
      await deleteCollection(planRef.collection("shiftsSnapshot"));
      await planRef.update({ status: "published", updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      transitioned.push(`${doc.id}: closed → published`);
    }
  }

  return { transitioned };
}
