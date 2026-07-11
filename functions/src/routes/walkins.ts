import { Router, Response, NextFunction } from "express";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { ctxFromReq, logCreate, logUpdate, logDelete } from "../services/auditLog";
import { actorCtx, resolveOnDutyActor } from "../services/recepceActor";
import { isHotelSlug, HotelSlug, walkinViewPerm, walkinManagePerm } from "../services/hotels";
import { listRecepceEmployees, todayPrague, currentReceptionShiftPrague, resolveEmployeeDisplays } from "../services/recepceEmployees";
import { scheduledEmployeeId } from "../services/scheduleLookup";
import {
  WalkinDoc,
  WalkinRange,
  Currency,
  isCurrency,
  isDateStr,
  walkinCol,
  walkinRangeRef,
  inRange,
} from "../services/walkinShared";

export const walkinsRouter = Router();

// The employee dropdown (shift-plan pool, with a reception-position fallback for
// a month that has no plan yet) lives in services/recepceEmployees.ts — Lobby
// bar's "Prodal" dropdown needs exactly the same list.

/** Validates the :hotel URL segment. Rejects unknown slugs with 404. */
function validateHotelParam(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!isHotelSlug(req.params.hotel)) {
    res.status(404).json({ error: "Neznámý hotel." });
    return;
  }
  next();
}

/** Dynamic per-hotel gate: `view` for reads + entry writes, `manage` for the
 *  range. `manage` implies `view`, so a manager is never locked out of reads. */
function requireWalkinPerm(kind: "view" | "manage") {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const hotel = req.params.hotel as HotelSlug;
    const set = req.permissions ?? new Set<string>();
    const ok =
      set.has("system.admin") ||
      set.has(walkinManagePerm(hotel)) ||
      (kind === "view" && set.has(walkinViewPerm(hotel)));
    if (ok) {
      next();
      return;
    }
    res.status(403).json({ error: "Nemáte oprávnění k této akci." });
  };
}

/** Manage users see all entries + add/edit any date; others are range-bound. */
function isManage(req: AuthRequest, hotel: HotelSlug): boolean {
  const set = req.permissions ?? new Set<string>();
  return set.has("system.admin") || set.has(walkinManagePerm(hotel));
}

async function readRange(hotel: HotelSlug): Promise<WalkinRange> {
  const snap = await walkinRangeRef(hotel).get();
  if (!snap.exists) return { from: null, to: null };
  const d = snap.data() as Record<string, unknown>;
  return {
    from: isDateStr(d.from) ? (d.from as string) : null,
    to: isDateStr(d.to) ? (d.to as string) : null,
  };
}

interface ParsedEntry {
  date: string;
  employeeId: string;
  employeeName: string;
  resNo: string;
  amount: number;
  currency: Currency;
}

/** Validate + normalize an entry body. Returns { error } on the first problem. */
function parseEntry(raw: unknown): ParsedEntry | { error: string } {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!isDateStr(b.date)) return { error: "Neplatné datum (YYYY-MM-DD)." };
  const employeeId = typeof b.employeeId === "string" ? b.employeeId.trim() : "";
  if (employeeId === "") return { error: "Vyberte zaměstnance." };
  const employeeName = typeof b.employeeName === "string" ? b.employeeName.trim() : "";
  const resNo = typeof b.resNo === "string" ? b.resNo.trim() : "";
  const amount = typeof b.amount === "number" && Number.isFinite(b.amount) ? b.amount : NaN;
  if (!Number.isFinite(amount)) return { error: "Neplatná částka." };
  if (!isCurrency(b.currency)) return { error: "Neplatná měna." };
  return { date: b.date as string, employeeId, employeeName, resNo, amount, currency: b.currency };
}

walkinsRouter.use("/:hotel", validateHotelParam);

/**
 * GET /api/walkins/:hotel/employees?date=YYYY-MM-DD
 * Everyone in that date's month shift plan (active planEmployees), deduped by
 * employeeId, plus `onShiftEmployeeId` — whoever is scheduled for the reception
 * shift happening now (independent of the queried `date`), so a new walk-in
 * defaults to the person at the desk. Null when nobody is scheduled / no plan.
 * Registered BEFORE `/:hotel/:id`.
 */
walkinsRouter.get(
  "/:hotel/employees",
  requireAuth,
  requireWalkinPerm("view"),
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const dateStr = isDateStr(req.query.date) ? (req.query.date as string) : todayPrague();
    const cur = currentReceptionShiftPrague();
    res.json({
      employees: await listRecepceEmployees(dateStr),
      onShiftEmployeeId: await scheduledEmployeeId(hotel, cur.date, cur.shift),
    });
  }
);

/** GET the visible range (any view user needs it to bound their own add form). */
walkinsRouter.get(
  "/:hotel/range",
  requireAuth,
  requireWalkinPerm("view"),
  async (req: AuthRequest, res: Response) => {
    res.json(await readRange(req.params.hotel as HotelSlug));
  }
);

/** PUT the visible range (walkiny.manage). */
walkinsRouter.put(
  "/:hotel/range",
  requireAuth,
  requireWalkinPerm("manage"),
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const b = req.body as { from?: unknown; to?: unknown };
    const from = isDateStr(b.from) ? (b.from as string) : null;
    const to = isDateStr(b.to) ? (b.to as string) : null;
    if (from && to && from > to) {
      res.status(400).json({ error: "Počáteční datum musí být před koncovým." });
      return;
    }
    const before = await readRange(hotel);
    await walkinRangeRef(hotel).set(
      { from, to, updatedBy: req.uid, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    await logUpdate(ctxFromReq(req), {
      collection: "walkinConfig",
      resourceId: "range",
      subResourceId: hotel,
      before: before as unknown as Record<string, unknown>,
      after: { from, to },
    });
    res.json({ from, to });
  }
);

/**
 * GET /api/walkins/:hotel — the continuous list, newest first. Managers see all;
 * everyone else is bounded by the visible range (inequality + orderBy on the same
 * `date` field, so no composite index is needed).
 */
walkinsRouter.get(
  "/:hotel",
  requireAuth,
  requireWalkinPerm("view"),
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const snap = await walkinCol(hotel).orderBy("date", "desc").get();
    let rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as WalkinDoc) }));
    // Non-managers are bounded by the visible range, applied IN-APP so that a
    // one-sided range (only `from` or only `to`) gates just that one side.
    if (!isManage(req, hotel)) {
      const range = await readRange(hotel);
      rows = rows.filter((r) => inRange(r.date, range));
    }
    // Show each row under the employee's CURRENT name (displayName || "First
    // Last"), re-resolved live; fall back to the stored snapshot if the employee
    // record is gone.
    const displays = await resolveEmployeeDisplays(rows.map((r) => r.employeeId));
    res.json(rows.map((r) => (displays.has(r.employeeId) ? { ...r, employeeName: displays.get(r.employeeId)!.name } : r)));
  }
);

/** POST a new entry (walkiny.view). Non-managers: date must be in the range. */
walkinsRouter.post(
  "/:hotel",
  requireAuth,
  requireWalkinPerm("view"),
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const parsed = parseEntry(req.body);
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    if (!isManage(req, hotel) && !inRange(parsed.date, await readRange(hotel))) {
      res.status(403).json({ error: "Datum je mimo povolené období." });
      return;
    }
    const ref = await walkinCol(hotel).add({
      ...parsed,
      createdBy: req.uid,
      updatedBy: req.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const saved = await ref.get();
    // Reception writes are attributed to the person on shift (last "Převzal"),
    // not the shared terminal account.
    await logCreate(actorCtx(await resolveOnDutyActor(req, hotel)), {
      collection: "walkins",
      resourceId: ref.id,
      subResourceId: hotel,
      summary: { date: parsed.date, employeeName: parsed.employeeName, amount: parsed.amount, currency: parsed.currency },
    });
    res.json({ id: ref.id, ...saved.data() });
  }
);

/** PUT an entry (walkiny.view). Non-managers: both old + new date must be in range. */
walkinsRouter.put(
  "/:hotel/:id",
  requireAuth,
  requireWalkinPerm("view"),
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const ref = walkinCol(hotel).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Záznam nenalezen." });
      return;
    }
    const before = snap.data() as WalkinDoc;
    const parsed = parseEntry(req.body);
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    if (!isManage(req, hotel)) {
      const range = await readRange(hotel);
      if (!inRange(before.date, range) || !inRange(parsed.date, range)) {
        res.status(403).json({ error: "Datum je mimo povolené období." });
        return;
      }
    }
    await ref.set(
      { ...parsed, updatedBy: req.uid, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    const saved = await ref.get();
    await logUpdate(actorCtx(await resolveOnDutyActor(req, hotel)), {
      collection: "walkins",
      resourceId: ref.id,
      subResourceId: hotel,
      before: before as unknown as Record<string, unknown>,
      after: { ...(before as unknown as Record<string, unknown>), ...parsed },
    });
    res.json({ id: ref.id, ...saved.data() });
  }
);

/** DELETE an entry (walkiny.view). Non-managers: entry's date must be in range. */
walkinsRouter.delete(
  "/:hotel/:id",
  requireAuth,
  requireWalkinPerm("view"),
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const ref = walkinCol(hotel).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Záznam nenalezen." });
      return;
    }
    const before = snap.data() as WalkinDoc;
    if (!isManage(req, hotel) && !inRange(before.date, await readRange(hotel))) {
      res.status(403).json({ error: "Datum je mimo povolené období." });
      return;
    }
    await ref.delete();
    await logDelete(actorCtx(await resolveOnDutyActor(req, hotel)), {
      collection: "walkins",
      resourceId: req.params.id,
      subResourceId: hotel,
      summary: { date: before.date, employeeName: before.employeeName, amount: before.amount, currency: before.currency },
    });
    res.json({ ok: true });
  }
);
