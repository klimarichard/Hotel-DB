import { Router } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, requireRole, AuthRequest, UserRole } from "../middleware/auth";
import { ctxFromReq, logCreate, logUpdate } from "../services/auditLog";

export const authRouter = Router();

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
    const validRoles: UserRole[] = ["admin", "director", "manager", "employee"];

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
      password: string;
      name: string;
      role: UserRole;
      employeeId?: string;
    };

    const validRoles: UserRole[] = ["admin", "director", "manager", "employee"];
    if (!email || !password || !name || !validRoles.includes(role)) {
      res.status(400).json({ error: "email, password, name, and valid role are required" });
      return;
    }

    const userRecord = await admin.auth().createUser({ email, password, displayName: name });
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

    res.status(201).json({ uid: userRecord.uid });
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
