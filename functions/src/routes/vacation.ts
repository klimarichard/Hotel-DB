import { Router } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, requireRole, AuthRequest } from "../middleware/auth";
import { applyVacationXsToPlans, removeVacationXsFromPlans } from "./shifts";

export const vacationRouter = Router();
const db = () => admin.firestore();

// ─── GET /vacation/check — does an approved vacation cover a specific date? ────
// Used before deleting an X shift to warn the user.

vacationRouter.get("/check", requireAuth, async (req: AuthRequest, res) => {
  const { employeeId, date } = req.query as { employeeId?: string; date?: string };
  if (!employeeId || !date) {
    res.status(400).json({ error: "employeeId and date are required" });
    return;
  }
  const snap = await db()
    .collection("vacationRequests")
    .where("employeeId", "==", employeeId)
    .where("status", "==", "approved")
    .get();

  const hasVacation = snap.docs.some((d) => {
    const data = d.data() as Record<string, string>;
    return data.startDate <= date && data.endDate >= date;
  });

  res.json({ hasVacation });
});

// ─── GET /vacation/pending-count — dashboard tile count ───────────────────────
// Sums requests needing admin/director attention: still-pending originals plus
// approved-but-edited requests whose edit hasn't been reviewed.

vacationRouter.get(
  "/pending-count",
  requireAuth,
  requireRole("admin", "director"),
  async (_req, res) => {
    const [pendingSnap, editSnap] = await Promise.all([
      db()
        .collection("vacationRequests")
        .where("status", "==", "pending")
        .get(),
      db()
        .collection("vacationRequests")
        .where("status", "==", "approved")
        .where("pendingEdit", "!=", null)
        .get(),
    ]);
    res.json({ count: pendingSnap.size + editSnap.size });
  }
);

// ─── GET /vacation/approved-upcoming ──────────────────────────────────────────
// Lightweight list of approved vacations whose endDate is today or later, for
// every authenticated user. Only name + date range fields are returned so
// employees can see where colleagues already have approved vacation without
// leaking reasons or other metadata. Sorted by startDate ascending.

vacationRouter.get("/approved-upcoming", requireAuth, async (_req, res) => {
  // YYYY-MM-DD in the Prague timezone, regardless of Cloud Functions TZ.
  const todayYMD = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Prague",
  }).format(new Date());

  const snap = await db()
    .collection("vacationRequests")
    .where("status", "==", "approved")
    .get();

  const rows = snap.docs
    .map((d) => d.data() as Record<string, unknown>)
    .filter((v) => ((v.endDate as string) ?? "") >= todayYMD)
    .map((v) => ({
      employeeId: (v.employeeId as string) ?? "",
      firstName: (v.firstName as string) ?? "",
      lastName: (v.lastName as string) ?? "",
      startDate: (v.startDate as string) ?? "",
      endDate: (v.endDate as string) ?? "",
    }))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  res.json(rows);
});

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
// Two modes detected by request body:
//   { startDate, endDate, reason } → employee edit (own request)
//   { status }                     → admin/director approve or reject

vacationRouter.patch("/:id", requireAuth, async (req: AuthRequest, res) => {
  const { id } = req.params;
  const body = req.body as Record<string, unknown>;
  const role = req.role;
  const isAdminOrDirector = role === "admin" || role === "director";

  const docRef = db().collection("vacationRequests").doc(id);
  const doc = await docRef.get();
  if (!doc.exists) {
    res.status(404).json({ error: "Žádost nenalezena" });
    return;
  }
  const data = doc.data() as Record<string, unknown>;

  // ── Employee edit ──────────────────────────────────────────────────────────
  if ("startDate" in body) {
    const isOwn = data.uid === req.uid;
    if (!isOwn && !isAdminOrDirector) {
      res.status(403).json({ error: "Nemáte oprávnění upravit tuto žádost" });
      return;
    }
    if (data.status === "rejected") {
      res.status(400).json({ error: "Zamítnutou žádost nelze upravit" });
      return;
    }
    if (data.pendingEdit) {
      res.status(400).json({ error: "Úprava již čeká na schválení" });
      return;
    }

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

    if (data.status === "pending") {
      // Pending request — update dates directly, no approval needed
      await docRef.update({ startDate, endDate, reason });
    } else {
      // Approved request — store as pending edit; original dates stay until approved
      await docRef.update({ pendingEdit: { startDate, endDate, reason } });
    }

    res.json({ ok: true });
    return;
  }

  // ── Admin approve / reject ─────────────────────────────────────────────────
  if (!isAdminOrDirector) {
    res.status(403).json({ error: "Nemáte oprávnění" });
    return;
  }

  const status = body.status as string;
  if (!["approved", "rejected"].includes(status)) {
    res.status(400).json({ error: "Stav musí být approved nebo rejected" });
    return;
  }

  const pendingEdit = data.pendingEdit as
    | { startDate: string; endDate: string; reason: string }
    | null
    | undefined;

  if (pendingEdit) {
    // Acting on a pending edit of an already-approved request
    if (status === "approved") {
      const oldStart = data.startDate as string;
      const oldEnd = data.endDate as string;
      const { startDate: newStart, endDate: newEnd, reason: newReason } = pendingEdit;

      await docRef.update({
        startDate: newStart,
        endDate: newEnd,
        reason: newReason,
        pendingEdit: null,
        reviewedBy: req.uid ?? null,
        reviewedAt: FieldValue.serverTimestamp(),
      });
      // Remove old X shifts, then write new ones
      await removeVacationXsFromPlans(data.employeeId as string, oldStart, oldEnd);
      await applyVacationXsToPlans(data.employeeId as string, newStart, newEnd);
    } else {
      // Reject the edit — keep current approved dates, clear pendingEdit
      await docRef.update({
        pendingEdit: null,
        reviewedBy: req.uid ?? null,
        reviewedAt: FieldValue.serverTimestamp(),
      });
    }
  } else {
    // Normal approve/reject of a pending request
    if (data.status !== "pending") {
      res.status(400).json({ error: "Žádost není ve stavu čekání" });
      return;
    }

    await docRef.update({
      status,
      reviewedBy: req.uid ?? null,
      reviewedAt: FieldValue.serverTimestamp(),
      rejectionReason: status === "rejected" ? ((body.rejectionReason as string) ?? null) : null,
    });

    if (status === "approved") {
      await applyVacationXsToPlans(
        data.employeeId as string,
        data.startDate as string,
        data.endDate as string
      );
    }
  }

  res.json({ ok: true });
});

// ─── DELETE /vacation/:id ─────────────────────────────────────────────────────
// Own pending or approved requests (no pendingEdit on approved), or admin/director

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

  const wasApproved = data.status === "approved";

  await docRef.delete();

  if (wasApproved) {
    await removeVacationXsFromPlans(
      data.employeeId as string,
      data.startDate as string,
      data.endDate as string
    );
  }

  res.json({ ok: true });
});
