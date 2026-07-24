import { Router, Response } from "express";
import { randomUUID } from "crypto";
import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { requirePermission } from "../auth/permissions";
import { createOrUpdatePayrollPeriod, getMultisportPrice, recomputeEntryForEmployee } from "../services/payrollCalculator";
import { nameParts, preferLive, resolveEmployeeNameParts } from "../services/employeeNames";
import { ctxFromReq, logCreate, logUpdate, logDelete, writeAudit } from "../services/auditLog";
import { upsertLedgerMonth } from "../services/vacationLedger";
import * as clock from "../services/clock";

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
  // Origin period of the logical note — used by the UI to allow "mark as read"
  // only in months strictly after the note was created.
  sourceYear?: number;
  sourceMonth?: number;
  createdBy: string;
  createdByName: string;
  createdAt: Timestamp | FieldValue;
  editedBy?: string;
  editedByName?: string;
  editedAt?: Timestamp | FieldValue;
  // Read-state: when marked read in a given month, this copy is struck through
  // and copies in all later periods are removed (see the mark-read endpoint).
  read?: boolean;
  readAt?: Timestamp | FieldValue;
  readBy?: string;
  readByName?: string;
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
    res.status(409).json({ error: "Mzdové období je uzamčeno – úpravy nejsou povoleny." });
    return false;
  }
  return true;
}

// ─── POST /payroll/periods/:id/entries/:employeeId/notes ─────────────────────
// Add a note. Every note carries forward: it is copied into every existing
// future period for this employee (each copy is a distinct note sharing the
// same `sourceNoteId` + origin `sourceYear`/`sourceMonth`). In a future month the
// note can be "marked read", which strikes it through there and drops it from all
// later months. Rejected on locked source period; locked future periods skipped.

payrollRouter.post(
  "/periods/:id/entries/:employeeId/notes",
  requireAuth,
  requirePermission("payroll.notes.manage"),
  async (req: AuthRequest, res: Response) => {
    const { id: periodId, employeeId } = req.params;
    const body = req.body as { text?: unknown; carryForward?: unknown };
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) {
      res.status(400).json({ error: "Text poznámky nesmí být prázdný." });
      return;
    }
    // Default: notes carry forward (sticky until marked read). A one-month note
    // (carryForward:false) lives only in the period it was entered in — it is
    // never copied to other periods and createOrUpdatePayrollPeriod's seeding
    // filter (carryForward === true) already skips it for newly-created periods.
    const carryForward = body.carryForward !== false;

    const periodRef = db().collection("payrollPeriods").doc(periodId);
    if (!(await ensurePeriodUnlocked(periodRef, res))) return;

    const periodData = (await periodRef.get()).data() as Record<string, unknown>;
    const year = periodData.year as number;
    const month = periodData.month as number;

    const createdByName = await getUserName(req.uid!);
    const now = Timestamp.now();
    const noteId = randomUUID();
    const note: PayrollNoteDoc = {
      id: noteId,
      sourceNoteId: noteId,
      text,
      carryForward,
      sourceYear: year,
      sourceMonth: month,
      createdBy: req.uid!,
      createdByName,
      createdAt: now,
    };

    const entryRef = periodRef.collection("entries").doc(employeeId);
    await entryRef.update({
      notes: FieldValue.arrayUnion(note),
      updatedAt: FieldValue.serverTimestamp(),
    });

    await logCreate(ctxFromReq(req), {
      collection: "payrollPeriods/entries/notes",
      resourceId: periodId,
      subResourceId: noteId,
      employeeId,
      summary: { text, carryForward, period: `${year}-${String(month).padStart(2, "0")}` },
    });

    // Seed into every existing future period — only for carry-forward notes.
    // A one-month note (carryForward:false) stays in its own period only.
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

// ─── POST /payroll/periods/:id/entries/:employeeId/notes/:noteId/read ─────────
// Mark a carried-forward note as read in THIS period: the copy here is struck
// through (read=true), and the same logical note (sourceNoteId) is removed from
// every LATER period (non-locked). Earlier periods keep it untouched. Auto/system
// notes can't be marked read. Rejected on locked period.

payrollRouter.post(
  "/periods/:id/entries/:employeeId/notes/:noteId/read",
  requireAuth,
  requirePermission("payroll.notes.manage"),
  async (req: AuthRequest, res: Response) => {
    const { id: periodId, employeeId, noteId } = req.params;
    const periodRef = db().collection("payrollPeriods").doc(periodId);
    if (!(await ensurePeriodUnlocked(periodRef, res))) return;

    const periodData = (await periodRef.get()).data() as Record<string, unknown>;
    const year = periodData.year as number;
    const month = periodData.month as number;

    const entryRef = periodRef.collection("entries").doc(employeeId);
    const entrySnap = await entryRef.get();
    if (!entrySnap.exists) {
      res.status(404).json({ error: "Záznam nenalezen." });
      return;
    }
    const notes = ((entrySnap.data() as Record<string, unknown>).notes as PayrollNoteDoc[] | undefined) ?? [];
    const idx = notes.findIndex((n) => n.id === noteId);
    if (idx === -1) {
      res.status(404).json({ error: "Poznámka nenalezena." });
      return;
    }
    if (notes[idx].read === true) {
      res.json({ ok: true });
      return;
    }

    const readByName = await getUserName(req.uid!);
    const now = Timestamp.now();
    const sourceNoteId = notes[idx].sourceNoteId ?? notes[idx].id;
    const nextNotes = notes.slice();
    nextNotes[idx] = {
      ...notes[idx],
      read: true,
      readAt: now,
      readBy: req.uid!,
      readByName,
    };
    await entryRef.update({ notes: nextNotes, updatedAt: FieldValue.serverTimestamp() });

    // Remove this logical note from every later (non-locked) period.
    const laterSnap = await db()
      .collection("payrollPeriods")
      .where("year", ">=", year)
      .get();
    for (const p of laterSnap.docs) {
      const d = p.data() as Record<string, unknown>;
      const py = d.year as number;
      const pm = d.month as number;
      const isLater = py > year || (py === year && pm > month);
      if (!isLater || d.locked === true) continue;
      const laterEntryRef = p.ref.collection("entries").doc(employeeId);
      const laterEntrySnap = await laterEntryRef.get();
      if (!laterEntrySnap.exists) continue;
      const laterNotes = ((laterEntrySnap.data() as Record<string, unknown>).notes as PayrollNoteDoc[] | undefined) ?? [];
      const filtered = laterNotes.filter((n) => (n.sourceNoteId ?? n.id) !== sourceNoteId);
      if (filtered.length !== laterNotes.length) {
        await laterEntryRef.update({ notes: filtered, updatedAt: FieldValue.serverTimestamp() });
      }
    }

    await logUpdate(ctxFromReq(req), {
      collection: "payrollPeriods/entries/notes",
      resourceId: periodId,
      subResourceId: noteId,
      employeeId,
      before: { read: false },
      after: { read: true, period: `${year}-${String(month).padStart(2, "0")}` },
    });
    res.json({ ok: true });
  }
);

// ─── PATCH /payroll/periods/:id/entries/:employeeId/notes/:noteId ────────────
// Edit a note's text in this period only (past + future copies keep their own
// text). Additionally, **in the note's ORIGIN month only**, the body may flip
// `carryForward`: turning it OFF removes the logical note (sourceNoteId) from
// every later non-locked period (→ one-month note); turning it ON re-seeds it
// into every future non-locked period. Outside the origin month the flag is
// ignored (text-only edit), matching the UI which only offers the toggle there.

payrollRouter.patch(
  "/periods/:id/entries/:employeeId/notes/:noteId",
  requireAuth,
  requirePermission("payroll.notes.manage"),
  async (req: AuthRequest, res: Response) => {
    const { id: periodId, employeeId, noteId } = req.params;
    const body = req.body as { text?: unknown; carryForward?: unknown };
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) {
      res.status(400).json({ error: "Text poznámky nesmí být prázdný." });
      return;
    }
    const cfFlag = typeof body.carryForward === "boolean" ? body.carryForward : undefined;

    const periodRef = db().collection("payrollPeriods").doc(periodId);
    if (!(await ensurePeriodUnlocked(periodRef, res))) return;
    const pdata = (await periodRef.get()).data() as Record<string, unknown>;
    const year = pdata.year as number;
    const month = pdata.month as number;

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
      editedBy: req.uid!,
      editedByName,
      editedAt: Timestamp.now(),
    };

    // Carry-forward toggle — only honored in the note's ORIGIN month, and only
    // when it actually changes the current value.
    const sourceNoteId = notes[idx].sourceNoteId ?? notes[idx].id;
    const isOrigin = notes[idx].sourceYear === year && notes[idx].sourceMonth === month;
    const prevCarry = notes[idx].carryForward !== false;
    const carryChanged = cfFlag !== undefined && isOrigin && cfFlag !== prevCarry;
    if (carryChanged) updated.carryForward = cfFlag;

    const nextNotes = notes.slice();
    nextNotes[idx] = updated;
    await entryRef.update({
      notes: nextNotes,
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (carryChanged && cfFlag === false) {
      // true → false: drop the logical note from every later (non-locked) period.
      const laterSnap = await db().collection("payrollPeriods").where("year", ">=", year).get();
      for (const p of laterSnap.docs) {
        const d = p.data() as Record<string, unknown>;
        const py = d.year as number;
        const pm = d.month as number;
        if (!(py > year || (py === year && pm > month)) || d.locked === true) continue;
        const laterEntryRef = p.ref.collection("entries").doc(employeeId);
        const laterEntrySnap = await laterEntryRef.get();
        if (!laterEntrySnap.exists) continue;
        const laterNotes = ((laterEntrySnap.data() as Record<string, unknown>).notes as PayrollNoteDoc[] | undefined) ?? [];
        const filtered = laterNotes.filter((n) => (n.sourceNoteId ?? n.id) !== sourceNoteId);
        if (filtered.length !== laterNotes.length) {
          await laterEntryRef.update({ notes: filtered, updatedAt: FieldValue.serverTimestamp() });
        }
      }
    } else if (carryChanged && cfFlag === true) {
      // false → true: seed the note into every future (non-locked) period.
      const futureSnap = await db().collection("payrollPeriods").where("year", ">=", year).get();
      for (const p of futureSnap.docs) {
        const d = p.data() as Record<string, unknown>;
        const py = d.year as number;
        const pm = d.month as number;
        if (!(py > year || (py === year && pm > month)) || d.locked === true) continue;
        const futureEntryRef = p.ref.collection("entries").doc(employeeId);
        const futureEntrySnap = await futureEntryRef.get();
        if (!futureEntrySnap.exists) continue;
        const futureNotes = ((futureEntrySnap.data() as Record<string, unknown>).notes as PayrollNoteDoc[] | undefined) ?? [];
        if (futureNotes.some((n) => (n.sourceNoteId ?? n.id) === sourceNoteId)) continue; // dedup
        const copy: PayrollNoteDoc = {
          ...updated,
          id: randomUUID(),
          sourceNoteId,
          carryForward: true,
          createdAt: Timestamp.now(),
        };
        await futureEntryRef.update({
          notes: FieldValue.arrayUnion(copy),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }

    await logUpdate(ctxFromReq(req), {
      collection: "payrollPeriods/entries/notes",
      resourceId: periodId,
      subResourceId: noteId,
      employeeId,
      before: { text: notes[idx].text, carryForward: prevCarry },
      after: { text: updated.text, carryForward: carryChanged ? cfFlag : prevCarry },
    });
    res.json({ ok: true });
  }
);

// ─── DELETE /payroll/periods/:id/entries/:employeeId/notes/:noteId ───────────
// Delete a single note in this period only.

payrollRouter.delete(
  "/periods/:id/entries/:employeeId/notes/:noteId",
  requireAuth,
  requirePermission("payroll.notes.manage"),
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
    const removed = notes.find((n) => n.id === noteId);
    await entryRef.update({
      notes: nextNotes,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await logDelete(ctxFromReq(req), {
      collection: "payrollPeriods/entries/notes",
      resourceId: periodId,
      subResourceId: noteId,
      employeeId,
      summary: { text: removed?.text, carryForward: removed?.carryForward },
    });
    res.json({ ok: true });
  }
);

// ─── GET /payroll/settings ────────────────────────────────────────────────────

payrollRouter.get(
  "/settings",
  requireAuth,
  requirePermission("nav.payroll.view"),
  async (_req: AuthRequest, res: Response) => {
    const snap = await db().collection("settings").doc("payroll").get();
    const data = snap.exists ? snap.data() : undefined;
    const foodVoucherRate = (data?.foodVoucherRate as number | undefined) ?? 129.5;
    const dppMaxMonthlyReward = (data?.dppMaxMonthlyReward as number | undefined) ?? 11999;
    const minimumWage = (data?.minimumWage as number | undefined) ?? 22400;
    const multisportBasePrice = (data?.multisportBasePrice as number | undefined) ?? 470;
    const mealAllowanceMinHours = (data?.mealAllowanceMinHours as number | undefined) ?? 3;
    res.json({ foodVoucherRate, dppMaxMonthlyReward, minimumWage, multisportBasePrice, mealAllowanceMinHours });
  }
);

// ─── PATCH /payroll/settings ──────────────────────────────────────────────────

payrollRouter.patch(
  "/settings",
  requireAuth,
  requirePermission("settings.payroll.manage"),
  async (req: AuthRequest, res: Response) => {
    const { foodVoucherRate, dppMaxMonthlyReward, minimumWage, multisportBasePrice, mealAllowanceMinHours } = req.body as {
      foodVoucherRate?: number;
      dppMaxMonthlyReward?: number;
      minimumWage?: number;
      multisportBasePrice?: number;
      mealAllowanceMinHours?: number;
    };
    const update: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: req.uid,
    };
    if (foodVoucherRate !== undefined) {
      if (typeof foodVoucherRate !== "number" || foodVoucherRate <= 0) {
        res.status(400).json({ error: "Neplatná sazba stravenky." });
        return;
      }
      update.foodVoucherRate = foodVoucherRate;
    }
    if (dppMaxMonthlyReward !== undefined) {
      if (typeof dppMaxMonthlyReward !== "number" || dppMaxMonthlyReward <= 0) {
        res.status(400).json({ error: "Neplatná maximální měsíční odměna DPP." });
        return;
      }
      update.dppMaxMonthlyReward = dppMaxMonthlyReward;
    }
    if (minimumWage !== undefined) {
      if (typeof minimumWage !== "number" || minimumWage <= 0) {
        res.status(400).json({ error: "Neplatná minimální mzda." });
        return;
      }
      update.minimumWage = minimumWage;
    }
    if (multisportBasePrice !== undefined) {
      if (typeof multisportBasePrice !== "number" || multisportBasePrice <= 0) {
        res.status(400).json({ error: "Neplatná základní cena Multisport." });
        return;
      }
      update.multisportBasePrice = multisportBasePrice;
    }
    if (mealAllowanceMinHours !== undefined) {
      if (typeof mealAllowanceMinHours !== "number" || mealAllowanceMinHours <= 0) {
        res.status(400).json({ error: "Neplatná minimální délka směny pro stravenku." });
        return;
      }
      update.mealAllowanceMinHours = mealAllowanceMinHours;
    }
    const settingsRef = db().collection("settings").doc("payroll");
    const beforeSnap = await settingsRef.get();
    const before = beforeSnap.exists ? (beforeSnap.data() as Record<string, unknown>) : {};
    await settingsRef.set(update, { merge: true });
    await logUpdate(ctxFromReq(req), {
      collection: "settings",
      resourceId: "payroll",
      before,
      after: { ...before, ...update },
    });
    res.json({ ok: true });
  }
);

// ─── GET /payroll/min-wage-check ──────────────────────────────────────────────
// Given a candidate `minimumWage`, returns the list of employees whose CURRENT
// effective monthly salary is below the threshold for their contract type
// (HPP ≥ minWage; PPP ≥ (minWage/40)×hoursPerWeek, default 20h; DPP not checked).
// Used by the Settings → Mzdy editor to show exactly which contracts would fall
// below a new minimum before it's saved. Read-only; gated like the setting.

type MinWageRow = Record<string, unknown>;

function uvazekToContractTypeLite(value: string): "HPP" | "PPP" | null {
  const v = value.toLowerCase();
  if (v.includes("polovič") || v.includes("zkrácen") || v.includes("částečn")) return "PPP";
  if (v.includes("plný") || v.includes("plny")) return "HPP";
  return null;
}

function minWageThresholdServer(
  contractType: string,
  minWage: number,
  hoursPerWeek: number | null
): number | null {
  if (contractType === "HPP") return Math.round(minWage);
  if (contractType === "PPP") {
    const h = hoursPerWeek && hoursPerWeek > 0 ? hoursPerWeek : 20;
    return Math.round((minWage / 40) * h);
  }
  return null; // DPP / unknown: not checked
}

/**
 * Current effective comp for the minimum-wage check: folds the latest
 * NON-parallel (primary) session — so a concurrent second contract doesn't
 * mask the primary — and applies mzda / úvazek / počet hodin / délka smlouvy
 * Dodatky that have taken effect by today. Mirrors the frontend
 * computeEffectiveState + the audit script.
 */
function currentEffectiveForMinWage(
  rows: MinWageRow[],
  today: string
): { contractType: string; salary: number | null; hoursPerWeek: number | null; active: boolean } | null {
  const sorted = [...rows].sort((a, b) =>
    String(a.startDate ?? "").localeCompare(String(b.startDate ?? ""))
  );
  type S = { nastup: MinWageRow; dodatky: MinWageRow[]; ukonceni: MinWageRow | null; parallel: boolean };
  const sessions: S[] = [];
  let cur: S | null = null;
  for (const r of sorted) {
    const ct = r.changeType;
    if (ct === "nástup") {
      if (cur) sessions.push(cur);
      cur = { nastup: r, dodatky: [], ukonceni: null, parallel: r.parallel === true };
    } else if (cur && ct === "změna smlouvy") {
      cur.dodatky.push(r);
    } else if (cur && ct === "ukončení") {
      cur.ukonceni = r;
    }
  }
  if (cur) sessions.push(cur);
  const nonParallel = sessions.filter((s) => !s.parallel);
  const s = nonParallel.length ? nonParallel[nonParallel.length - 1] : null;
  if (!s) return null;

  let contractType = String(s.nastup.contractType ?? "");
  let salary = s.nastup.salary != null ? Number(s.nastup.salary) : null;
  let hoursPerWeek = s.nastup.hoursPerWeek != null ? Number(s.nastup.hoursPerWeek) : null;
  let endDate = (s.nastup.endDate as string | null | undefined) ?? null;
  for (const d of s.dodatky) {
    if (String(d.startDate ?? "") > today) continue; // future-dated: not yet effective
    const changes = (d.changes as Array<{ changeKind?: string; value?: string }> | undefined) ?? [];
    for (const ch of changes) {
      if (ch.changeKind === "mzda" && ch.value) {
        const n = Number(ch.value);
        if (Number.isFinite(n) && contractType !== "DPP") salary = n;
      } else if (ch.changeKind === "úvazek" && ch.value) {
        const m = uvazekToContractTypeLite(ch.value);
        if (m) contractType = m;
      } else if (ch.changeKind === "počet hodin" && ch.value) {
        const n = Number(ch.value);
        if (Number.isFinite(n)) hoursPerWeek = n;
      } else if (ch.changeKind === "délka smlouvy") {
        endDate = ch.value || null;
      }
    }
  }
  if (s.ukonceni && s.ukonceni.startDate) endDate = s.ukonceni.startDate as string;
  const started = String(s.nastup.startDate ?? "") <= today;
  const ended = !!endDate && String(endDate) < today;
  return { contractType, salary, hoursPerWeek, active: started && !ended };
}

payrollRouter.get(
  "/min-wage-check",
  requireAuth,
  requirePermission("settings.payroll.manage"),
  async (req: AuthRequest, res: Response) => {
    const minWage = Number(req.query.minimumWage);
    if (!Number.isFinite(minWage) || minWage <= 0) {
      res.status(400).json({ error: "Neplatná minimální mzda." });
      return;
    }
    const today = clock.today();
    const empSnap = await db().collection("employees").get();
    const checked = await Promise.all(
      empSnap.docs.map(async (empDoc) => {
        const rowsSnap = await empDoc.ref.collection("employment").get();
        const rows = rowsSnap.docs.map((r) => r.data() as MinWageRow);
        const eff = currentEffectiveForMinWage(rows, today);
        if (!eff || !eff.active) return null;
        const threshold = minWageThresholdServer(eff.contractType, minWage, eff.hoursPerWeek);
        if (threshold == null) return null; // DPP not checked
        if (eff.salary == null || !Number.isFinite(eff.salary) || eff.salary >= threshold) return null;
        // Display context — honour displayName like the rest of the UI.
        const n = nameParts(empDoc.data());
        return {
          employeeId: empDoc.id,
          name: n.displayName || `${n.firstName} ${n.lastName}`.trim() || empDoc.id,
          contractType: eff.contractType,
          hoursPerWeek: eff.hoursPerWeek,
          salary: eff.salary,
          threshold,
        };
      })
    );
    const violations = checked
      .filter((v): v is NonNullable<typeof v> => v !== null)
      .sort((a, b) => a.salary - b.salary);
    res.json({ minimumWage: minWage, violations });
  }
);

// ─── GET /payroll/periods ─────────────────────────────────────────────────────

payrollRouter.get(
  "/periods",
  requireAuth,
  requirePermission("nav.payroll.view"),
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

// Multisport reflects the employee's CURRENT enrollment, so for an unlocked
// period we recompute the price live on read (benefits change without a payroll
// recount). A LOCKED period is finalized — keep its stored price/flag frozen.
async function hydrateMultisport(
  entries: Record<string, unknown>[],
  year: number,
  month: number,
  basePrice: number,
  locked: boolean
): Promise<Record<string, unknown>[]> {
  if (locked) return entries;
  return Promise.all(
    entries.map(async (e) => {
      const multisportPrice = await getMultisportPrice(e.id as string, year, month, basePrice);
      return { ...e, multisportPrice, multisportActive: multisportPrice > 0 };
    })
  );
}

/**
 * Re-resolve each entry's name against the LIVE employee record. The stored name
 * was copied from the shift plan's planEmployees snapshot, which is frozen at
 * roster-add time — so renaming an employee (or giving them a displayName) never
 * reached existing entries, and a recalc could not fix it either because it read
 * the same stale roster. Fixed on READ so LOCKED periods display correctly too:
 * we never write this back, the stored snapshot stays untouched and remains the
 * fallback for employees that have since been deleted.
 */
async function hydrateNames(
  entries: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  const ids = entries.map((e) => (e.employeeId as string | undefined) ?? (e.id as string));
  const live = await resolveEmployeeNameParts(ids);
  return entries.map((e) => {
    const id = (e.employeeId as string | undefined) ?? (e.id as string);
    const { firstName, lastName, displayName } = preferLive(live, id, e);
    return { ...e, firstName, lastName, displayName };
  });
}

payrollRouter.get(
  "/periods/:id",
  requireAuth,
  requirePermission("nav.payroll.view"),
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
    const entries = await hydrateNames(
      await hydrateMultisport(
        rawEntries,
        periodData.year as number,
        periodData.month as number,
        (periodData.multisportBasePrice as number | undefined) ?? 470,
        periodData.locked === true
      )
    );
    res.json({ id: periodSnap.id, ...periodData, entries });
  }
);

// ─── GET /payroll/periods/by-month/:year/:month ───────────────────────────────

payrollRouter.get(
  "/periods/by-month/:year/:month",
  requireAuth,
  requirePermission("nav.payroll.view"),
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
    const periodData = snap.docs[0].data() as Record<string, unknown>;
    const entriesSnap = await periodRef.collection("entries").get();
    const rawEntries = entriesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const entries = await hydrateNames(
      await hydrateMultisport(
        rawEntries,
        year,
        month,
        (periodData.multisportBasePrice as number | undefined) ?? 470,
        periodData.locked === true
      )
    );
    res.json({ id: snap.docs[0].id, ...periodData, entries });
  }
);

// ─── PATCH /payroll/periods/:id ───────────────────────────────────────────────
// Lock/unlock a payroll period (admin only). Locked periods are read-only.

/**
 * On a period lock, mirror each entry's vacation hours into the per-employee
 * vacation ledger for the period's month. The effective figure follows the same
 * precedence the UI shows: manual override → Nemoc auto-override → computed
 * `vacationHours` (reading the raw field alone would misreport anyone with a
 * sick-leave cascade). Idempotent: `upsertLedgerMonth` overwrites months[month],
 * so re-locking or a lock→unlock→lock cycle can't double-count. Best-effort — a
 * failure here must not block the lock itself. Returns the number of entries fed.
 */
async function feedVacationLedgerOnLock(
  periodRef: admin.firestore.DocumentReference,
  year: number,
  month: number,
  uid: string | null
): Promise<number> {
  const entriesSnap = await periodRef.collection("entries").get();
  let n = 0;
  for (const d of entriesSnap.docs) {
    const e = d.data() as {
      employeeId?: string;
      vacationHours?: number;
      overrides?: Record<string, number>;
      autoOverrides?: Record<string, number>;
    };
    const employeeId = e.employeeId ?? d.id;
    const eff =
      e.overrides?.vacationHours ??
      e.autoOverrides?.vacationHours ??
      e.vacationHours ??
      0;
    await upsertLedgerMonth({
      employeeId,
      year,
      month,
      hours: eff,
      source: "payroll-lock",
      updatedBy: uid,
    });
    n++;
  }
  return n;
}

payrollRouter.patch(
  "/periods/:id",
  requireAuth,
  requirePermission("payroll.lock"),
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
    const before = snap.data() as Record<string, unknown>;
    await periodRef.update(update);
    await logUpdate(ctxFromReq(req), {
      collection: "payrollPeriods",
      resourceId: req.params.id,
      before: { locked: before.locked ?? false },
      after: { locked },
    });

    // Feed the vacation ledger only on a genuine unlocked→locked transition, so a
    // repeated lock (the handler doesn't reject re-locks) doesn't re-run needlessly.
    const wasLocked = before.locked === true;
    if (locked && !wasLocked) {
      const year = Number(before.year);
      const month = Number(before.month);
      if (Number.isInteger(year) && Number.isInteger(month)) {
        try {
          const n = await feedVacationLedgerOnLock(periodRef, year, month, req.uid ?? null);
          await writeAudit(ctxFromReq(req), {
            action: "update",
            collection: "employees/vacationLedger",
            resourceId: req.params.id,
            event: "vacation.ledger.fromPayrollLock",
            year,
            month,
            extra: { source: "payroll-lock", employees: n },
          });
        } catch (err) {
          // Ledger feed is idempotent and re-runnable (unlock→lock) — never fail the lock.
          console.error("[payroll lock] vacation ledger feed failed:", err);
        }
      }
    }

    res.json({ ok: true, locked });
  }
);

// ─── PATCH /payroll/periods/:id/entries/:employeeId ──────────────────────────

payrollRouter.patch(
  "/periods/:id/entries/:employeeId",
  requireAuth,
  requirePermission("payroll.edit"),
  async (req: AuthRequest, res: Response) => {
    const periodRef = db().collection("payrollPeriods").doc(req.params.id);
    const periodSnap = await periodRef.get();
    if (!periodSnap.exists) {
      res.status(404).json({ error: "Mzdové období nebylo nalezeno." });
      return;
    }
    if ((periodSnap.data() as Record<string, unknown>).locked === true) {
      res.status(409).json({ error: "Mzdové období je uzamčeno – úpravy nejsou povoleny." });
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
    const beforeSnap = await entryRef.get();
    const before = beforeSnap.exists ? (beforeSnap.data() as Record<string, unknown>) : {};
    await entryRef.update(update);
    await logUpdate(ctxFromReq(req), {
      collection: "payrollPeriods/entries",
      resourceId: req.params.id,
      subResourceId: req.params.employeeId,
      employeeId: req.params.employeeId,
      before: {
        sickLeaveHours: before.sickLeaveHours,
        overrides: before.overrides,
        autoOverrides: before.autoOverrides,
      },
      after: {
        sickLeaveHours: update.sickLeaveHours ?? before.sickLeaveHours,
        overrides: update.overrides ?? before.overrides,
        autoOverrides: update.autoOverrides ?? before.autoOverrides,
      },
    });
    res.json({ ok: true });
  }
);

// ─── POST /payroll/periods/:id/entries/:employeeId/recalculate ───────────────
// Per-employee, per-field hard recompute (admin only, destructive). The body
// lists the fields to recalculate; each one's manual override is DISCARDED so it
// recomputes cleanly from the shift plan (Nemoc has no shift-plan source, so
// recalculating it resets sickLeaveHours to 0). Fields NOT listed keep their
// manual override pinned. The whole entry's computed values still refresh from
// the current shifts. Locked periods rejected (409).

const RECALC_OVERRIDE_KEYS = new Set([
  "totalHours", "reportHours", "vacationHours",
  "nightHours", "holidayHours", "weekendHours", "extraPay", "foodVouchers",
]);

payrollRouter.post(
  "/periods/:id/entries/:employeeId/recalculate",
  requireAuth,
  requirePermission("payroll.recalculate.hard"),
  async (req: AuthRequest, res: Response) => {
    const { id: periodId, employeeId } = req.params;
    const fields = Array.isArray((req.body as { fields?: unknown }).fields)
      ? ((req.body as { fields: unknown[] }).fields.filter((f) => typeof f === "string") as string[])
      : [];
    if (fields.length === 0) {
      res.status(400).json({ error: "Nebyla vybrána žádná složka k přepočtu." });
      return;
    }

    const periodRef = db().collection("payrollPeriods").doc(periodId);
    if (!(await ensurePeriodUnlocked(periodRef, res))) return;

    const entryRef = periodRef.collection("entries").doc(employeeId);
    const entrySnap = await entryRef.get();
    if (!entrySnap.exists) {
      res.status(404).json({ error: "Záznam zaměstnance nenalezen." });
      return;
    }
    const entry = entrySnap.data() as Record<string, unknown>;
    const prevOverrides = (entry.overrides as Record<string, number> | undefined) ?? {};
    const prevSick = (entry.sickLeaveHours as number | undefined) ?? 0;

    // Drop the selected fields' manual overrides; keep the rest pinned.
    const checked = new Set(fields);
    const survivingOverrides: Record<string, number> = {};
    for (const [k, v] of Object.entries(prevOverrides)) {
      if (!(checked.has(k) && RECALC_OVERRIDE_KEYS.has(k))) survivingOverrides[k] = v;
    }
    const newSick = checked.has("sickLeaveHours") ? 0 : prevSick;

    const ok = await recomputeEntryForEmployee(periodId, employeeId, {
      overrides: survivingOverrides,
      sickLeaveHours: newSick,
    });
    if (!ok) {
      res.status(400).json({ error: "Přepočet se nezdařil – období nemá platný směnný plán." });
      return;
    }

    await logUpdate(ctxFromReq(req), {
      collection: "payrollPeriods/entries",
      resourceId: periodId,
      subResourceId: employeeId,
      employeeId,
      before: { overrides: prevOverrides, sickLeaveHours: prevSick },
      after: { overrides: survivingOverrides, sickLeaveHours: newSick, recalculatedFields: fields },
    });
    res.json({ ok: true });
  }
);

// ─── POST /payroll/periods/:id/recalculate ────────────────────────────────────
// Manual re-run of the payroll calculation for a single period. Locked periods
// are rejected explicitly; createOrUpdatePayrollPeriod also skips them defensively.

payrollRouter.post(
  "/periods/:id/recalculate",
  requireAuth,
  requirePermission("payroll.recalculate"),
  async (req: AuthRequest, res: Response) => {
    const periodRef = db().collection("payrollPeriods").doc(req.params.id);
    const snap = await periodRef.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Mzdové období nebylo nalezeno." });
      return;
    }
    const data = snap.data() as Record<string, unknown>;
    if (data.locked === true) {
      res.status(409).json({ error: "Mzdové období je uzamčeno – přepočet není povolen." });
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
    await writeAudit(ctxFromReq(req), {
      action: "update",
      collection: "payrollPeriods",
      resourceId: req.params.id,
      extra: { kind: "recalculate", year, month },
    });
    res.json({ ok: true });
  }
);

// ─── POST /payroll/periods/:id/reset ──────────────────────────────────────────
// Hard recompute (admin only, destructive): re-run the calculation but DISCARD
// every per-field manual override so all cells recompute cleanly from the shift
// plan. sickLeaveHours (Nemoc) and notes are preserved. Locked periods rejected.

payrollRouter.post(
  "/periods/:id/reset",
  requireAuth,
  requirePermission("payroll.recalculate.hard"),
  async (req: AuthRequest, res: Response) => {
    const periodRef = db().collection("payrollPeriods").doc(req.params.id);
    const snap = await periodRef.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Mzdové období nebylo nalezeno." });
      return;
    }
    const data = snap.data() as Record<string, unknown>;
    if (data.locked === true) {
      res.status(409).json({ error: "Mzdové období je uzamčeno – přepočet není povolen." });
      return;
    }
    const planId = data.shiftPlanId as string | undefined;
    const year = data.year as number | undefined;
    const month = data.month as number | undefined;
    if (!planId || year == null || month == null) {
      res.status(400).json({ error: "Období nemá odkaz na směnný plán." });
      return;
    }
    await createOrUpdatePayrollPeriod(planId, year, month, { discardOverrides: true });
    await writeAudit(ctxFromReq(req), {
      action: "update",
      collection: "payrollPeriods",
      resourceId: req.params.id,
      extra: { kind: "hard-recalculate", year, month },
    });
    res.json({ ok: true });
  }
);

// ─── DELETE /payroll/periods/:id ──────────────────────────────────────────────
// Delete an entire payroll period and all its entries (admin only, destructive).
// All manual data on the period (overrides, Nemoc, notes) is permanently lost;
// the computed figures can be regenerated from the published plan via the
// "Vytvořit mzdy ručně" / by-month create. Locked periods are rejected (409) —
// the admin must unlock first, mirroring recalc/edit.

payrollRouter.delete(
  "/periods/:id",
  requireAuth,
  requirePermission("payroll.period.delete"),
  async (req: AuthRequest, res: Response) => {
    const periodRef = db().collection("payrollPeriods").doc(req.params.id);
    const snap = await periodRef.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Mzdové období nebylo nalezeno." });
      return;
    }
    const data = snap.data() as Record<string, unknown>;
    if (data.locked === true) {
      res.status(409).json({ error: "Mzdové období je uzamčeno – nejprve ho odemkněte." });
      return;
    }

    // Delete all entry docs, then the period doc, in a single batch. Entry counts
    // are small (one per planned employee, ~35) — well under the 500-op batch cap.
    const entriesSnap = await periodRef.collection("entries").get();
    const batch = db().batch();
    for (const d of entriesSnap.docs) batch.delete(d.ref);
    batch.delete(periodRef);
    await batch.commit();

    await logDelete(ctxFromReq(req), {
      collection: "payrollPeriods",
      resourceId: req.params.id,
      summary: {
        year: data.year,
        month: data.month,
        entryCount: entriesSnap.size,
      },
    });
    res.json({ ok: true });
  }
);

// ─── POST /payroll/periods/by-month/:year/:month ──────────────────────────────
// Manually create a payrollPeriod for an already-published plan. Useful for
// seeded plans that bypassed the publish trigger. Refuses to overwrite an
// existing period (admins should use /recalculate for that).

payrollRouter.post(
  "/periods/by-month/:year/:month",
  requireAuth,
  requirePermission("payroll.create"),
  async (req: AuthRequest, res: Response) => {
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      res.status(400).json({ error: "Neplatný rok nebo měsíc." });
      return;
    }

    const existing = await db()
      .collection("payrollPeriods")
      .where("year", "==", year)
      .where("month", "==", month)
      .limit(1)
      .get();
    if (!existing.empty) {
      res.status(409).json({ error: "Mzdové období pro tento měsíc už existuje." });
      return;
    }

    const planSnap = await db()
      .collection("shiftPlans")
      .where("year", "==", year)
      .where("month", "==", month)
      .where("status", "==", "published")
      .limit(1)
      .get();
    if (planSnap.empty) {
      res.status(404).json({
        error: "Pro tento měsíc neexistuje publikovaný směnný plán.",
      });
      return;
    }

    const planId = planSnap.docs[0].id;
    await createOrUpdatePayrollPeriod(planId, year, month);
    await logCreate(ctxFromReq(req), {
      collection: "payrollPeriods",
      resourceId: `${year}-${String(month).padStart(2, "0")}`,
      summary: { year, month, shiftPlanId: planId },
    });
    res.status(201).json({ ok: true });
  }
);

// ─── POST /payroll/trigger ────────────────────────────────────────────────────
// Manual trigger for emulator testing — recalculates all published plans.

payrollRouter.post(
  "/trigger",
  requireAuth,
  requirePermission("system.triggers"),
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
