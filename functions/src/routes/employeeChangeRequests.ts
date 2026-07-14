import { Router } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { requirePermission } from "../auth/permissions";
import { ctxFromReq, writeAudit, logUpdate } from "../services/auditLog";
import {
  applyApprovedChanges,
  redactChangeForResponse,
  revealProposedValue,
  getUserName,
  StoredChange,
} from "../services/employeeChangeRequests";
import { resolveEmployeeNameParts, preferLive } from "../services/employeeNames";

/**
 * Admin/director review of employee self-service edit requests, mounted at
 * `/employee-change-requests`. Approving applies the proposed changes to the
 * live record (see services/employeeChangeRequests.applyApprovedChanges).
 */
export const employeeChangeRequestsRouter = Router();

const db = () => admin.firestore();

employeeChangeRequestsRouter.use(requireAuth);
employeeChangeRequestsRouter.use(requirePermission("changeRequests.review"));

// ─── Pending count (badge) ───────────────────────────────────────────────────

employeeChangeRequestsRouter.get("/pending-count", async (_req: AuthRequest, res) => {
  const snap = await db()
    .collection("employeeChangeRequests")
    .where("status", "==", "pending")
    .count()
    .get();
  res.json({ count: snap.data().count });
});

// ─── Pending list ────────────────────────────────────────────────────────────

employeeChangeRequestsRouter.get("/pending", async (_req: AuthRequest, res) => {
  const snap = await db()
    .collection("employeeChangeRequests")
    .where("status", "==", "pending")
    .get();

  // Resolve the employee name for display. Live (never the write-time snapshot
  // on the request) so a rename or a newly-set display name shows up at once —
  // and batched into a single getAll rather than a per-row read.
  const docs = snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
  const live = await resolveEmployeeNameParts(docs.map((d) => d.data.employeeId as string));

  const rows = docs.map(({ id, data }) => {
    const empId = data.employeeId as string;
    const name = preferLive(live, empId, data);
    return {
      id,
      employeeId: empId,
      employeeFirstName: name.firstName,
      employeeLastName: name.lastName,
      employeeDisplayName: name.displayName,
      requestedByName: data.requestedByName ?? "",
      requestedAt: data.requestedAt,
      changes: ((data.changes as StoredChange[]) ?? []).map(redactChangeForResponse),
    };
  });
  rows.sort((a, b) => msOf(a.requestedAt) - msOf(b.requestedAt));
  res.json(rows);
});

// ─── Reveal a proposed sensitive value ───────────────────────────────────────

employeeChangeRequestsRouter.post("/:id/reveal", requirePermission("sensitive.reveal"), async (req: AuthRequest, res) => {
  const { field } = req.body as { field: string };
  const snap = await db().collection("employeeChangeRequests").doc(req.params.id).get();
  if (!snap.exists) { res.status(404).json({ error: "Žádost nenalezena." }); return; }
  const data = snap.data() as Record<string, unknown>;
  const change = ((data.changes as StoredChange[]) ?? []).find((c) => c.field === field && c.sensitive);
  if (!change) { res.status(404).json({ error: "Pole nenalezeno." }); return; }

  const value = revealProposedValue(change);
  if (value === null) { res.status(404).json({ error: "Hodnota nenalezena." }); return; }

  await writeAudit(ctxFromReq(req), {
    action: "reveal",
    collection: "employeeChangeRequests",
    resourceId: req.params.id,
    employeeId: data.employeeId as string | undefined,
    extra: { fieldName: field, proposed: true },
  });
  res.json({ value });
});

// ─── Approve / reject ────────────────────────────────────────────────────────

employeeChangeRequestsRouter.patch("/:id", async (req: AuthRequest, res) => {
  const { status, rejectionReason } = req.body as { status?: string; rejectionReason?: string };
  if (status !== "approved" && status !== "rejected") {
    res.status(400).json({ error: "status musí být 'approved' nebo 'rejected'." });
    return;
  }

  const ref = db().collection("employeeChangeRequests").doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists) { res.status(404).json({ error: "Žádost nenalezena." }); return; }
  const data = snap.data() as Record<string, unknown>;
  if (data.status !== "pending") { res.status(409).json({ error: "Žádost již byla vyřízena." }); return; }

  const ctx = ctxFromReq(req);
  // Apply the live changes first so a failed write leaves the request pending
  // (and reviewable) rather than marked approved with nothing applied.
  if (status === "approved") {
    await applyApprovedChanges(ctx, data.employeeId as string, (data.changes as StoredChange[]) ?? []);
  }

  await ref.update({
    status,
    rejectionReason: status === "rejected" ? (rejectionReason ?? null) : null,
    reviewedByUid: req.uid,
    reviewedByName: await getUserName(req.uid!),
    reviewedAt: FieldValue.serverTimestamp(),
  });

  await logUpdate(ctx, {
    collection: "employeeChangeRequests",
    resourceId: req.params.id,
    employeeId: data.employeeId as string | undefined,
    // Reviewing a Můj-profil request belongs to the Zaměstnanci page (the submit
    // is logged under mujProfil); event distinguishes approve from reject.
    category: "zamestnanci",
    event: status === "approved" ? "employeeChange.approve" : "employeeChange.reject",
    before: { status: "pending" },
    after: { status },
  });
  res.json({ ok: true });
});

/** Firestore Timestamp → epoch ms. */
function msOf(ts: unknown): number {
  const t = ts as { toMillis?: () => number } | null;
  return t && typeof t.toMillis === "function" ? t.toMillis() : 0;
}
