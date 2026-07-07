import { Router, Response, NextFunction } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { ctxFromReq, logCreate, logUpdate, logDelete } from "../services/auditLog";
import {
  isHotelSlug,
  HotelSlug,
  taxiViewPerm,
  taxiManagePerm,
  TAXI_MANAGE_RATES_PERM,
} from "../services/hotels";
import {
  TaxiRideDoc,
  TaxiRoute,
  TaxiRange,
  isDateStr,
  taxiRideCol,
  taxiRangeRef,
  taxiRoutesRef,
  inRange,
} from "../services/taxiShared";

const db = () => admin.firestore();

export const taxiRouter = Router();

/** A fresh Firestore auto-id (no write), used for stable route ids. */
function newId(): string {
  return db().collection("_ids").doc().id;
}

function validateHotelParam(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!isHotelSlug(req.params.hotel)) {
    res.status(404).json({ error: "Neznámý hotel." });
    return;
  }
  next();
}

/** Static-permission gate (system.admin always passes). For the global routes. */
function requirePerm(perm: string) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const set = req.permissions ?? new Set<string>();
    if (set.has("system.admin") || set.has(perm)) {
      next();
      return;
    }
    res.status(403).json({ error: "Nemáte oprávnění k této akci." });
  };
}

/** Per-hotel gate: `view` for reads + ride writes, `manage` for the range.
 *  `manage` implies `view`. */
function requireTaxiPerm(kind: "view" | "manage") {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const hotel = req.params.hotel as HotelSlug;
    const set = req.permissions ?? new Set<string>();
    const ok =
      set.has("system.admin") ||
      set.has(taxiManagePerm(hotel)) ||
      (kind === "view" && set.has(taxiViewPerm(hotel)));
    if (ok) {
      next();
      return;
    }
    res.status(403).json({ error: "Nemáte oprávnění k této akci." });
  };
}

function isManage(req: AuthRequest, hotel: HotelSlug): boolean {
  const set = req.permissions ?? new Set<string>();
  return set.has("system.admin") || set.has(taxiManagePerm(hotel));
}

// ── Global routes (settings/taxiRoutes) ───────────────────────────────────────
function sanitizeRoutes(raw: unknown): TaxiRoute[] {
  if (!Array.isArray(raw)) return [];
  const out: TaxiRoute[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const name = typeof e.name === "string" ? e.name.trim() : "";
    if (name === "") continue;
    const price = typeof e.price === "number" && Number.isFinite(e.price) && e.price >= 0 ? e.price : 0;
    const provision =
      typeof e.provision === "number" && Number.isFinite(e.provision) && e.provision >= 0 ? e.provision : 0;
    const roundtrip = e.roundtrip === true;
    let id = typeof e.id === "string" && e.id !== "" ? e.id : "";
    if (id === "" || seen.has(id)) id = newId();
    seen.add(id);
    out.push({ id, name, price, provision, roundtrip });
  }
  return out;
}

async function readRoutes(): Promise<TaxiRoute[]> {
  const snap = await taxiRoutesRef().get();
  if (!snap.exists) return [];
  return sanitizeRoutes((snap.data() as { routes?: unknown }).routes);
}

// GET is readable by anyone in the Recepce area (needed to fill the ride form);
// PUT is gated on the global recepce.taxi.manageRates key. Registered BEFORE the
// `/:hotel` middleware so "routes" isn't validated as a hotel slug.
taxiRouter.get(
  "/routes",
  requireAuth,
  requirePerm("nav.recepce.view"),
  async (_req: AuthRequest, res: Response) => {
    res.json({ routes: await readRoutes() });
  }
);

taxiRouter.put(
  "/routes",
  requireAuth,
  requirePerm(TAXI_MANAGE_RATES_PERM),
  async (req: AuthRequest, res: Response) => {
    const before = await readRoutes();
    const routes = sanitizeRoutes((req.body as { routes?: unknown }).routes);
    await taxiRoutesRef().set(
      { routes, updatedBy: req.uid, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    await logUpdate(ctxFromReq(req), {
      collection: "taxiRoutes",
      resourceId: "taxiRoutes",
      before: { count: before.length },
      after: { count: routes.length },
    });
    res.json({ routes });
  }
);

taxiRouter.use("/:hotel", validateHotelParam);

async function readRange(hotel: HotelSlug): Promise<TaxiRange> {
  const snap = await taxiRangeRef(hotel).get();
  if (!snap.exists) return { from: null, to: null };
  const d = snap.data() as Record<string, unknown>;
  return {
    from: isDateStr(d.from) ? (d.from as string) : null,
    to: isDateStr(d.to) ? (d.to as string) : null,
  };
}

// ── Per-hotel visible range ───────────────────────────────────────────────────
taxiRouter.get(
  "/:hotel/range",
  requireAuth,
  requireTaxiPerm("view"),
  async (req: AuthRequest, res: Response) => {
    res.json(await readRange(req.params.hotel as HotelSlug));
  }
);

taxiRouter.put(
  "/:hotel/range",
  requireAuth,
  requireTaxiPerm("manage"),
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
    await taxiRangeRef(hotel).set(
      { from, to, updatedBy: req.uid, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    await logUpdate(ctxFromReq(req), {
      collection: "taxiConfig",
      resourceId: "range",
      subResourceId: hotel,
      before: before as unknown as Record<string, unknown>,
      after: { from, to },
    });
    res.json({ from, to });
  }
);

// ── Rides ─────────────────────────────────────────────────────────────────────
interface ParsedRide {
  date: string;
  time: string;
  room: string;
  pax: number | null;
  routeName: string;
  amount: number;
  provision: number;
  note: string;
}

/**
 * Validate + normalize a ride body against the global routes. For a common route
 * (routeId found) the name/amount/provision are snapshotted from the route and
 * the time is required unless the route is a roundtrip. For "Other" (no routeId)
 * the amount and note are required and entered by the client.
 */
function parseRide(raw: unknown, routes: TaxiRoute[]): ParsedRide | { error: string } {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!isDateStr(b.date)) return { error: "Neplatné datum (YYYY-MM-DD)." };
  const time = typeof b.time === "string" ? b.time.trim() : "";
  const room = typeof b.room === "string" ? b.room.trim() : "";
  let pax: number | null = null;
  if (typeof b.pax === "number" && Number.isFinite(b.pax) && b.pax >= 0) pax = Math.floor(b.pax);
  const note = typeof b.note === "string" ? b.note.trim() : "";
  const routeId = typeof b.routeId === "string" ? b.routeId : "";

  if (routeId !== "") {
    const route = routes.find((r) => r.id === routeId);
    if (!route) return { error: "Neznámá trasa." };
    if (!route.roundtrip && time === "") return { error: "Zadejte čas." };
    return { date: b.date as string, time, room, pax, routeName: route.name, amount: route.price, provision: route.provision, note };
  }

  // Other (custom) ride.
  const amount = typeof b.amount === "number" && Number.isFinite(b.amount) ? b.amount : NaN;
  if (!Number.isFinite(amount)) return { error: "Zadejte částku." };
  const provision = typeof b.provision === "number" && Number.isFinite(b.provision) ? b.provision : 0;
  if (note === "") return { error: "U vlastní trasy je poznámka povinná." };
  if (time === "") return { error: "Zadejte čas." };
  return { date: b.date as string, time, room, pax, routeName: "", amount, provision, note };
}

taxiRouter.get(
  "/:hotel",
  requireAuth,
  requireTaxiPerm("view"),
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const range = isManage(req, hotel) ? { from: null, to: null } : await readRange(hotel);

    let q: admin.firestore.Query = taxiRideCol(hotel);
    if (range.from) q = q.where("date", ">=", range.from);
    if (range.to) q = q.where("date", "<=", range.to);
    q = q.orderBy("date", "desc");

    const snap = await q.get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }
);

taxiRouter.post(
  "/:hotel",
  requireAuth,
  requireTaxiPerm("view"),
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const parsed = parseRide(req.body, await readRoutes());
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    if (!isManage(req, hotel) && !inRange(parsed.date, await readRange(hotel))) {
      res.status(403).json({ error: "Datum je mimo povolené období." });
      return;
    }
    const ref = await taxiRideCol(hotel).add({
      ...parsed,
      createdBy: req.uid,
      updatedBy: req.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const saved = await ref.get();
    await logCreate(ctxFromReq(req), {
      collection: "taxiRides",
      resourceId: ref.id,
      subResourceId: hotel,
      summary: { date: parsed.date, routeName: parsed.routeName || "(jiné)", amount: parsed.amount },
    });
    res.json({ id: ref.id, ...saved.data() });
  }
);

taxiRouter.put(
  "/:hotel/:id",
  requireAuth,
  requireTaxiPerm("view"),
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const ref = taxiRideCol(hotel).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Jízda nenalezena." });
      return;
    }
    const before = snap.data() as TaxiRideDoc;
    const parsed = parseRide(req.body, await readRoutes());
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
    await logUpdate(ctxFromReq(req), {
      collection: "taxiRides",
      resourceId: ref.id,
      subResourceId: hotel,
      before: before as unknown as Record<string, unknown>,
      after: { ...(before as unknown as Record<string, unknown>), ...parsed },
    });
    res.json({ id: ref.id, ...saved.data() });
  }
);

taxiRouter.delete(
  "/:hotel/:id",
  requireAuth,
  requireTaxiPerm("view"),
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const ref = taxiRideCol(hotel).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Jízda nenalezena." });
      return;
    }
    const before = snap.data() as TaxiRideDoc;
    if (!isManage(req, hotel) && !inRange(before.date, await readRange(hotel))) {
      res.status(403).json({ error: "Datum je mimo povolené období." });
      return;
    }
    await ref.delete();
    await logDelete(ctxFromReq(req), {
      collection: "taxiRides",
      resourceId: req.params.id,
      subResourceId: hotel,
      summary: { date: before.date, routeName: before.routeName || "(jiné)", amount: before.amount },
    });
    res.json({ ok: true });
  }
);
