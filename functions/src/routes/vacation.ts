import { Router } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { requirePermission } from "../auth/permissions";
import { applyVacationXsToPlans, removeVacationXsFromPlans, findShiftCollisions } from "./shifts";
import { getManagementEmployeeIds } from "./employees";
import { ctxFromReq, logCreate, logUpdate, logDelete } from "../services/auditLog";
import { resolveEmployeeNameParts, preferLive } from "../services/employeeNames";

export const vacationRouter = Router();
const db = () => admin.firestore();

// Resolve the requesting user's linked employeeId. Vacation "ownership" keys off
// this STABLE id rather than the auth uid: prod accounts were recreated after the
// staging→prod data migration, so migrated requests carry stale staging uids
// while their employeeId stays correct (the shift plan already uses employeeId).
async function requesterEmployeeId(uid: string | undefined): Promise<string | null> {
  if (!uid) return null;
  const snap = await db().collection("users").doc(uid).get();
  return snap.exists ? (((snap.data() as Record<string, unknown>).employeeId as string | null) ?? null) : null;
}

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

// ─── GET /vacation/employees — roster for "file vacation for anyone" ──────────
// Lightweight {id, firstName, lastName} list of non-terminated employees, gated
// by vacation.request.forAny so the capability is self-contained (the holder
// need not also have employees.view.all). Sorted by surname then first name.

vacationRouter.get(
  "/employees",
  requireAuth,
  requirePermission("vacation.request.forAny"),
  async (_req: AuthRequest, res) => {
    const snap = await db().collection("employees").get();
    const employees = snap.docs
      .map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          firstName: (data.firstName as string) ?? "",
          lastName: (data.lastName as string) ?? "",
          status: (data.status as string) ?? "active",
        };
      })
      .filter((e) => e.status !== "terminated")
      .sort((a, b) =>
        (a.lastName || "").localeCompare(b.lastName || "", "cs") ||
        (a.firstName || "").localeCompare(b.firstName || "", "cs")
      )
      .map(({ id, firstName, lastName }) => ({ id, firstName, lastName }));
    res.json(employees);
  }
);

// ─── GET /vacation/pending-count — dashboard tile count ───────────────────────
// Sums requests needing admin/director attention: still-pending originals plus
// approved-but-edited requests whose edit hasn't been reviewed.

vacationRouter.get(
  "/pending-count",
  requireAuth,
  requirePermission("vacation.review"),
  async (_req, res) => {
    // Two single-field equality queries (status) — both served by Firestore's
    // automatic index. We deliberately do NOT combine status == "approved" with
    // a `pendingEdit != null` filter: that needs a composite index that isn't in
    // firestore.indexes.json, so on real Firestore the query throws
    // FAILED_PRECONDITION, the endpoint 500s, and the frontend (which swallows
    // the error) shows a stale 0 — no badge anywhere. Filter the edits in JS.
    const [pendingSnap, approvedSnap] = await Promise.all([
      db()
        .collection("vacationRequests")
        .where("status", "==", "pending")
        .get(),
      db()
        .collection("vacationRequests")
        .where("status", "==", "approved")
        .get(),
    ]);
    const editCount = approvedSnap.docs.filter(
      (d) => (d.data() as Record<string, unknown>).pendingEdit != null
    ).length;
    res.json({ count: pendingSnap.size + editCount });
  }
);

// ─── GET /vacation/approved-upcoming ──────────────────────────────────────────
// Lightweight list of approved vacations that haven't ended yet (endDate
// today or later — includes ongoing vacations), scoped to NON-management staff
// (colleagues). Returned to every authenticated user so employees can see
// where colleagues already have approved vacation without leaking reasons
// or other metadata. Sorted by startDate ascending.

vacationRouter.get("/approved-upcoming", requireAuth, async (_req, res) => {
  // YYYY-MM-DD in the Prague timezone, regardless of Cloud Functions TZ.
  const todayYMD = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Prague",
  }).format(new Date());

  // Exclude vacations belonging to management staff. Management is determined by
  // the user type's `management` flag (works for built-in AND custom types) —
  // never by the legacy role, so a custom non-management type still shows here.
  const [vacSnap, mgmtIds] = await Promise.all([
    db().collection("vacationRequests").where("status", "==", "approved").get(),
    getManagementEmployeeIds(),
  ]);

  const visible = vacSnap.docs
    .map((d) => d.data() as Record<string, unknown>)
    .filter((v) => ((v.endDate as string) ?? "") >= todayYMD)
    .filter((v) => {
      const eid = (v.employeeId as string) ?? "";
      return eid !== "" && !mgmtIds.has(eid);
    });

  // The name on the request is a write-time SNAPSHOT and is never rewritten, so
  // a later rename (or a first-ever displayName) would never reach this list.
  // Re-resolve against the live employee record; the snapshot only survives as
  // the fallback for employees that no longer exist.
  const live = await resolveEmployeeNameParts(visible.map((v) => v.employeeId as string));

  const rows = visible
    .map((v) => {
      const employeeId = (v.employeeId as string) ?? "";
      const name = preferLive(live, employeeId, v);
      return {
        employeeId,
        firstName: name.firstName,
        lastName: name.lastName,
        displayName: name.displayName,
        startDate: (v.startDate as string) ?? "",
        endDate: (v.endDate as string) ?? "",
      };
    })
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

    const canReview = req.permissions?.has("vacation.review") ?? false;
    if (!canReview) {
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
// Reviewers (vacation.view.all): all requests; others: own requests only

vacationRouter.get("/", requireAuth, async (req: AuthRequest, res) => {
  let query: admin.firestore.Query = db().collection("vacationRequests");

  if (!req.permissions?.has("vacation.view.all")) {
    // Own requests by stable employeeId (migrated requests carry stale uids);
    // fall back to uid for users without an employee link.
    const empId = await requesterEmployeeId(req.uid);
    query = empId
      ? query.where("employeeId", "==", empId)
      : query.where("uid", "==", req.uid!);
  }

  const snap = await query.get();
  // Sort by requestedAt desc IN MEMORY rather than via a Firestore
  // orderBy("requestedAt"): an orderBy silently EXCLUDES any document missing
  // the ordered field, which dropped legacy requests (created before
  // requestedAt existed — often already approved) from the employee's
  // "Moje žádosti" (#45). In-memory sort returns every request and also drops
  // the (uid, requestedAt) composite-index dependency for the employee query.
  const tsMs = (t: unknown): number => {
    const o = t as { toMillis?: () => number; _seconds?: number; seconds?: number } | null;
    if (!o) return 0;
    if (typeof o.toMillis === "function") return o.toMillis();
    if (typeof o._seconds === "number") return o._seconds * 1000;
    if (typeof o.seconds === "number") return o.seconds * 1000;
    return 0;
  };
  const items: Record<string, unknown>[] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  items.sort((a, b) => tsMs(b.requestedAt) - tsMs(a.requestedAt));

  // The firstName/lastName stored on the request are a write-time SNAPSHOT that
  // nothing ever rewrites (and legacy requests carry no displayName at all), so
  // renaming an employee — or giving them a display name — would never show up
  // here. Re-resolve from the live employee record and fall back to the snapshot
  // only for employees that have since been deleted.
  const live = await resolveEmployeeNameParts(items.map((v) => v.employeeId as string));
  const enriched = items.map((v) => ({
    ...v,
    ...preferLive(live, v.employeeId as string, v),
  }));

  res.json(enriched);
});

// ─── POST /vacation ───────────────────────────────────────────────────────────
// A user submits a vacation request for themselves. Gated on vacation.request.self
// (mirrors the frontend form gate; closes the front↔back enforcement gap).

vacationRouter.post("/", requireAuth, requirePermission("vacation.request.self", "vacation.request.forAny"), async (req: AuthRequest, res) => {
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

  // Determine WHO the request is for. A vacation.request.forAny holder may pass a
  // target employeeId to file on someone else's behalf; otherwise it's their own.
  const canForAny = req.permissions?.has("vacation.request.forAny") ?? false;
  const targetId =
    typeof body.employeeId === "string" && body.employeeId.trim() ? (body.employeeId as string).trim() : null;

  let employeeId: string;
  let ownerUid: string | null;
  if (canForAny && targetId) {
    // Filing on behalf of another employee.
    employeeId = targetId;
    // Link to that employee's own user account (if any) so the request shows up
    // as theirs in "Moje žádosti" (which also matches by employeeId).
    const linkedSnap = await db().collection("users").where("employeeId", "==", targetId).limit(1).get();
    ownerUid = linkedSnap.empty ? null : linkedSnap.docs[0].id;
  } else {
    // Filing the caller's own request — resolve their linked employeeId.
    const userDoc = await db().collection("users").doc(req.uid!).get();
    if (!userDoc.exists) {
      res.status(404).json({ error: "Uživatelský profil nenalezen" });
      return;
    }
    const ownEid = ((userDoc.data() as Record<string, unknown>).employeeId as string | null) ?? null;
    if (!ownEid) {
      res.status(400).json({ error: "Uživatel nemá přiřazeného zaměstnance" });
      return;
    }
    employeeId = ownEid;
    ownerUid = req.uid ?? null;
  }

  // Fetch employee name for denormalization (+ validate the employee exists).
  const empDoc = await db().collection("employees").doc(employeeId).get();
  if (!empDoc.exists) {
    res.status(404).json({ error: "Zaměstnanec nenalezen" });
    return;
  }
  const empData = empDoc.data() as Record<string, unknown>;
  const firstName = (empData.firstName as string) ?? "";
  const lastName = (empData.lastName as string) ?? "";
  // Snapshot the display name too. Reads re-resolve this from the live record,
  // so the snapshot only matters once the employee is deleted — but then it has
  // to be the RIGHT name, not just the legal one.
  const displayName = (empData.displayName as string) ?? "";

  // Hard-block if any non-X shift already exists in the requested date range.
  // This collision query needs a composite index on real Firestore; if it
  // throws (or any transient error occurs), return a visible 500 rather than
  // letting the async rejection go unhandled — which leaves the request
  // hanging with no response (the form just spins forever).
  let collisions: Awaited<ReturnType<typeof findShiftCollisions>>;
  try {
    collisions = await findShiftCollisions(employeeId, startDate, endDate);
  } catch (err) {
    console.error("[vacation] collision check failed:", err);
    res.status(500).json({ error: "Kontrolu kolizí se nepodařilo provést. Zkuste to prosím znovu." });
    return;
  }
  if (collisions.length > 0) {
    res.status(409).json({ error: "shift_collision", collisions });
    return;
  }

  const ref = await db().collection("vacationRequests").add({
    employeeId,
    firstName,
    lastName,
    displayName,
    uid: ownerUid,
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

  res.status(201).json({ id: ref.id, firstName, lastName, displayName });
});

// ─── PATCH /vacation/:id ──────────────────────────────────────────────────────
// Two modes detected by request body:
//   { startDate, endDate, reason } → employee edit (own request)
//   { status }                     → admin/director approve or reject

vacationRouter.patch("/:id", requireAuth, async (req: AuthRequest, res) => {
  const { id } = req.params;
  const body = req.body as Record<string, unknown>;
  const canReview = req.permissions?.has("vacation.review") ?? false;

  const docRef = db().collection("vacationRequests").doc(id);
  const doc = await docRef.get();
  if (!doc.exists) {
    res.status(404).json({ error: "Žádost nenalezena" });
    return;
  }
  const data = doc.data() as Record<string, unknown>;

  // ── Employee edit ──────────────────────────────────────────────────────────
  if ("startDate" in body) {
    const myEmpId = await requesterEmployeeId(req.uid);
    const isOwn = data.uid === req.uid || (!!myEmpId && data.employeeId === myEmpId);
    if (!isOwn && !canReview) {
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

  // ── Approve / reject (reviewers only) ──────────────────────────────────────
  if (!canReview) {
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
  // Semantic event for the change log: distinguish approve/reject of a pending
  // request from approve/reject of an EDIT to an already-approved request.
  const vacationEvent = pendingEdit
    ? status === "approved"
      ? "vacation.approveEdit"
      : "vacation.rejectEdit"
    : status === "approved"
      ? "vacation.approve"
      : "vacation.reject";
  // Year (Dovolená page filter) from the request's start date.
  const vacationYear =
    Number(String(afterData.startDate ?? data.startDate ?? "").slice(0, 4)) || undefined;
  await logUpdate(ctxFromReq(req), {
    collection: "vacationRequests",
    resourceId: id,
    employeeId: data.employeeId as string,
    event: vacationEvent,
    year: vacationYear,
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

  const docRef = db().collection("vacationRequests").doc(id);
  const doc = await docRef.get();
  if (!doc.exists) {
    res.status(404).json({ error: "Žádost nenalezena" });
    return;
  }

  const data = doc.data() as Record<string, unknown>;
  const myEmpId = await requesterEmployeeId(req.uid);
  const isOwn = data.uid === req.uid || (!!myEmpId && data.employeeId === myEmpId);
  const canReview = req.permissions?.has("vacation.review") ?? false;

  if (!isOwn && !canReview) {
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
