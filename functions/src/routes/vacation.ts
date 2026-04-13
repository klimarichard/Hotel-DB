import { Router } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, requireRole, AuthRequest } from "../middleware/auth";
import { applyVacationXsToPlans } from "./shifts";

export const vacationRouter = Router();
const db = () => admin.firestore();

// ─── GET /vacation ────────────────────────────────────────────────────────────
// Admin/director: all requests; others: own requests only

vacationRouter.get("/", requireAuth, async (req: AuthRequest, res) => {
  const role = req.role;
  let query: admin.firestore.Query = db()
    .collection("vacationRequests")
    .orderBy("requestedAt", "desc");

  if (role !== "admin" && role !== "director") {
    query = query.where("uid", "==", req.uid!);
  }

  const snap = await query.get();
  res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
});

// ─── POST /vacation ───────────────────────────────────────────────────────────
// Any authenticated user submits a vacation request for themselves

vacationRouter.post("/", requireAuth, async (req: AuthRequest, res) => {
  const body = req.body as Record<string, unknown>;
  const startDate = (body.startDate as string) ?? "";
  const endDate = (body.endDate as string) ?? "";
  const reason = (body.reason as string) ?? "";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    res.status(400).json({ error: "Neplatný formát data (YYYY-MM-DD)" });
    return;
  }
  if (startDate > endDate) {
    res.status(400).json({ error: "Datum začátku musí být před datem konce" });
    return;
  }

  // Fetch user profile to get employeeId, firstName, lastName
  const userDoc = await db().collection("users").doc(req.uid!).get();
  if (!userDoc.exists) {
    res.status(404).json({ error: "Uživatelský profil nenalezen" });
    return;
  }
  const userData = userDoc.data() as Record<string, unknown>;
  const employeeId = (userData.employeeId as string | null) ?? null;
  if (!employeeId) {
    res.status(400).json({ error: "Uživatel nemá přiřazeného zaměstnance" });
    return;
  }

  // Fetch employee name for denormalization
  const empDoc = await db().collection("employees").doc(employeeId).get();
  const empData = empDoc.exists ? (empDoc.data() as Record<string, unknown>) : {};
  const firstName = (empData.firstName as string) ?? (userData.name as string) ?? "";
  const lastName = (empData.lastName as string) ?? "";

  const ref = await db().collection("vacationRequests").add({
    employeeId,
    firstName,
    lastName,
    uid: req.uid,
    startDate,
    endDate,
    reason,
    status: "pending",
    requestedAt: FieldValue.serverTimestamp(),
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
  });

  res.status(201).json({ id: ref.id });
});

// ─── PATCH /vacation/:id ──────────────────────────────────────────────────────
// Admin/director only: approve or reject

vacationRouter.patch(
  "/:id",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res) => {
    const { id } = req.params;
    const body = req.body as Record<string, unknown>;
    const status = body.status as string;

    if (!["approved", "rejected"].includes(status)) {
      res.status(400).json({ error: "Stav musí být approved nebo rejected" });
      return;
    }

    const docRef = db().collection("vacationRequests").doc(id);
    const doc = await docRef.get();
    if (!doc.exists) {
      res.status(404).json({ error: "Žádost nenalezena" });
      return;
    }

    const data = doc.data() as Record<string, unknown>;

    await docRef.update({
      status,
      reviewedBy: req.uid ?? null,
      reviewedAt: FieldValue.serverTimestamp(),
      rejectionReason: status === "rejected" ? ((body.rejectionReason as string) ?? null) : null,
    });

    // On approval: apply X shifts to any existing plans in the date range
    if (status === "approved") {
      await applyVacationXsToPlans(
        data.employeeId as string,
        data.startDate as string,
        data.endDate as string
      );
    }

    res.json({ ok: true });
  }
);

// ─── DELETE /vacation/:id ─────────────────────────────────────────────────────
// Own pending requests, or admin/director

vacationRouter.delete("/:id", requireAuth, async (req: AuthRequest, res) => {
  const { id } = req.params;
  const role = req.role;

  const docRef = db().collection("vacationRequests").doc(id);
  const doc = await docRef.get();
  if (!doc.exists) {
    res.status(404).json({ error: "Žádost nenalezena" });
    return;
  }

  const data = doc.data() as Record<string, unknown>;

  const isOwn = data.uid === req.uid;
  const isAdmin = role === "admin" || role === "director";

  if (!isOwn && !isAdmin) {
    res.status(403).json({ error: "Nemáte oprávnění smazat tuto žádost" });
    return;
  }
  if (data.status !== "pending") {
    res.status(400).json({ error: "Lze smazat pouze čekající žádost" });
    return;
  }

  await docRef.delete();
  res.json({ ok: true });
});
