import { Router, Response, NextFunction } from "express";
import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { ctxFromReq, logCreate, logUpdate, logDelete } from "../services/auditLog";
import { actorCtx, resolveOnDutyActor } from "../services/recepceActor";
import { isHotelSlug, HotelSlug, terminalViewPerm, terminalManagePerm } from "../services/hotels";
import {
  TerminalPayment,
  TerminalRange,
  TerminalTypeItem,
  DEFAULT_TERMINAL_TYPES,
  OTHER_TYPE_ID,
  OTHER_TYPE_LABEL,
  isDateStr,
  terminalCol,
  terminalRangeRef,
  terminalTypesRef,
  inRange,
} from "../services/terminalShared";

export const terminalRouter = Router();

/** A fresh Firestore auto-id (no write), used for stable payment-type ids. */
function newId(): string {
  return admin.firestore().collection("_ids").doc().id;
}

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

/**
 * Sanitize the payment-type catalogue like lobby bar's sanitizeItems: trim
 * labels, drop empty-label rows, assign a fresh id when missing/duplicate, and
 * preserve order. The built-in `other` id is reserved so a custom type can never
 * shadow "Jiné…".
 */
function sanitizeTypes(raw: unknown): TerminalTypeItem[] {
  if (!Array.isArray(raw)) return [];
  const out: TerminalTypeItem[] = [];
  const seen = new Set<string>([OTHER_TYPE_ID]);
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const label = typeof e.label === "string" ? e.label.trim() : "";
    if (label === "") continue;
    let id = typeof e.id === "string" && e.id !== "" ? e.id : "";
    if (id === "" || seen.has(id)) id = newId();
    seen.add(id);
    out.push({ id, label });
  }
  return out;
}

/**
 * The configurable types for a hotel (excluding the built-in "other", which the
 * client appends). An ABSENT doc falls back to the defaults; an explicitly-saved
 * empty list is respected (leaving only "Jiné…").
 */
async function readTypes(hotel: HotelSlug): Promise<TerminalTypeItem[]> {
  const snap = await terminalTypesRef(hotel).get();
  if (!snap.exists) return [...DEFAULT_TERMINAL_TYPES];
  return sanitizeTypes((snap.data() as Record<string, unknown>).types);
}

interface ParsedEntry {
  date: string;
  amount: number;
  type: string;
  typeLabel: string;
  note: string;
}

/**
 * Validate + normalize a payment body against the CURRENT type catalogue. The
 * type must be the built-in `other` or a catalogue id; the label is snapshotted
 * server-side so a later rename/delete never rewrites this row. `settled` is
 * deliberately NOT parsed here — see the create/update handlers.
 */
function parseEntry(raw: unknown, types: TerminalTypeItem[]): ParsedEntry | { error: string } {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!isDateStr(b.date)) return { error: "Neplatné datum (YYYY-MM-DD)." };
  const amount = typeof b.amount === "number" && Number.isFinite(b.amount) ? b.amount : NaN;
  if (!Number.isFinite(amount)) return { error: "Neplatná částka." };
  const typeId = typeof b.type === "string" ? b.type : "";
  const isOther = typeId === OTHER_TYPE_ID;
  const item = types.find((t) => t.id === typeId);
  if (!isOther && !item) return { error: "Neplatný typ transakce." };
  const typeLabel = isOther ? OTHER_TYPE_LABEL : (item as TerminalTypeItem).label;
  // The note is optional for catalogue types, but MANDATORY for "Jiné…" — it is
  // the only record of what the payment actually was. Mirrors the taxi rule for
  // a ride booked off the ceník.
  const note = typeof b.note === "string" ? b.note.trim() : "";
  if (isOther && note === "") {
    return { error: "U typu „Jiné…“ je poznámka povinná." };
  }
  // Amount is CZK only — round to a whole number.
  return { date: b.date as string, amount: Math.round(amount), type: typeId, typeLabel, note };
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

// ── Configurable payment-type catalogue ───────────────────────────────────────
// Registered BEFORE `/:hotel/:id` so "types" isn't captured as an :id segment.

/** GET the payment-type catalogue (view — needed to fill the Typ dropdown). The
 *  built-in "Jiné…" is appended by the client, not stored here. */
terminalRouter.get(
  "/:hotel/types",
  requireAuth,
  requireTerminalPerm("view"),
  async (req: AuthRequest, res: Response) => {
    res.json({ types: await readTypes(req.params.hotel as HotelSlug) });
  }
);

/** PUT the payment-type catalogue (terminal.manage). */
terminalRouter.put(
  "/:hotel/types",
  requireAuth,
  requireTerminalPerm("manage"),
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const before = await readTypes(hotel);
    const types = sanitizeTypes((req.body as { types?: unknown }).types);
    await terminalTypesRef(hotel).set(
      { types, updatedBy: req.uid, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    await logUpdate(ctxFromReq(req), {
      collection: "terminalTypes",
      resourceId: "types",
      subResourceId: hotel,
      before: { count: before.length },
      after: { count: types.length },
    });
    res.json({ types });
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
    const parsed = parseEntry(req.body, await readTypes(hotel));
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
    const parsed = parseEntry(req.body, await readTypes(hotel));
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
