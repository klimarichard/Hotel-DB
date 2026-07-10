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

/** The fields a sale shares with its siblings when several are added at once. */
interface SaleHeader {
  date: string;
  currency: Currency;
  employeeId: string;
  employeeName: string;
}

/** Upper bound on lines in one batch — well under Firestore's 500-op WriteBatch limit. */
const MAX_BATCH_LINES = 50;

/** Validate the date / currency / employee shared by every row of a sale. */
function parseHeader(b: Record<string, unknown>): SaleHeader | { error: string } {
  if (!isDateStr(b.date)) return { error: "Neplatné datum (YYYY-MM-DD)." };
  if (!isCurrency(b.currency)) return { error: "Neplatná měna." };
  const employeeId = typeof b.employeeId === "string" ? b.employeeId.trim() : "";
  if (employeeId === "") return { error: "Vyberte zaměstnance." };
  return {
    date: b.date as string,
    currency: b.currency,
    employeeId,
    employeeName: typeof b.employeeName === "string" ? b.employeeName.trim() : "",
  };
}

/**
 * Resolve one { itemId, quantity } line against the CURRENT catalogue. The item
 * name and every money field are computed/snapshotted server-side here —
 * client-sent money is never trusted.
 */
function parseLine(raw: unknown, header: SaleHeader, cfg: LobbyBarConfig): ParsedSale | { error: string } {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const itemId = typeof b.itemId === "string" ? b.itemId.trim() : "";
  const item = cfg.items.find((i) => i.id === itemId);
  if (!item) return { error: "Neznámá položka." };
  const quantity =
    typeof b.quantity === "number" && Number.isInteger(b.quantity) && b.quantity >= 1 ? b.quantity : NaN;
  if (!Number.isFinite(quantity)) return { error: "Neplatný počet." };
  return {
    ...header,
    itemId: item.id,
    itemName: item.name,
    quantity,
    ...computeSale(item, quantity, header.currency, cfg),
  };
}

/** Validate + normalize a single-sale body (POST / PUT of one row). */
function parseSale(raw: unknown, cfg: LobbyBarConfig): ParsedSale | { error: string } {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const header = parseHeader(b);
  if ("error" in header) return header;
  return parseLine(b, header, cfg);
}

/**
 * Validate + normalize a multi-line sale body: one shared header plus N
 * { itemId, quantity } lines. Every line is resolved BEFORE anything is written,
 * so a bad line aborts the whole batch instead of half-saving it.
 */
function parseSaleBatch(raw: unknown, cfg: LobbyBarConfig): ParsedSale[] | { error: string } {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const header = parseHeader(b);
  if ("error" in header) return header;
  if (!Array.isArray(b.lines) || b.lines.length === 0) return { error: "Přidejte alespoň jednu položku." };
  if (b.lines.length > MAX_BATCH_LINES) return { error: `Najednou lze uložit nejvýše ${MAX_BATCH_LINES} položek.` };
  const out: ParsedSale[] = [];
  for (const line of b.lines) {
    const parsed = parseLine(line, header, cfg);
    if ("error" in parsed) return parsed;
    out.push(parsed);
  }
  return out;
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

/**
 * POST /api/lobby-bar/:hotel/batch — add several sales in one go (lobbyBar.view).
 *
 * The body is one shared header (date, currency, employee) plus `lines`
 * [{ itemId, quantity }]. Each line becomes its own sale document, exactly as if
 * it had been added one at a time, so the table, totals and per-row edit/delete
 * are unchanged. Every line is validated first and the writes go out in a single
 * WriteBatch: either all rows land or none do — a receptionist never has to
 * guess which half of a round got saved.
 */
lobbyBarRouter.post(
  "/:hotel/batch",
  requireAuth,
  requireLobbyBarPerm("view"),
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const parsed = parseSaleBatch(req.body, await readConfig(hotel));
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    if (!isManage(req, hotel) && !inRange(parsed[0].date, await readRange(hotel))) {
      res.status(403).json({ error: "Datum je mimo povolené období." });
      return;
    }

    const batch = db().batch();
    const refs = parsed.map((sale) => {
      const ref = lobbyBarCol(hotel).doc();
      batch.set(ref, {
        ...sale,
        createdBy: req.uid,
        updatedBy: req.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return ref;
    });
    await batch.commit();

    // One audit entry per row, matching the single-sale POST: each row is
    // independently editable/deletable later, so each needs its own resourceId.
    const ctx = actorCtx(await resolveOnDutyActor(req, hotel));
    await Promise.all(
      refs.map((ref, i) =>
        logCreate(ctx, {
          collection: "lobbyBarSales",
          resourceId: ref.id,
          subResourceId: hotel,
          summary: {
            date: parsed[i].date,
            itemName: parsed[i].itemName,
            quantity: parsed[i].quantity,
            currency: parsed[i].currency,
            price: parsed[i].price,
          },
        })
      )
    );

    const saved = await Promise.all(refs.map((r) => r.get()));
    res.json(saved.map((s) => ({ id: s.id, ...s.data() })));
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
