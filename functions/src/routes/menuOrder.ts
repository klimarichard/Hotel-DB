import { Router } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { requirePermission } from "../auth/permissions";
import { ctxFromReq, logUpdate } from "../services/auditLog";

export const menuOrderRouter = Router();

const db = () => admin.firestore();

// Valid sidebar item ids (mirror of frontend/src/lib/menuItems.ts). The backend
// validates that saved orders only reference real items; per-TYPE visibility is
// enforced by the sidebar itself (Layout's resolveOrderByPermission only shows
// items the user has the permission for), so we don't re-check permissions here.
const VALID_IDS = new Set<string>([
  "prehled", "smeny", "dovolena", "recepce", "tabulky", "zamestnanci", "mzdy",
  "upozorneni", "smlouvy", "dokumenty", "audit", "navody", "nastaveni", "mujProfil",
]);

const docRef = () => db().collection("settings").doc("menuOrder");

/**
 * GET /api/settings/menu-order
 * Returns the full per-user-type map. Admin only.
 */
menuOrderRouter.get(
  "/",
  requireAuth,
  requirePermission("settings.menuOrder.manage"),
  async (_req: AuthRequest, res) => {
    const snap = await docRef().get();
    res.json(snap.exists ? (snap.data() ?? {}) : {});
  }
);

/**
 * GET /api/settings/menu-order/me
 * Returns just the current user's type's saved order, or null when none is
 * configured (frontend falls back to default order). Available to any
 * authenticated user — needed by Layout.tsx on every login. Keyed by the user's
 * roleType (which defaults to the legacy role).
 */
menuOrderRouter.get(
  "/me",
  requireAuth,
  async (req: AuthRequest, res) => {
    const typeId = req.roleType;
    if (!typeId) {
      res.json({ order: null });
      return;
    }
    const snap = await docRef().get();
    if (!snap.exists) {
      res.json({ order: null });
      return;
    }
    const order = (snap.data() as Record<string, unknown>)[typeId];
    res.json({ order: Array.isArray(order) ? order : null });
  }
);

/**
 * PUT /api/settings/menu-order
 * Admin only. Body: { <typeId>: [...itemIds], ... } — one entry per user type.
 * Each value is cleaned to valid, de-duplicated item ids. Item visibility per
 * type is enforced by the sidebar, so we don't reject items here; unknown ids
 * are silently dropped. Reserved keys (updatedAt/updatedBy) are ignored.
 */
menuOrderRouter.put(
  "/",
  requireAuth,
  requirePermission("settings.menuOrder.manage"),
  async (req: AuthRequest, res) => {
    const body = req.body as Record<string, unknown>;
    const update: Record<string, string[]> = {};

    for (const [typeId, value] of Object.entries(body)) {
      if (typeId === "updatedAt" || typeId === "updatedBy") continue;
      if (!Array.isArray(value)) {
        res.status(400).json({ error: `Pole '${typeId}' musí být seznam id.` });
        return;
      }
      const seen = new Set<string>();
      const cleaned: string[] = [];
      for (const id of value) {
        if (typeof id !== "string") {
          res.status(400).json({ error: `Neplatný typ id v '${typeId}'.` });
          return;
        }
        if (!VALID_IDS.has(id) || seen.has(id)) continue; // drop unknown / dupes
        cleaned.push(id);
        seen.add(id);
      }
      update[typeId] = cleaned;
    }

    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: "Nic k uložení." });
      return;
    }

    const beforeSnap = await docRef().get();
    const before = beforeSnap.exists ? (beforeSnap.data() as Record<string, unknown>) : {};

    await docRef().set(
      { ...update, updatedAt: FieldValue.serverTimestamp(), updatedBy: req.uid },
      { merge: true }
    );

    await logUpdate(ctxFromReq(req), {
      collection: "settings",
      resourceId: "menuOrder",
      before,
      after: { ...before, ...update },
    });

    res.json({ ok: true });
  }
);
