/**
 * Plan deadline transition helpers.
 * Shared between the Express route handler and the scheduled Cloud Function.
 */

import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import * as clock from "./clock";
import { logSystemEvent } from "./auditLog";
import { parseShiftExpression } from "./shiftParser";
import { getCzechHolidays } from "./payrollCalculator";

const db = () => admin.firestore();

// Log an automatic plan phase change as a "Systém" change-log event. The render
// layer maps `plan.autoTransition` + summary.from/to → the Czech line
// ("Systém — Automatické otevření plánu …: Vytvořený → Otevřený").
async function logPlanAutoTransition(
  doc: admin.firestore.QueryDocumentSnapshot,
  from: string,
  to: string
): Promise<void> {
  const data = doc.data();
  await logSystemEvent({
    event: "plan.autoTransition",
    collection: "shiftPlans",
    resourceId: doc.id,
    year: typeof data.year === "number" ? data.year : undefined,
    month: typeof data.month === "number" ? data.month : undefined,
    summary: { from, to },
  });
}

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

// ─── Auto-fill "R" for managers (FOM) on Closed → Published ───────────────────

/**
 * On a plan's Closed → Published transition, auto-fill "R" (8 h day shift) for
 * every FOM / manager row (section "vedoucí") on each Mon–Fri **non-holiday**
 * workday whose cell is currently EMPTY.
 *
 * Data-safe by design:
 *  - X (days off) and any existing entry (HO, a covered DA/N shift, …) are
 *    NEVER overwritten — only genuinely empty cells are filled.
 *  - Public holidays are skipped: the payroll calculator already grants managers
 *    Mon–Fri holiday credit (`countMonFriHolidays`), so an R on a holiday would
 *    double-count VÝKAZ.
 *
 * Logs a single "Systém" audit event summarising the fill (never per cell, to
 * avoid flooding the change log on publish). Shared by the manual transition
 * route and the scheduled deadline transition.
 */
export async function autoFillManagerRShifts(
  planRef: admin.firestore.DocumentReference,
  year: number,
  month: number
): Promise<{ filled: number; managers: number }> {
  // Active manager (vedoucí) rows only.
  const empSnap = await planRef
    .collection("planEmployees")
    .where("section", "==", "vedoucí")
    .get();
  const managers = empSnap.docs
    .map((d) => d.data() as Record<string, unknown>)
    .filter((e) => e.active !== false)
    .map((e) => e.employeeId as string);
  if (managers.length === 0) return { filled: 0, managers: 0 };

  // Any cell with a non-empty rawInput is "occupied" and must be preserved.
  const shiftsSnap = await planRef.collection("shifts").get();
  const occupied = new Set<string>();
  for (const d of shiftsSnap.docs) {
    const data = d.data() as Record<string, unknown>;
    if (((data.rawInput as string) ?? "").trim() !== "") occupied.add(d.id);
  }

  // Workdays = Mon–Fri, excluding Czech public holidays.
  const holidays = getCzechHolidays(year);
  const lastDay = new Date(year, month, 0).getDate();
  const workdays: string[] = [];
  for (let day = 1; day <= lastDay; day++) {
    const dow = new Date(year, month - 1, day).getDay(); // 0=Sun, 6=Sat
    if (dow === 0 || dow === 6) continue;
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (holidays.has(dateStr)) continue;
    workdays.push(dateStr);
  }

  const r = parseShiftExpression("R"); // segments [{R,null,8}], 8 h, assigned
  let filled = 0;
  let batch = db().batch();
  let ops = 0;
  for (const employeeId of managers) {
    for (const date of workdays) {
      const docId = `${employeeId}_${date}`;
      if (occupied.has(docId)) continue;
      batch.set(planRef.collection("shifts").doc(docId), {
        employeeId,
        date,
        rawInput: r.rawInput,
        segments: r.segments,
        hoursComputed: r.hoursComputed,
        isDouble: r.isDouble,
        status: "assigned",
        updatedAt: FieldValue.serverTimestamp(),
      });
      filled++;
      if (++ops >= 400) {
        await batch.commit();
        batch = db().batch();
        ops = 0;
      }
    }
  }
  if (ops > 0) await batch.commit();

  if (filled > 0) {
    await planRef.update({ updatedAt: FieldValue.serverTimestamp() });
    await logSystemEvent({
      event: "plan.autoFillManagerR",
      collection: "shiftPlans",
      resourceId: planRef.id,
      year,
      month,
      summary: { filled, managers: managers.length },
    });
  }

  return { filled, managers: managers.length };
}

// ─── Check all plans and apply deadline transitions ───────────────────────────

export async function transitionPlanDeadlines(): Promise<{ transitioned: string[] }> {
  const now = clock.nowMs();
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
      await planRef.update({ status: "opened", updatedAt: FieldValue.serverTimestamp() });
      await logPlanAutoTransition(doc, "created", "opened");
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
      await planRef.update({ status: "closed", updatedAt: FieldValue.serverTimestamp() });
      await logPlanAutoTransition(doc, "opened", "closed");
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
      if (typeof data.year === "number" && typeof data.month === "number") {
        await autoFillManagerRShifts(planRef, data.year, data.month);
      }
      await planRef.update({ status: "published", updatedAt: FieldValue.serverTimestamp() });
      await logPlanAutoTransition(doc, "closed", "published");
      transitioned.push(`${doc.id}: closed → published`);
    }
  }

  return { transitioned };
}
