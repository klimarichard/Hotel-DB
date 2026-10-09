/**
 * /api/vacation-proposals — vacation-balance correction proposals parked by the
 * payroll check (Kontrola mezd, POST /payroll/periods/:id/vacation-proposals),
 * reviewed on the Dovolená page: Převzít (apply) or Zamítnout (dismiss).
 *
 * Every route is gated on employees.vacationBalance.manage — the same key that
 * gates hand-editing the ledger, since applying a proposal IS a ledger edit.
 *
 * Mounted outside employeesRouter, so its enforceEmpAccess is NOT inherited:
 * management records are filtered by hand (hiddenManagementEmployeeIds), the
 * same helper GET /vacation/ledger-overview uses. A hidden employee's proposal
 * is omitted from the list/count and 404s on apply/dismiss.
 *
 * App-side figures are never read from the stored doc: evaluateProposal
 * recomputes them from the ledger as it is NOW. A pending proposal whose
 * discrepancy has since disappeared (someone fixed the ledger by hand) is
 * lazily marked "resolved" and dropped from the list.
 */
import { Router, Response } from "express";
import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { requirePermission } from "../auth/permissions";
import { hiddenManagementEmployeeIds } from "./employees";
import { ctxFromReq, logUpdate } from "../services/auditLog";
import { resolveEmployeeNameParts, preferLive } from "../services/employeeNames";
import { ledgerRef, readLedger, writeManualLedgerEdit } from "../services/vacationLedger";
import {
  evaluateProposal,
  proposalsCol,
  readPdf,
  type ProposalEvaluation,
} from "../services/vacationProposals";

export const vacationProposalsRouter = Router();
const db = () => admin.firestore();

interface PendingRow {
  id: string;
  data: Record<string, unknown>;
  ev: ProposalEvaluation;
}

async function userName(uid: string | undefined): Promise<string | null> {
  if (!uid) return null;
  const snap = await db().collection("users").doc(uid).get();
  const name = snap.exists ? (snap.data() as Record<string, unknown>).name : null;
  return typeof name === "string" && name ? name : null;
}

/**
 * Every visible pending proposal that is STILL a discrepancy against the current
 * ledger. Shared by GET / and GET /pending-count so the badge can never disagree
 * with the list. Side effect: pending docs that no longer differ are marked
 * "resolved" (hidden management records are skipped, never touched).
 */
async function livePendingProposals(req: AuthRequest): Promise<PendingRow[]> {
  const [snap, hidden] = await Promise.all([
    proposalsCol().where("status", "==", "pending").get(),
    hiddenManagementEmployeeIds(req.permissions),
  ]);
  const docs = snap.docs.filter((d) => {
    const eid = (d.data() as Record<string, unknown>).employeeId;
    return typeof eid === "string" && !(hidden && hidden.has(eid));
  });

  // Current ledger per (employee, year) — chunked getAll.
  const refs = docs.map((d) => {
    const p = d.data() as Record<string, unknown>;
    return ledgerRef(p.employeeId as string, Number(p.year));
  });
  const ledgers: (Record<string, unknown> | null)[] = [];
  for (let i = 0; i < refs.length; i += 100) {
    const snaps = await db().getAll(...refs.slice(i, i + 100));
    for (const s of snaps) ledgers.push(s.exists ? (s.data() as Record<string, unknown>) : null);
  }

  const live: PendingRow[] = [];
  const stale: admin.firestore.DocumentReference[] = [];
  docs.forEach((d, i) => {
    const data = d.data() as Record<string, unknown>;
    const ev = evaluateProposal(ledgers[i], Number(data.month), readPdf(data));
    if (ev.discrepancy) live.push({ id: d.id, data, ev });
    else stale.push(d.ref);
  });

  for (let i = 0; i < stale.length; i += 400) {
    const batch = db().batch();
    const now = FieldValue.serverTimestamp();
    for (const ref of stale.slice(i, i + 400)) {
      batch.set(
        ref,
        { status: "resolved", reviewedAt: now, reviewedBy: null, reviewedByName: null, updatedAt: now },
        { merge: true }
      );
    }
    await batch.commit();
  }
  return live;
}

/**
 * Load one proposal for apply/dismiss: 404 when unknown or the employee is a
 * management record hidden from the caller, 409 when no longer pending.
 * Returns null after sending the error response.
 */
async function loadPendingForReview(
  req: AuthRequest,
  res: Response
): Promise<{ ref: admin.firestore.DocumentReference; data: Record<string, unknown> } | null> {
  const ref = proposalsCol().doc(req.params.id);
  const [snap, hidden] = await Promise.all([ref.get(), hiddenManagementEmployeeIds(req.permissions)]);
  const data = snap.exists ? (snap.data() as Record<string, unknown>) : null;
  const eid = data?.employeeId;
  if (!data || typeof eid !== "string" || (hidden && hidden.has(eid))) {
    res.status(404).json({ error: "Návrh nebyl nalezen." });
    return null;
  }
  if (data.status !== "pending") {
    res.status(409).json({ error: "Návrh už byl vyřízen." });
    return null;
  }
  return { ref, data };
}

// ─── GET /vacation-proposals — pending proposals, live-evaluated ─────────────

vacationProposalsRouter.get(
  "/",
  requireAuth,
  requirePermission("employees.vacationBalance.manage"),
  async (req: AuthRequest, res) => {
    const rows = await livePendingProposals(req);
    const names = await resolveEmployeeNameParts(rows.map((r) => r.data.employeeId as string));
    const proposals = rows
      .map(({ id, data, ev }) => {
        const employeeId = data.employeeId as string;
        const n = preferLive(names, employeeId, {});
        const pdf = readPdf(data);
        const createdAt = data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : "";
        return {
          id,
          employeeId,
          firstName: n.firstName,
          lastName: n.lastName,
          displayName: n.displayName || null,
          year: Number(data.year),
          month: Number(data.month),
          contract: typeof data.contract === "string" ? data.contract : "",
          slipName: typeof data.slipName === "string" ? data.slipName : "",
          pdf: { ...pdf, total: ev.total },
          appRemaining: ev.appRemaining,
          currentYearHours: ev.currentYearHours,
          proposedCurrentYearHours: ev.proposedCurrentYearHours,
          delta: ev.delta,
          createdAt,
          createdByName: typeof data.createdByName === "string" && data.createdByName ? data.createdByName : null,
        };
      })
      .sort(
        (a, b) =>
          a.lastName.localeCompare(b.lastName, "cs") ||
          a.firstName.localeCompare(b.firstName, "cs") ||
          a.year - b.year ||
          a.month - b.month
      );
    res.json({ proposals });
  }
);

// ─── GET /vacation-proposals/pending-count — badge ───────────────────────────

vacationProposalsRouter.get(
  "/pending-count",
  requireAuth,
  requirePermission("employees.vacationBalance.manage"),
  async (req: AuthRequest, res) => {
    const rows = await livePendingProposals(req);
    res.json({ count: rows.length });
  }
);

// ─── POST /vacation-proposals/:id/apply — Převzít ────────────────────────────
// Recomputes against the ledger NOW. Still a discrepancy → Letošní is set to the
// proposed value through writeManualLedgerEdit, the exact write + audit path of
// PATCH /employees/:id/vacation-ledger/:year (source "manual"). No longer a
// discrepancy → "resolved", no ledger write.

vacationProposalsRouter.post(
  "/:id/apply",
  requireAuth,
  requirePermission("employees.vacationBalance.manage"),
  async (req: AuthRequest, res) => {
    const loaded = await loadPendingForReview(req, res);
    if (!loaded) return;
    const { ref, data } = loaded;
    const employeeId = data.employeeId as string;
    const year = Number(data.year);
    const month = Number(data.month);

    const ledgerSnap = await ledgerRef(employeeId, year).get();
    const ev = evaluateProposal(
      ledgerSnap.exists ? (ledgerSnap.data() as Record<string, unknown>) : null,
      month,
      readPdf(data)
    );

    const ctx = ctxFromReq(req);
    const now = FieldValue.serverTimestamp();
    if (!ev.discrepancy) {
      await ref.set(
        { status: "resolved", reviewedAt: now, reviewedBy: null, reviewedByName: null, updatedAt: now },
        { merge: true }
      );
      res.json({ status: "resolved", ledger: await readLedger(employeeId, year) });
      return;
    }

    const ledger = await writeManualLedgerEdit(ctx, {
      employeeId,
      year,
      edit: { kind: "annual", field: "currentYearHours", hours: ev.proposedCurrentYearHours },
    });
    const reviewedByName = await userName(req.uid);
    await ref.set(
      {
        status: "applied",
        reviewedAt: now,
        reviewedBy: req.uid ?? null,
        reviewedByName,
        appliedCurrentYearHours: ev.proposedCurrentYearHours,
        updatedAt: now,
      },
      { merge: true }
    );
    await logUpdate(ctx, {
      collection: "vacationProposals",
      resourceId: ref.id,
      employeeId,
      before: { status: "pending" },
      after: { status: "applied", appliedCurrentYearHours: ev.proposedCurrentYearHours },
      event: "vacation.proposal.apply",
      year,
      month,
    });
    res.json({ status: "applied", ledger });
  }
);

// ─── POST /vacation-proposals/:id/dismiss — Zamítnout ────────────────────────

vacationProposalsRouter.post(
  "/:id/dismiss",
  requireAuth,
  requirePermission("employees.vacationBalance.manage"),
  async (req: AuthRequest, res) => {
    const loaded = await loadPendingForReview(req, res);
    if (!loaded) return;
    const { ref, data } = loaded;
    const now = FieldValue.serverTimestamp();
    await ref.set(
      {
        status: "dismissed",
        reviewedAt: now,
        reviewedBy: req.uid ?? null,
        reviewedByName: await userName(req.uid),
        updatedAt: now,
      },
      { merge: true }
    );
    await logUpdate(ctxFromReq(req), {
      collection: "vacationProposals",
      resourceId: ref.id,
      employeeId: data.employeeId as string,
      before: { status: "pending" },
      after: { status: "dismissed" },
      event: "vacation.proposal.dismiss",
      year: Number(data.year),
      month: Number(data.month),
    });
    res.json({ status: "dismissed" });
  }
);
