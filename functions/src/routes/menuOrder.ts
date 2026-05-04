import { Router } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, requireRole, AuthRequest, UserRole } from "../middleware/auth";
import { ctxFromReq, logUpdate } from "../services/auditLog";

export const menuOrderRouter = Router();

const db = () => admin.firestore();

// Mirror of frontend/src/lib/menuItems.ts. Kept here so the backend can
// validate PUT payloads — admin can't sneak in an item id that doesn't
// exist or assign one to a role that can't access it.
const MENU_ITEMS: { id: string; roles: UserRole[] }[] = [
  { id: "prehled",     roles: ["admin", "director", "manager", "employee"] },
  { id: "smeny",       roles: ["admin", "director", "manager", "employee"] },
  { id: "dovolena",    roles: ["admin", "director", "manager", "employee"] },
  { id: "zamestnanci", roles: ["admin", "director"] },
  { id: "mzdy",        roles: ["admin", "director"] },
  { id: "upozorneni",  roles: ["admin", "director"] },
  { id: "smlouvy",     roles: ["admin", "director"] },
  { id: "audit",       roles: ["admin", "director"] },
  { id: "nastaveni",   roles: ["admin"] },
];

const ALL_ROLES: UserRole[] = ["admin", "director", "manager", "employee"];
const VALID_IDS = new Set(MENU_ITEMS.map((m) => m.id));
const ROLE_TO_ALLOWED_IDS: Record<UserRole, Set<string>> = {
  admin: new Set(MENU_ITEMS.filter((m) => m.roles.includes("admin")).map((m) => m.id)),
  director: new Set(MENU_ITEMS.filter((m) => m.roles.includes("director")).map((m) => m.id)),
  manager: new Set(MENU_ITEMS.filter((m) => m.roles.includes("manager")).map((m) => m.id)),
  employee: new Set(MENU_ITEMS.filter((m) => m.roles.includes("employee")).map((m) => m.id)),
};

const docRef = () => db().collection("settings").doc("menuOrder");

/**
 * GET /api/settings/menu-order
 * Returns the full per-role map. Admin only.
 */
menuOrderRouter.get(
  "/",
  requireAuth,
  requireRole("admin"),
  async (_req: AuthRequest, res) => {
    const snap = await docRef().get();
    res.json(snap.exists ? (snap.data() ?? {}) : {});
  }
);

/**
 * GET /api/settings/menu-order/me
 * Returns just the current user's role's saved order, or null when no
 * order is configured (frontend falls back to default order). Available
 * to any authenticated user — needed by Layout.tsx on every login.
 */
menuOrderRouter.get(
  "/me",
  requireAuth,
  async (req: AuthRequest, res) => {
    const role = req.role;
    if (!role) {
      res.json({ order: null });
      return;
    }
    const snap = await docRef().get();
    if (!snap.exists) {
      res.json({ order: null });
      return;
    }
    const data = snap.data() ?? {};
    const order = (data as Record<string, unknown>)[role];
    res.json({ order: Array.isArray(order) ? order : null });
  }
);

/**
 * PUT /api/settings/menu-order
 * Admin only. Body: { admin?: [...], director?: [...], manager?: [...], employee?: [...] }
 * Each value must be an array of valid item ids that the role is allowed
 * to access — sneaking 'nastaveni' into 'employee' is rejected.
 */
menuOrderRouter.put(
  "/",
  requireAuth,
  requireRole("admin"),
  async (req: AuthRequest, res) => {
    const body = req.body as Record<string, unknown>;
    const update: Record<string, string[]> = {};

    for (const role of ALL_ROLES) {
      if (!(role in body)) continue;
      const value = body[role];
      if (!Array.isArray(value)) {
        res.status(400).json({ error: `Pole '${role}' musí být seznam id.` });
        return;
      }
      const allowed = ROLE_TO_ALLOWED_IDS[role];
      const seen = new Set<string>();
      const cleaned: string[] = [];
      for (const id of value) {
        if (typeof id !== "string") {
          res.status(400).json({ error: `Neplatný typ id v '${role}'.` });
          return;
        }
        if (!VALID_IDS.has(id)) continue; // silently drop unknown ids
        if (!allowed.has(id)) {
          res.status(400).json({
            error: `Položka '${id}' není povolena pro roli '${role}'.`,
          });
          return;
        }
        if (seen.has(id)) continue;
        cleaned.push(id);
        seen.add(id);
      }
      update[role] = cleaned;
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
