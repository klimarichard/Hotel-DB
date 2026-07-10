import { Router, Response, NextFunction } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { ctxFromReq, logCreate, logUpdate, logDelete } from "../services/auditLog";
import { actorCtx, resolveOnDutyActor } from "../services/recepceActor";
import { isHotelSlug, HotelSlug, lobbyBarViewPerm, lobbyBarManagePerm } from "../services/hotels";
import { listRecepceEmployees, todayPrague } from "../services/recepceEmployees";
import {
  LobbyBarConfig,
  LobbyBarItem,
  LobbyBarRange,
  LobbyBarSale,
  Currency,
  DEFAULT_PROVISION_CZK,
  DEFAULT_PROVISION_EUR,
  isCurrency,
  isDateStr,
  computeSale,
  lobbyBarCol,
  lobbyBarRangeRef,
  lobbyBarItemsRef,
  inRange,
} from "../services/lobbyBarShared";

const db = () => admin.firestore();

export const lobbyBarRouter = Router();

/** A fresh Firestore auto-id (no write), used for stable item ids. */
function newId(): string {
  return db().collection("_ids").doc().id;
}

/** Validates the :hotel URL segment. Rejects unknown slugs with 404. */
function validateHotelParam(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!isHotelSlug(req.params.hotel)) {
    res.status(404).json({ error: "Neznámý hotel." });
    return;
  }
  next();
}

/** Dynamic per-hotel gate: `view` for reads + sale writes, `manage` for the
 *  range + catalogue. `manage` implies `view`, so a manager is never locked
 *  out of reads. system.admin always passes. */
function requireLobbyBarPerm(kind: "view" | "manage") {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const hotel = req.params.hotel as HotelSlug;
    const set = req.permissions ?? new Set<string>();
    const ok =
      set.has("system.admin") ||
      set.has(lobbyBarManagePerm(hotel)) ||
      (kind === "view" && set.has(lobbyBarViewPerm(hotel)));
    if (ok) {
      next();
      return;
    }
    res.status(403).json({ error: "Nemáte oprávnění k této akci." });
  };
}

/** Manage users see all sales + add/edit any date; others are range-bound. */
function isManage(req: AuthRequest, hotel: HotelSlug): boolean {
  const set = req.permissions ?? new Set<string>();
  return set.has("system.admin") || set.has(lobbyBarManagePerm(hotel));
}

lobbyBarRouter.use("/:hotel", validateHotelParam);

async function readRange(hotel: HotelSlug): Promise<LobbyBarRange> {
  const snap = await lobbyBarRangeRef(hotel).get();
  if (!snap.exists) return { from: null, to: null };
  const d = snap.data() as Record<string, unknown>;
  return {
    from: isDateStr(d.from) ? (d.from as string) : null,
    to: isDateStr(d.to) ? (d.to as string) : null,
  };
}

/** Clamp a value to a finite number >= 0, falling back to `fallback`. */
function clampRate(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;
}

/**
 * Sanitize the item catalogue like taxi's sanitizeRoutes: trim names, drop
 * empty-name rows, clamp both prices to finite >= 0 (else 0), assign a fresh
 * id when missing/duplicate, and preserve the array order.
 */
function sanitizeItems(raw: unknown): LobbyBarItem[] {
  if (!Array.isArray(raw)) return [];
  const out: LobbyBarItem[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const name = typeof e.name === "string" ? e.name.trim() : "";
    if (name === "") continue;
    const priceCZK =
      typeof e.priceCZK === "number" && Number.isFinite(e.priceCZK) && e.priceCZK >= 0 ? e.priceCZK : 0;
    const priceEUR =
      typeof e.priceEUR === "number" && Number.isFinite(e.priceEUR) && e.priceEUR >= 0 ? e.priceEUR : 0;
    let id = typeof e.id === "string" && e.id !== "" ? e.id : "";
    if (id === "" || seen.has(id)) id = newId();
    seen.add(id);
    out.push({ id, name, priceCZK, priceEUR });
  }
  return out;
}

/** Read the catalogue + provision rates, applying defaults when the doc is absent. */
async function readConfig(hotel: HotelSlug): Promise<LobbyBarConfig> {
  const snap = await lobbyBarItemsRef(hotel).get();
  if (!snap.exists) {
    return { items: [], provisionCZK: DEFAULT_PROVISION_CZK, provisionEUR: DEFAULT_PROVISION_EUR };
  }
  const d = snap.data() as Record<string, unknown>;
  return {
    items: sanitizeItems(d.items),
    provisionCZK: clampRate(d.provisionCZK, DEFAULT_PROVISION_CZK),
    provisionEUR: clampRate(d.provisionEUR, DEFAULT_PROVISION_EUR),
  };
}

interface ParsedSale {
  date: string;
  itemId: string;
  itemName: string;
  quantity: number;
  currency: Currency;
  employeeId: string;
  employeeName: string;
  unitPrice: number;
  price: number;
  provision: number;
  doSpolecne: number;
}

/**
 * Validate + normalize a sale body against the CURRENT catalogue. The item name
 * and every money field are computed/snapshotted server-side here — client-sent
 * money is never trusted. Returns { error } on the first problem.
 */
function parseSale(raw: unknown, cfg: LobbyBarConfig): ParsedSale | { error: string } {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!isDateStr(b.date)) return { error: "Neplatné datum (YYYY-MM-DD)." };
  const itemId = typeof b.itemId === "string" ? b.itemId.trim() : "";
  const item = cfg.items.find((i) => i.id === itemId);
  if (!item) return { error: "Neznámá položka." };
  const quantity =
    typeof b.quantity === "number" && Number.isInteger(b.quantity) && b.quantity >= 1 ? b.quantity : NaN;
  if (!Number.isFinite(quantity)) return { error: "Neplatný počet." };
  if (!isCurrency(b.currency)) return { error: "Neplatná měna." };
  const employeeId = typeof b.employeeId === "string" ? b.employeeId.trim() : "";
  if (employeeId === "") return { error: "Vyberte zaměstnance." };
  const employeeName = typeof b.employeeName === "string" ? b.employeeName.trim() : "";

  const money = computeSale(item, quantity, b.currency, cfg);
  return {
    date: b.date as string,
    itemId: item.id,
    itemName: item.name,
    quantity,
    currency: b.currency,
    employeeId,
    employeeName,
    ...money,
  };
}

// ── Sub-resource routes registered BEFORE `/:hotel/:id` so the fixed segments
//    ("employees", "range", "items") aren't swallowed by the :id param. ─────────

/** GET the "who sold this" employee dropdown for the entry's month. */
lobbyBarRouter.get(
  "/:hotel/employees",
  requireAuth,
  requireLobbyBarPerm("view"),
  async (req: AuthRequest, res: Response) => {
    res.json(await listRecepceEmployees(isDateStr(req.query.date) ? (req.query.date as string) : todayPrague()));
  }
);

/** GET the visible range (any view user needs it to bound their own add form). */
lobbyBarRouter.get(
  "/:hotel/range",
  requireAuth,
  requireLobbyBarPerm("view"),
  async (req: AuthRequest, res: Response) => {
    res.json(await readRange(req.params.hotel as HotelSlug));
  }
);

/** PUT the visible range (lobbyBar.manage). */
lobbyBarRouter.put(
  "/:hotel/range",
  requireAuth,
  requireLobbyBarPerm("manage"),
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
    await lobbyBarRangeRef(hotel).set(
      { from, to, updatedBy: req.uid, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    await logUpdate(ctxFromReq(req), {
      collection: "lobbyBarConfig",
      resourceId: "range",
      subResourceId: hotel,
      before: before as unknown as Record<string, unknown>,
      after: { from, to },
    });
    res.json({ from, to });
  }
);

/** GET the item catalogue + provision rates (view — needed to fill the sale form). */
lobbyBarRouter.get(
  "/:hotel/items",
  requireAuth,
  requireLobbyBarPerm("view"),
  async (req: AuthRequest, res: Response) => {
    const cfg = await readConfig(req.params.hotel as HotelSlug);
    res.json({ items: cfg.items, provisionCZK: cfg.provisionCZK, provisionEUR: cfg.provisionEUR });
  }
);

/** PUT the item catalogue + provision rates (lobbyBar.manage). */
lobbyBarRouter.put(
  "/:hotel/items",
  requireAuth,
  requireLobbyBarPerm("manage"),
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const before = await readConfig(hotel);
    const b = req.body as { items?: unknown; provisionCZK?: unknown; provisionEUR?: unknown };
    const items = sanitizeItems(b.items);
    const provisionCZK = clampRate(b.provisionCZK, DEFAULT_PROVISION_CZK);
    const provisionEUR = clampRate(b.provisionEUR, DEFAULT_PROVISION_EUR);
    await lobbyBarItemsRef(hotel).set(
      { items, provisionCZK, provisionEUR, updatedBy: req.uid, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    await logUpdate(ctxFromReq(req), {
      collection: "lobbyBarItems",
      resourceId: "items",
      subResourceId: hotel,
      before: { count: before.items.length, provisionCZK: before.provisionCZK, provisionEUR: before.provisionEUR },
      after: { count: items.length, provisionCZK, provisionEUR },
    });
    res.json({ items, provisionCZK, provisionEUR });
  }
);

/**
 * GET /api/lobby-bar/:hotel — the continuous list, newest first. Managers see
 * all; everyone else is bounded by the visible range, applied IN-APP so that a
 * one-sided range (only `from` or only `to`) gates just that one side (single
 * `date` orderBy, so no composite index is needed).
 */
lobbyBarRouter.get(
  "/:hotel",
  requireAuth,
  requireLobbyBarPerm("view"),
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const snap = await lobbyBarCol(hotel).orderBy("date", "desc").get();
    let rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as LobbyBarSale) }));
    if (!isManage(req, hotel)) {
      const range = await readRange(hotel);
      rows = rows.filter((r) => inRange(r.date, range));
    }
    res.json(rows);
  }
);

/** POST a new sale (lobbyBar.view). Non-managers: date must be in the range. */
lobbyBarRouter.post(
  "/:hotel",
  requireAuth,
  requireLobbyBarPerm("view"),
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const parsed = parseSale(req.body, await readConfig(hotel));
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    if (!isManage(req, hotel) && !inRange(parsed.date, await readRange(hotel))) {
      res.status(403).json({ error: "Datum je mimo povolené období." });
      return;
    }
    const ref = await lobbyBarCol(hotel).add({
      ...parsed,
      createdBy: req.uid,
      updatedBy: req.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const saved = await ref.get();
    // Reception writes are attributed to the person on shift (last "Převzal"),
    // not the shared terminal account that may be logged in.
    await logCreate(actorCtx(await resolveOnDutyActor(req, hotel)), {
      collection: "lobbyBarSales",
      resourceId: ref.id,
      subResourceId: hotel,
      summary: { date: parsed.date, itemName: parsed.itemName, quantity: parsed.quantity, currency: parsed.currency, price: parsed.price },
    });
    res.json({ id: ref.id, ...saved.data() });
  }
);

/** PUT a sale (lobbyBar.view). Non-managers: both old + new date must be in range. */
lobbyBarRouter.put(
  "/:hotel/:id",
  requireAuth,
  requireLobbyBarPerm("view"),
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const ref = lobbyBarCol(hotel).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Prodej nenalezen." });
      return;
    }
    const before = snap.data() as LobbyBarSale;
    const parsed = parseSale(req.body, await readConfig(hotel));
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
    await ref.set({ ...parsed, updatedBy: req.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    const saved = await ref.get();
    await logUpdate(actorCtx(await resolveOnDutyActor(req, hotel)), {
      collection: "lobbyBarSales",
      resourceId: ref.id,
      subResourceId: hotel,
      before: before as unknown as Record<string, unknown>,
      after: { ...(before as unknown as Record<string, unknown>), ...parsed },
    });
    res.json({ id: ref.id, ...saved.data() });
  }
);

/** DELETE a sale (lobbyBar.view). Non-managers: sale's date must be in range. */
lobbyBarRouter.delete(
  "/:hotel/:id",
  requireAuth,
  requireLobbyBarPerm("view"),
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const ref = lobbyBarCol(hotel).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Prodej nenalezen." });
      return;
    }
    const before = snap.data() as LobbyBarSale;
    if (!isManage(req, hotel) && !inRange(before.date, await readRange(hotel))) {
      res.status(403).json({ error: "Datum je mimo povolené období." });
      return;
    }
    await ref.delete();
    await logDelete(actorCtx(await resolveOnDutyActor(req, hotel)), {
      collection: "lobbyBarSales",
      resourceId: req.params.id,
      subResourceId: hotel,
      summary: { date: before.date, itemName: before.itemName, quantity: before.quantity, currency: before.currency, price: before.price },
    });
    res.json({ ok: true });
  }
);
