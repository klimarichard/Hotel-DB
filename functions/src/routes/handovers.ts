import { Router, Response, NextFunction } from "express";
import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { ctxFromReq, logCreate, logUpdate, logDelete } from "../services/auditLog";
import { isHotelSlug, HotelSlug, handoverViewPerm, handoverEditPerm } from "../services/hotels";
import {
  HandoverDoc,
  SignatureSlot,
  StampedSignature,
  isShiftDate,
  isShiftType,
  docId,
  handoverCol,
} from "../services/handoverShared";

export const handoversRouter = Router();

const db = () => admin.firestore();

// YYYY-MM-DD in Europe/Prague — guards against the client clock landing on the
// wrong day for late-shift handovers written just past midnight.
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

function sanitizeSmBreakdown(raw: unknown): { EUR: number; USD: number; GBP: number } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const cleanCount = (v: unknown): number => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return 0;
    return Math.floor(v);
  };
  return { EUR: cleanCount(r.EUR), USD: cleanCount(r.USD), GBP: cleanCount(r.GBP) };
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

const isAdmin = (req: AuthRequest): boolean => (req.permissions ?? new Set<string>()).has("system.admin");

/**
 * Dynamic per-hotel permission gate — the required key depends on the `:hotel`
 * URL param, so a static requirePermission() can't be used. `view` gates reads,
 * `edit` gates writes (basic version: the protokol.view key confers both; a
 * dedicated manage key for locked reverts etc. arrives in a later pass).
 * Assumes requireAuth ran first (req.permissions) and validateHotelParam
 * validated the slug.
 */
function requireHotelPerm(kind: "view" | "edit") {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const hotel = req.params.hotel as HotelSlug;
    const set = req.permissions ?? new Set<string>();
    const needed = kind === "view" ? handoverViewPerm(hotel) : handoverEditPerm(hotel);
    if (set.has("system.admin") || set.has(needed)) {
      next();
      return;
    }
    res.status(403).json({ error: "Nemáte oprávnění k tomuto hotelu." });
  };
}

/** A protocol is "closed" once both slots are signed — content then freezes (admin override only). */
function isClosed(doc: HandoverDoc | null): boolean {
  return !!(doc?.predal && doc?.prevzal);
}

async function resolveDisplayName(uid: string, fallbackEmail: string): Promise<string> {
  try {
    const userDoc = await db().collection("users").doc(uid).get();
    if (userDoc.exists) {
      const data = userDoc.data() as Record<string, unknown>;
      const employeeId = data.employeeId as string | undefined;
      if (employeeId) {
        const empDoc = await db().collection("employees").doc(employeeId).get();
        if (empDoc.exists) {
          const emp = empDoc.data() as Record<string, unknown>;
          const fn = (emp.firstName as string | undefined) ?? "";
          const ln = (emp.lastName as string | undefined) ?? "";
          const full = `${fn} ${ln}`.trim();
          if (full !== "") return full;
        }
      }
      const name = (data.name as string | undefined) ?? "";
      if (name.trim() !== "") return name;
      const display = (data.displayName as string | undefined) ?? "";
      if (display.trim() !== "") return display;
    }
  } catch {
    // never block a stamp on a missing user record
  }
  return fallbackEmail;
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
 * Body: { shiftDate, shiftType, notes, cashCounts, accounts, smBreakdown }.
 * predal/prevzal are NOT settable here — they go through the dedicated POST
 * endpoints so the server enforces credential verification. Closed protocols
 * (both slots signed) are frozen: content edits require admin.
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
      smBreakdown?: unknown;
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

    if (isClosed(before) && !isAdmin(req)) {
      res.status(403).json({ error: "Uzavřený protokol nelze upravit." });
      return;
    }

    const after = {
      shiftDate: body.shiftDate,
      shiftType: body.shiftType,
      notes: sanitizeNotes(body.notes),
      cashCounts: sanitizeCashCounts(body.cashCounts),
      accounts: sanitizeAccounts(body.accounts),
      smBreakdown: sanitizeSmBreakdown(body.smBreakdown),
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

    res.json({ id });
  }
);

/**
 * Předal/Převzal signing. The frontend verifies the signer's email+password on
 * a secondary Firebase app (without disturbing the active session) and posts
 * the resulting ID token; the server verifies it and stamps the slot. Basic
 * lock rules: a slot can't be re-signed while set (revert first, unless admin),
 * Převzal needs Předal first, and the two slots must be different people.
 */
function stampHandler(slot: SignatureSlot) {
  const otherSlot: SignatureSlot = slot === "predal" ? "prevzal" : "predal";
  return async (req: AuthRequest, res: Response): Promise<void> => {
    const hotel = req.params.hotel as HotelSlug;
    const id = req.params.id;
    const body = req.body as { idToken?: unknown };
    if (typeof body.idToken !== "string" || body.idToken.trim() === "") {
      res.status(400).json({ error: "Chybí ID token." });
      return;
    }

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(body.idToken);
    } catch {
      res.status(401).json({ error: "Neplatné nebo prošlé heslo." });
      return;
    }

    const ref = handoverCol(hotel).doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Předání nenalezeno." });
      return;
    }
    const before = snap.data() as HandoverDoc;

    if (isClosed(before) && !isAdmin(req)) {
      res.status(403).json({ error: "Uzavřený protokol nelze měnit." });
      return;
    }
    if (before[slot] && !isAdmin(req)) {
      res.status(400).json({ error: "Tento podpis už existuje. Nejprve jej odeberte." });
      return;
    }
    if (slot === "prevzal" && !before.predal) {
      res.status(400).json({ error: "Protokol musí být nejprve označen jako Předal." });
      return;
    }

    const otherStamp = before[otherSlot] as StampedSignature | null | undefined;
    if (otherStamp && otherStamp.uid === decoded.uid) {
      res.status(400).json({ error: "Předal a převzal musí být dva různí uživatelé." });
      return;
    }

    const stamp: StampedSignature = {
      uid: decoded.uid,
      displayName: await resolveDisplayName(decoded.uid, decoded.email ?? ""),
      email: decoded.email ?? "",
      at: Timestamp.now(),
    };

    await ref.set(
      { [slot]: stamp, updatedBy: req.uid, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );

    await logUpdate(ctxFromReq(req), {
      collection: "shiftHandovers",
      resourceId: id,
      subResourceId: hotel,
      before: { [slot]: before[slot] ?? null },
      after: { [slot]: stamp },
    });

    res.json({ ok: true, [slot]: stamp });
  };
}

handoversRouter.post("/:hotel/:id/predal", requireAuth, requireHotelPerm("edit"), stampHandler("predal"));
handoversRouter.post("/:hotel/:id/prevzal", requireAuth, requireHotelPerm("edit"), stampHandler("prevzal"));

/**
 * Revert a signature. Allowed for the signer themselves or an admin. Předal
 * can't be reverted while Převzal is still set (would orphan it) — admin only.
 */
function revertHandler(slot: SignatureSlot) {
  return async (req: AuthRequest, res: Response): Promise<void> => {
    const hotel = req.params.hotel as HotelSlug;
    const id = req.params.id;
    const ref = handoverCol(hotel).doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Předání nenalezeno." });
      return;
    }
    const before = snap.data() as HandoverDoc;
    const stamp = before[slot];
    if (!stamp) {
      res.status(404).json({ error: "Tento podpis nebyl nalezen." });
      return;
    }
    if (stamp.uid !== req.uid && !isAdmin(req)) {
      res.status(403).json({ error: "Nelze odebrat cizí podpis." });
      return;
    }
    if (slot === "predal" && before.prevzal && !isAdmin(req)) {
      res.status(400).json({ error: "Nejprve odeberte podpis Převzal." });
      return;
    }

    await ref.set(
      { [slot]: null, updatedBy: req.uid, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );

    await logUpdate(ctxFromReq(req), {
      collection: "shiftHandovers",
      resourceId: id,
      subResourceId: hotel,
      before: { [slot]: stamp },
      after: { [slot]: null },
    });

    res.json({ ok: true });
  };
}

handoversRouter.delete("/:hotel/:id/predal", requireAuth, requireHotelPerm("edit"), revertHandler("predal"));
handoversRouter.delete("/:hotel/:id/prevzal", requireAuth, requireHotelPerm("edit"), revertHandler("prevzal"));

/**
 * DELETE /api/handovers/:hotel/:id
 * Whole-record delete — admin only (receptionists and managers can't wipe a
 * handover). Still requires the per-hotel view perm to reach the route.
 */
handoversRouter.delete(
  "/:hotel/:id",
  requireAuth,
  requireHotelPerm("view"),
  async (req: AuthRequest, res: Response) => {
    if (!isAdmin(req)) {
      res.status(403).json({ error: "Smazat protokol může jen administrátor." });
      return;
    }
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
