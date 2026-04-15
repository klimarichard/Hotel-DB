import { Router, Response } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, requireRole, AuthRequest } from "../middleware/auth";
import { createOrUpdatePayrollPeriod } from "../services/payrollCalculator";

export const payrollRouter = Router();

const db = () => admin.firestore();

// ─── GET /payroll/settings ────────────────────────────────────────────────────

payrollRouter.get(
  "/settings",
  requireAuth,
  requireRole("admin", "director"),
  async (_req: AuthRequest, res: Response) => {
    const snap = await db().collection("settings").doc("payroll").get();
    const rate = snap.exists ? (snap.data()?.foodVoucherRate as number ?? 129.5) : 129.5;
    res.json({ foodVoucherRate: rate });
  }
);

// ─── PATCH /payroll/settings ──────────────────────────────────────────────────

payrollRouter.patch(
  "/settings",
  requireAuth,
  requireRole("admin"),
  async (req: AuthRequest, res: Response) => {
    const { foodVoucherRate } = req.body as { foodVoucherRate: number };
    if (typeof foodVoucherRate !== "number" || foodVoucherRate <= 0) {
      res.status(400).json({ error: "Neplatná sazba stravenky." });
      return;
    }
    await db().collection("settings").doc("payroll").set({
      foodVoucherRate,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: req.uid,
    }, { merge: true });
    res.json({ ok: true });
  }
);

// ─── GET /payroll/periods ─────────────────────────────────────────────────────

payrollRouter.get(
  "/periods",
  requireAuth,
  requireRole("admin", "director"),
  async (_req: AuthRequest, res: Response) => {
    const snap = await db()
      .collection("payrollPeriods")
      .orderBy("year", "desc")
      .orderBy("month", "desc")
      .get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }
);

// ─── GET /payroll/periods/:id ─────────────────────────────────────────────────

payrollRouter.get(
  "/periods/:id",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res: Response) => {
    const periodRef = db().collection("payrollPeriods").doc(req.params.id);
    const [periodSnap, entriesSnap] = await Promise.all([
      periodRef.get(),
      periodRef.collection("entries").get(),
    ]);
    if (!periodSnap.exists) {
      res.status(404).json({ error: "Mzdové období nebylo nalezeno." });
      return;
    }
    const entries = entriesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json({ id: periodSnap.id, ...periodSnap.data(), entries });
  }
);

// ─── GET /payroll/periods/by-month/:year/:month ───────────────────────────────

payrollRouter.get(
  "/periods/by-month/:year/:month",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res: Response) => {
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);
    const snap = await db()
      .collection("payrollPeriods")
      .where("year", "==", year)
      .where("month", "==", month)
      .limit(1)
      .get();
    if (snap.empty) {
      res.json(null);
      return;
    }
    const periodRef = snap.docs[0].ref;
    const entriesSnap = await periodRef.collection("entries").get();
    const entries = entriesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json({ id: snap.docs[0].id, ...snap.docs[0].data(), entries });
  }
);

// ─── PATCH /payroll/periods/:id/entries/:employeeId ──────────────────────────

payrollRouter.patch(
  "/periods/:id/entries/:employeeId",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res: Response) => {
    const { sickLeaveHours, overrides, autoOverrides } = req.body as {
      sickLeaveHours?: number;
      overrides?: Record<string, number>;
      autoOverrides?: Record<string, number>;
    };
    const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (typeof sickLeaveHours === "number" && sickLeaveHours >= 0) {
      update.sickLeaveHours = sickLeaveHours;
    }
    if (overrides !== undefined && overrides !== null && typeof overrides === "object") {
      update.overrides = overrides;
    }
    if (autoOverrides !== undefined && autoOverrides !== null && typeof autoOverrides === "object") {
      update.autoOverrides = autoOverrides;
    }
    if (Object.keys(update).length === 1) {
      res.status(400).json({ error: "Nic k uložení." });
      return;
    }
    const entryRef = db()
      .collection("payrollPeriods")
      .doc(req.params.id)
      .collection("entries")
      .doc(req.params.employeeId);
    await entryRef.update(update);
    res.json({ ok: true });
  }
);

// ─── POST /payroll/trigger ────────────────────────────────────────────────────
// Manual trigger for emulator testing — recalculates all published plans.

payrollRouter.post(
  "/trigger",
  requireAuth,
  requireRole("admin"),
  async (_req: AuthRequest, res: Response) => {
    const snap = await db()
      .collection("shiftPlans")
      .where("status", "==", "published")
      .get();
    const results: string[] = [];
    for (const doc of snap.docs) {
      const data = doc.data() as { year: number; month: number };
      await createOrUpdatePayrollPeriod(doc.id, data.year, data.month);
      results.push(`${data.year}-${String(data.month).padStart(2, "0")}`);
    }
    res.json({ recalculated: results });
  }
);
