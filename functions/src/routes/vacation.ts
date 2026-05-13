import { Router } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, requireRole, AuthRequest } from "../middleware/auth";
import { applyVacationXsToPlans, removeVacationXsFromPlans, findShiftCollisions } from "./shifts";
import { ctxFromReq, logCreate, logUpdate, logDelete } from "../services/auditLog";

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
// Lightweight list of approved vacations starting today or later, scoped to
// rank-and-file employees only. Returned to every authenticated user so
// employees can see where colleagues already have approved vacation without
// leaking reasons or other metadata. Sorted by startDate ascending.

vacationRouter.get("/approved-upcoming", requireAuth, async (_req, res) => {
  // YYYY-MM-DD in the Prague timezone, regardless of Cloud Functions TZ.
  const todayYMD = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Prague",
  }).format(new Date());

  const [vacSnap, employeeUsersSnap] = await Promise.all([
    db().collection("vacationRequests").where("status", "==", "approved").get(),
    db().collection("users").where("role", "==", "employee").get(),
  ]);

  const employeeUids = new Set(employeeUsersSnap.docs.map((d) => d.id));

  const rows = vacSnap.docs
    .map((d) => d.data() as Record<string, unknown>)
    .filter((v) => ((v.startDate as string) ?? "") >= todayYMD)
    .filter((v) => employeeUids.has((v.uid as string) ?? ""))
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

// ─── GET /vacation/check-collisions ──────────────────────────────────────────
// Pre-check used by the UI before submitting a vacation request or before an
// admin/director approves one. Employees can only check their own employeeId
// (matched against users/{uid}.employeeId); admin/director can check anyone.

vacationRouter.get(
  "/check-collisions",
  requireAuth,
  async (req: AuthRequest, res) => {
    const { employeeId, startDate, endDate } = req.query as {
      employeeId?: string;
      startDate?: string;
      endDate?: string;
    };
    if (!employeeId || !startDate || !endDate) {
      res.status(400).json({ error: "employeeId, startDate, endDate are required" });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      res.status(400).json({ error: "Neplatný formát data (YYYY-MM-DD)" });
      return;
    }

    const role = req.role;
    const isAdminOrDirector = role === "admin" || role === "director";
    if (!isAdminOrDirector) {
      const userDoc = await db().collection("users").doc(req.uid!).get();
      const userEmpId = userDoc.exists
        ? ((userDoc.data() as Record<string, unknown>).employeeId as string | null)
        : null;
      if (userEmpId !== employeeId) {
        res.status(403).json({ error: "Nemáte oprávnění" });
        return;
      }
    }

    const collisions = await findShiftCollisions(employeeId, startDate, endDate);
    res.json({ collisions });
  }
);

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

  // Hard-block if any non-X shift already exists in the requested date range.
  const collisions = await findShiftCollisions(employeeId, startDate, endDate);
  if (collisions.length > 0) {
    res.status(409).json({ error: "shift_collision", collisions });
    return;
  }

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

  await logCreate(ctxFromReq(req), {
    collection: "vacationRequests",
    resourceId: ref.id,
    employeeId,
    summary: { startDate, endDate, reason, status: "pending" },
  });

  res.status(201).json({ id: ref.id, firstName, lastName });
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

    // Hard-block if the new dates collide with non-X shifts.
    const editCollisions = await findShiftCollisions(
      data.employeeId as string,
      startDate,
      endDate
    );
    if (editCollisions.length > 0) {
      res.status(409).json({ error: "shift_collision", collisions: editCollisions });
      return;
    }

    if (data.status === "pending") {
      // Pending request — update dates directly, no approval needed
      await docRef.update({ startDate, endDate, reason });
      await logUpdate(ctxFromReq(req), {
        collection: "vacationRequests",
        resourceId: id,
        employeeId: data.employeeId as string,
        before: { startDate: data.startDate, endDate: data.endDate, reason: data.reason },
        after: { startDate, endDate, reason },
      });
    } else {
      // Approved request — store as pending edit; original dates stay until approved
      await docRef.update({ pendingEdit: { startDate, endDate, reason } });
      await logUpdate(ctxFromReq(req), {
        collection: "vacationRequests",
        resourceId: id,
        employeeId: data.employeeId as string,
        before: { pendingEdit: data.pendingEdit ?? null },
        after: { pendingEdit: { startDate, endDate, reason } },
      });
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

  // Client-side resolution payload: array of YYYY-MM-DD dates the user
  // explicitly chose to KEEP (i.e. don't overwrite with X). Anything not
  // in this list — including all other collision dates — is implicitly an
  // overwrite.
  //
  // Presence of the field signals "the user came through the resolution
  // dialog, trust their choice"; absence means "no dialog yet — gate on
  // collisions and force the UI to open the dialog by returning 409".
  const excludeProvided = "excludeDates" in body;
  const rawExcluded = body.excludeDates;
  const excludeDates: string[] = Array.isArray(rawExcluded)
    ? (rawExcluded as unknown[]).filter((x): x is string => typeof x === "string")
    : [];

  const beforeForLog: Record<string, unknown> = {
    status: data.status,
    startDate: data.startDate,
    endDate: data.endDate,
    pendingEdit: data.pendingEdit ?? null,
  };

  if (pendingEdit) {
    // Acting on a pending edit of an already-approved request
    if (status === "approved") {
      const oldStart = data.startDate as string;
      const oldEnd = data.endDate as string;
      const { startDate: newStart, endDate: newEnd, reason: newReason } = pendingEdit;

      // Force the resolution dialog if the caller hasn't sent excludeDates yet.
      if (!excludeProvided) {
        const collisions = await findShiftCollisions(
          data.employeeId as string,
          newStart,
          newEnd
        );
        if (collisions.length > 0) {
          res.status(409).json({ error: "shift_collision", collisions });
          return;
        }
      }

      await docRef.update({
        startDate: newStart,
        endDate: newEnd,
        reason: newReason,
        pendingEdit: null,
        excludedDates: excludeDates,
        reviewedBy: req.uid ?? null,
        reviewedAt: FieldValue.serverTimestamp(),
      });
      // Remove old X shifts, then write new ones (applyVacationXs reads
      // the request's excludedDates field and skips those days)
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

    if (status === "approved" && !excludeProvided) {
      const collisions = await findShiftCollisions(
        data.employeeId as string,
        data.startDate as string,
        data.endDate as string
      );
      if (collisions.length > 0) {
        res.status(409).json({ error: "shift_collision", collisions });
        return;
      }
    }

    await docRef.update({
      status,
      reviewedBy: req.uid ?? null,
      reviewedAt: FieldValue.serverTimestamp(),
      rejectionReason: status === "rejected" ? ((body.rejectionReason as string) ?? null) : null,
      ...(status === "approved" ? { excludedDates: excludeDates } : {}),
    });

    if (status === "approved") {
      await applyVacationXsToPlans(
        data.employeeId as string,
        data.startDate as string,
        data.endDate as string
      );
    }
  }

  // Re-read for the after-snapshot
  const afterSnap = await docRef.get();
  const afterData = afterSnap.exists ? (afterSnap.data() as Record<string, unknown>) : {};
  await logUpdate(ctxFromReq(req), {
    collection: "vacationRequests",
    resourceId: id,
    employeeId: data.employeeId as string,
    before: beforeForLog,
    after: {
      status: afterData.status,
      startDate: afterData.startDate,
      endDate: afterData.endDate,
      pendingEdit: afterData.pendingEdit ?? null,
      rejectionReason: afterData.rejectionReason ?? null,
    },
  });

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

  await logDelete(ctxFromReq(req), {
    collection: "vacationRequests",
    resourceId: id,
    employeeId: data.employeeId as string,
    summary: {
      startDate: data.startDate,
      endDate: data.endDate,
      reason: data.reason,
      status: data.status,
    },
  });

  res.json({ ok: true });
});
