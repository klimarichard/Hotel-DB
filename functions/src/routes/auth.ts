import { Router } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import {
  requirePermission,
  resolveEffectivePermissions,
  ALL_PERMISSIONS,
  ROLE_TYPES_COLLECTION,
} from "../auth/permissions";
import { ctxFromReq, logCreate, logUpdate } from "../services/auditLog";

export const authRouter = Router();

/**
 * Turn a Firebase password-policy failure into a clear, actionable Czech
 * message. The project enforces a password policy; an unmet rule comes back
 * from createUser wrapped as `auth/internal-error`, with the failing rules
 * embedded in the message, e.g.:
 *   "Missing password requirements: [Password must contain an upper case character]"
 * We extract and translate the known rules, with a sensible fallback.
 */
function passwordPolicyMessage(message: string): string {
  const bracket = message.match(/\[(.*?)\]/);
  const reqs = bracket ? bracket[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
  const translations: { test: RegExp; cz: string }[] = [
    { test: /upper.?case/i, cz: "velké písmeno" },
    { test: /lower.?case/i, cz: "malé písmeno" },
    { test: /numeric|number|digit/i, cz: "číslici" },
    { test: /non.?alphanumeric|special/i, cz: "speciální znak" },
  ];
  const bits: string[] = [];
  for (const r of reqs) {
    const lenMatch = r.match(/at least (\d+)/i);
    if (lenMatch) { bits.push(`alespoň ${lenMatch[1]} znaků`); continue; }
    const t = translations.find((x) => x.test.test(r));
    if (t) bits.push(t.cz);
  }
  if (bits.length) return `Heslo nesplňuje požadavky — musí obsahovat ${bits.join(", ")}.`;
  return "Heslo nesplňuje bezpečnostní požadavky. Použijte delší heslo s velkými i malými písmeny a číslicí.";
}

/**
 * Merge a partial claim patch into a user's existing custom claims.
 * setCustomUserClaims REPLACES all claims, so we read + merge to avoid wiping
 * role / roleType / per-user permission overrides. The new claims take effect
 * on the user's next token refresh (≤1h, or immediately on re-login).
 */
async function mergeCustomClaims(uid: string, patch: Record<string, unknown>): Promise<void> {
  const user = await admin.auth().getUser(uid);
  await admin.auth().setCustomUserClaims(uid, { ...(user.customClaims ?? {}), ...patch });
}

const ALL_PERM_SET = new Set<string>(ALL_PERMISSIONS);
const sanitizePerms = (value: unknown): string[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((p): p is string => typeof p === "string" && ALL_PERM_SET.has(p)))]
    : [];

/** Does this user's stored config resolve to the superadmin permission? */
async function userIsAdmin(u: Record<string, unknown>): Promise<boolean> {
  const set = await resolveEffectivePermissions({
    roleType: typeof u.roleType === "string" ? u.roleType : undefined,
    extra: Array.isArray(u.extraPermissions) ? (u.extraPermissions as string[]) : [],
    revoked: Array.isArray(u.revokedPermissions) ? (u.revokedPermissions as string[]) : [],
  });
  return set.has("system.admin");
}

/**
 * PATCH /api/auth/users/:uid/permissions
 * Assign a user's configurable type + per-user permission grants/revokes.
 * Body: { roleType?: string|null, extraPermissions?: string[], revokedPermissions?: string[] }
 * (absent fields keep their current value). Writes merged claims + mirrors to
 * users/{uid}; the resolver reads these. Lockout guards: you can't remove your
 * own superadmin, and the last active superadmin can't be demoted.
 */
authRouter.patch(
  "/users/:uid/permissions",
  requireAuth,
  requirePermission("users.permissions.manage", "users.setType"),
  async (req: AuthRequest, res) => {
    const { uid } = req.params;
    const body = req.body as {
      roleType?: string | null;
      extraPermissions?: unknown;
      revokedPermissions?: unknown;
    };

    const userRef = admin.firestore().collection("users").doc(uid);
    const snap = await userRef.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Uživatel nenalezen." });
      return;
    }
    const cur = snap.data() as Record<string, unknown>;

    // Desired next state (absent fields keep current values).
    let nextRoleType: string | null;
    if ("roleType" in body) {
      if (body.roleType === null) {
        nextRoleType = null;
      } else if (typeof body.roleType === "string" && body.roleType) {
        const t = await admin.firestore().collection(ROLE_TYPES_COLLECTION).doc(body.roleType).get();
        if (!t.exists) {
          res.status(400).json({ error: "Zvolený typ neexistuje." });
          return;
        }
        nextRoleType = body.roleType;
      } else {
        res.status(400).json({ error: "Neplatný typ." });
        return;
      }
    } else {
      nextRoleType = (cur.roleType as string) ?? null;
    }
    const nextExtra = "extraPermissions" in body
      ? sanitizePerms(body.extraPermissions)
      : (Array.isArray(cur.extraPermissions) ? (cur.extraPermissions as string[]) : []);
    const nextRevoked = "revokedPermissions" in body
      ? sanitizePerms(body.revokedPermissions)
      : (Array.isArray(cur.revokedPermissions) ? (cur.revokedPermissions as string[]) : []);

    // ── Lockout guards ────────────────────────────────────────────────────────
    const wasAdmin = await userIsAdmin(cur);
    const willBeAdmin = (
      await resolveEffectivePermissions({
        roleType: nextRoleType ?? undefined,
        extra: nextExtra,
        revoked: nextRevoked,
      })
    ).has("system.admin");

    if (wasAdmin && !willBeAdmin) {
      if (uid === req.uid) {
        res.status(400).json({ error: "Nemůžete odebrat vlastní administrátorská práva." });
        return;
      }
      const activeUsers = await admin.firestore().collection("users").where("active", "==", true).get();
      let otherAdmins = 0;
      for (const d of activeUsers.docs) {
        if (d.id === uid) continue;
        if (await userIsAdmin(d.data() as Record<string, unknown>)) otherAdmins++;
      }
      if (otherAdmins === 0) {
        res.status(400).json({ error: "Nelze odebrat práva poslednímu administrátorovi." });
        return;
      }
    }

    // ── Apply: merge claims (take effect on next token refresh) + mirror doc ──
    await mergeCustomClaims(uid, {
      roleType: nextRoleType,
      extraPermissions: nextExtra,
      revokedPermissions: nextRevoked,
    });
    await userRef.update({
      roleType: nextRoleType,
      extraPermissions: nextExtra,
      revokedPermissions: nextRevoked,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await logUpdate(ctxFromReq(req), {
      collection: "users",
      resourceId: uid,
      before: {
        roleType: cur.roleType ?? null,
        extraPermissions: cur.extraPermissions ?? [],
        revokedPermissions: cur.revokedPermissions ?? [],
      },
      after: { roleType: nextRoleType, extraPermissions: nextExtra, revokedPermissions: nextRevoked },
    });
    res.json({ success: true });
  }
);

/**
 * POST /api/auth/create-user
 * Admin-only: create a Firebase Auth user and store in users/ collection.
 * Body: { email, password, name, roleType, employeeId? }
 */
authRouter.post(
  "/create-user",
  requireAuth,
  requirePermission("users.manage"),
  async (req: AuthRequest, res) => {
    const { email, password, name, roleType, employeeId } = req.body as {
      email: string;
      password?: string;
      name: string;
      roleType?: string;
      employeeId?: string;
    };

    // Users are purely type-based: they get a roleType (and nothing else).
    const typeId = typeof roleType === "string" && roleType ? roleType : "";
    if (!email || !name || !typeId) {
      res.status(400).json({ error: "email, name, and a user type are required" });
      return;
    }
    const typeDoc = await admin.firestore().collection(ROLE_TYPES_COLLECTION).doc(typeId).get();
    if (!typeDoc.exists) {
      res.status(400).json({ error: "Zvolený typ uživatele neexistuje." });
      return;
    }
    // New users are purely type-based — no legacy `role` is set. Everything reads
    // roleType: permissions resolve from it, the sidebar + menu config key off it
    // (req.roleType), management scoping reads the type's flag, and the resolver
    // falls back to the built-in mapping by the type id when a doc is missing.
    // Password is optional. When omitted the account is created WITHOUT a password
    // and we hand back a reset link so the user can set their own (see below).
    const hasPassword = typeof password === "string" && password.length > 0;

    // Wrap the Firebase Auth/Firestore calls: without this, a rejection (most
    // commonly auth/email-already-exists — Auth accounts survive a Firestore
    // wipe) would bubble out of the async handler with no response sent, and
    // Express 4 would let the request hang ("Vytvořit" spins forever). Map the
    // known Firebase error codes to actionable Czech messages instead.
    try {
      const userRecord = await admin.auth().createUser(
        hasPassword ? { email, password, displayName: name } : { email, displayName: name }
      );
      await admin.auth().setCustomUserClaims(userRecord.uid, { roleType: typeId });

      await admin.firestore().collection("users").doc(userRecord.uid).set({
        name,
        email,
        roleType: typeId,
        employeeId: employeeId ?? null,
        active: true,
        createdAt: FieldValue.serverTimestamp(),
        lastLogin: null,
      });

      await logCreate(ctxFromReq(req), {
        collection: "users",
        resourceId: userRecord.uid,
        employeeId: employeeId ?? undefined,
        summary: { name, email, roleType: typeId, employeeId: employeeId ?? null },
      });

      // No password set → return a reset link the admin can send (there is no
      // server-side email service; the frontend also offers the email path).
      let resetLink: string | null = null;
      if (!hasPassword) {
        try {
          resetLink = await admin.auth().generatePasswordResetLink(email);
        } catch (linkErr) {
          console.error("generatePasswordResetLink failed:", linkErr);
        }
      }

      res.status(201).json({ uid: userRecord.uid, resetLink });
    } catch (err) {
      // Firebase Admin errors expose the code as `.code`; some wrap it under
      // `.errorInfo.code`. Read both so we always get the real code.
      const e = err as { code?: string; message?: string; errorInfo?: { code?: string } };
      const code = e?.code ?? e?.errorInfo?.code ?? "";
      const message = e?.message ?? "";

      // Password-policy violations come back wrapped as auth/internal-error
      // with the failing rules in the message — present them cleanly.
      if (/PASSWORD_DOES_NOT_MEET_REQUIREMENTS|Missing password requirements/i.test(message)) {
        res.status(400).json({ error: passwordPolicyMessage(message) });
        return;
      }

      const errorMap: Record<string, { status: number; message: string }> = {
        "auth/email-already-exists": { status: 409, message: "Uživatel s tímto e-mailem již existuje." },
        "auth/uid-already-exists": { status: 409, message: "Uživatel s tímto ID již existuje." },
        "auth/invalid-email": { status: 400, message: "Neplatný formát e-mailu." },
        "auth/invalid-password": { status: 400, message: "Heslo musí mít alespoň 6 znaků." },
        "auth/invalid-display-name": { status: 400, message: "Neplatné jméno." },
        "auth/insufficient-permission": { status: 403, message: "Server nemá oprávnění vytvářet uživatele." },
      };
      const mapped = errorMap[code];
      if (mapped) {
        res.status(mapped.status).json({ error: mapped.message });
        return;
      }

      // Truly unexpected — log the full error server-side; keep the user-facing
      // message clean (the raw blob was only a temporary diagnostic).
      console.error("create-user failed:", err);
      res.status(500).json({ error: "Nepodařilo se vytvořit uživatele. Zkuste to prosím znovu." });
    }
  }
);

/**
 * PATCH /api/auth/deactivate-user/:uid
 * Admin-only: disable a user account.
 */
authRouter.patch(
  "/deactivate-user/:uid",
  requireAuth,
  requirePermission("users.manage"),
  async (req: AuthRequest, res) => {
    const { uid } = req.params;
    await admin.auth().updateUser(uid, { disabled: true });
    await admin.firestore().collection("users").doc(uid).update({
      active: false,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await logUpdate(ctxFromReq(req), {
      collection: "users",
      resourceId: uid,
      before: { active: true },
      after: { active: false },
    });
    res.json({ success: true });
  }
);

/**
 * GET /api/auth/users
 * Admin-only: list all user profiles from users/ collection.
 */
authRouter.get("/users", requireAuth, requirePermission("users.view"), async (_req, res) => {
  const [snapshot, typesSnap] = await Promise.all([
    admin.firestore().collection("users").orderBy("name").get(),
    admin.firestore().collection(ROLE_TYPES_COLLECTION).get(),
  ]);
  // id → Czech display name, so a viewer without the type catalogue still sees a
  // readable type label (e.g. "FOM", "Ředitel") instead of the raw id.
  const typeNames = new Map<string, string>();
  typesSnap.docs.forEach((d) =>
    typeNames.set(d.id, ((d.data() as Record<string, unknown>).name as string) ?? d.id)
  );
  const users = snapshot.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>;
    const typeId = (data.roleType as string) || (data.role as string) || "";
    return { uid: doc.id, ...data, roleTypeName: typeId ? typeNames.get(typeId) ?? typeId : null };
  });
  res.json(users);
});

/**
 * PATCH /api/auth/reactivate-user/:uid
 * Admin-only: re-enable a previously disabled user account.
 */
authRouter.patch(
  "/reactivate-user/:uid",
  requireAuth,
  requirePermission("users.manage"),
  async (req: AuthRequest, res) => {
    const { uid } = req.params;
    await admin.auth().updateUser(uid, { disabled: false });
    await admin.firestore().collection("users").doc(uid).update({
      active: true,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await logUpdate(ctxFromReq(req), {
      collection: "users",
      resourceId: uid,
      before: { active: false },
      after: { active: true },
    });
    res.json({ success: true });
  }
);

/**
 * PATCH /api/auth/users/:uid/employee
 * Admin-only: link or unlink an employee record to a user profile.
 * Body: { employeeId: string | null }
 */
authRouter.patch(
  "/users/:uid/employee",
  requireAuth,
  requirePermission("users.linkEmployee"),
  async (req: AuthRequest, res) => {
    const { uid } = req.params;
    const { employeeId } = req.body as { employeeId: string | null };

    const userRef = admin.firestore().collection("users").doc(uid);
    const beforeSnap = await userRef.get();
    const before = beforeSnap.exists ? (beforeSnap.data() as Record<string, unknown>) : {};

    await userRef.update({
      employeeId: employeeId ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    });

    await logUpdate(ctxFromReq(req), {
      collection: "users",
      resourceId: uid,
      employeeId: employeeId ?? (before.employeeId as string | undefined),
      before: { employeeId: before.employeeId ?? null },
      after: { employeeId: employeeId ?? null },
    });

    res.json({ success: true });
  }
);

/**
 * PATCH /api/auth/users/:uid
 * Admin-only: edit a user's name and/or email. Email changes update BOTH the
 * Firebase Auth account (the login identity) and the Firestore profile — the
 * frontend warns that this changes how the user signs in. Role / employee link /
 * active state have their own endpoints; password is never edited here (reset
 * link only).
 * Body: { name?: string, email?: string }
 */
authRouter.patch(
  "/users/:uid",
  requireAuth,
  requirePermission("users.manage"),
  async (req: AuthRequest, res) => {
    const { uid } = req.params;
    const { name, email } = req.body as { name?: string; email?: string };
    const wantName = typeof name === "string" && name.trim().length > 0;
    const wantEmail = typeof email === "string" && email.trim().length > 0;
    if (!wantName && !wantEmail) {
      res.status(400).json({ error: "Není co uložit (jméno ani e-mail)." });
      return;
    }

    const userRef = admin.firestore().collection("users").doc(uid);
    const beforeSnap = await userRef.get();
    if (!beforeSnap.exists) {
      res.status(404).json({ error: "Uživatel nenalezen." });
      return;
    }
    const before = beforeSnap.data() as Record<string, unknown>;

    try {
      const authUpdate: { displayName?: string; email?: string } = {};
      const fsUpdate: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
      if (wantName) { authUpdate.displayName = name!.trim(); fsUpdate.name = name!.trim(); }
      if (wantEmail) { authUpdate.email = email!.trim(); fsUpdate.email = email!.trim(); }

      // Update the Auth record first (it's the one that can fail on a duplicate
      // email); only then mirror into Firestore.
      await admin.auth().updateUser(uid, authUpdate);
      await userRef.update(fsUpdate);

      await logUpdate(ctxFromReq(req), {
        collection: "users",
        resourceId: uid,
        before: { name: before.name, email: before.email },
        after: { name: fsUpdate.name ?? before.name, email: fsUpdate.email ?? before.email },
      });
      res.json({ success: true });
    } catch (err) {
      const e = err as { code?: string; errorInfo?: { code?: string } };
      const code = e?.code ?? e?.errorInfo?.code ?? "";
      const errorMap: Record<string, { status: number; message: string }> = {
        "auth/email-already-exists": { status: 409, message: "Uživatel s tímto e-mailem již existuje." },
        "auth/invalid-email": { status: 400, message: "Neplatný formát e-mailu." },
        "auth/user-not-found": { status: 404, message: "Uživatel nenalezen." },
      };
      const mapped = errorMap[code];
      if (mapped) {
        res.status(mapped.status).json({ error: mapped.message });
        return;
      }
      console.error("update-user failed:", err);
      res.status(500).json({ error: "Nepodařilo se uložit změny uživatele." });
    }
  }
);

/**
 * GET /api/auth/me
 * Returns the current user's profile from users/ collection.
 */
authRouter.get("/me", requireAuth, async (req: AuthRequest, res) => {
  const doc = await admin.firestore().collection("users").doc(req.uid!).get();
  if (!doc.exists) {
    res.status(404).json({ error: "User profile not found" });
    return;
  }
  // Effective permission set for the frontend's can() helper — already resolved
  // by requireAuth from the token claim (configurable roleType + per-user
  // grants/revokes, falling back to the built-in role mapping). The backend is
  // still the real gate; this only drives which UI controls show.
  const permissions = [...(req.permissions ?? [])];
  // Resolve the user's type display name for the sidebar label.
  // Best-effort — null if the type doc is gone.
  const data = doc.data() as Record<string, unknown>;
  const typeId = (data.roleType as string) || "";
  let roleTypeName: string | null = null;
  if (typeId) {
    const t = await admin.firestore().collection(ROLE_TYPES_COLLECTION).doc(typeId).get();
    roleTypeName = t.exists ? ((t.data() as Record<string, unknown>).name as string) ?? typeId : typeId;
  }
  res.json({ uid: doc.id, ...data, permissions, roleTypeName });
});

/**
 * GET /api/auth/me/theme
 * Returns the current user's saved theme preference, or null if unset.
 */
authRouter.get("/me/theme", requireAuth, async (req: AuthRequest, res) => {
  const doc = await admin.firestore().collection("users").doc(req.uid!).get();
  const theme = doc.exists ? (doc.data()?.theme ?? null) : null;
  res.json({ theme });
});

/**
 * PUT /api/auth/me/theme
 * Persists the current user's theme preference.
 * Body: { theme: "light" | "dark" }
 */
authRouter.put("/me/theme", requireAuth, async (req: AuthRequest, res) => {
  const { theme } = req.body as { theme: unknown };
  if (theme !== "light" && theme !== "dark") {
    res.status(400).json({ error: "theme must be 'light' or 'dark'" });
    return;
  }
  await admin.firestore().collection("users").doc(req.uid!).set(
    { theme, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  res.json({ theme });
});

/**
 * GET /api/auth/me/tours
 * Returns the onboarding tours the user has completed:
 * { toursSeen: { [tourId]: completedVersion } } (empty map if none).
 */
authRouter.get("/me/tours", requireAuth, async (req: AuthRequest, res) => {
  const doc = await admin.firestore().collection("users").doc(req.uid!).get();
  const toursSeen = doc.exists ? (doc.data()?.toursSeen ?? {}) : {};
  res.json({ toursSeen });
});

/**
 * PUT /api/auth/me/tours
 * Marks one tour as completed at a given version. Deep-merges a single key so
 * sibling tour entries are preserved.
 * Body: { tourId: string, version: number }
 */
authRouter.put("/me/tours", requireAuth, async (req: AuthRequest, res) => {
  const { tourId, version } = req.body as { tourId: unknown; version: unknown };
  if (typeof tourId !== "string" || !tourId.trim() || typeof version !== "number" || !Number.isFinite(version)) {
    res.status(400).json({ error: "tourId musí být řetězec a version číslo." });
    return;
  }
  await admin.firestore().collection("users").doc(req.uid!).set(
    { toursSeen: { [tourId]: version }, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  res.json({ ok: true });
});
