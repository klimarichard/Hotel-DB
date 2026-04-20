import { Router, Response } from "express";
import { randomUUID } from "crypto";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, requireRole, AuthRequest } from "../middleware/auth";
import { createOrUpdatePayrollPeriod, getMultisportActive } from "../services/payrollCalculator";

export const payrollRouter = Router();

const db = () => admin.firestore();

// ─── Payroll notes ────────────────────────────────────────────────────────────
// Notes are stored as an array on each entry doc. Each note keeps a
// `sourceNoteId` that links copies of the same logical note across periods
// (carry-forward). Edits and deletes affect only the current period — past
// and future copies are untouched. New periods created after a note is added
// pick up carry-forward copies via payrollCalculator.

interface PayrollNoteDoc {
  id: string;
  sourceNoteId: string;
  text: string;
  carryForward: boolean;
  createdBy: string;
  createdByName: string;
  createdAt: admin.firestore.Timestamp | FieldValue;
  editedBy?: string;
  editedByName?: string;
  editedAt?: admin.firestore.Timestamp | FieldValue;
}

async function getUserName(uid: string): Promise<string> {
  const snap = await db().collection("users").doc(uid).get();
  return snap.exists ? ((snap.data() as Record<string, unknown>).name as string) ?? "" : "";
}

async function ensurePeriodUnlocked(
  periodRef: admin.firestore.DocumentReference,
  res: Response
): Promise<boolean> {
  const snap = await periodRef.get();
  if (!snap.exists) {
    res.status(404).json({ error: "Mzdové období nebylo nalezeno." });
    return false;
  }
  if ((snap.data() as Record<string, unknown>).locked === true) {
    res.status(409).json({ error: "Mzdové období je uzamčeno — úpravy nejsou povoleny." });
    return false;
  }
  return true;
}

// ─── POST /payroll/periods/:id/entries/:employeeId/notes ─────────────────────
// Add a note. When `carryForward` is true, copy the note into every existing
// future period for this employee (each copy is a distinct note sharing the
// same `sourceNoteId`). Rejected on locked source period; individual future
// periods that are locked are skipped silently.

payrollRouter.post(
  "/periods/:id/entries/:employeeId/notes",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res: Response) => {
    const { id: periodId, employeeId } = req.params;
    const body = req.body as { text?: unknown; carryForward?: unknown };
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const carryForward = body.carryForward === true;
    if (!text) {
      res.status(400).json({ error: "Text poznámky nesmí být prázdný." });
      return;
    }

    const periodRef = db().collection("payrollPeriods").doc(periodId);
    if (!(await ensurePeriodUnlocked(periodRef, res))) return;

    const periodData = (await periodRef.get()).data() as Record<string, unknown>;
    const year = periodData.year as number;
    const month = periodData.month as number;

    const createdByName = await getUserName(req.uid!);
    const now = admin.firestore.Timestamp.now();
    const noteId = randomUUID();
    const note: PayrollNoteDoc = {
      id: noteId,
      sourceNoteId: noteId,
      text,
      carryForward,
      createdBy: req.uid!,
      createdByName,
      createdAt: now,
    };

    const entryRef = periodRef.collection("entries").doc(employeeId);
    await entryRef.update({
      notes: FieldValue.arrayUnion(note),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Seed into existing future periods if carryForward
    if (carryForward) {
      const futureSnap = await db()
        .collection("payrollPeriods")
        .where("year", ">=", year)
        .get();
      for (const p of futureSnap.docs) {
        const d = p.data() as Record<string, unknown>;
        const py = d.year as number;
        const pm = d.month as number;
        const isFuture = py > year || (py === year && pm > month);
        if (!isFuture) continue;
        if (d.locked === true) continue;
        const futureEntryRef = p.ref.collection("entries").doc(employeeId);
        const futureEntrySnap = await futureEntryRef.get();
        if (!futureEntrySnap.exists) continue;
        const copy: PayrollNoteDoc = {
          ...note,
          id: randomUUID(),
          sourceNoteId: noteId,
          createdAt: now,
        };
        await futureEntryRef.update({
          notes: FieldValue.arrayUnion(copy),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }

    res.status(201).json({ id: noteId });
  }
);

// ─── PATCH /payroll/periods/:id/entries/:employeeId/notes/:noteId ────────────
// Edit a single note in this period only. Past and future copies stay put —
// the user asked for "freeze past months"; we extend the symmetry to future.

payrollRouter.patch(
  "/periods/:id/entries/:employeeId/notes/:noteId",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res: Response) => {
    const { id: periodId, employeeId, noteId } = req.params;
    const body = req.body as { text?: unknown; carryForward?: unknown };
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) {
      res.status(400).json({ error: "Text poznámky nesmí být prázdný." });
      return;
    }
    const hasCarryForward = typeof body.carryForward === "boolean";

    const periodRef = db().collection("payrollPeriods").doc(periodId);
    if (!(await ensurePeriodUnlocked(periodRef, res))) return;

    const entryRef = periodRef.collection("entries").doc(employeeId);
    const entrySnap = await entryRef.get();
    if (!entrySnap.exists) {
      res.status(404).json({ error: "Záznam nenalezen." });
      return;
    }
    const entryData = entrySnap.data() as Record<string, unknown>;
    const notes = (entryData.notes as PayrollNoteDoc[] | undefined) ?? [];
    const idx = notes.findIndex((n) => n.id === noteId);
    if (idx === -1) {
      res.status(404).json({ error: "Poznámka nenalezena." });
      return;
    }

    const editedByName = await getUserName(req.uid!);
    const updated: PayrollNoteDoc = {
      ...notes[idx],
      text,
      carryForward: hasCarryForward ? (body.carryForward as boolean) : notes[idx].carryForward,
      editedBy: req.uid!,
      editedByName,
      editedAt: admin.firestore.Timestamp.now(),
    };
    const nextNotes = notes.slice();
    nextNotes[idx] = updated;

    await entryRef.update({
      notes: nextNotes,
      updatedAt: FieldValue.serverTimestamp(),
    });
    res.json({ ok: true });
  }
);

// ─── DELETE /payroll/periods/:id/entries/:employeeId/notes/:noteId ───────────
// Delete a single note in this period only.

payrollRouter.delete(
  "/periods/:id/entries/:employeeId/notes/:noteId",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res: Response) => {
    const { id: periodId, employeeId, noteId } = req.params;
    const periodRef = db().collection("payrollPeriods").doc(periodId);
    if (!(await ensurePeriodUnlocked(periodRef, res))) return;

    const entryRef = periodRef.collection("entries").doc(employeeId);
    const entrySnap = await entryRef.get();
    if (!entrySnap.exists) {
      res.status(404).json({ error: "Záznam nenalezen." });
      return;
    }
    const entryData = entrySnap.data() as Record<string, unknown>;
    const notes = (entryData.notes as PayrollNoteDoc[] | undefined) ?? [];
    const nextNotes = notes.filter((n) => n.id !== noteId);
    if (nextNotes.length === notes.length) {
      res.status(404).json({ error: "Poznámka nenalezena." });
      return;
    }
    await entryRef.update({
      notes: nextNotes,
      updatedAt: FieldValue.serverTimestamp(),
    });
    res.json({ ok: true });
  }
);

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

async function hydrateMultisport(
  entries: Record<string, unknown>[],
  year: number,
  month: number
): Promise<Record<string, unknown>[]> {
  return Promise.all(
    entries.map(async (e) => ({
      ...e,
      multisportActive: await getMultisportActive(e.id as string, year, month),
    }))
  );
}

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
    const periodData = periodSnap.data() as Record<string, unknown>;
    const rawEntries = entriesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const entries = await hydrateMultisport(
      rawEntries,
      periodData.year as number,
      periodData.month as number
    );
    res.json({ id: periodSnap.id, ...periodData, entries });
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
    const rawEntries = entriesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const entries = await hydrateMultisport(rawEntries, year, month);
    res.json({ id: snap.docs[0].id, ...snap.docs[0].data(), entries });
  }
);

// ─── PATCH /payroll/periods/:id ───────────────────────────────────────────────
// Lock/unlock a payroll period (admin only). Locked periods are read-only.

payrollRouter.patch(
  "/periods/:id",
  requireAuth,
  requireRole("admin"),
  async (req: AuthRequest, res: Response) => {
    const { locked } = req.body as { locked?: boolean };
    if (typeof locked !== "boolean") {
      res.status(400).json({ error: "Pole 'locked' musí být boolean." });
      return;
    }
    const periodRef = db().collection("payrollPeriods").doc(req.params.id);
    const snap = await periodRef.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Mzdové období nebylo nalezeno." });
      return;
    }
    const update: Record<string, unknown> = {
      locked,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (locked) {
      update.lockedAt = FieldValue.serverTimestamp();
      update.lockedBy = req.uid;
    } else {
      update.lockedAt = FieldValue.delete();
      update.lockedBy = FieldValue.delete();
    }
    await periodRef.update(update);
    res.json({ ok: true, locked });
  }
);

// ─── PATCH /payroll/periods/:id/entries/:employeeId ──────────────────────────

payrollRouter.patch(
  "/periods/:id/entries/:employeeId",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res: Response) => {
    const periodRef = db().collection("payrollPeriods").doc(req.params.id);
    const periodSnap = await periodRef.get();
    if (!periodSnap.exists) {
      res.status(404).json({ error: "Mzdové období nebylo nalezeno." });
      return;
    }
    if ((periodSnap.data() as Record<string, unknown>).locked === true) {
      res.status(409).json({ error: "Mzdové období je uzamčeno — úpravy nejsou povoleny." });
      return;
    }

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
    const entryRef = periodRef
      .collection("entries")
      .doc(req.params.employeeId);
    await entryRef.update(update);
    res.json({ ok: true });
  }
);

// ─── POST /payroll/periods/:id/recalculate ────────────────────────────────────
// Manual re-run of the payroll calculation for a single period. Locked periods
// are rejected explicitly; createOrUpdatePayrollPeriod also skips them defensively.

payrollRouter.post(
  "/periods/:id/recalculate",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res: Response) => {
    const periodRef = db().collection("payrollPeriods").doc(req.params.id);
    const snap = await periodRef.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Mzdové období nebylo nalezeno." });
      return;
    }
    const data = snap.data() as Record<string, unknown>;
    if (data.locked === true) {
      res.status(409).json({ error: "Mzdové období je uzamčeno — přepočet není povolen." });
      return;
    }
    const planId = data.shiftPlanId as string | undefined;
    const year = data.year as number | undefined;
    const month = data.month as number | undefined;
    if (!planId || year == null || month == null) {
      res.status(400).json({ error: "Období nemá odkaz na směnný plán." });
      return;
    }
    await createOrUpdatePayrollPeriod(planId, year, month);
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
