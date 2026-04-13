import { Router } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, requireRole, AuthRequest } from "../middleware/auth";
import { parseShiftExpression, HOTEL_CODES } from "../services/shiftParser";

export const shiftsRouter = Router();
const db = () => admin.firestore();

const VALID_SECTIONS = ["vedoucí", "recepce", "portýři"] as const;
const VALID_SHIFT_TYPES = ["D", "N", "R", "DP", "NP"] as const;

// ─── Helper: batch-delete a sub-collection ─────────────────────────────────

async function deleteCollection(
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

// ─── Helper: copy shifts to snapshot sub-collection ─────────────────────────

async function snapshotShifts(planRef: admin.firestore.DocumentReference): Promise<void> {
  const shiftsSnap = await planRef.collection("shifts").get();
  if (shiftsSnap.empty) return;
  // Process in batches of 400
  const docs = shiftsSnap.docs;
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db().batch();
    const chunk = docs.slice(i, i + 400);
    for (const doc of chunk) {
      batch.set(planRef.collection("shiftsSnapshot").doc(doc.id), doc.data());
    }
    await batch.commit();
  }
}

// ─── Plans ──────────────────────────────────────────────────────────────────

// GET /shifts/plans — list all plans
shiftsRouter.get(
  "/plans",
  requireAuth,
  requireRole("admin", "director", "manager"),
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
  requireRole("admin", "director", "manager"),
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

    const response: Record<string, unknown> = {
      id: planDoc.id,
      ...planData,
      employees: employeesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      shifts,
      modShifts: modSnap.docs.map((d) => ({ id: d.id, date: d.id, ...d.data() })),
    };

    // Include snapshot for closed plans (employees see this instead of real shifts)
    if (planData.status === "closed") {
      const snapshotSnap = await planRef.collection("shiftsSnapshot").get();
      response.shiftsSnapshot = snapshotSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }

    res.json(response);
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

    // On publish: delete the snapshot (no longer needed)
    if (newStatus === "published") {
      await deleteCollection(planRef.collection("shiftsSnapshot"));
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

    const ref = await db()
      .collection("shiftPlans")
      .doc(planId)
      .collection("planEmployees")
      .add({
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

    const batch = db().batch();
    for (const doc of sourceSnap.docs) {
      const ref = db()
        .collection("shiftPlans")
        .doc(planId)
        .collection("planEmployees")
        .doc(doc.id);
      batch.set(ref, { ...doc.data(), createdAt: FieldValue.serverTimestamp() });
    }
    await batch.commit();
    res.json({ ok: true, copied: sourceSnap.size });
  }
);

// ─── Shifts (cells) ──────────────────────────────────────────────────────────

// PUT /shifts/plans/:planId/shifts/:employeeId/:date — upsert a shift cell
shiftsRouter.put(
  "/plans/:planId/shifts/:employeeId/:date",
  requireAuth,
  requireRole("admin", "director", "manager"),
  async (req, res) => {
    const { planId, employeeId, date } = req.params;
    const body = req.body as Record<string, unknown>;
    const rawInput = (body.rawInput as string) ?? "";

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: "Neplatný formát data" });
      return;
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

    res.json({ ok: true, hoursComputed: parsed.hoursComputed });
  }
);

// DELETE /shifts/plans/:planId/shifts/:employeeId/:date
shiftsRouter.delete(
  "/plans/:planId/shifts/:employeeId/:date",
  requireAuth,
  requireRole("admin", "director", "manager"),
  async (req, res) => {
    const { planId, employeeId, date } = req.params;
    const docId = `${employeeId}_${date}`;
    await db()
      .collection("shiftPlans")
      .doc(planId)
      .collection("shifts")
      .doc(docId)
      .delete();
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
    res.json({ ok: true });
  }
);
