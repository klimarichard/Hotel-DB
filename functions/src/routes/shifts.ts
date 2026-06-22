import { Router } from "express";
import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { requirePermission } from "../auth/permissions";
import { parseShiftExpression, HOTEL_CODES } from "../services/shiftParser";
import { snapshotShifts, deleteCollection, autoFillManagerRShifts } from "../services/planTransitions";
import { createOrUpdatePayrollPeriod } from "../services/payrollCalculator";
import {
  ctxFromReq,
  logCreate,
  logUpdate,
  logDelete,
  logSystemEvent,
  writeAudit,
} from "../services/auditLog";

export const shiftsRouter = Router();
const db = () => admin.firestore();

const VALID_SECTIONS = ["vedoucí", "recepce", "portýři"] as const;
const VALID_SHIFT_TYPES = ["D", "N", "R", "DP", "NP"] as const;

// ─── Volné směny (free shifts) ───────────────────────────────────────────────
// Standing daily porter coverage requirements surfaced on a PUBLISHED plan.
// DPQ/NPQ/NPA are needed every day; DPA only on admin-marked days
// (plan.freeShiftDpaDays). A slot is "free" when no employee covers it that day.
const FREE_SHIFT_SLOTS = [
  { code: "DP", hotel: "Q" }, // DPQ — day porter, Amigo
  { code: "NP", hotel: "Q" }, // NPQ — night porter, Amigo
  { code: "NP", hotel: "A" }, // NPA — night porter, Ambiance
] as const;
const FREE_SHIFT_DPA = { code: "DP", hotel: "A" } as const; // day porter, Ambiance — marked days only

function isValidFreeSlot(code: string, hotel: string): boolean {
  if (code === FREE_SHIFT_DPA.code && hotel === FREE_SHIFT_DPA.hotel) return true;
  return FREE_SHIFT_SLOTS.some((s) => s.code === code && s.hotel === hotel);
}

/** True when some employee in the plan already covers {code, hotel} on `date`. */
async function isSlotCovered(
  planRef: admin.firestore.DocumentReference,
  date: string,
  code: string,
  hotel: string
): Promise<boolean> {
  const snap = await planRef.collection("shifts").where("date", "==", date).get();
  for (const d of snap.docs) {
    const raw = (d.data().rawInput as string) ?? "";
    const parsed = parseShiftExpression(raw);
    if (parsed.isValid && parsed.segments.some((s) => s.code === code && s.hotel === hotel)) return true;
  }
  return false;
}

/**
 * #32 — Use a client-supplied ISO timestamp (the moment the user initiated the
 * action) when it is present and valid; otherwise fall back to the server clock.
 * Guards against garbage / future-dated / pre-2000 values to stop a bad client
 * from back- or forward-dating a request arbitrarily.
 */
function clientTimestampOrServer(iso: string | undefined): Timestamp | FieldValue {
  if (typeof iso === "string") {
    const ms = Date.parse(iso);
    if (!Number.isNaN(ms)) {
      const now = Date.now();
      // accept only the last 24h up to ~1min of clock skew into the future
      if (ms <= now + 60_000 && ms >= now - 86_400_000) {
        return Timestamp.fromMillis(ms);
      }
    }
  }
  return FieldValue.serverTimestamp();
}

// ─── Section ordering helper ─────────────────────────────────────────────────

/**
 * Re-number planEmployees within a single section so displayOrder is contiguous 1..N.
 *
 * If `target` is given, the targeted doc is anchored at `target.newOrder`:
 *   - When `oldOrder` is undefined or `newOrder <= oldOrder` (insert / move-up), the
 *     target wins ties and lands AT `newOrder`, pushing collisions down.
 *   - When `newOrder > oldOrder` (move-down), the target loses ties so it still lands
 *     at `newOrder` after the gap left behind is closed.
 *
 * Without a target, simply compacts the section (used after deletes).
 */
async function renumberSection(
  planRef: admin.firestore.DocumentReference,
  section: string,
  target?: { docId: string; newOrder: number; oldOrder?: number }
): Promise<void> {
  const snap = await planRef
    .collection("planEmployees")
    .where("section", "==", section)
    .get();

  const rows = snap.docs.map((d) => {
    const currentOrder = Number(d.data().displayOrder ?? 0);
    let effectiveOrder = currentOrder;
    if (target && d.id === target.docId) {
      const movingDown =
        target.oldOrder !== undefined && target.newOrder > target.oldOrder;
      effectiveOrder = movingDown ? target.newOrder + 0.5 : target.newOrder - 0.5;
    }
    return { id: d.id, currentOrder, effectiveOrder };
  });

  rows.sort((a, b) => a.effectiveOrder - b.effectiveOrder);

  const batch = db().batch();
  let dirty = false;
  rows.forEach((row, idx) => {
    const finalOrder = idx + 1;
    if (finalOrder !== row.currentOrder) {
      batch.update(planRef.collection("planEmployees").doc(row.id), {
        displayOrder: finalOrder,
      });
      dirty = true;
    }
  });
  if (dirty) await batch.commit();
}

// ─── Vacation X helpers ──────────────────────────────────────────────────────

export interface ShiftCollision {
  date: string;       // YYYY-MM-DD
  rawInput: string;   // e.g. "DA", "N", "ZD"
  planId: string;
  planMonth: number;
  planYear: number;
}

/**
 * For the given employee and date range, return every existing shift cell
 * with status === "assigned" that falls inside the range. Used to gate
 * vacation requests/approvals against pre-scheduled work.
 *
 * X shifts (status "day_off") and blank cells (status "unassigned") are
 * intentionally excluded — re-applying X over X is a no-op, and blank
 * cells are obviously safe to overwrite.
 */
export async function findShiftCollisions(
  employeeId: string,
  startDate: string,
  endDate: string
): Promise<ShiftCollision[]> {
  const startD = new Date(startDate + "T00:00:00");
  const endD = new Date(endDate + "T00:00:00");
  const cur = new Date(startD.getFullYear(), startD.getMonth(), 1);
  const months: { year: number; month: number }[] = [];
  while (cur <= endD) {
    months.push({ year: cur.getFullYear(), month: cur.getMonth() + 1 });
    cur.setMonth(cur.getMonth() + 1);
  }

  const out: ShiftCollision[] = [];
  for (const { year, month } of months) {
    const planSnap = await db()
      .collection("shiftPlans")
      .where("year", "==", year)
      .where("month", "==", month)
      .limit(1)
      .get();
    if (planSnap.empty) continue;
    const planDoc = planSnap.docs[0];

    const lastDay = new Date(year, month, 0).getDate();
    const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
    const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    const clampedStart = startDate < monthStart ? monthStart : startDate;
    const clampedEnd = endDate > monthEnd ? monthEnd : endDate;

    const shiftSnap = await planDoc.ref
      .collection("shifts")
      .where("employeeId", "==", employeeId)
      .where("date", ">=", clampedStart)
      .where("date", "<=", clampedEnd)
      .get();

    for (const s of shiftSnap.docs) {
      const sd = s.data() as Record<string, unknown>;
      if (sd.status !== "assigned") continue;
      out.push({
        date: sd.date as string,
        rawInput: (sd.rawInput as string) ?? "",
        planId: planDoc.id,
        planMonth: month,
        planYear: year,
      });
    }
  }

  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/**
 * For a given plan and employee, find all approved vacation requests that
 * overlap with the plan's month and batch-write X shift docs.
 * Exported so vacation.ts can call applyVacationXsToPlans.
 *
 * Honors each request's optional `excludedDates: string[]` field — those
 * days are skipped so the existing shift cell survives. Used by the
 * approval-time collision-resolution dialog.
 */
export async function applyVacationXs(
  planRef: admin.firestore.DocumentReference,
  employeeId: string,
  year: number,
  month: number
): Promise<void> {
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const snap = await db()
    .collection("vacationRequests")
    .where("employeeId", "==", employeeId)
    .where("status", "==", "approved")
    .where("endDate", ">=", monthStart)
    .get();

  const overlapping = snap.docs.filter((d) => (d.data().startDate as string) <= monthEnd);
  if (overlapping.length === 0) return;

  const batch = db().batch();
  for (const doc of overlapping) {
    const dd = doc.data() as Record<string, unknown>;
    const startDate = dd.startDate as string;
    const endDate = dd.endDate as string;
    const excluded = new Set<string>(Array.isArray(dd.excludedDates) ? (dd.excludedDates as string[]) : []);
    const clampedStart = startDate < monthStart ? monthStart : startDate;
    const clampedEnd = endDate > monthEnd ? monthEnd : endDate;
    const cur = new Date(clampedStart + "T00:00:00");
    const end = new Date(clampedEnd + "T00:00:00");
    while (cur <= end) {
      const dateStr = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
      if (!excluded.has(dateStr)) {
        const docId = `${employeeId}_${dateStr}`;
        batch.set(planRef.collection("shifts").doc(docId), {
          employeeId,
          date: dateStr,
          rawInput: "X",
          segments: [{ code: "X", hotel: null, hours: 0 }],
          hoursComputed: 0,
          isDouble: false,
          status: "day_off",
          // Tag vacation-origin Xs so the planner can exclude them from the
          // voluntary X-limit count (8 HPP / 13 PPP). Manual Xs have no source.
          source: "vacation",
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      cur.setDate(cur.getDate() + 1);
    }
  }
  await batch.commit();
}

/**
 * Called when a vacation request is approved. Finds all existing plans
 * whose month overlaps with the date range and applies X shifts if the
 * employee is in that plan.
 */
export async function applyVacationXsToPlans(
  employeeId: string,
  startDate: string,
  endDate: string
): Promise<void> {
  const startD = new Date(startDate + "T00:00:00");
  const endD = new Date(endDate + "T00:00:00");
  const cur = new Date(startD.getFullYear(), startD.getMonth(), 1);
  const months: { year: number; month: number }[] = [];
  while (cur <= endD) {
    months.push({ year: cur.getFullYear(), month: cur.getMonth() + 1 });
    cur.setMonth(cur.getMonth() + 1);
  }

  for (const { year, month } of months) {
    const planSnap = await db()
      .collection("shiftPlans")
      .where("year", "==", year)
      .where("month", "==", month)
      .limit(1)
      .get();
    if (planSnap.empty) continue;
    const planDoc = planSnap.docs[0];

    const empSnap = await planDoc.ref
      .collection("planEmployees")
      .where("employeeId", "==", employeeId)
      .limit(1)
      .get();
    if (empSnap.empty) continue;

    await applyVacationXs(planDoc.ref, employeeId, year, month);
  }
}

/**
 * Deletes vacation X shift docs from all plans for the given employee and date range.
 * Called when a vacation request is deleted or when an approved edit replaces old dates.
 */
export async function removeVacationXsFromPlans(
  employeeId: string,
  startDate: string,
  endDate: string
): Promise<void> {
  const startD = new Date(startDate + "T00:00:00");
  const endD = new Date(endDate + "T00:00:00");
  const cur = new Date(startD.getFullYear(), startD.getMonth(), 1);
  const months: { year: number; month: number }[] = [];
  while (cur <= endD) {
    months.push({ year: cur.getFullYear(), month: cur.getMonth() + 1 });
    cur.setMonth(cur.getMonth() + 1);
  }

  for (const { year, month } of months) {
    const planSnap = await db()
      .collection("shiftPlans")
      .where("year", "==", year)
      .where("month", "==", month)
      .limit(1)
      .get();
    if (planSnap.empty) continue;
    const planDoc = planSnap.docs[0];

    const empSnap = await planDoc.ref
      .collection("planEmployees")
      .where("employeeId", "==", employeeId)
      .limit(1)
      .get();
    if (empSnap.empty) continue;

    const lastDay = new Date(year, month, 0).getDate();
    const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
    const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    const clampedStart = startDate < monthStart ? monthStart : startDate;
    const clampedEnd = endDate > monthEnd ? monthEnd : endDate;

    // Collect the candidate cell refs for the range. NOTE: local-date math, not
    // toISOString() — in UTC+2 toISOString() rolls back a day (see CLAUDE.md).
    const refs: admin.firestore.DocumentReference[] = [];
    const curDate = new Date(clampedStart + "T00:00:00");
    const endDateObj = new Date(clampedEnd + "T00:00:00");
    while (curDate <= endDateObj) {
      const dateStr = `${curDate.getFullYear()}-${String(curDate.getMonth() + 1).padStart(2, "0")}-${String(curDate.getDate()).padStart(2, "0")}`;
      refs.push(planDoc.ref.collection("shifts").doc(`${employeeId}_${dateStr}`));
      curDate.setDate(curDate.getDate() + 1);
    }
    if (refs.length === 0) continue;

    // Only delete cells that are actually vacation-origin Xs (tagged
    // source === "vacation" on write). A real shift entered over a vacation day
    // — e.g. a day kept via the approval-time `excludedDates` dialog, or an
    // admin overwriting an X after approval — must survive, or we'd silently
    // destroy worked shifts and drop their payroll hours.
    const snaps = await db().getAll(...refs);
    const batch = db().batch();
    let toDelete = 0;
    for (const snap of snaps) {
      if (!snap.exists) continue;
      if (snap.data()?.source !== "vacation") continue;
      batch.delete(snap.ref);
      toDelete++;
    }
    if (toDelete > 0) await batch.commit();
  }
}

// ─── Plans ──────────────────────────────────────────────────────────────────

// GET /shifts/plans — list all plans
// Employees cannot see plans in "created" state — they only appear once opened.
shiftsRouter.get(
  "/plans",
  requireAuth,
  requirePermission("shifts.view.all", "shifts.view.self"),
  async (req: AuthRequest, res) => {
    const snap = await db()
      .collection("shiftPlans")
      .orderBy("year", "desc")
      .orderBy("month", "desc")
      .get();
    const all = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Array<Record<string, unknown> & { id: string; status: string }>;
    // Self-service viewers (shifts.view.self without shifts.view.all — e.g. the
    // built-in employee) don't see plans still in "created" (unopened).
    const seesAllPlans = req.permissions?.has("shifts.view.all") ?? false;
    const filtered = seesAllPlans ? all : all.filter((p) => p.status !== "created");
    res.json(filtered);
  }
);

// POST /shifts/plans — create a plan
shiftsRouter.post(
  "/plans",
  requireAuth,
  requirePermission("shifts.plan.create"),
  async (req: AuthRequest, res) => {
    const body = req.body as Record<string, unknown>;
    const month = Number(body.month);
    const year = Number(body.year);

    if (!Number.isInteger(month) || month < 1 || month > 12) {
      res.status(400).json({ error: "Neplatný měsíc" });
      return;
    }
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      res.status(400).json({ error: "Neplatný rok" });
      return;
    }

    // Uniqueness check
    const existing = await db()
      .collection("shiftPlans")
      .where("month", "==", month)
      .where("year", "==", year)
      .limit(1)
      .get();
    if (!existing.empty) {
      res.status(409).json({ error: "Plán pro tento měsíc již existuje" });
      return;
    }

    const ref = await db().collection("shiftPlans").add({
      month,
      year,
      status: "created",
      createdBy: req.uid ?? null,
      openedAt: null,
      closedAt: null,
      publishedAt: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await logCreate(ctxFromReq(req), {
      collection: "shiftPlans",
      resourceId: ref.id,
      summary: { year, month },
    });
    res.status(201).json({ id: ref.id });
  }
);

// GET /shifts/plans/:planId — plan + employees + shifts
shiftsRouter.get(
  "/plans/:planId",
  requireAuth,
  requirePermission("shifts.view.all", "shifts.view.self"),
  async (req: AuthRequest, res) => {
    const { planId } = req.params;
    const planRef = db().collection("shiftPlans").doc(planId);

    const [planDoc, employeesSnap, shiftsSnap, modSnap] = await Promise.all([
      planRef.get(),
      planRef.collection("planEmployees").orderBy("displayOrder", "asc").get(),
      planRef.collection("shifts").get(),
      planRef.collection("modRow").get(),
    ]);

    if (!planDoc.exists) {
      res.status(404).json({ error: "Plán nenalezen" });
      return;
    }

    const planData = planDoc.data()!;

    // Self-service viewers (no shifts.view.all) may only view plans that have
    // been opened (or beyond).
    const seesAllPlans = req.permissions?.has("shifts.view.all") ?? false;
    if (!seesAllPlans && planData.status === "created") {
      res.status(404).json({ error: "Plán nenalezen" });
      return;
    }

    // Only return shifts for employees currently in the plan (filter orphans)
    const currentEmployeeIds = new Set(employeesSnap.docs.map((d) => d.data().employeeId as string));
    const shifts = shiftsSnap.docs
      .filter((d) => currentEmployeeIds.has(d.data().employeeId as string))
      .map((d) => ({ id: d.id, ...d.data() }));

    // Enrich planEmployees with contractType from global employee docs
    const rawEmployees = employeesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown> & { id: string; employeeId: string }));
    const employeeIds = rawEmployees.map((e) => e.employeeId as string);
    const empDocs = await Promise.all(
      employeeIds.map((id) => db().collection("employees").doc(id).get())
    );
    const contractTypeMap = new Map<string, string>();
    empDocs.forEach((d) => {
      if (d.exists) {
        const data = d.data() as Record<string, unknown>;
        contractTypeMap.set(d.id, (data.currentContractType as string) ?? "");
      }
    });
    const employees = rawEmployees.map((e) => ({
      ...e,
      contractType: contractTypeMap.get(e.employeeId) ?? null,
    }));

    // Self-service viewers (no shifts.view.all) see a closed plan's snapshot
    // taken at close time, not the live shifts — admin changes after closing are
    // invisible until publish.
    let visibleShifts = shifts;
    if (planData.status === "closed" && !seesAllPlans) {
      const snapshotSnap = await planRef.collection("shiftsSnapshot").get();
      visibleShifts = snapshotSnap.docs
        .filter((d) => currentEmployeeIds.has(d.data().employeeId as string))
        .map((d) => ({ id: d.id, ...d.data() }));
    }

    res.json({
      id: planDoc.id,
      ...planData,
      modPersons: (planData.modPersons as Record<string, string>) ?? {},
      employees,
      shifts: visibleShifts,
      modShifts: modSnap.docs.map((d) => ({ id: d.id, date: d.id, ...d.data() })),
    });
  }
);

// PATCH /shifts/plans/:planId — status transition
shiftsRouter.patch(
  "/plans/:planId",
  requireAuth,
  requirePermission("shifts.plan.transition"),
  async (req, res) => {
    const { planId } = req.params;
    const body = req.body as Record<string, unknown>;
    const newStatus = body.status as string;

    const planRef = db().collection("shiftPlans").doc(planId);
    const planDoc = await planRef.get();
    if (!planDoc.exists) {
      res.status(404).json({ error: "Plán nenalezen" });
      return;
    }

    const currentStatus = planDoc.data()?.status as string;
    const validTransitions: Record<string, string> = {
      created: "opened",
      opened: "closed",
      closed: "published",
    };
    const reverseTransitions: Record<string, string> = {
      opened: "created",
      closed: "opened",
      published: "closed",
    };

    const isForward = validTransitions[currentStatus] === newStatus;
    const isReverse = reverseTransitions[currentStatus] === newStatus;
    const canRevert = (req as AuthRequest).permissions?.has("shifts.plan.revert") ?? false;

    if (!isForward && !(isReverse && canRevert)) {
      res.status(400).json({ error: "Neplatný přechod stavu" });
      return;
    }

    // On close: snapshot current shifts for employee view
    if (newStatus === "closed") {
      await snapshotShifts(planRef);
    }

    // On publish: delete the snapshot (no longer needed) + auto-fill manager R
    // + create payroll
    if (newStatus === "published") {
      await deleteCollection(planRef.collection("shiftsSnapshot"));
      const planData = planDoc.data() as { year: number; month: number };
      // Auto-fill "R" for FOM/managers on empty Mon–Fri non-holiday workdays.
      // Must run BEFORE payroll so the filled hours are picked up by the calc.
      await autoFillManagerRShifts(planRef, planData.year, planData.month);
      // Fire-and-forget: don't block the response on payroll calculation
      createOrUpdatePayrollPeriod(planId, planData.year, planData.month).catch((e) =>
        console.error("Payroll creation failed after publish:", e)
      );
    }

    // On revert from closed → opened: delete the snapshot
    if (currentStatus === "closed" && newStatus === "opened") {
      await deleteCollection(planRef.collection("shiftsSnapshot"));
    }

    await planRef.update({
      status: newStatus,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await logUpdate(ctxFromReq(req as AuthRequest), {
      collection: "shiftPlans",
      resourceId: planId,
      before: { status: currentStatus },
      after: { status: newStatus },
    });
    res.json({ ok: true });
  }
);

// PATCH /shifts/plans/:planId/deadlines — set automatic transition deadlines
shiftsRouter.patch(
  "/plans/:planId/deadlines",
  requireAuth,
  requirePermission("shifts.plan.edit"),
  async (req, res) => {
    const { planId } = req.params;
    const body = req.body as Record<string, unknown>;

    const planRef = db().collection("shiftPlans").doc(planId);
    const planDoc = await planRef.get();
    if (!planDoc.exists) {
      res.status(404).json({ error: "Plán nenalezen" });
      return;
    }

    const update: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    if ("openedAt" in body) {
      update.openedAt = body.openedAt ?? null;
    }
    if ("closedAt" in body) {
      update.closedAt = body.closedAt ?? null;
    }
    if ("publishedAt" in body) {
      update.publishedAt = body.publishedAt ?? null;
    }

    const before = planDoc.data() as Record<string, unknown>;
    await planRef.update(update);
    await logUpdate(ctxFromReq(req as AuthRequest), {
      collection: "shiftPlans",
      resourceId: planId,
      before: {
        openedAt: before.openedAt ?? null,
        closedAt: before.closedAt ?? null,
        publishedAt: before.publishedAt ?? null,
      },
      after: {
        openedAt: "openedAt" in body ? (body.openedAt ?? null) : (before.openedAt ?? null),
        closedAt: "closedAt" in body ? (body.closedAt ?? null) : (before.closedAt ?? null),
        publishedAt: "publishedAt" in body ? (body.publishedAt ?? null) : (before.publishedAt ?? null),
      },
    });
    res.json({ ok: true });
  }
);

// PATCH /shifts/plans/:planId/free-dpa-day — toggle a day where the DPA free-shift
// row appears (admin/director). DPQ/NPQ/NPA rows are automatic; DPA is opt-in per day.
shiftsRouter.patch(
  "/plans/:planId/free-dpa-day",
  requireAuth,
  requirePermission("shifts.freeShift.manage"),
  async (req, res) => {
    const { planId } = req.params;
    const body = req.body as Record<string, unknown>;
    const date = body.date as string;
    const enabled = body.enabled === true;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: "Neplatný formát data" });
      return;
    }

    const planRef = db().collection("shiftPlans").doc(planId);
    const planDoc = await planRef.get();
    if (!planDoc.exists) {
      res.status(404).json({ error: "Plán nenalezen" });
      return;
    }
    const cur = Array.isArray(planDoc.data()?.freeShiftDpaDays)
      ? (planDoc.data()!.freeShiftDpaDays as string[])
      : [];
    const set = new Set(cur);
    if (enabled) set.add(date); else set.delete(date);
    const next = [...set].sort();

    await planRef.update({ freeShiftDpaDays: next, updatedAt: FieldValue.serverTimestamp() });
    res.json({ ok: true, freeShiftDpaDays: next });
  }
);

// DELETE /shifts/plans/:planId — delete plan (admin only, ONLY while "created")
shiftsRouter.delete(
  "/plans/:planId",
  requireAuth,
  requirePermission("shifts.plan.delete"),
  async (req, res) => {
    const { planId } = req.params;
    const planRef = db().collection("shiftPlans").doc(planId);
    const planDoc = await planRef.get();

    if (!planDoc.exists) {
      res.status(404).json({ error: "Plán nenalezen" });
      return;
    }

    // #49 — a plan can only be deleted while still in the "created" state.
    // Once opened (employees may have filed Xs / change requests), deletion is
    // blocked; revert to "created" first if it really must go.
    if ((planDoc.data() as Record<string, unknown>).status !== "created") {
      res.status(409).json({
        error: "Plán lze smazat pouze ve stavu „Vytvořený“. Nejprve jej vraťte zpět do tohoto stavu.",
      });
      return;
    }

    const subCols = ["planEmployees", "shifts", "shiftsSnapshot", "modRow", "rules", "unavailabilityRequests", "shiftOverrideRequests", "shiftChangeRequests"];
    for (const col of subCols) {
      await deleteCollection(planRef.collection(col));
    }
    const before = planDoc.data() as Record<string, unknown>;
    await planRef.delete();
    await logDelete(ctxFromReq(req as AuthRequest), {
      collection: "shiftPlans",
      resourceId: planId,
      summary: { year: before.year, month: before.month, status: before.status },
    });
    res.json({ ok: true });
  }
);

// ─── Plan Employees ──────────────────────────────────────────────────────────

// GET /shifts/plans/:planId/employees
shiftsRouter.get(
  "/plans/:planId/employees",
  requireAuth,
  requirePermission("shifts.view.all"),
  async (req, res) => {
    const { planId } = req.params;
    const snap = await db()
      .collection("shiftPlans")
      .doc(planId)
      .collection("planEmployees")
      .orderBy("displayOrder", "asc")
      .get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }
);

// POST /shifts/plans/:planId/employees
shiftsRouter.post(
  "/plans/:planId/employees",
  requireAuth,
  requirePermission("shifts.planEmployees.manage"),
  async (req, res) => {
    const { planId } = req.params;
    const body = req.body as Record<string, unknown>;

    const employeeId = body.employeeId as string;
    const firstName = body.firstName as string;
    const lastName = body.lastName as string;
    const displayName = (body.displayName as string | undefined) ?? "";
    const section = body.section as string;
    const primaryShiftType = (body.primaryShiftType as string | null) ?? null;
    const primaryHotel = (body.primaryHotel as string | null) ?? null;
    const displayOrder = Number(body.displayOrder ?? 100);
    const active = body.active !== false; // default true

    if (!employeeId || !firstName || !lastName) {
      res.status(400).json({ error: "employeeId, firstName a lastName jsou povinné" });
      return;
    }
    if (!(VALID_SECTIONS as readonly string[]).includes(section)) {
      res.status(400).json({ error: "Neplatná sekce" });
      return;
    }
    if (primaryShiftType !== null && !(VALID_SHIFT_TYPES as readonly string[]).includes(primaryShiftType)) {
      res.status(400).json({ error: "Neplatný typ směny" });
      return;
    }
    if (primaryHotel !== null && !(HOTEL_CODES as readonly string[]).includes(primaryHotel)) {
      res.status(400).json({ error: "Neplatný hotel" });
      return;
    }

    // Duplicate check
    const dup = await db()
      .collection("shiftPlans")
      .doc(planId)
      .collection("planEmployees")
      .where("employeeId", "==", employeeId)
      .limit(1)
      .get();
    if (!dup.empty) {
      res.status(409).json({ error: "Zaměstnanec již v plánu je" });
      return;
    }

    const planRef = db().collection("shiftPlans").doc(planId);
    const planDoc = await planRef.get();
    if (!planDoc.exists) {
      res.status(404).json({ error: "Plán nenalezen" });
      return;
    }
    const planData = planDoc.data() as Record<string, unknown>;

    const ref = await planRef.collection("planEmployees").add({
      employeeId,
      firstName,
      lastName,
      displayName,
      section,
      primaryShiftType,
      primaryHotel,
      displayOrder,
      active,
      createdAt: FieldValue.serverTimestamp(),
    });

    // Make displayOrder contiguous and shift collisions down within the section.
    await renumberSection(planRef, section, { docId: ref.id, newOrder: displayOrder });

    // Auto-fill approved vacation days as X for this employee in this month
    await applyVacationXs(planRef, employeeId, planData.year as number, planData.month as number);

    // Bump plan.updatedAt so connected clients reload via the onSnapshot listener
    // (other employees' displayOrders may have shifted).
    await planRef.update({ updatedAt: FieldValue.serverTimestamp() });

    await logCreate(ctxFromReq(req as AuthRequest), {
      collection: "shiftPlans/planEmployees",
      resourceId: planId,
      subResourceId: ref.id,
      employeeId,
      summary: { firstName, lastName, section, primaryShiftType, primaryHotel },
    });

    res.status(201).json({ id: ref.id });
  }
);

// PUT /shifts/plans/:planId/employees/:docId — update a plan employee
shiftsRouter.put(
  "/plans/:planId/employees/:docId",
  requireAuth,
  requirePermission("shifts.planEmployees.manage"),
  async (req, res) => {
    const { planId, docId } = req.params;
    const body = req.body as Record<string, unknown>;

    const section = body.section as string;
    const primaryShiftType = (body.primaryShiftType as string | null) ?? null;
    const primaryHotel = (body.primaryHotel as string | null) ?? null;
    const displayOrder = Number(body.displayOrder ?? 100);
    const active = body.active !== false; // default true

    if (!(VALID_SECTIONS as readonly string[]).includes(section)) {
      res.status(400).json({ error: "Neplatná sekce" });
      return;
    }
    if (primaryShiftType !== null && !(VALID_SHIFT_TYPES as readonly string[]).includes(primaryShiftType)) {
      res.status(400).json({ error: "Neplatný typ směny" });
      return;
    }
    if (primaryHotel !== null && !(HOTEL_CODES as readonly string[]).includes(primaryHotel)) {
      res.status(400).json({ error: "Neplatný hotel" });
      return;
    }

    const planRef = db().collection("shiftPlans").doc(planId);
    const empRef = planRef.collection("planEmployees").doc(docId);

    // Capture pre-update state so we can renumber correctly when section or
    // displayOrder changes.
    const prevSnap = await empRef.get();
    if (!prevSnap.exists) {
      res.status(404).json({ error: "Zaměstnanec v plánu nenalezen" });
      return;
    }
    const prev = prevSnap.data() as { section: string; displayOrder: number };

    await empRef.update({
      section,
      primaryShiftType,
      primaryHotel,
      displayOrder,
      active,
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (prev.section !== section) {
      // Compact the section the employee left, then insert into the new one.
      await renumberSection(planRef, prev.section);
      await renumberSection(planRef, section, { docId, newOrder: displayOrder });
    } else {
      await renumberSection(planRef, section, {
        docId,
        newOrder: displayOrder,
        oldOrder: Number(prev.displayOrder),
      });
    }

    await planRef.update({ updatedAt: FieldValue.serverTimestamp() });
    const employeeIdForLog = (prevSnap.data() as Record<string, unknown>).employeeId as string | undefined;
    await logUpdate(ctxFromReq(req as AuthRequest), {
      collection: "shiftPlans/planEmployees",
      resourceId: planId,
      subResourceId: docId,
      employeeId: employeeIdForLog,
      before: prev as unknown as Record<string, unknown>,
      after: { section, primaryShiftType, primaryHotel, displayOrder, active },
    });
    res.json({ ok: true });
  }
);

// PATCH /shifts/plans/:planId/employees/:docId/x-allowance — set the per-employee,
// per-month absolute X limit (admin/director). Stored on the planEmployee so it is
// naturally scoped to the plan's month. This override is only meaningful when the
// employee has an approved vacation in the month; the client applies it accordingly.
shiftsRouter.patch(
  "/plans/:planId/employees/:docId/x-allowance",
  requireAuth,
  requirePermission("shifts.xAllowance.manage"),
  async (req, res) => {
    const { planId, docId } = req.params;
    const body = req.body as Record<string, unknown>;
    const limit = Number(body.limit);

    if (!Number.isInteger(limit) || limit < 0 || limit > 31) {
      res.status(400).json({ error: "Limit musí být celé číslo 0–31" });
      return;
    }

    const planRef = db().collection("shiftPlans").doc(planId);
    const empRef = planRef.collection("planEmployees").doc(docId);
    const prevSnap = await empRef.get();
    if (!prevSnap.exists) {
      res.status(404).json({ error: "Zaměstnanec v plánu nenalezen" });
      return;
    }
    const prevData = prevSnap.data() as Record<string, unknown>;
    const prevLimit = prevData.xLimitOverride ?? null;

    await empRef.update({ xLimitOverride: limit, updatedAt: FieldValue.serverTimestamp() });
    await planRef.update({ updatedAt: FieldValue.serverTimestamp() });
    await logUpdate(ctxFromReq(req as AuthRequest), {
      collection: "shiftPlans/planEmployees",
      resourceId: planId,
      subResourceId: docId,
      employeeId: prevData.employeeId as string | undefined,
      before: { xLimitOverride: prevLimit },
      after: { xLimitOverride: limit },
    });
    res.json({ ok: true, xLimitOverride: limit });
  }
);

// DELETE /shifts/plans/:planId/employees/:docId
shiftsRouter.delete(
  "/plans/:planId/employees/:docId",
  requireAuth,
  requirePermission("shifts.planEmployees.manage"),
  async (req, res) => {
    const { planId, docId } = req.params;
    const planRef = db().collection("shiftPlans").doc(planId);

    // Resolve the employeeId before deleting the planEmployee doc
    const empDoc = await planRef.collection("planEmployees").doc(docId).get();
    if (!empDoc.exists) {
      res.status(404).json({ error: "Zaměstnanec v plánu nenalezen" });
      return;
    }
    const employeeData = empDoc.data()!;
    const employeeId = employeeData.employeeId as string;
    const section = employeeData.section as string;

    // Delete the planEmployee doc
    await empDoc.ref.delete();

    // Compact the section so remaining employees keep contiguous displayOrders.
    await renumberSection(planRef, section);

    // Cascade: delete all shift docs for this employee in this plan
    const shiftsSnap = await planRef
      .collection("shifts")
      .where("employeeId", "==", employeeId)
      .get();
    if (!shiftsSnap.empty) {
      const batch = db().batch();
      shiftsSnap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    await planRef.update({ updatedAt: FieldValue.serverTimestamp() });
    await logDelete(ctxFromReq(req as AuthRequest), {
      collection: "shiftPlans/planEmployees",
      resourceId: planId,
      subResourceId: docId,
      employeeId,
      summary: {
        firstName: employeeData.firstName,
        lastName: employeeData.lastName,
        section,
        cascadedShifts: shiftsSnap.size,
      },
    });
    res.json({ ok: true });
  }
);

// POST /shifts/plans/:planId/copy-employees — copy planEmployees from another plan
shiftsRouter.post(
  "/plans/:planId/copy-employees",
  requireAuth,
  requirePermission("shifts.plan.edit"),
  async (req, res) => {
    const { planId } = req.params;
    const body = req.body as Record<string, unknown>;
    const sourcePlanId = body.sourcePlanId as string;

    if (!sourcePlanId) {
      res.status(400).json({ error: "sourcePlanId je povinné" });
      return;
    }

    const sourceSnap = await db()
      .collection("shiftPlans")
      .doc(sourcePlanId)
      .collection("planEmployees")
      .get();

    if (sourceSnap.empty) {
      res.json({ ok: true, copied: 0 });
      return;
    }

    // Fetch target plan to get year/month for vacation X auto-fill
    const targetPlanDoc = await db().collection("shiftPlans").doc(planId).get();
    const targetPlanData = targetPlanDoc.data() as Record<string, unknown>;
    const targetYear = targetPlanData.year as number;
    const targetMonth = targetPlanData.month as number;
    const targetPlanRef = db().collection("shiftPlans").doc(planId);

    const batch = db().batch();
    for (const doc of sourceSnap.docs) {
      const ref = targetPlanRef.collection("planEmployees").doc(doc.id);
      // The X-limit override is month-specific (tied to that month's vacation), so it
      // must not carry into a copied month. Drop it (and the legacy extra field too).
      const { xLimitOverride: _x, xAllowanceExtra: _xa, ...rest } = doc.data() as Record<string, unknown>;
      void _x; void _xa;
      batch.set(ref, { ...rest, createdAt: FieldValue.serverTimestamp() });
    }
    await batch.commit();

    // Auto-fill approved vacation days as X for each copied employee
    for (const doc of sourceSnap.docs) {
      await applyVacationXs(targetPlanRef, doc.data().employeeId as string, targetYear, targetMonth);
    }

    await writeAudit(ctxFromReq(req as AuthRequest), {
      action: "create",
      collection: "shiftPlans/planEmployees",
      resourceId: planId,
      extra: { kind: "copy-employees", sourcePlanId, copied: sourceSnap.size },
    });

    res.json({ ok: true, copied: sourceSnap.size });
  }
);

// ─── Shifts (cells) ──────────────────────────────────────────────────────────

// PUT /shifts/plans/:planId/shifts/:employeeId/:date — upsert a shift cell
shiftsRouter.put(
  "/plans/:planId/shifts/:employeeId/:date",
  requireAuth,
  requirePermission("shifts.cells.edit", "shifts.cells.editOwnX"),
  async (req: AuthRequest, res) => {
    const { planId, employeeId, date } = req.params;
    const body = req.body as Record<string, unknown>;
    const rawInput = (body.rawInput as string) ?? "";
    // Self-service editors (shifts.cells.editOwnX but NOT shifts.cells.edit —
    // e.g. the built-in employee) may only enter X on an opened plan.
    const selfServiceOnly =
      (req.permissions?.has("shifts.cells.editOwnX") && !req.permissions?.has("shifts.cells.edit")) ?? false;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: "Neplatný formát data" });
      return;
    }

    // Self-service guards: X only, opened plan only
    if (selfServiceOnly) {
      const planDoc = await db().collection("shiftPlans").doc(planId).get();
      if (planDoc.data()?.status !== "opened") {
        res.status(403).json({ error: "Zaměstnanci mohou upravovat směny pouze v otevřeném plánu." });
        return;
      }

      const parsed = parseShiftExpression(rawInput);
      if (rawInput.trim() !== "" && (!parsed.isValid || !parsed.segments.every((s) => s.code === "X"))) {
        res.status(403).json({ error: "Zaměstnanci mohou zadávat pouze X." });
        return;
      }
    }

    const parsed = parseShiftExpression(rawInput);
    if (!parsed.isValid) {
      res.status(400).json({ error: parsed.error ?? "Neplatný výraz směny" });
      return;
    }

    let status: "assigned" | "day_off" | "unassigned";
    if (rawInput.trim() === "") {
      status = "unassigned";
    } else if (parsed.segments.every((s) => s.code === "X")) {
      status = "day_off";
    } else {
      status = "assigned";
    }

    const docId = `${employeeId}_${date}`;
    const shiftRef = db()
      .collection("shiftPlans")
      .doc(planId)
      .collection("shifts")
      .doc(docId);
    const beforeSnap = await shiftRef.get();
    const beforeRaw = beforeSnap.exists ? ((beforeSnap.data() as Record<string, unknown>).rawInput as string) ?? "" : "";
    await shiftRef.set({
      employeeId,
      date,
      rawInput: parsed.rawInput,
      segments: parsed.segments,
      hoursComputed: parsed.hoursComputed,
      isDouble: parsed.isDouble,
      status,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await db().collection("shiftPlans").doc(planId).update({ updatedAt: FieldValue.serverTimestamp() });

    // Compact form: only log the rawInput change. Segments + hours are
    // derived from rawInput so storing them would just inflate the log.
    if (beforeRaw !== parsed.rawInput) {
      await logUpdate(ctxFromReq(req), {
        collection: "shiftPlans/shifts",
        resourceId: planId,
        subResourceId: `${employeeId}_${date}`,
        employeeId,
        year: Number(String(date).slice(0, 4)) || undefined,
        month: Number(String(date).slice(5, 7)) || undefined,
        before: { rawInput: beforeRaw },
        after: { rawInput: parsed.rawInput },
      });
    }
    res.json({ ok: true, hoursComputed: parsed.hoursComputed });
  }
);

// DELETE /shifts/plans/:planId/shifts/:employeeId/:date
shiftsRouter.delete(
  "/plans/:planId/shifts/:employeeId/:date",
  requireAuth,
  requirePermission("shifts.cells.edit", "shifts.cells.editOwnX"),
  async (req: AuthRequest, res) => {
    const { planId, employeeId, date } = req.params;
    // Self-service editors (editOwnX but not cells.edit) may only delete on an opened plan.
    const selfServiceOnly =
      (req.permissions?.has("shifts.cells.editOwnX") && !req.permissions?.has("shifts.cells.edit")) ?? false;

    if (selfServiceOnly) {
      const planDoc = await db().collection("shiftPlans").doc(planId).get();
      if (planDoc.data()?.status !== "opened") {
        res.status(403).json({ error: "Zaměstnanci mohou mazat směny pouze v otevřeném plánu." });
        return;
      }
    }

    const docId = `${employeeId}_${date}`;
    const shiftRef = db()
      .collection("shiftPlans")
      .doc(planId)
      .collection("shifts")
      .doc(docId);
    const beforeSnap = await shiftRef.get();
    const beforeData = beforeSnap.exists ? (beforeSnap.data() as Record<string, unknown>) : {};
    await shiftRef.delete();
    await db().collection("shiftPlans").doc(planId).update({ updatedAt: FieldValue.serverTimestamp() });
    if (beforeSnap.exists) {
      await logDelete(ctxFromReq(req), {
        collection: "shiftPlans/shifts",
        resourceId: planId,
        subResourceId: `${employeeId}_${date}`,
        employeeId,
        year: Number(String(date).slice(0, 4)) || undefined,
        month: Number(String(date).slice(5, 7)) || undefined,
        summary: { date, rawInput: beforeData.rawInput },
      });
    }
    res.json({ ok: true });
  }
);

// ─── Rules ───────────────────────────────────────────────────────────────────

// GET /shifts/plans/:planId/rules
shiftsRouter.get(
  "/plans/:planId/rules",
  requireAuth,
  requirePermission("shifts.view.all"),
  async (req, res) => {
    const { planId } = req.params;
    const snap = await db()
      .collection("shiftPlans")
      .doc(planId)
      .collection("rules")
      .get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }
);

// PUT /shifts/plans/:planId/rules — batch upsert rules
shiftsRouter.put(
  "/plans/:planId/rules",
  requireAuth,
  requirePermission("shifts.cells.edit"),
  async (req, res) => {
    const { planId } = req.params;
    const body = req.body as Record<string, unknown>;
    const rules = body.rules as Array<{ ruleType: string; value: string; enabled: boolean }>;

    if (!Array.isArray(rules)) {
      res.status(400).json({ error: "rules musí být pole" });
      return;
    }

    const batch = db().batch();
    for (const rule of rules) {
      const ref = db()
        .collection("shiftPlans")
        .doc(planId)
        .collection("rules")
        .doc(rule.ruleType);
      batch.set(ref, { ...rule, updatedAt: FieldValue.serverTimestamp() });
    }
    await batch.commit();
    await writeAudit(ctxFromReq(req as AuthRequest), {
      action: "update",
      collection: "shiftPlans/rules",
      resourceId: planId,
      extra: {
        rules: rules.map((r) => ({ ruleType: r.ruleType, value: r.value, enabled: r.enabled })),
      },
    });
    res.json({ ok: true });
  }
);

// ─── Unavailability Requests ─────────────────────────────────────────────────

// GET /shifts/plans/:planId/unavailability — manager sees all requests
shiftsRouter.get(
  "/plans/:planId/unavailability",
  requireAuth,
  requirePermission("shifts.view.all"),
  async (req, res) => {
    const { planId } = req.params;
    const snap = await db()
      .collection("shiftPlans")
      .doc(planId)
      .collection("unavailabilityRequests")
      .orderBy("requestedAt", "desc")
      .get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }
);

// POST /shifts/plans/:planId/unavailability — employee submits request
shiftsRouter.post(
  "/plans/:planId/unavailability",
  requireAuth,
  async (req: AuthRequest, res) => {
    const { planId } = req.params;
    const body = req.body as Record<string, unknown>;

    const employeeId = body.employeeId as string;
    const date = body.date as string;
    const reason = (body.reason as string) ?? "";
    const isException = Boolean(body.isException);

    if (!employeeId || !date) {
      res.status(400).json({ error: "employeeId a date jsou povinné" });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: "Neplatný formát data" });
      return;
    }

    const ref = await db()
      .collection("shiftPlans")
      .doc(planId)
      .collection("unavailabilityRequests")
      .add({
        employeeId,
        date,
        reason,
        isException,
        status: "pending",
        requestedAt: FieldValue.serverTimestamp(),
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null,
      });
    await logCreate(ctxFromReq(req), {
      collection: "shiftPlans/unavailabilityRequests",
      resourceId: planId,
      subResourceId: ref.id,
      employeeId,
      summary: { date, reason, isException },
    });
    res.status(201).json({ id: ref.id });
  }
);

// PATCH /shifts/plans/:planId/unavailability/:reqId — approve or reject
shiftsRouter.patch(
  "/plans/:planId/unavailability/:reqId",
  requireAuth,
  requirePermission("shifts.override.review"),
  async (req: AuthRequest, res) => {
    const { planId, reqId } = req.params;
    const body = req.body as Record<string, unknown>;
    const status = body.status as string;

    if (!["approved", "rejected"].includes(status)) {
      res.status(400).json({ error: "Stav musí být approved nebo rejected" });
      return;
    }

    const reqRef = db()
      .collection("shiftPlans")
      .doc(planId)
      .collection("unavailabilityRequests")
      .doc(reqId);
    const beforeSnap = await reqRef.get();
    const before = beforeSnap.exists ? (beforeSnap.data() as Record<string, unknown>) : {};
    await reqRef.update({
      status,
      reviewedBy: req.uid ?? null,
      reviewedAt: FieldValue.serverTimestamp(),
      rejectionReason: status === "rejected" ? ((body.rejectionReason as string) ?? null) : null,
    });
    const uaYmSrc = String(before.date ?? "");
    await logUpdate(ctxFromReq(req), {
      collection: "shiftPlans/unavailabilityRequests",
      resourceId: planId,
      subResourceId: reqId,
      employeeId: before.employeeId as string | undefined,
      event: status === "approved" ? "shift.unavailability.approve" : "shift.unavailability.reject",
      year: Number(uaYmSrc.slice(0, 4)) || undefined,
      month: Number(uaYmSrc.slice(5, 7)) || undefined,
      before: { status: before.status },
      after: { status },
    });
    res.json({ ok: true });
  }
);

// ─── Shift Override Count (global — across all plans) ────────────────────────

// GET /shifts/overrides/pending-count — total pending overrides for nav badge
shiftsRouter.get(
  "/overrides/pending-count",
  requireAuth,
  requirePermission("shifts.override.review"),
  async (_req, res) => {
    const snap = await db()
      .collectionGroup("shiftOverrideRequests")
      .where("status", "==", "pending")
      .get();
    res.json({ count: snap.size });
  }
);

// GET /shifts/overrides/pending — full list across all plans, denormalized
// with planId / planMonth / planYear so the upozorneni hub can deep-link.
shiftsRouter.get(
  "/overrides/pending",
  requireAuth,
  requirePermission("shifts.override.review"),
  async (_req, res) => {
    const snap = await db()
      .collectionGroup("shiftOverrideRequests")
      .where("status", "==", "pending")
      .orderBy("requestedAt", "desc")
      .get();
    // parent.parent is the shiftPlans/{planId} doc. Resolve plan year/month.
    const planMetaCache = new Map<string, { year: number; month: number } | null>();
    async function planMeta(planId: string) {
      if (planMetaCache.has(planId)) return planMetaCache.get(planId)!;
      const planDoc = await db().collection("shiftPlans").doc(planId).get();
      const meta = planDoc.exists
        ? {
            year: (planDoc.data() as Record<string, unknown>).year as number,
            month: (planDoc.data() as Record<string, unknown>).month as number,
          }
        : null;
      planMetaCache.set(planId, meta);
      return meta;
    }
    const out = await Promise.all(
      snap.docs.map(async (d) => {
        const planId = d.ref.parent.parent?.id ?? "";
        const meta = planId ? await planMeta(planId) : null;
        return {
          id: d.id,
          planId,
          planYear: meta?.year ?? null,
          planMonth: meta?.month ?? null,
          ...d.data(),
        };
      })
    );
    res.json(out);
  }
);

// ─── Shift Override Requests ─────────────────────────────────────────────────

// GET /shifts/plans/:planId/shiftOverrides — list override requests
// Admin/director/manager: all requests. Employee: own requests only.
shiftsRouter.get(
  "/plans/:planId/shiftOverrides",
  requireAuth,
  requirePermission("shifts.override.review", "shifts.override.submit", "shifts.view.self"),
  async (req: AuthRequest, res) => {
    const { planId } = req.params;
    // Staff who fill the grid (shifts.cells.edit = built-in admin/director/manager)
    // see all override requests; self-service submitters see only their own.
    const isPrivileged = req.permissions?.has("shifts.cells.edit") ?? false;

    let query: admin.firestore.Query = db()
      .collection("shiftPlans")
      .doc(planId)
      .collection("shiftOverrideRequests")
      .orderBy("requestedAt", "desc");

    if (!isPrivileged) {
      query = query.where("requestedBy", "==", req.uid!);
    }

    const snap = await query.get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }
);

// POST /shifts/plans/:planId/shiftOverrides — submit override request
shiftsRouter.post(
  "/plans/:planId/shiftOverrides",
  requireAuth,
  requirePermission("shifts.override.submit", "shifts.view.self"),
  async (req: AuthRequest, res) => {
    const { planId } = req.params;
    const body = req.body as Record<string, unknown>;

    const employeeId = body.employeeId as string;
    const date = body.date as string;
    const requestedInput = (body.requestedInput as string) ?? "";
    const reason = (body.reason as string) ?? "";
    const violationTypes = Array.isArray(body.violationTypes) ? body.violationTypes as string[] : [];

    if (!employeeId || !date) {
      res.status(400).json({ error: "employeeId a date jsou povinné" });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: "Neplatný formát data" });
      return;
    }
    if (!reason.trim()) {
      res.status(400).json({ error: "Důvod je povinný" });
      return;
    }

    const ref = await db()
      .collection("shiftPlans")
      .doc(planId)
      .collection("shiftOverrideRequests")
      .add({
        employeeId,
        date,
        requestedInput,
        reason,
        violationTypes,
        status: "pending",
        requestedBy: req.uid ?? null,
        requestedAt: FieldValue.serverTimestamp(),
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null,
      });
    await db().collection("shiftPlans").doc(planId).update({ updatedAt: FieldValue.serverTimestamp() });
    await logCreate(ctxFromReq(req), {
      collection: "shiftPlans/shiftOverrideRequests",
      resourceId: planId,
      subResourceId: ref.id,
      employeeId,
      summary: { date, requestedInput, reason, violationTypes },
    });
    res.status(201).json({ id: ref.id });
  }
);

// PATCH /shifts/plans/:planId/shiftOverrides/:reqId — approve or reject
shiftsRouter.patch(
  "/plans/:planId/shiftOverrides/:reqId",
  requireAuth,
  requirePermission("shifts.override.review"),
  async (req: AuthRequest, res) => {
    const { planId, reqId } = req.params;
    const body = req.body as Record<string, unknown>;
    const status = body.status as string;

    if (!["approved", "rejected"].includes(status)) {
      res.status(400).json({ error: "Stav musí být approved nebo rejected" });
      return;
    }

    const overrideRef = db()
      .collection("shiftPlans")
      .doc(planId)
      .collection("shiftOverrideRequests")
      .doc(reqId);

    const overrideDoc = await overrideRef.get();
    if (!overrideDoc.exists) {
      res.status(404).json({ error: "Žádost nenalezena" });
      return;
    }

    const overrideData = overrideDoc.data() as Record<string, unknown>;

    // On approval: save the shift to Firestore
    if (status === "approved") {
      const employeeId = overrideData.employeeId as string;
      const date = overrideData.date as string;
      const rawInput = overrideData.requestedInput as string;

      const parsed = parseShiftExpression(rawInput);
      if (!parsed.isValid) {
        res.status(400).json({ error: "Neplatný výraz směny v žádosti" });
        return;
      }

      const shiftStatus = parsed.segments.every((s) => s.code === "X") ? "day_off" : "assigned";
      const docId = `${employeeId}_${date}`;
      await db()
        .collection("shiftPlans")
        .doc(planId)
        .collection("shifts")
        .doc(docId)
        .set({
          employeeId,
          date,
          rawInput: parsed.rawInput,
          segments: parsed.segments,
          hoursComputed: parsed.hoursComputed,
          isDouble: parsed.isDouble,
          status: shiftStatus,
          updatedAt: FieldValue.serverTimestamp(),
        });
    }

    await overrideRef.update({
      status,
      reviewedBy: req.uid ?? null,
      reviewedAt: FieldValue.serverTimestamp(),
      rejectionReason: status === "rejected" ? ((body.rejectionReason as string) ?? null) : null,
    });
    await db().collection("shiftPlans").doc(planId).update({ updatedAt: FieldValue.serverTimestamp() });
    const ovYmSrc = String(overrideData.date ?? "");
    await logUpdate(ctxFromReq(req), {
      collection: "shiftPlans/shiftOverrideRequests",
      resourceId: planId,
      subResourceId: reqId,
      employeeId: overrideData.employeeId as string | undefined,
      event: status === "approved" ? "shift.override.approve" : "shift.override.reject",
      year: Number(ovYmSrc.slice(0, 4)) || undefined,
      month: Number(ovYmSrc.slice(5, 7)) || undefined,
      before: { status: overrideData.status },
      after: { status },
    });
    res.json({ ok: true });
  }
);

// DELETE /shifts/plans/:planId/shiftOverrides/:reqId — requester cancels own pending request
shiftsRouter.delete(
  "/plans/:planId/shiftOverrides/:reqId",
  requireAuth,
  requirePermission("shifts.override.submit", "shifts.view.self"),
  async (req: AuthRequest, res) => {
    const { planId, reqId } = req.params;
    const ref = db()
      .collection("shiftPlans")
      .doc(planId)
      .collection("shiftOverrideRequests")
      .doc(reqId);

    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Žádost nenalezena" });
      return;
    }
    const data = snap.data() as Record<string, unknown>;
    if (data.requestedBy !== req.uid) {
      res.status(403).json({ error: "Nemáte oprávnění tuto žádost zrušit" });
      return;
    }
    if (data.status !== "pending") {
      res.status(400).json({ error: "Lze zrušit pouze čekající žádost" });
      return;
    }
    await ref.delete();
    await db().collection("shiftPlans").doc(planId).update({ updatedAt: FieldValue.serverTimestamp() });
    await logDelete(ctxFromReq(req), {
      collection: "shiftPlans/shiftOverrideRequests",
      resourceId: planId,
      subResourceId: reqId,
      employeeId: data.employeeId as string | undefined,
      summary: { date: data.date, requestedInput: data.requestedInput, reason: data.reason },
    });
    res.json({ ok: true });
  }
);

// ─── Shift Change Requests (published plans) ────────────────────────────────

// GET /shifts/changeRequests/pending-count — total pending change requests for nav badge
shiftsRouter.get(
  "/changeRequests/pending-count",
  requireAuth,
  requirePermission("shifts.changeRequest.review"),
  async (_req, res) => {
    const snap = await db()
      .collectionGroup("shiftChangeRequests")
      .where("status", "==", "pending")
      .get();
    res.json({ count: snap.size });
  }
);

// GET /shifts/changeRequests/pending — full list across all plans
shiftsRouter.get(
  "/changeRequests/pending",
  requireAuth,
  requirePermission("shifts.changeRequest.review"),
  async (_req, res) => {
    const snap = await db()
      .collectionGroup("shiftChangeRequests")
      .where("status", "==", "pending")
      .orderBy("requestedAt", "desc")
      .get();
    const planMetaCache = new Map<string, { year: number; month: number } | null>();
    async function planMeta(planId: string) {
      if (planMetaCache.has(planId)) return planMetaCache.get(planId)!;
      const planDoc = await db().collection("shiftPlans").doc(planId).get();
      const meta = planDoc.exists
        ? {
            year: (planDoc.data() as Record<string, unknown>).year as number,
            month: (planDoc.data() as Record<string, unknown>).month as number,
          }
        : null;
      planMetaCache.set(planId, meta);
      return meta;
    }
    const out = await Promise.all(
      snap.docs.map(async (d) => {
        const planId = d.ref.parent.parent?.id ?? "";
        const meta = planId ? await planMeta(planId) : null;
        return {
          id: d.id,
          planId,
          planYear: meta?.year ?? null,
          planMonth: meta?.month ?? null,
          ...d.data(),
        };
      })
    );
    res.json(out);
  }
);

// GET /shifts/plans/:planId/shiftChangeRequests — list change requests for a plan
// Admin/director: all requests. Everyone else: own requests only (filtered by requestedBy).
shiftsRouter.get(
  "/plans/:planId/shiftChangeRequests",
  requireAuth,
  requirePermission("shifts.changeRequest.review", "shifts.changeRequest.submit", "shifts.view.self"),
  async (req: AuthRequest, res) => {
    const { planId } = req.params;
    // Reviewers (shifts.changeRequest.review = built-in admin/director) see all
    // change requests; submitters see only their own.
    const isPrivileged = req.permissions?.has("shifts.changeRequest.review") ?? false;

    let query: admin.firestore.Query = db()
      .collection("shiftPlans")
      .doc(planId)
      .collection("shiftChangeRequests")
      .orderBy("requestedAt", "desc");

    if (!isPrivileged) {
      query = query.where("requestedBy", "==", req.uid!);
    }

    const snap = await query.get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }
);

// POST /shifts/plans/:planId/shiftChangeRequests — submit a change request
shiftsRouter.post(
  "/plans/:planId/shiftChangeRequests",
  requireAuth,
  requirePermission("shifts.changeRequest.submit", "shifts.freeShift.claim"),
  async (req: AuthRequest, res) => {
    const { planId } = req.params;
    const body = req.body as Record<string, unknown>;

    const employeeId = body.employeeId as string;
    const date = body.date as string;
    const currentRawInput = (body.currentRawInput as string) ?? "";
    const reason = (body.reason as string) ?? "";
    // #32 — the request time is the moment the employee STARTED the request
    // (double-clicked the cell), captured client-side and passed here, not the
    // moment they finished typing a reason + submitted. Fall back to server time.
    const requestedAtClient = body.requestedAtClient as string | undefined;
    // Volné směny: kind "free-claim" claims an unassigned porter slot {code, hotel}
    // for `date`; on approval the shift is written to this employee. Default is the
    // existing "change" flow (request to change one's own already-assigned shift).
    const kind = body.kind === "free-claim" ? "free-claim" : "change";
    const code = (body.code as string) ?? "";
    const hotel = (body.hotel as string) ?? "";

    if (!employeeId || !date) {
      res.status(400).json({ error: "employeeId a date jsou povinné" });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: "Neplatný formát data" });
      return;
    }
    if (kind === "change" && !reason.trim()) {
      res.status(400).json({ error: "Důvod je povinný" });
      return;
    }

    // Plan must exist and be published
    const planRef = db().collection("shiftPlans").doc(planId);
    const planDoc = await planRef.get();
    if (!planDoc.exists) {
      res.status(404).json({ error: "Plán nenalezen" });
      return;
    }
    const planData = planDoc.data() as Record<string, unknown>;
    if (planData.status !== "published") {
      res.status(400).json({ error: "Žádosti o změnu lze podávat pouze k publikovaným plánům" });
      return;
    }

    const docData: Record<string, unknown> = {
      employeeId,
      date,
      kind,
      currentRawInput,
      reason,
      status: "pending",
      requestedBy: req.uid ?? null,
      requestedAt: clientTimestampOrServer(requestedAtClient),
      reviewedBy: null,
      reviewedAt: null,
      rejectionReason: null,
    };

    if (kind === "free-claim") {
      if (!isValidFreeSlot(code, hotel)) {
        res.status(400).json({ error: "Neplatná volná směna" });
        return;
      }
      // Slot must still be free
      if (await isSlotCovered(planRef, date, code, hotel)) {
        res.status(409).json({ error: "Tato směna je již obsazená" });
        return;
      }
      // Reject a duplicate pending claim by the same employee for the same slot
      const sameDay = await planRef.collection("shiftChangeRequests").where("date", "==", date).get();
      const dup = sameDay.docs.some((d) => {
        const x = d.data();
        return x.kind === "free-claim" && x.status === "pending" &&
          x.employeeId === employeeId && x.code === code && x.hotel === hotel;
      });
      if (dup) {
        res.status(409).json({ error: "Tuto směnu jste si již zarezervoval/a" });
        return;
      }
      docData.code = code;
      docData.hotel = hotel;
    }

    const ref = await planRef.collection("shiftChangeRequests").add(docData);
    await planRef.update({ updatedAt: FieldValue.serverTimestamp() });
    await logCreate(ctxFromReq(req), {
      collection: "shiftPlans/shiftChangeRequests",
      resourceId: planId,
      subResourceId: ref.id,
      employeeId,
      summary: kind === "free-claim"
        ? { kind, date, code, hotel }
        : { date, currentRawInput, reason },
    });
    res.status(201).json({ id: ref.id });
  }
);

// PATCH /shifts/plans/:planId/shiftChangeRequests/:reqId — approve or reject
shiftsRouter.patch(
  "/plans/:planId/shiftChangeRequests/:reqId",
  requireAuth,
  requirePermission("shifts.changeRequest.review"),
  async (req: AuthRequest, res) => {
    const { planId, reqId } = req.params;
    const body = req.body as Record<string, unknown>;
    const status = body.status as string;

    if (!["approved", "rejected"].includes(status)) {
      res.status(400).json({ error: "Stav musí být approved nebo rejected" });
      return;
    }

    const changeReqRef = db()
      .collection("shiftPlans")
      .doc(planId)
      .collection("shiftChangeRequests")
      .doc(reqId);

    const changeReqDoc = await changeReqRef.get();
    if (!changeReqDoc.exists) {
      res.status(404).json({ error: "Žádost nenalezena" });
      return;
    }

    const beforeData = changeReqDoc.data() as Record<string, unknown>;
    const planRef = db().collection("shiftPlans").doc(planId);

    // Volné směny: approving a free-claim ASSIGNS the porter shift to the employee
    // and auto-rejects any other pending claims competing for the same slot.
    if (status === "approved" && beforeData.kind === "free-claim") {
      const claimDate = beforeData.date as string;
      const claimCode = beforeData.code as string;
      const claimHotel = beforeData.hotel as string;
      const claimEmployeeId = beforeData.employeeId as string;

      if (await isSlotCovered(planRef, claimDate, claimCode, claimHotel)) {
        res.status(409).json({ error: "Tato směna už byla mezitím obsazena." });
        return;
      }

      const parsed = parseShiftExpression(`${claimCode}${claimHotel}`);
      const shiftDocId = `${claimEmployeeId}_${claimDate}`;
      await planRef.collection("shifts").doc(shiftDocId).set({
        employeeId: claimEmployeeId,
        date: claimDate,
        rawInput: parsed.rawInput,
        segments: parsed.segments,
        hoursComputed: parsed.hoursComputed,
        isDouble: parsed.isDouble,
        status: "assigned",
        updatedAt: FieldValue.serverTimestamp(),
      });
      const claimYear = Number(String(claimDate).slice(0, 4)) || undefined;
      const claimMonth = Number(String(claimDate).slice(5, 7)) || undefined;
      await logUpdate(ctxFromReq(req), {
        collection: "shiftPlans/shifts",
        resourceId: planId,
        subResourceId: shiftDocId,
        employeeId: claimEmployeeId,
        year: claimYear,
        month: claimMonth,
        before: { rawInput: "" },
        after: { rawInput: parsed.rawInput },
      });

      // Auto-reject sibling pending claims for the same slot.
      const sameDay = await planRef.collection("shiftChangeRequests").where("date", "==", claimDate).get();
      const batch = db().batch();
      const autoRejected: { id: string; employeeId?: string }[] = [];
      for (const d of sameDay.docs) {
        if (d.id === reqId) continue;
        const x = d.data();
        if (x.kind === "free-claim" && x.status === "pending" && x.code === claimCode && x.hotel === claimHotel) {
          batch.update(d.ref, {
            status: "rejected",
            reviewedBy: req.uid ?? null,
            reviewedAt: FieldValue.serverTimestamp(),
            rejectionReason: "Směnu převzal jiný zaměstnanec.",
          });
          autoRejected.push({ id: d.id, employeeId: x.employeeId as string | undefined });
        }
      }
      await batch.commit();

      // Audit each competing claim that lost the slot as a Systém action
      // (previously these batch rejections were silent — change-log gap).
      for (const loser of autoRejected) {
        await logSystemEvent({
          event: "shift.freeClaim.autoReject",
          collection: "shiftPlans/shiftChangeRequests",
          resourceId: planId,
          subResourceId: loser.id,
          employeeId: loser.employeeId,
          year: claimYear,
          month: claimMonth,
          summary: { rejectionReason: "Směnu převzal jiný zaměstnanec." },
        });
      }
    }

    await changeReqRef.update({
      status,
      reviewedBy: req.uid ?? null,
      reviewedAt: FieldValue.serverTimestamp(),
      rejectionReason: status === "rejected" ? ((body.rejectionReason as string) ?? null) : null,
    });
    await planRef.update({ updatedAt: FieldValue.serverTimestamp() });
    const crYmSrc = String(beforeData.date ?? "");
    const isFreeClaim = beforeData.kind === "free-claim";
    const crEvent = isFreeClaim
      ? status === "approved"
        ? "shift.freeClaim.approve"
        : "shift.freeClaim.reject"
      : status === "approved"
        ? "shift.change.approve"
        : "shift.change.reject";
    await logUpdate(ctxFromReq(req), {
      collection: "shiftPlans/shiftChangeRequests",
      resourceId: planId,
      subResourceId: reqId,
      employeeId: beforeData.employeeId as string | undefined,
      event: crEvent,
      year: Number(crYmSrc.slice(0, 4)) || undefined,
      month: Number(crYmSrc.slice(5, 7)) || undefined,
      before: { status: beforeData.status },
      after: { status },
    });
    res.json({ ok: true });
  }
);

// DELETE /shifts/plans/:planId/shiftChangeRequests/:reqId — requester cancels own pending request
shiftsRouter.delete(
  "/plans/:planId/shiftChangeRequests/:reqId",
  requireAuth,
  requirePermission("shifts.changeRequest.submit", "shifts.freeShift.claim"),
  async (req: AuthRequest, res) => {
    const { planId, reqId } = req.params;
    const ref = db()
      .collection("shiftPlans")
      .doc(planId)
      .collection("shiftChangeRequests")
      .doc(reqId);

    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Žádost nenalezena" });
      return;
    }
    const data = snap.data() as Record<string, unknown>;
    if (data.requestedBy !== req.uid) {
      res.status(403).json({ error: "Nemáte oprávnění tuto žádost zrušit" });
      return;
    }
    if (data.status !== "pending") {
      res.status(400).json({ error: "Lze zrušit pouze čekající žádost" });
      return;
    }
    await ref.delete();
    await db().collection("shiftPlans").doc(planId).update({ updatedAt: FieldValue.serverTimestamp() });
    await logDelete(ctxFromReq(req), {
      collection: "shiftPlans/shiftChangeRequests",
      resourceId: planId,
      subResourceId: reqId,
      employeeId: data.employeeId as string | undefined,
      summary: { date: data.date, currentRawInput: data.currentRawInput, reason: data.reason },
    });
    res.json({ ok: true });
  }
);

// ─── MOD Row (Manager on Duty) ───────────────────────────────────────────────

const VALID_MOD_CODE = /^[A-Z]$/;

// PATCH /shifts/plans/:planId/mod-persons — reassign a MOD letter to an employee
// Also renames (or deletes) all existing modRow entries for the old letter.
shiftsRouter.patch(
  "/plans/:planId/mod-persons",
  requireAuth,
  requirePermission("shifts.mod.manage"),
  async (req: AuthRequest, res) => {
    const { planId } = req.params;
    const { employeeId, oldLetter, newLetter } = req.body as {
      employeeId: string;
      oldLetter: string | null;
      newLetter: string | null;
    };

    if (!employeeId) {
      res.status(400).json({ error: "employeeId je povinné" });
      return;
    }
    if (newLetter !== null && !VALID_MOD_CODE.test(newLetter)) {
      res.status(400).json({ error: `Neplatný MOD kód: ${newLetter}` });
      return;
    }

    const planRef = db().collection("shiftPlans").doc(planId);
    const planDoc = await planRef.get();
    if (!planDoc.exists) {
      res.status(404).json({ error: "Plán nenalezen" });
      return;
    }

    const currentModPersons = (planDoc.data()!.modPersons as Record<string, string>) ?? {};

    // Build updated modPersons: remove any entry for this employee, then add new one
    const updated: Record<string, string> = {};
    for (const [letter, empId] of Object.entries(currentModPersons)) {
      if (letter !== oldLetter && empId !== employeeId) updated[letter] = empId;
    }
    if (newLetter) updated[newLetter] = employeeId;

    const batch = db().batch();

    if (oldLetter && newLetter && oldLetter !== newLetter) {
      // Rename all modRow entries with the old letter to the new letter
      const modSnap = await planRef.collection("modRow").where("code", "==", oldLetter).get();
      for (const d of modSnap.docs) {
        batch.update(d.ref, { code: newLetter, updatedAt: FieldValue.serverTimestamp() });
      }
    } else if (oldLetter && !newLetter) {
      // Unassign: delete all modRow entries for the old letter
      const modSnap = await planRef.collection("modRow").where("code", "==", oldLetter).get();
      for (const d of modSnap.docs) {
        batch.delete(d.ref);
      }
    }

    batch.update(planRef, {
      modPersons: updated,
      updatedAt: FieldValue.serverTimestamp(),
    });

    await batch.commit();
    await logUpdate(ctxFromReq(req), {
      collection: "shiftPlans",
      resourceId: planId,
      employeeId,
      before: { modPersons: currentModPersons },
      after: { modPersons: updated },
    });
    res.json({ ok: true, modPersons: updated });
  }
);

// PUT /shifts/plans/:planId/mod/:date — upsert a MOD cell
shiftsRouter.put(
  "/plans/:planId/mod/:date",
  requireAuth,
  requirePermission("shifts.mod.manage"),
  async (req, res) => {
    const { planId, date } = req.params;
    const body = req.body as Record<string, unknown>;
    const code = ((body.code as string) ?? "").toUpperCase().trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: "Neplatný formát data" });
      return;
    }
    if (!VALID_MOD_CODE.test(code)) {
      res.status(400).json({ error: `Neplatný MOD kód: ${code}` });
      return;
    }

    const modRef = db()
      .collection("shiftPlans")
      .doc(planId)
      .collection("modRow")
      .doc(date);
    const beforeSnap = await modRef.get();
    const beforeCode = beforeSnap.exists ? ((beforeSnap.data() as Record<string, unknown>).code as string | undefined) ?? null : null;
    await modRef.set({ code, updatedAt: FieldValue.serverTimestamp() });
    await db().collection("shiftPlans").doc(planId).update({ updatedAt: FieldValue.serverTimestamp() });
    if (beforeCode !== code) {
      await logUpdate(ctxFromReq(req as AuthRequest), {
        collection: "shiftPlans/modRow",
        resourceId: planId,
        subResourceId: date,
        before: { code: beforeCode },
        after: { code },
      });
    }
    res.json({ ok: true });
  }
);

// DELETE /shifts/plans/:planId/mod/:date — delete a MOD cell
shiftsRouter.delete(
  "/plans/:planId/mod/:date",
  requireAuth,
  requirePermission("shifts.mod.manage"),
  async (req, res) => {
    const { planId, date } = req.params;
    const modRef = db()
      .collection("shiftPlans")
      .doc(planId)
      .collection("modRow")
      .doc(date);
    const beforeSnap = await modRef.get();
    const beforeCode = beforeSnap.exists ? ((beforeSnap.data() as Record<string, unknown>).code as string | undefined) ?? null : null;
    await modRef.delete();
    await db().collection("shiftPlans").doc(planId).update({ updatedAt: FieldValue.serverTimestamp() });
    if (beforeSnap.exists) {
      await logDelete(ctxFromReq(req as AuthRequest), {
        collection: "shiftPlans/modRow",
        resourceId: planId,
        subResourceId: date,
        summary: { code: beforeCode },
      });
    }
    res.json({ ok: true });
  }
);
