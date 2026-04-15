import { Router } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, requireRole, AuthRequest } from "../middleware/auth";
import { parseShiftExpression, HOTEL_CODES } from "../services/shiftParser";
import { snapshotShifts, deleteCollection } from "../services/planTransitions";
import { createOrUpdatePayrollPeriod } from "../services/payrollCalculator";

export const shiftsRouter = Router();
const db = () => admin.firestore();

const VALID_SECTIONS = ["vedoucí", "recepce", "portýři"] as const;
const VALID_SHIFT_TYPES = ["D", "N", "R", "DP", "NP"] as const;

// ─── Vacation X helpers ──────────────────────────────────────────────────────

/**
 * For a given plan and employee, find all approved vacation requests that
 * overlap with the plan's month and batch-write X shift docs.
 * Exported so vacation.ts can call applyVacationXsToPlans.
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
    const { startDate, endDate } = doc.data() as { startDate: string; endDate: string };
    const clampedStart = startDate < monthStart ? monthStart : startDate;
    const clampedEnd = endDate > monthEnd ? monthEnd : endDate;
    const cur = new Date(clampedStart + "T00:00:00");
    const end = new Date(clampedEnd + "T00:00:00");
    while (cur <= end) {
      const dateStr = cur.toISOString().slice(0, 10);
      const docId = `${employeeId}_${dateStr}`;
      batch.set(planRef.collection("shifts").doc(docId), {
        employeeId,
        date: dateStr,
        rawInput: "X",
        segments: [{ code: "X", hotel: null, hours: 0 }],
        hoursComputed: 0,
        isDouble: false,
        status: "day_off",
        updatedAt: FieldValue.serverTimestamp(),
      });
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

    const batch = db().batch();
    const curDate = new Date(clampedStart + "T00:00:00");
    const endDateObj = new Date(clampedEnd + "T00:00:00");
    while (curDate <= endDateObj) {
      const dateStr = curDate.toISOString().slice(0, 10);
      batch.delete(planDoc.ref.collection("shifts").doc(`${employeeId}_${dateStr}`));
      curDate.setDate(curDate.getDate() + 1);
    }
    await batch.commit();
  }
}

// ─── Plans ──────────────────────────────────────────────────────────────────

// GET /shifts/plans — list all plans
shiftsRouter.get(
  "/plans",
  requireAuth,
  requireRole("admin", "director", "manager", "employee"),
  async (_req, res) => {
    const snap = await db()
      .collection("shiftPlans")
      .orderBy("year", "desc")
      .orderBy("month", "desc")
      .get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }
);

// POST /shifts/plans — create a plan
shiftsRouter.post(
  "/plans",
  requireAuth,
  requireRole("admin", "director", "manager"),
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
      closedAt: null,
      publishedAt: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    res.status(201).json({ id: ref.id });
  }
);

// GET /shifts/plans/:planId — plan + employees + shifts
shiftsRouter.get(
  "/plans/:planId",
  requireAuth,
  requireRole("admin", "director", "manager", "employee"),
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

    // Employees viewing a closed plan see the snapshot taken at close time,
    // not the live shifts — admin changes after closing are invisible until publish.
    let visibleShifts = shifts;
    const userRole = (req as AuthRequest).role;
    if (planData.status === "closed" && userRole === "employee") {
      const snapshotSnap = await planRef.collection("shiftsSnapshot").get();
      visibleShifts = snapshotSnap.docs
        .filter((d) => currentEmployeeIds.has(d.data().employeeId as string))
        .map((d) => ({ id: d.id, ...d.data() }));
    }

    res.json({
      id: planDoc.id,
      ...planData,
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
  requireRole("admin", "director", "manager"),
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
    const userRole = (req as AuthRequest).role;

    if (!isForward && !(isReverse && userRole === "admin")) {
      res.status(400).json({ error: "Neplatný přechod stavu" });
      return;
    }

    // On close: snapshot current shifts for employee view
    if (newStatus === "closed") {
      await snapshotShifts(planRef);
    }

    // On publish: delete the snapshot (no longer needed) + create payroll
    if (newStatus === "published") {
      await deleteCollection(planRef.collection("shiftsSnapshot"));
      const planData = planDoc.data() as { year: number; month: number };
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
    res.json({ ok: true });
  }
);

// PATCH /shifts/plans/:planId/deadlines — set automatic transition deadlines
shiftsRouter.patch(
  "/plans/:planId/deadlines",
  requireAuth,
  requireRole("admin", "director", "manager"),
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

    if ("closedAt" in body) {
      update.closedAt = body.closedAt ?? null;
    }
    if ("publishedAt" in body) {
      update.publishedAt = body.publishedAt ?? null;
    }

    await planRef.update(update);
    res.json({ ok: true });
  }
);

// DELETE /shifts/plans/:planId — delete plan (admin only, any status)
shiftsRouter.delete(
  "/plans/:planId",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    const { planId } = req.params;
    const planRef = db().collection("shiftPlans").doc(planId);
    const planDoc = await planRef.get();

    if (!planDoc.exists) {
      res.status(404).json({ error: "Plán nenalezen" });
      return;
    }

    const subCols = ["planEmployees", "shifts", "shiftsSnapshot", "modRow", "rules", "unavailabilityRequests"];
    for (const col of subCols) {
      await deleteCollection(planRef.collection(col));
    }
    await planRef.delete();
    res.json({ ok: true });
  }
);

// ─── Plan Employees ──────────────────────────────────────────────────────────

// GET /shifts/plans/:planId/employees
shiftsRouter.get(
  "/plans/:planId/employees",
  requireAuth,
  requireRole("admin", "director", "manager"),
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
  requireRole("admin", "director", "manager"),
  async (req, res) => {
    const { planId } = req.params;
    const body = req.body as Record<string, unknown>;

    const employeeId = body.employeeId as string;
    const firstName = body.firstName as string;
    const lastName = body.lastName as string;
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
      section,
      primaryShiftType,
      primaryHotel,
      displayOrder,
      active,
      createdAt: FieldValue.serverTimestamp(),
    });

    // Auto-fill approved vacation days as X for this employee in this month
    await applyVacationXs(planRef, employeeId, planData.year as number, planData.month as number);

    res.status(201).json({ id: ref.id });
  }
);

// PUT /shifts/plans/:planId/employees/:docId — update a plan employee
shiftsRouter.put(
  "/plans/:planId/employees/:docId",
  requireAuth,
  requireRole("admin", "director", "manager"),
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

    await db()
      .collection("shiftPlans")
      .doc(planId)
      .collection("planEmployees")
      .doc(docId)
      .update({ section, primaryShiftType, primaryHotel, displayOrder, active, updatedAt: FieldValue.serverTimestamp() });
    await db().collection("shiftPlans").doc(planId).update({ updatedAt: FieldValue.serverTimestamp() });
    res.json({ ok: true });
  }
);

// DELETE /shifts/plans/:planId/employees/:docId
shiftsRouter.delete(
  "/plans/:planId/employees/:docId",
  requireAuth,
  requireRole("admin", "director", "manager"),
  async (req, res) => {
    const { planId, docId } = req.params;
    const planRef = db().collection("shiftPlans").doc(planId);

    // Resolve the employeeId before deleting the planEmployee doc
    const empDoc = await planRef.collection("planEmployees").doc(docId).get();
    if (!empDoc.exists) {
      res.status(404).json({ error: "Zaměstnanec v plánu nenalezen" });
      return;
    }
    const employeeId = empDoc.data()!.employeeId as string;

    // Delete the planEmployee doc
    await empDoc.ref.delete();

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
    res.json({ ok: true });
  }
);

// POST /shifts/plans/:planId/copy-employees — copy planEmployees from another plan
shiftsRouter.post(
  "/plans/:planId/copy-employees",
  requireAuth,
  requireRole("admin", "director", "manager"),
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
      batch.set(ref, { ...doc.data(), createdAt: FieldValue.serverTimestamp() });
    }
    await batch.commit();

    // Auto-fill approved vacation days as X for each copied employee
    for (const doc of sourceSnap.docs) {
      await applyVacationXs(targetPlanRef, doc.data().employeeId as string, targetYear, targetMonth);
    }

    res.json({ ok: true, copied: sourceSnap.size });
  }
);

// ─── Shifts (cells) ──────────────────────────────────────────────────────────

// PUT /shifts/plans/:planId/shifts/:employeeId/:date — upsert a shift cell
shiftsRouter.put(
  "/plans/:planId/shifts/:employeeId/:date",
  requireAuth,
  requireRole("admin", "director", "manager", "employee"),
  async (req: AuthRequest, res) => {
    const { planId, employeeId, date } = req.params;
    const body = req.body as Record<string, unknown>;
    const rawInput = (body.rawInput as string) ?? "";
    const userRole = req.role;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: "Neplatný formát data" });
      return;
    }

    // Employee-specific guards: X only, opened plan only
    if (userRole === "employee") {
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
        status,
        updatedAt: FieldValue.serverTimestamp(),
      });
    await db().collection("shiftPlans").doc(planId).update({ updatedAt: FieldValue.serverTimestamp() });
    res.json({ ok: true, hoursComputed: parsed.hoursComputed });
  }
);

// DELETE /shifts/plans/:planId/shifts/:employeeId/:date
shiftsRouter.delete(
  "/plans/:planId/shifts/:employeeId/:date",
  requireAuth,
  requireRole("admin", "director", "manager", "employee"),
  async (req: AuthRequest, res) => {
    const { planId, employeeId, date } = req.params;
    const userRole = req.role;

    // Employee-specific guards: opened plan only
    if (userRole === "employee") {
      const planDoc = await db().collection("shiftPlans").doc(planId).get();
      if (planDoc.data()?.status !== "opened") {
        res.status(403).json({ error: "Zaměstnanci mohou mazat směny pouze v otevřeném plánu." });
        return;
      }
    }

    const docId = `${employeeId}_${date}`;
    await db()
      .collection("shiftPlans")
      .doc(planId)
      .collection("shifts")
      .doc(docId)
      .delete();
    await db().collection("shiftPlans").doc(planId).update({ updatedAt: FieldValue.serverTimestamp() });
    res.json({ ok: true });
  }
);

// ─── Rules ───────────────────────────────────────────────────────────────────

// GET /shifts/plans/:planId/rules
shiftsRouter.get(
  "/plans/:planId/rules",
  requireAuth,
  requireRole("admin", "director", "manager"),
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
  requireRole("admin", "director", "manager"),
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
    res.json({ ok: true });
  }
);

// ─── Unavailability Requests ─────────────────────────────────────────────────

// GET /shifts/plans/:planId/unavailability — manager sees all requests
shiftsRouter.get(
  "/plans/:planId/unavailability",
  requireAuth,
  requireRole("admin", "director", "manager"),
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
    res.status(201).json({ id: ref.id });
  }
);

// PATCH /shifts/plans/:planId/unavailability/:reqId — approve or reject
shiftsRouter.patch(
  "/plans/:planId/unavailability/:reqId",
  requireAuth,
  requireRole("admin", "director", "manager"),
  async (req: AuthRequest, res) => {
    const { planId, reqId } = req.params;
    const body = req.body as Record<string, unknown>;
    const status = body.status as string;

    if (!["approved", "rejected"].includes(status)) {
      res.status(400).json({ error: "Stav musí být approved nebo rejected" });
      return;
    }

    await db()
      .collection("shiftPlans")
      .doc(planId)
      .collection("unavailabilityRequests")
      .doc(reqId)
      .update({
        status,
        reviewedBy: req.uid ?? null,
        reviewedAt: FieldValue.serverTimestamp(),
        rejectionReason: status === "rejected" ? ((body.rejectionReason as string) ?? null) : null,
      });
    res.json({ ok: true });
  }
);

// ─── Shift Override Count (global — across all plans) ────────────────────────

// GET /shifts/overrides/pending-count — total pending overrides for nav badge
shiftsRouter.get(
  "/overrides/pending-count",
  requireAuth,
  requireRole("admin", "director"),
  async (_req, res) => {
    const snap = await db()
      .collectionGroup("shiftOverrideRequests")
      .where("status", "==", "pending")
      .get();
    res.json({ count: snap.size });
  }
);

// ─── Shift Override Requests ─────────────────────────────────────────────────

// GET /shifts/plans/:planId/shiftOverrides — list override requests
// Admin/director/manager: all requests. Employee: own requests only.
shiftsRouter.get(
  "/plans/:planId/shiftOverrides",
  requireAuth,
  requireRole("admin", "director", "manager", "employee"),
  async (req: AuthRequest, res) => {
    const { planId } = req.params;
    const isPrivileged = req.role === "admin" || req.role === "director" || req.role === "manager";

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
  requireRole("admin", "director", "manager", "employee"),
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
    res.status(201).json({ id: ref.id });
  }
);

// PATCH /shifts/plans/:planId/shiftOverrides/:reqId — approve or reject
shiftsRouter.patch(
  "/plans/:planId/shiftOverrides/:reqId",
  requireAuth,
  requireRole("admin", "director"),
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
    res.json({ ok: true });
  }
);

// DELETE /shifts/plans/:planId/shiftOverrides/:reqId — requester cancels own pending request
shiftsRouter.delete(
  "/plans/:planId/shiftOverrides/:reqId",
  requireAuth,
  requireRole("admin", "director", "manager", "employee"),
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
    res.json({ ok: true });
  }
);

// ─── Shift Change Requests (published plans) ────────────────────────────────

// GET /shifts/changeRequests/pending-count — total pending change requests for nav badge
shiftsRouter.get(
  "/changeRequests/pending-count",
  requireAuth,
  requireRole("admin", "director"),
  async (_req, res) => {
    const snap = await db()
      .collectionGroup("shiftChangeRequests")
      .where("status", "==", "pending")
      .get();
    res.json({ count: snap.size });
  }
);

// GET /shifts/plans/:planId/shiftChangeRequests — list change requests for a plan
// Admin/director: all requests. Everyone else: own requests only (filtered by requestedBy).
shiftsRouter.get(
  "/plans/:planId/shiftChangeRequests",
  requireAuth,
  requireRole("admin", "director", "manager", "employee"),
  async (req: AuthRequest, res) => {
    const { planId } = req.params;
    const userRole = req.role;
    const isPrivileged = userRole === "admin" || userRole === "director";

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
  requireRole("admin", "director", "manager", "employee"),
  async (req: AuthRequest, res) => {
    const { planId } = req.params;
    const body = req.body as Record<string, unknown>;

    const employeeId = body.employeeId as string;
    const date = body.date as string;
    const currentRawInput = (body.currentRawInput as string) ?? "";
    const reason = (body.reason as string) ?? "";

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

    // Plan must exist and be published
    const planDoc = await db().collection("shiftPlans").doc(planId).get();
    if (!planDoc.exists) {
      res.status(404).json({ error: "Plán nenalezen" });
      return;
    }
    const planData = planDoc.data() as Record<string, unknown>;
    if (planData.status !== "published") {
      res.status(400).json({ error: "Žádosti o změnu lze podávat pouze k publikovaným plánům" });
      return;
    }

    const ref = await db()
      .collection("shiftPlans")
      .doc(planId)
      .collection("shiftChangeRequests")
      .add({
        employeeId,
        date,
        currentRawInput,
        reason,
        status: "pending",
        requestedBy: req.uid ?? null,
        requestedAt: FieldValue.serverTimestamp(),
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null,
      });
    await db().collection("shiftPlans").doc(planId).update({ updatedAt: FieldValue.serverTimestamp() });
    res.status(201).json({ id: ref.id });
  }
);

// PATCH /shifts/plans/:planId/shiftChangeRequests/:reqId — approve or reject
shiftsRouter.patch(
  "/plans/:planId/shiftChangeRequests/:reqId",
  requireAuth,
  requireRole("admin", "director"),
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

    await changeReqRef.update({
      status,
      reviewedBy: req.uid ?? null,
      reviewedAt: FieldValue.serverTimestamp(),
      rejectionReason: status === "rejected" ? ((body.rejectionReason as string) ?? null) : null,
    });
    await db().collection("shiftPlans").doc(planId).update({ updatedAt: FieldValue.serverTimestamp() });
    res.json({ ok: true });
  }
);

// DELETE /shifts/plans/:planId/shiftChangeRequests/:reqId — requester cancels own pending request
shiftsRouter.delete(
  "/plans/:planId/shiftChangeRequests/:reqId",
  requireAuth,
  requireRole("admin", "director", "manager", "employee"),
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
    res.json({ ok: true });
  }
);

// ─── MOD Row (Manager on Duty) ───────────────────────────────────────────────

const VALID_MOD_CODES = ["V", "R", "N", "O", "K", "A"] as const;

// PUT /shifts/plans/:planId/mod/:date — upsert a MOD cell
shiftsRouter.put(
  "/plans/:planId/mod/:date",
  requireAuth,
  requireRole("admin", "director", "manager"),
  async (req, res) => {
    const { planId, date } = req.params;
    const body = req.body as Record<string, unknown>;
    const code = ((body.code as string) ?? "").toUpperCase().trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: "Neplatný formát data" });
      return;
    }
    if (!(VALID_MOD_CODES as readonly string[]).includes(code)) {
      res.status(400).json({ error: `Neplatný MOD kód: ${code}` });
      return;
    }

    await db()
      .collection("shiftPlans")
      .doc(planId)
      .collection("modRow")
      .doc(date)
      .set({ code, updatedAt: FieldValue.serverTimestamp() });
    await db().collection("shiftPlans").doc(planId).update({ updatedAt: FieldValue.serverTimestamp() });
    res.json({ ok: true });
  }
);

// DELETE /shifts/plans/:planId/mod/:date — delete a MOD cell
shiftsRouter.delete(
  "/plans/:planId/mod/:date",
  requireAuth,
  requireRole("admin", "director", "manager"),
  async (req, res) => {
    const { planId, date } = req.params;
    await db()
      .collection("shiftPlans")
      .doc(planId)
      .collection("modRow")
      .doc(date)
      .delete();
    await db().collection("shiftPlans").doc(planId).update({ updatedAt: FieldValue.serverTimestamp() });
    res.json({ ok: true });
  }
);
