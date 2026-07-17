import { Router } from "express";
import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import {
  requirePermission,
  resolveEffectivePermissions,
  roleTypeFromUserDoc,
  sanitizePermissionList,
  ROLE_TYPES_COLLECTION,
} from "../auth/permissions";
import { ctxFromReq, logCreate, logUpdate } from "../services/auditLog";
import { isHotelSlug, hotelViewPerm, type HotelSlug } from "../services/hotels";
import { resolveEmployeeDisplays } from "../services/recepceEmployees";
import * as clock from "../services/clock";
import { deactivateUserCore } from "../services/userDeactivation";

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

// Strips unknown + non-grantable keys (e.g. system.admin) so a per-user grant
// can never confer superadmin — see sanitizePermissionList.
const sanitizePerms = sanitizePermissionList;

/** Does this user's stored config resolve to the superadmin permission? */
async function userIsAdmin(u: Record<string, unknown>): Promise<boolean> {
  const set = await resolveEffectivePermissions({
    roleType: roleTypeFromUserDoc(u),
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

    // This endpoint is reachable with EITHER users.setType OR
    // users.permissions.manage (requirePermission is an OR). Those are
    // deliberately separate permissions: assigning a type is a lower-trust
    // action than handing out individual grants/revokes. So a setType-only
    // caller may change `roleType` but must NOT be able to write
    // extra/revoked permissions — otherwise the split is meaningless and a
    // setType-only user could grant themselves anything. Gate the per-user
    // grant fields on users.permissions.manage specifically.
    const canManagePerms =
      req.permissions?.has("system.admin") || req.permissions?.has("users.permissions.manage") || false;
    if (("extraPermissions" in body || "revokedPermissions" in body) && !canManagePerms) {
      res.status(403).json({ error: "K úpravě individuálních oprávnění je třeba oprávnění „Spravovat individuální oprávnění uživatele“." });
      return;
    }

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

    // ── Apply: merge claims + mirror doc, then revoke refresh tokens ──────────
    // Revoking forces the user to re-authenticate, so a type/permission change
    // (especially a downgrade) takes effect on their next request instead of
    // lingering until their current token happens to refresh (≤1h).
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
    await admin.auth().revokeRefreshTokens(uid);
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

    // Linking an employee record at creation must satisfy the SAME gate as the
    // dedicated PATCH /users/:uid/employee endpoint (users.linkEmployee). Without
    // this, a users.manage holder lacking users.linkEmployee could attach an
    // employee here, bypassing that gate.
    const linkedEmployeeId = typeof employeeId === "string" && employeeId ? employeeId : null;
    if (linkedEmployeeId) {
      const canLink =
        (req.permissions?.has("users.linkEmployee") || req.permissions?.has("system.admin")) ?? false;
      if (!canLink) {
        res.status(403).json({
          error: "K propojení uživatele se zaměstnancem je třeba oprávnění „Propojit uživatele se zaměstnancem“.",
        });
        return;
      }
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
        employeeId: linkedEmployeeId,
        active: true,
        createdAt: FieldValue.serverTimestamp(),
        lastLogin: null,
      });

      await logCreate(ctxFromReq(req), {
        collection: "users",
        resourceId: userRecord.uid,
        employeeId: linkedEmployeeId ?? undefined,
        summary: { name, email, roleType: typeId, employeeId: linkedEmployeeId },
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
 * Admin-only: disable a user account immediately.
 */
authRouter.patch(
  "/deactivate-user/:uid",
  requireAuth,
  requirePermission("users.manage"),
  async (req: AuthRequest, res) => {
    await deactivateUserCore(req.params.uid, ctxFromReq(req));
    res.json({ success: true });
  }
);

/**
 * PATCH /api/auth/schedule-deactivation/:uid
 * Admin-only: schedule an automatic deactivation for a future instant. The
 * account stays fully active until the runScheduledDeactivations job fires
 * (within ~5 min of the chosen time). Body: { at: ISO-8601 string }.
 */
authRouter.patch(
  "/schedule-deactivation/:uid",
  requireAuth,
  requirePermission("users.manage"),
  async (req: AuthRequest, res) => {
    const { uid } = req.params;
    const { at } = req.body as { at?: string };
    const when = at ? new Date(at) : null;
    if (!when || isNaN(when.getTime())) {
      return res.status(400).json({ error: "Neplatné datum a čas." });
    }
    // Compare against the (possibly overridden, non-prod) clock so scheduling
    // is testable under the test clock, matching how the job fires.
    await clock.refresh(true);
    if (when.getTime() <= clock.nowMs()) {
      return res.status(400).json({ error: "Naplánovaný čas musí být v budoucnosti." });
    }
    const userRef = admin.firestore().collection("users").doc(uid);
    const snap = await userRef.get();
    if (!snap.exists) return res.status(404).json({ error: "Uživatel nenalezen." });
    if (snap.get("active") !== true) {
      return res.status(400).json({ error: "Účet už je deaktivovaný." });
    }
    await userRef.update({
      scheduledDeactivationAt: Timestamp.fromDate(when),
      scheduledDeactivationBy: req.uid ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await logUpdate(ctxFromReq(req), {
      collection: "users",
      resourceId: uid,
      before: { scheduledDeactivationAt: null },
      after: { scheduledDeactivationAt: when.toISOString() },
    });
    return res.json({ success: true, scheduledDeactivationAt: when.toISOString() });
  }
);

/**
 * PATCH /api/auth/cancel-scheduled-deactivation/:uid
 * Admin-only: clear a pending scheduled deactivation. No-op-safe if none set.
 */
authRouter.patch(
  "/cancel-scheduled-deactivation/:uid",
  requireAuth,
  requirePermission("users.manage"),
  async (req: AuthRequest, res) => {
    const { uid } = req.params;
    const userRef = admin.firestore().collection("users").doc(uid);
    const snap = await userRef.get();
    if (!snap.exists) return res.status(404).json({ error: "Uživatel nenalezen." });
    const prev = snap.get("scheduledDeactivationAt") as Timestamp | null | undefined;
    await userRef.update({
      scheduledDeactivationAt: null,
      scheduledDeactivationBy: null,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await logUpdate(ctxFromReq(req), {
      collection: "users",
      resourceId: uid,
      before: { scheduledDeactivationAt: prev ? prev.toDate().toISOString() : null },
      after: { scheduledDeactivationAt: null },
    });
    return res.json({ success: true });
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
  // Resolve each linked employee's surname-first name server-side, so the
  // linked-employee column shows even for viewers without the employees list
  // (e.g. they can't link) and regardless of the employee's status.
  const empIds = [
    ...new Set(
      snapshot.docs
        .map((d) => (d.data() as Record<string, unknown>).employeeId as string | undefined)
        .filter((id): id is string => !!id)
    ),
  ];
  const empNames = new Map<string, string>();
  if (empIds.length) {
    const refs = empIds.map((id) => admin.firestore().collection("employees").doc(id));
    const empDocs = await admin.firestore().getAll(...refs);
    empDocs.forEach((d) => {
      if (!d.exists) return;
      const e = d.data() as Record<string, unknown>;
      empNames.set(d.id, `${(e.lastName as string ?? "").trim()} ${(e.firstName as string ?? "").trim()}`.trim());
    });
  }
  const users = snapshot.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>;
    const typeId = roleTypeFromUserDoc(data) ?? "";
    const employeeId = (data.employeeId as string) || null;
    // Emit the pending-deactivation instant as a clean ISO string (the raw
    // Firestore Timestamp serialises to an awkward {_seconds,_nanoseconds}).
    const schedAt = data.scheduledDeactivationAt as Timestamp | null | undefined;
    return {
      uid: doc.id,
      ...data,
      scheduledDeactivationAt: schedAt ? schedAt.toDate().toISOString() : null,
      roleTypeName: typeId ? typeNames.get(typeId) ?? typeId : null,
      employeeName: employeeId ? empNames.get(employeeId) ?? null : null,
    };
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
      scheduledDeactivationAt: null,
      scheduledDeactivationBy: null,
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
    const body = req.body as { recepceDefaultHotel?: unknown };
    const wantName = typeof name === "string" && name.trim().length > 0;
    const wantEmail = typeof email === "string" && email.trim().length > 0;
    // Absent = leave alone; null = clear. Distinguished with `in`, so that
    // clearing the default isn't read as "nothing to save".
    const wantDefaultHotel = "recepceDefaultHotel" in body;
    if (!wantName && !wantEmail && !wantDefaultHotel) {
      res.status(400).json({ error: "Není co uložit (jméno ani e-mail)." });
      return;
    }
    let defaultHotel: HotelSlug | null = null;
    if (wantDefaultHotel) {
      const raw = body.recepceDefaultHotel;
      if (raw !== null && !isHotelSlug(raw)) {
        res.status(400).json({ error: "Neplatný hotel." });
        return;
      }
      defaultHotel = raw;
    }

    const userRef = admin.firestore().collection("users").doc(uid);
    const beforeSnap = await userRef.get();
    if (!beforeSnap.exists) {
      res.status(404).json({ error: "Uživatel nenalezen." });
      return;
    }
    const before = beforeSnap.data() as Record<string, unknown>;

    // A default hotel picks which accessible hotel opens first; it must never be
    // a hotel the TARGET user cannot see. Validate against *their* effective
    // permissions, not the admin's — the admin can see every hotel.
    if (wantDefaultHotel && defaultHotel !== null) {
      const theirPerms = await resolveEffectivePermissions({
        roleType: before.roleType as string | undefined,
        extra: (before.extraPermissions as string[] | undefined) ?? [],
        revoked: (before.revokedPermissions as string[] | undefined) ?? [],
      });
      if (!theirPerms.has(hotelViewPerm(defaultHotel)) && !theirPerms.has("system.admin")) {
        res.status(400).json({ error: "Uživatel nemá k tomuto hotelu přístup." });
        return;
      }
    }

    try {
      const authUpdate: { displayName?: string; email?: string } = {};
      const fsUpdate: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
      if (wantName) { authUpdate.displayName = name!.trim(); fsUpdate.name = name!.trim(); }
      if (wantEmail) { authUpdate.email = email!.trim(); fsUpdate.email = email!.trim(); }
      if (wantDefaultHotel) fsUpdate.recepceDefaultHotel = defaultHotel;

      // Update the Auth record first (it's the one that can fail on a duplicate
      // email); only then mirror into Firestore. Skipped when only the default
      // hotel changed — there is nothing in the Auth record to touch.
      if (wantName || wantEmail) await admin.auth().updateUser(uid, authUpdate);
      await userRef.update(fsUpdate);

      await logUpdate(ctxFromReq(req), {
        collection: "users",
        resourceId: uid,
        before: { name: before.name, email: before.email, recepceDefaultHotel: before.recepceDefaultHotel ?? null },
        after: {
          name: fsUpdate.name ?? before.name,
          email: fsUpdate.email ?? before.email,
          recepceDefaultHotel: wantDefaultHotel ? defaultHotel : (before.recepceDefaultHotel ?? null),
        },
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
  // The token claim is authoritative and always carries roleType; the doc field
  // is only a mirror, and legacy docs have `role` instead. Prefer the claim, and
  // fall back through both doc generations.
  const typeId = req.roleType || roleTypeFromUserDoc(data) || "";
  let roleTypeName: string | null = null;
  // Shared-terminal flag drives the "who is really requesting?" picker on the
  // shift planner (Recepce etc. share one login). Read from the same roleType doc.
  let sharedTerminal = false;
  // No-self-logout flag: the sidebar/mobile "Odhlásit" opens the authorization
  // modal instead of signing out. Same doc read as sharedTerminal above.
  let noSelfLogout = false;
  if (typeId) {
    const t = await admin.firestore().collection(ROLE_TYPES_COLLECTION).doc(typeId).get();
    const td = t.exists ? (t.data() as Record<string, unknown>) : null;
    roleTypeName = td ? ((td.name as string) ?? typeId) : typeId;
    sharedTerminal = td?.sharedTerminal === true;
    noSelfLogout = td?.noSelfLogout === true;
  }
  res.json({ uid: doc.id, ...data, permissions, roleTypeName, sharedTerminal, noSelfLogout });
});

// ─── No-self-logout release (shared terminals) ────────────────────────────────
// Accounts whose type carries `noSelfLogout` cannot sign themselves out; a
// superior authorizes by picking their own name and typing their password. The
// client verifies that password on a SEPARATE Firebase app (lib/secondaryAuth.ts)
// so the primary session is never disturbed, and posts the resulting idToken
// here. We re-verify it server-side and evaluate the AUTHORIZER's permissions
// from the decoded token's claims — never the logged-in terminal account's.
//
// This is a UX guard, not a security boundary: sign-out is client-side, so
// devtools can always end the session regardless. The endpoint exists to prove
// authorization happened and to record who granted it.

/** Live `noSelfLogout` read for a user type — same uncached doc read /auth/me
 *  makes, so the two can never disagree. Fails open (false) on a read error:
 *  a Firestore blip must not strand anyone on a terminal. */
async function readNoSelfLogoutLive(roleType: string | undefined): Promise<boolean> {
  if (!roleType) return false;
  try {
    const t = await admin.firestore().collection(ROLE_TYPES_COLLECTION).doc(roleType).get();
    return t.exists && (t.data() as Record<string, unknown>).noSelfLogout === true;
  } catch {
    return false;
  }
}

/**
 * GET /api/auth/logout-authorizers
 * The pool of people who may release this terminal: everyone holding
 * `system.logout.authorize` (or `system.admin`). Returns `[{ uid, name, email,
 * label }]` — the exact shape SignModal's `Signer` expects. `email` is the real
 * login, which is what the password check runs against.
 *
 * Restricted to accounts that actually need it (types flagged noSelfLogout), so
 * the response — real names paired with login emails — is not enumerable by every
 * authenticated user.
 */
authRouter.get("/logout-authorizers", requireAuth, async (req: AuthRequest, res) => {
  // Read the flag LIVE, exactly as /auth/me does. The cached accessor would
  // disagree with /auth/me for up to the roleTypes cache TTL after an admin
  // toggles the flag (clearRoleTypeCache only clears the instance that served
  // the write), and that skew would open the modal to an empty authorizer list.
  if (!(await readNoSelfLogoutLive(req.roleType))) {
    res.status(403).json({ error: "Tento účet se odhlašuje bez autorizace." });
    return;
  }
  const usersSnap = await admin.firestore().collection("users").get();
  const included: Array<{ uid: string; name: string; email: string; employeeId: string | null }> = [];
  const seenEmp = new Set<string>();
  for (const d of usersSnap.docs) {
    const u = d.data() as {
      name?: unknown;
      email?: unknown;
      employeeId?: unknown;
      active?: unknown;
      roleType?: unknown;
      extraPermissions?: unknown;
      revokedPermissions?: unknown;
    };
    if (u.active === false) continue;
    const name = typeof u.name === "string" ? u.name : "";
    const email = typeof u.email === "string" ? u.email : "";
    // Authorizing re-verifies the password, so an authorizer needs a real email.
    if (email.trim() === "") continue;
    const perms = await resolveEffectivePermissions({
      roleType: roleTypeFromUserDoc(u),
      extra: Array.isArray(u.extraPermissions) ? (u.extraPermissions as string[]) : [],
      revoked: Array.isArray(u.revokedPermissions) ? (u.revokedPermissions as string[]) : [],
    });
    if (!perms.has("system.admin") && !perms.has("system.logout.authorize")) continue;
    const empId = typeof u.employeeId === "string" ? u.employeeId : null;
    if (empId) {
      if (seenEmp.has(empId)) continue;
      seenEmp.add(empId);
    }
    included.push({ uid: d.id, name, email, employeeId: empId });
  }

  // LIVE employee-name labels (displayName || "First Last"), surname-first sort —
  // same convention as the handover signer pickers.
  const displays = await resolveEmployeeDisplays(included.map((e) => e.employeeId ?? ""));
  const out = included.map((e) => {
    const disp = e.employeeId ? displays.get(e.employeeId) : undefined;
    const label = disp?.name || e.name;
    const sortKey = disp?.sortKey || label.toLowerCase();
    return { uid: e.uid, name: e.name, email: e.email, label, sortKey };
  });
  out.sort((a, b) => a.sortKey.localeCompare(b.sortKey, "cs"));
  res.json(out.map(({ sortKey, ...s }) => s));
});

/**
 * POST /api/auth/logout-authorize   body: { idToken }
 * Verifies the authorizer's password-proven idToken and confirms they hold
 * `system.logout.authorize` (or `system.admin`). On success the client signs the
 * terminal out. Every authorization is recorded to auditLog/ — the entry is
 * attributed to the terminal account (ctxFromReq) and names the authorizer.
 */
authRouter.post("/logout-authorize", requireAuth, async (req: AuthRequest, res) => {
  const body = req.body as { idToken?: unknown };
  if (typeof body.idToken !== "string" || body.idToken.trim() === "") {
    res.status(400).json({ error: "Chybí ověření." });
    return;
  }
  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(body.idToken);
  } catch {
    res.status(401).json({ error: "Neplatné jméno nebo heslo." });
    return;
  }
  // Permissions of the password-proven identity, from ITS claims — independent
  // of the shared account that is making this request.
  const perms = await resolveEffectivePermissions({
    roleType: typeof decoded.roleType === "string" ? decoded.roleType : undefined,
    extra: Array.isArray(decoded.extraPermissions) ? (decoded.extraPermissions as string[]) : [],
    revoked: Array.isArray(decoded.revokedPermissions) ? (decoded.revokedPermissions as string[]) : [],
  });
  if (!perms.has("system.admin") && !perms.has("system.logout.authorize")) {
    res.status(403).json({ error: "Tento uživatel nemá oprávnění autorizovat odhlášení." });
    return;
  }

  const authorizer = await resolveLogoutAuthorizerName(decoded.uid, decoded.email ?? "");
  await logUpdate(ctxFromReq(req), {
    collection: "users",
    resourceId: req.uid!,
    before: { logoutAuthorizedBy: null },
    after: { logoutAuthorizedBy: authorizer },
  });
  res.json({ ok: true, authorizedBy: authorizer });
});

/** Authorizer's display name for the audit entry: live employee name, else the
 *  users/ record name, else the login email. */
async function resolveLogoutAuthorizerName(uid: string, fallbackEmail: string): Promise<string> {
  try {
    const u = await admin.firestore().collection("users").doc(uid).get();
    const ud = u.exists ? (u.data() as { name?: unknown; employeeId?: unknown }) : null;
    const empId = typeof ud?.employeeId === "string" ? ud.employeeId : null;
    if (empId) {
      const displays = await resolveEmployeeDisplays([empId]);
      const disp = displays.get(empId);
      if (disp?.name) return disp.name;
    }
    if (typeof ud?.name === "string" && ud.name.trim()) return ud.name;
  } catch {
    /* fall through to the email */
  }
  return fallbackEmail;
}

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
 * GET /api/auth/me/recepce-default
 * The hotel the Recepce hub opens on for this user, or null when unset.
 */
authRouter.get("/me/recepce-default", requireAuth, async (req: AuthRequest, res) => {
  const doc = await admin.firestore().collection("users").doc(req.uid!).get();
  const hotel = doc.exists ? (doc.data()?.recepceDefaultHotel ?? null) : null;
  res.json({ hotel });
});

/**
 * PUT /api/auth/me/recepce-default
 * Body: { hotel: HotelSlug | null }. Self-service, like the theme preference —
 * requireAuth only, no permission key, because a user may only ever set their
 * OWN default. `null` clears it.
 *
 * The default picks which accessible hotel opens first; it never GRANTS access.
 * Rejecting a hotel the caller cannot view keeps the stored value honest, and
 * the read path filters it against live permissions anyway, so a default left
 * behind by a later revoke simply falls through to the next candidate.
 */
authRouter.put("/me/recepce-default", requireAuth, async (req: AuthRequest, res) => {
  const { hotel } = req.body as { hotel: unknown };
  if (hotel !== null && !isHotelSlug(hotel)) {
    res.status(400).json({ error: "Neplatný hotel." });
    return;
  }
  if (hotel !== null && !(req.permissions ?? new Set<string>()).has(hotelViewPerm(hotel)) && !(req.permissions ?? new Set<string>()).has("system.admin")) {
    res.status(403).json({ error: "K tomuto hotelu nemáte přístup." });
    return;
  }
  await admin.firestore().collection("users").doc(req.uid!).set(
    { recepceDefaultHotel: hotel, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  res.json({ hotel });
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
