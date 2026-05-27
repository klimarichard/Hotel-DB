import { Router } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, requireRole, AuthRequest, UserRole } from "../middleware/auth";
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
 * POST /api/auth/set-role
 * Admin-only: set a custom role claim on a user.
 * Body: { uid: string, role: UserRole }
 */
authRouter.post(
  "/set-role",
  requireAuth,
  requireRole("admin"),
  async (req: AuthRequest, res) => {
    const { uid, role } = req.body as { uid: string; role: UserRole };
    const validRoles: UserRole[] = ["admin", "director", "manager", "employee", "accountant", "hr"];

    if (!uid || !validRoles.includes(role)) {
      res.status(400).json({ error: "uid and a valid role are required" });
      return;
    }

    const userRef = admin.firestore().collection("users").doc(uid);
    const beforeSnap = await userRef.get();
    const before = beforeSnap.exists ? (beforeSnap.data() as Record<string, unknown>) : {};

    await admin.auth().setCustomUserClaims(uid, { role });

    // Also update the users/ collection
    await userRef.set(
      { role, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );

    await logUpdate(ctxFromReq(req), {
      collection: "users",
      resourceId: uid,
      before: { role: before.role },
      after: { role },
    });

    res.json({ success: true });
  }
);

/**
 * POST /api/auth/create-user
 * Admin-only: create a Firebase Auth user and store in users/ collection.
 * Body: { email, password, name, role, employeeId? }
 */
authRouter.post(
  "/create-user",
  requireAuth,
  requireRole("admin"),
  async (req: AuthRequest, res) => {
    const { email, password, name, role, employeeId } = req.body as {
      email: string;
      password?: string;
      name: string;
      role: UserRole;
      employeeId?: string;
    };

    const validRoles: UserRole[] = ["admin", "director", "manager", "employee", "accountant", "hr"];
    if (!email || !name || !validRoles.includes(role)) {
      res.status(400).json({ error: "email, name, and valid role are required" });
      return;
    }
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
      await admin.auth().setCustomUserClaims(userRecord.uid, { role });

      await admin.firestore().collection("users").doc(userRecord.uid).set({
        name,
        email,
        role,
        employeeId: employeeId ?? null,
        active: true,
        createdAt: FieldValue.serverTimestamp(),
        lastLogin: null,
      });

      await logCreate(ctxFromReq(req), {
        collection: "users",
        resourceId: userRecord.uid,
        employeeId: employeeId ?? undefined,
        summary: { name, email, role, employeeId: employeeId ?? null },
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
  requireRole("admin"),
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
authRouter.get("/users", requireAuth, requireRole("admin"), async (_req, res) => {
  const snapshot = await admin.firestore().collection("users").orderBy("name").get();
  const users = snapshot.docs.map((doc) => ({ uid: doc.id, ...doc.data() }));
  res.json(users);
});

/**
 * PATCH /api/auth/reactivate-user/:uid
 * Admin-only: re-enable a previously disabled user account.
 */
authRouter.patch(
  "/reactivate-user/:uid",
  requireAuth,
  requireRole("admin"),
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
  requireRole("admin"),
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
  requireRole("admin"),
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
  res.json({ uid: doc.id, ...doc.data() });
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
