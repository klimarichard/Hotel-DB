/**
 * Objednávky (Tabulky → Objednávky) — the číselník behind the order-e-mail
 * builder, and NOTHING else.
 *
 * There is no order resource in this router, and that is not an omission. The
 * feature composes an e-mail in the browser and puts it on the clipboard; the
 * message is then sent from the user's own mail client. Nothing about a
 * placed order is stored, so there is nothing to list, version or audit —
 * exactly the shape `docs/tabulky.md` describes for Směnárna, minus even the
 * snapshots.
 *
 * What IS stored is shared configuration (`settings/objednavkyConfig`): the
 * product catalogue and the four hotels with their delivery addresses and
 * billing details. That is worth tracing, so `PUT /config` is audit-logged,
 * matching `PUT /faktury/config`.
 */
import { Router, Response } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { requirePermission } from "../auth/permissions";
import { ctxFromReq, logUpdate } from "../services/auditLog";
import {
  DEFAULT_OBJEDNAVKY_CONFIG,
  ObjednavkyConfig,
  OrderHotel,
  OrderItem,
  OrderUnit,
} from "../services/orderTypes";

export const objednavkyRouter = Router();

const db = () => admin.firestore();

const CONFIG_DOC = () => db().collection("settings").doc("objednavkyConfig");

const VIEW_PERM = "tabulky.objednavky.view";
const MANAGE_PERM = "tabulky.objednavky.manage";

/** A fresh Firestore auto-id (no write) — same trick as faktury.ts `newId()`. */
function newId(): string {
  return db().collection("_ids").doc().id;
}

/* ------------------------------------------------------------------ */
/* Validators (same shape as faktury.ts — deliberately kept local, the  */
/* two číselníky share no fields and coupling them buys nothing)        */
/* ------------------------------------------------------------------ */

const STR_MAX = 200;
/** Addresses and billing blocks are longer, and may carry newlines. */
const TEXT_MAX = 500;
const MAX_ITEMS = 400;
const MAX_HOTELS = 20;

class BadRequest extends Error {}

function fail(msg: string): never {
  throw new BadRequest(msg);
}

/** Trim + cap. Anything that isn't a string becomes "". */
function str(v: unknown, max = STR_MAX): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function arrayOf(v: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(v)) fail(`${label} musí být pole.`);
  const arr = v as unknown[];
  if (arr.length > max) fail(`${label}: nejvýše ${max} položek.`);
  return arr;
}

/**
 * Keeps a client-supplied id when it is usable, mints one otherwise. A blank
 * or DUPLICATE id is replaced — a duplicate would make two catalogue rows
 * indistinguishable to every lookup on the page.
 */
function idOf(raw: Record<string, unknown>, seen: Set<string>): string {
  let id = typeof raw.id === "string" ? raw.id.trim().slice(0, STR_MAX) : "";
  if (id === "" || seen.has(id)) id = newId();
  seen.add(id);
  return id;
}

const UNITS = new Set<OrderUnit>(["ks", "balení"]);

function sanitizeConfig(raw: unknown): ObjednavkyConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const itemIds = new Set<string>();
  const items: OrderItem[] = arrayOf(c.items, "items", MAX_ITEMS).map((entry) => {
    const e = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    return {
      id: idOf(e, itemIds),
      name: str(e.name),
      code: str(e.code, 50),
      // Whitelisted rather than defaulted from a string compare: the unit is
      // printed VERBATIM into the e-mail, so an unrecognised value would reach
      // the supplier as-is. "ks" is the safe fallback (it is the narrower
      // claim — a piece, not a whole package).
      unit: UNITS.has(e.unit as OrderUnit) ? (e.unit as OrderUnit) : "ks",
      active: e.active !== false,
    };
  });

  const hotelIds = new Set<string>();
  const hotels: OrderHotel[] = arrayOf(c.hotels, "hotels", MAX_HOTELS).map((entry) => {
    const e = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    return {
      id: idOf(e, hotelIds),
      name: str(e.name),
      deliveryAddress: str(e.deliveryAddress, TEXT_MAX),
      // Deliberately NOT validated against the live `companies` collection:
      // that registry is editable elsewhere, so a company deleted after a hotel
      // pointed at it must degrade gracefully (the tab blocks the copy and says
      // so) rather than 400 and leave the číselník unsaveable. Same reasoning as
      // `faktury.ts` not validating a draft's `vatRateId` against the rate list.
      companyId:
        typeof e.companyId === "string" && e.companyId.trim() !== ""
          ? e.companyId.trim().slice(0, STR_MAX)
          : null,
      active: e.active !== false,
    };
  });

  return { items, hotels };
}

/* ------------------------------------------------------------------ */
/* Endpoints                                                           */
/* ------------------------------------------------------------------ */

/**
 * Current config, or the shipped defaults when the doc has never been written.
 * Lazily seeded on purpose: a GET must not write. The defaults only become a
 * real document the first time someone saves the číselník.
 */
async function readConfig(): Promise<ObjednavkyConfig> {
  const snap = await CONFIG_DOC().get();
  if (!snap.exists) return DEFAULT_OBJEDNAVKY_CONFIG;
  const data = snap.data() as Record<string, unknown>;
  return {
    items: Array.isArray(data.items) ? (data.items as OrderItem[]) : [],
    hotels: Array.isArray(data.hotels) ? (data.hotels as OrderHotel[]) : [],
  };
}

/**
 * GET /api/objednavky/config
 * Gated on the VIEW key, not the manage key: the page is unusable without the
 * catalogue, and every user of the tab needs to read it.
 */
objednavkyRouter.get(
  "/config",
  requireAuth,
  requirePermission(VIEW_PERM),
  async (_req: AuthRequest, res: Response) => {
    res.json(await readConfig());
  }
);

/**
 * PUT /api/objednavky/config
 * Whole-document replace, mirroring `PUT /faktury/config`. Audited: a wrong
 * delivery address here sends real goods to the wrong hotel, and the resulting
 * e-mail carries no trace of who changed it.
 */
objednavkyRouter.put(
  "/config",
  requireAuth,
  requirePermission(MANAGE_PERM),
  async (req: AuthRequest, res: Response) => {
    let config: ObjednavkyConfig;
    try {
      config = sanitizeConfig(req.body);
    } catch (e) {
      if (e instanceof BadRequest) {
        res.status(400).json({ error: e.message });
        return;
      }
      throw e;
    }

    const beforeSnap = await CONFIG_DOC().get();
    const before = beforeSnap.exists ? (beforeSnap.data() as Record<string, unknown>) : {};
    await CONFIG_DOC().set({
      ...config,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: req.uid,
    });

    // Counts, not contents — same call as faktury's config audit. The arrays
    // are verbose and the interesting fact is "the catalogue changed".
    await logUpdate(ctxFromReq(req), {
      collection: "settings",
      resourceId: "objednavkyConfig",
      before: {
        items: Array.isArray(before.items) ? before.items.length : 0,
        hotels: Array.isArray(before.hotels) ? before.hotels.length : 0,
      },
      after: { items: config.items.length, hotels: config.hotels.length },
    });

    res.json({ ok: true });
  }
);
