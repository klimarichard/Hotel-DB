import { Router } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import {
  requirePermission,
  clearRoleTypeCache,
  sanitizePermissionList,
  ROLE_TYPES_COLLECTION,
} from "../auth/permissions";
import { ctxFromReq, logCreate, logUpdate, logDelete } from "../services/auditLog";

/**
 * CRUD for configurable user types (roleTypes/{id} = { name, permissions[],
 * management, system }). All gated by `userTypes.manage` (list also allows
 * `users.setType` so the user-assignment dropdown can read it). The resolver
 * reads these docs; writes clear the in-instance cache so the editing admin
 * sees the change immediately (other instances refresh within the TTL).
 *
 * Guards: the `system` type (admin) can't be edited or deleted; a type can't be
 * deleted while any user is still assigned to it (block, not cascade — the admin
 * must reassign first, mirroring the app-wide delete-protection rule).
 */
export const roleTypesRouter = Router();
const db = () => admin.firestore();

roleTypesRouter.use(requireAuth);

// Strips unknown + non-grantable keys (e.g. system.admin) so a custom type can
// never be edited/cloned into a superadmin — see sanitizePermissionList.
const sanitizePerms = sanitizePermissionList;

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "typ"
  );
}

async function uniqueId(base: string): Promise<string> {
  let id = base;
  let i = 2;
  // eslint-disable-next-line no-await-in-loop
  while ((await db().collection(ROLE_TYPES_COLLECTION).doc(id).get()).exists) {
    id = `${base}-${i++}`;
  }
  return id;
}

// ─── GET /role-types — list all types ─────────────────────────────────────────
roleTypesRouter.get(
  "/",
  requirePermission("userTypes.manage", "users.setType"),
  async (_req, res) => {
    const snap = await db().collection(ROLE_TYPES_COLLECTION).get();
    const types = snap.docs
      .map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          name: (data.name as string) ?? d.id,
          permissions: Array.isArray(data.permissions) ? data.permissions : [],
          management: data.management === true,
          system: data.system === true,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "cs"));
    res.json(types);
  }
);

// ─── POST /role-types — create (optionally cloning an existing type) ──────────
roleTypesRouter.post(
  "/",
  requirePermission("userTypes.manage"),
  async (req: AuthRequest, res) => {
    const body = req.body as {
      name?: string;
      permissions?: unknown;
      management?: unknown;
      cloneFrom?: string;
    };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      res.status(400).json({ error: "Název typu je povinný." });
      return;
    }

    // Permissions: explicit list wins; else clone source; else blank ("strip all").
    let permissions = sanitizePerms(body.permissions);
    let management = body.management === true;
    if (body.cloneFrom && !Array.isArray(body.permissions)) {
      const src = await db().collection(ROLE_TYPES_COLLECTION).doc(body.cloneFrom).get();
      if (src.exists) {
        const sd = src.data() as Record<string, unknown>;
        permissions = sanitizePerms(sd.permissions);
        if (body.management === undefined) management = sd.management === true;
      }
    }

    const id = await uniqueId(slugify(name));
    await db().collection(ROLE_TYPES_COLLECTION).doc(id).set({
      name,
      permissions,
      management,
      system: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: req.uid ?? null,
    });
    clearRoleTypeCache();
    await logCreate(ctxFromReq(req), {
      collection: ROLE_TYPES_COLLECTION,
      resourceId: id,
      summary: { name, permissions: permissions.length, management, clonedFrom: body.cloneFrom ?? null },
    });
    res.status(201).json({ id });
  }
);

// ─── PATCH /role-types/:id — edit name / permissions / management flag ────────
roleTypesRouter.patch(
  "/:id",
  requirePermission("userTypes.manage"),
  async (req: AuthRequest, res) => {
    const ref = db().collection(ROLE_TYPES_COLLECTION).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Typ nenalezen." });
      return;
    }
    const cur = snap.data() as Record<string, unknown>;
    if (cur.system === true) {
      res.status(403).json({ error: "Systémový typ (Administrátor) nelze upravit." });
      return;
    }

    const body = req.body as { name?: string; permissions?: unknown; management?: unknown };
    const patch: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: req.uid ?? null,
    };
    if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
    if ("permissions" in body) patch.permissions = sanitizePerms(body.permissions);
    if ("management" in body) patch.management = body.management === true;

    await ref.update(patch);
    clearRoleTypeCache();
    await logUpdate(ctxFromReq(req), {
      collection: ROLE_TYPES_COLLECTION,
      resourceId: req.params.id,
      before: { name: cur.name, permissions: (cur.permissions as unknown[])?.length ?? 0, management: cur.management === true },
      after: {
        name: patch.name ?? cur.name,
        permissions: Array.isArray(patch.permissions) ? patch.permissions.length : (cur.permissions as unknown[])?.length ?? 0,
        management: "management" in patch ? patch.management : cur.management === true,
      },
    });
    res.json({ ok: true });
  }
);

// ─── DELETE /role-types/:id — block if system or still assigned ───────────────
roleTypesRouter.delete(
  "/:id",
  requirePermission("userTypes.manage"),
  async (req: AuthRequest, res) => {
    const id = req.params.id;
    const ref = db().collection(ROLE_TYPES_COLLECTION).doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Typ nenalezen." });
      return;
    }
    const data = snap.data() as Record<string, unknown>;
    if (data.system === true) {
      res.status(403).json({ error: "Systémový typ (Administrátor) nelze smazat." });
      return;
    }

    // Block delete while any user is assigned this type — admin must reassign first.
    const usersSnap = await db().collection("users").get();
    const assigned = usersSnap.docs.filter((d) => {
      const u = d.data() as Record<string, unknown>;
      return ((u.roleType as string) || "") === id;
    });
    if (assigned.length > 0) {
      res.status(409).json({
        error: `Typ je přiřazen ${assigned.length} uživatel${assigned.length === 1 ? "i" : "ům"}. Nejprve je přeřaďte na jiný typ.`,
        count: assigned.length,
      });
      return;
    }

    await ref.delete();
    clearRoleTypeCache();
    await logDelete(ctxFromReq(req), {
      collection: ROLE_TYPES_COLLECTION,
      resourceId: id,
      summary: { name: data.name },
    });
    res.json({ ok: true });
  }
);
