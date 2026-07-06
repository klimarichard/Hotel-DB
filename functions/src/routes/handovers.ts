import { Router, Response, NextFunction } from "express";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { ctxFromReq, logCreate, logUpdate, logDelete } from "../services/auditLog";
import {
  isHotelSlug,
  HotelSlug,
  handoverViewPerm,
  handoverEditPerm,
  handoverDeletePerm,
} from "../services/hotels";
import {
  HandoverDoc,
  isShiftDate,
  isShiftType,
  docId,
  handoverCol,
} from "../services/handoverShared";

export const handoversRouter = Router();

// YYYY-MM-DD in Europe/Prague — guards against the client clock landing on the
// wrong day for late-shift records written just past midnight.
function todayPrague(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Prague" }).format(new Date());
}

const CZK_DENOMS = ["5000", "2000", "1000", "500", "200", "100", "50", "20", "10", "5", "2", "1"] as const;
const EUR_DENOMS = ["500", "200", "100", "50", "20", "10", "5", "2", "1"] as const;
type DrawerKey = "kasaCZK" | "trezorCZK" | "kasaEUR" | "trezorEUR";

function sanitizeDenomMap(raw: unknown, allowed: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const denom of allowed) {
    const v = (raw as Record<string, unknown>)[denom];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) continue;
    const n = Math.floor(v);
    if (n === 0) continue;
    out[denom] = n;
  }
  return out;
}

function sanitizeCashCounts(raw: unknown): Record<DrawerKey, Record<string, number>> {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    kasaCZK: sanitizeDenomMap(r.kasaCZK, CZK_DENOMS),
    trezorCZK: sanitizeDenomMap(r.trezorCZK, CZK_DENOMS),
    kasaEUR: sanitizeDenomMap(r.kasaEUR, EUR_DENOMS),
    trezorEUR: sanitizeDenomMap(r.trezorEUR, EUR_DENOMS),
  };
}

function sanitizeNotes(raw: unknown): Array<{ text: string; done: boolean }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ text: string; done: boolean }> = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const text = (entry as { text?: unknown }).text;
    if (typeof text !== "string") continue;
    const done = (entry as { done?: unknown }).done === true;
    out.push({ text, done });
  }
  return out;
}

function sanitizeAccounts(raw: unknown): Array<{ name: string; amount: number }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ name: string; amount: number }> = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const name = (entry as { name?: unknown }).name;
    const amount = (entry as { amount?: unknown }).amount;
    if (typeof name !== "string" || name.trim() === "") continue;
    if (typeof amount !== "number" || !Number.isFinite(amount)) continue;
    out.push({ name: name.trim(), amount: Math.round(amount) });
  }
  return out;
}

/** Validates the :hotel URL segment. Rejects unknown slugs with 404. */
function validateHotelParam(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!isHotelSlug(req.params.hotel)) {
    res.status(404).json({ error: "Neznámý hotel." });
    return;
  }
  next();
}

/**
 * Dynamic per-hotel permission gate — the required key depends on the `:hotel`
 * URL param, so a static requirePermission() can't be used. `view` gates reads,
 * `edit` gates create/update (the protokol.view key confers both), `delete`
 * gates removal (its own recepce.<stem>.protokol.delete key). Assumes requireAuth
 * ran first (req.permissions) and validateHotelParam validated the slug.
 */
function requireHotelPerm(kind: "view" | "edit" | "delete") {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const hotel = req.params.hotel as HotelSlug;
    const set = req.permissions ?? new Set<string>();
    const needed =
      kind === "view"
        ? handoverViewPerm(hotel)
        : kind === "edit"
          ? handoverEditPerm(hotel)
          : handoverDeletePerm(hotel);
    if (set.has("system.admin") || set.has(needed)) {
      next();
      return;
    }
    res.status(403).json({ error: "Nemáte oprávnění k této akci." });
  };
}

handoversRouter.use("/:hotel", validateHotelParam);

/**
 * GET /api/handovers/:hotel?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Defaults to the trailing 14 days ending today (Europe/Prague).
 */
handoversRouter.get(
  "/:hotel",
  requireAuth,
  requireHotelPerm("view"),
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const today = todayPrague();
    const to = isShiftDate(req.query.to) ? (req.query.to as string) : today;
    let from: string;
    if (isShiftDate(req.query.from)) {
      from = req.query.from as string;
    } else {
      const d = new Date(`${to}T00:00:00`);
      d.setDate(d.getDate() - 13);
      from = new Intl.DateTimeFormat("sv-SE").format(d);
    }

    const snap = await handoverCol(hotel)
      .where("shiftDate", ">=", from)
      .where("shiftDate", "<=", to)
      .orderBy("shiftDate", "desc")
      .get();

    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }
);

/** GET /api/handovers/:hotel/:id */
handoversRouter.get(
  "/:hotel/:id",
  requireAuth,
  requireHotelPerm("view"),
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const doc = await handoverCol(hotel).doc(req.params.id).get();
    if (!doc.exists) {
      res.status(404).json({ error: "Předání nenalezeno." });
      return;
    }
    res.json({ id: doc.id, ...doc.data() });
  }
);

/**
 * PUT /api/handovers/:hotel
 * Body: { shiftDate, shiftType, notes, cashCounts, accounts }. Creates the doc
 * on first write, merges on subsequent writes. RETURNS THE FULL DOCUMENT so the
 * client never needs a read-back GET (that read-after-write round-trip was racy
 * on the hosting→function path).
 */
handoversRouter.put(
  "/:hotel",
  requireAuth,
  requireHotelPerm("edit"),
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const body = req.body as {
      shiftDate?: unknown;
      shiftType?: unknown;
      notes?: unknown;
      cashCounts?: unknown;
      accounts?: unknown;
    };

    if (!isShiftDate(body.shiftDate)) {
      res.status(400).json({ error: "Neplatné datum směny (formát YYYY-MM-DD)." });
      return;
    }
    if (!isShiftType(body.shiftType)) {
      res.status(400).json({ error: "Neplatný typ směny (den|noc)." });
      return;
    }

    const id = docId(body.shiftDate, body.shiftType);
    const ref = handoverCol(hotel).doc(id);
    const beforeSnap = await ref.get();
    const before = beforeSnap.exists ? (beforeSnap.data() as HandoverDoc) : null;

    const after = {
      shiftDate: body.shiftDate,
      shiftType: body.shiftType,
      notes: sanitizeNotes(body.notes),
      cashCounts: sanitizeCashCounts(body.cashCounts),
      accounts: sanitizeAccounts(body.accounts),
      updatedBy: req.uid,
    };

    if (!beforeSnap.exists) {
      await ref.set({
        ...after,
        createdBy: req.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await logCreate(ctxFromReq(req), {
        collection: "shiftHandovers",
        resourceId: id,
        subResourceId: hotel,
        summary: { shiftDate: body.shiftDate, shiftType: body.shiftType, authorUid: req.uid },
      });
    } else {
      await ref.set({ ...after, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await logUpdate(ctxFromReq(req), {
        collection: "shiftHandovers",
        resourceId: id,
        subResourceId: hotel,
        before: (before as unknown as Record<string, unknown>) ?? undefined,
        after: { ...((before as unknown as Record<string, unknown>) ?? {}), ...after },
      });
    }

    // Return the persisted document (read-back in the SAME invocation is reliable,
    // unlike a separate client GET) so the client can update its state directly.
    const saved = await ref.get();
    res.json({ id, ...saved.data() });
  }
);

/**
 * DELETE /api/handovers/:hotel/:id
 * Gated by the per-hotel recepce.<stem>.protokol.delete permission.
 */
handoversRouter.delete(
  "/:hotel/:id",
  requireAuth,
  requireHotelPerm("delete"),
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const ref = handoverCol(hotel).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Předání nenalezeno." });
      return;
    }
    const data = snap.data() as Record<string, unknown>;
    await ref.delete();

    await logDelete(ctxFromReq(req), {
      collection: "shiftHandovers",
      resourceId: req.params.id,
      subResourceId: hotel,
      summary: { shiftDate: data.shiftDate, shiftType: data.shiftType },
    });

    res.json({ ok: true });
  }
);
