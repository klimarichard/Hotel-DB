import { Router, Response, NextFunction } from "express";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { ctxFromReq, logCreate, logUpdate, logDelete } from "../services/auditLog";
import { actorCtx, resolveOnDutyActor } from "../services/recepceActor";
import { isHotelSlug, HotelSlug, terminalViewPerm, terminalManagePerm } from "../services/hotels";
import {
  TerminalPayment,
  TerminalRange,
  TerminalType,
  isTerminalType,
  isDateStr,
  terminalCol,
  terminalRangeRef,
  inRange,
} from "../services/terminalShared";

export const terminalRouter = Router();

/** Validates the :hotel URL segment. Rejects unknown slugs with 404. */
function validateHotelParam(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!isHotelSlug(req.params.hotel)) {
    res.status(404).json({ error: "Neznámý hotel." });
    return;
  }
  next();
}

/** Dynamic per-hotel gate: `view` for reads + entry writes, `manage` for the
 *  range + settling. `manage` implies `view`, so a manager is never locked out
 *  of reads. */
function requireTerminalPerm(kind: "view" | "manage") {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const hotel = req.params.hotel as HotelSlug;
    const set = req.permissions ?? new Set<string>();
    const ok =
      set.has("system.admin") ||
      set.has(terminalManagePerm(hotel)) ||
      (kind === "view" && set.has(terminalViewPerm(hotel)));
    if (ok) {
      next();
      return;
    }
    res.status(403).json({ error: "Nemáte oprávnění k této akci." });
  };
}

/** Manage users see all payments + add/edit any date; others are range-bound. */
function isManage(req: AuthRequest, hotel: HotelSlug): boolean {
  const set = req.permissions ?? new Set<string>();
  return set.has("system.admin") || set.has(terminalManagePerm(hotel));
}

async function readRange(hotel: HotelSlug): Promise<TerminalRange> {
  const snap = await terminalRangeRef(hotel).get();
  if (!snap.exists) return { from: null, to: null };
  const d = snap.data() as Record<string, unknown>;
  return {
    from: isDateStr(d.from) ? (d.from as string) : null,
    to: isDateStr(d.to) ? (d.to as string) : null,
  };
}

interface ParsedEntry {
  date: string;
  amount: number;
  type: TerminalType;
  note: string;
}

/** Validate + normalize a payment body. Returns { error } on the first problem.
 *  `settled` is deliberately NOT parsed here — see the create/update handlers. */
function parseEntry(raw: unknown): ParsedEntry | { error: string } {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!isDateStr(b.date)) return { error: "Neplatné datum (YYYY-MM-DD)." };
  const amount = typeof b.amount === "number" && Number.isFinite(b.amount) ? b.amount : NaN;
  if (!Number.isFinite(amount)) return { error: "Neplatná částka." };
  if (!isTerminalType(b.type)) return { error: "Neplatný typ transakce." };
  // Note is optional for EVERY type (including "other").
  const note = typeof b.note === "string" ? b.note.trim() : "";
  // Amount is CZK only — round to a whole number.
  return { date: b.date as string, amount: Math.round(amount), type: b.type, note };
}

terminalRouter.use("/:hotel", validateHotelParam);

// ── Per-hotel visible range ───────────────────────────────────────────────────
// Registered BEFORE `/:hotel/:id` so "range" isn't captured as an :id segment.
terminalRouter.get(
  "/:hotel/range",
  requireAuth,
  requireTerminalPerm("view"),
  async (req: AuthRequest, res: Response) => {
    res.json(await readRange(req.params.hotel as HotelSlug));
  }
);

terminalRouter.put(
  "/:hotel/range",
  requireAuth,
  requireTerminalPerm("manage"),
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
    await terminalRangeRef(hotel).set(
      { from, to, updatedBy: req.uid, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    await logUpdate(ctxFromReq(req), {
      collection: "terminalConfig",
      resourceId: "range",
      subResourceId: hotel,
      before: before as unknown as Record<string, unknown>,
      after: { from, to },
    });
    res.json({ from, to });
  }
);

/**
 * GET /api/terminal/:hotel — the continuous list, newest first. Managers see all;
 * everyone else is bounded by the visible range (inequality + orderBy on the same
 * `date` field, so no composite index is needed).
 */
terminalRouter.get(
  "/:hotel",
  requireAuth,
  requireTerminalPerm("view"),
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const snap = await terminalCol(hotel).orderBy("date", "desc").get();
    let rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as TerminalPayment) }));
    // Non-managers are bounded by the visible range, applied IN-APP so that a
    // one-sided range (only `from` or only `to`) gates just that one side.
    if (!isManage(req, hotel)) {
      const range = await readRange(hotel);
      rows = rows.filter((r) => inRange(r.date, range));
    }
    res.json(rows);
  }
);

/** POST a new payment (terminal.view). Non-managers: date must be in the range. */
terminalRouter.post(
  "/:hotel",
  requireAuth,
  requireTerminalPerm("view"),
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
    // SECURITY: `settled` ("Předáno") is NEVER honoured from the create body — it
    // is a manage-only flag flipped through PUT /:id/settled. A view user always
    // creates an un-settled payment regardless of what the client sends.
    const ref = await terminalCol(hotel).add({
      ...parsed,
      settled: false,
      settledBy: null,
      settledAt: null,
      createdBy: req.uid,
      updatedBy: req.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const saved = await ref.get();
    // Reception writes are attributed to the person on shift (last "Převzal"),
    // not the shared terminal account that may be logged in.
    await logCreate(actorCtx(await resolveOnDutyActor(req, hotel)), {
      collection: "terminalPayments",
      resourceId: ref.id,
      subResourceId: hotel,
      summary: { date: parsed.date, type: parsed.type, amount: parsed.amount },
    });
    res.json({ id: ref.id, ...saved.data() });
  }
);

/** PUT a payment (terminal.view). Non-managers: both old + new date must be in
 *  range, and they cannot change `settled`. */
terminalRouter.put(
  "/:hotel/:id",
  requireAuth,
  requireTerminalPerm("view"),
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const ref = terminalCol(hotel).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Záznam nenalezen." });
      return;
    }
    const before = snap.data() as TerminalPayment;
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
    // SECURITY: `settled` is NOT part of `parsed`, so a PUT here can never flip
    // the "Předáno" flag (for either role) — it keeps the existing value. The
    // dedicated manage-only PUT /:id/settled endpoint is the only way to change it.
    await ref.set(
      { ...parsed, updatedBy: req.uid, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    const saved = await ref.get();
    await logUpdate(actorCtx(await resolveOnDutyActor(req, hotel)), {
      collection: "terminalPayments",
      resourceId: ref.id,
      subResourceId: hotel,
      before: before as unknown as Record<string, unknown>,
      after: { ...(before as unknown as Record<string, unknown>), ...parsed },
    });
    res.json({ id: ref.id, ...saved.data() });
  }
);

/** PUT the "Předáno" flag (terminal.manage only). Records who settled + when. */
terminalRouter.put(
  "/:hotel/:id/settled",
  requireAuth,
  requireTerminalPerm("manage"),
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const ref = terminalCol(hotel).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Záznam nenalezen." });
      return;
    }
    const before = snap.data() as TerminalPayment;
    const b = req.body as { settled?: unknown };
    if (typeof b.settled !== "boolean") {
      res.status(400).json({ error: "Neplatný stav předání." });
      return;
    }
    const settled = b.settled;
    await ref.set(
      {
        settled,
        settledBy: settled ? req.uid : null,
        settledAt: settled ? Timestamp.now() : null,
        updatedBy: req.uid,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    const saved = await ref.get();
    await logUpdate(ctxFromReq(req), {
      collection: "terminalPayments",
      resourceId: ref.id,
      subResourceId: hotel,
      before: { settled: before.settled ?? false },
      after: { settled },
    });
    res.json({ id: ref.id, ...saved.data() });
  }
);

/** DELETE a payment (terminal.view). Non-managers: entry's date must be in range. */
terminalRouter.delete(
  "/:hotel/:id",
  requireAuth,
  requireTerminalPerm("view"),
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const ref = terminalCol(hotel).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Záznam nenalezen." });
      return;
    }
    const before = snap.data() as TerminalPayment;
    if (!isManage(req, hotel) && !inRange(before.date, await readRange(hotel))) {
      res.status(403).json({ error: "Datum je mimo povolené období." });
      return;
    }
    await ref.delete();
    await logDelete(actorCtx(await resolveOnDutyActor(req, hotel)), {
      collection: "terminalPayments",
      resourceId: req.params.id,
      subResourceId: hotel,
      summary: { date: before.date, type: before.type, amount: before.amount },
    });
    res.json({ ok: true });
  }
);
