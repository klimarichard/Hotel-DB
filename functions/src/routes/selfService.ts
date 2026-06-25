import { Router } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { redactFields, decrypt } from "../services/encryption";
import { ctxFromReq, writeAudit, logCreate, logDelete } from "../services/auditLog";
import {
  getCallerEmployeeId,
  getUserName,
  buildStoredChanges,
  redactChangeForResponse,
  StoredChange,
} from "../services/employeeChangeRequests";

/**
 * Self-service endpoints, mounted at `/me`. Any authenticated user that is
 * linked to an employee record (users/{uid}.employeeId) can read THEIR OWN
 * record and propose edits to it — they can never reference another id, since
 * the employeeId is resolved server-side from the auth token, never the URL.
 *
 * Approval of proposed edits lives in routes/employeeChangeRequests.ts
 * (admin/director only).
 */
export const selfServiceRouter = Router();

const db = () => admin.firestore();

const ROOT_SENSITIVE = ["birthNumber"];
const DOC_SENSITIVE = ["idCardNumber", "idCardExpiry"];
const BEN_SENSITIVE = ["insuranceNumber", "bankAccount"];

selfServiceRouter.use(requireAuth);

// ─── Read own record ───────────────────────────────────────────────────────

selfServiceRouter.get("/employee", async (req: AuthRequest, res) => {
  const empId = await getCallerEmployeeId(req.uid!);
  if (!empId) { res.json(null); return; }
  const doc = await db().collection("employees").doc(empId).get();
  if (!doc.exists) { res.json(null); return; }
  res.json({ id: doc.id, ...redactFields(doc.data() as Record<string, unknown>, ROOT_SENSITIVE) });
});

/** Fetch the single doc of a sub-collection, optionally redacting sensitive fields. */
async function readSingleSubdoc(empId: string, sub: string, sensitive: string[]) {
  const snap = await db().collection("employees").doc(empId).collection(sub).limit(1).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...redactFields(snap.docs[0].data() as Record<string, unknown>, sensitive) };
}

selfServiceRouter.get("/employee/contact", async (req: AuthRequest, res) => {
  const empId = await getCallerEmployeeId(req.uid!);
  res.json(empId ? await readSingleSubdoc(empId, "contact", []) : null);
});

selfServiceRouter.get("/employee/documents", async (req: AuthRequest, res) => {
  const empId = await getCallerEmployeeId(req.uid!);
  res.json(empId ? await readSingleSubdoc(empId, "documents", DOC_SENSITIVE) : null);
});

selfServiceRouter.get("/employee/benefits", async (req: AuthRequest, res) => {
  const empId = await getCallerEmployeeId(req.uid!);
  res.json(empId ? await readSingleSubdoc(empId, "benefits", BEN_SENSITIVE) : null);
});

selfServiceRouter.get("/employee/employment", async (req: AuthRequest, res) => {
  const empId = await getCallerEmployeeId(req.uid!);
  if (!empId) { res.json([]); return; }
  const snap = await db()
    .collection("employees").doc(empId)
    .collection("employment").orderBy("startDate", "desc").get();
  res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
});

/**
 * GET /me/employee/alerts
 * Self-scoped mirror of GET /employees/:id/alerts: returns the caller's own
 * document-expiry alerts from the shared `alerts` collection — the SAME data
 * (and 30-day expiring/expired logic) the Upozornění feature shows to
 * alerts.view users. No extra permission: a linked employee sees only its own.
 */
selfServiceRouter.get("/employee/alerts", async (req: AuthRequest, res) => {
  const empId = await getCallerEmployeeId(req.uid!);
  if (!empId) { res.json([]); return; }
  const snap = await db()
    .collection("alerts")
    .where("employeeId", "==", empId)
    .get();
  res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
});

// ─── Reveal own sensitive field ──────────────────────────────────────────────

selfServiceRouter.post("/employee/reveal", async (req: AuthRequest, res) => {
  const empId = await getCallerEmployeeId(req.uid!);
  if (!empId) { res.status(400).json({ error: "Váš účet není propojen se zaměstnaneckým záznamem." }); return; }

  const { field } = req.body as { field: string };
  const all = [...ROOT_SENSITIVE, ...DOC_SENSITIVE, ...BEN_SENSITIVE];
  if (!all.includes(field)) { res.status(400).json({ error: "Neplatné pole." }); return; }

  let encryptedValue: string | undefined;
  if (ROOT_SENSITIVE.includes(field)) {
    const doc = await db().collection("employees").doc(empId).get();
    encryptedValue = doc.exists ? (doc.data() as Record<string, string>)[field] : undefined;
  } else {
    const sub = DOC_SENSITIVE.includes(field) ? "documents" : "benefits";
    const snap = await db().collection("employees").doc(empId).collection(sub).limit(1).get();
    if (!snap.empty) encryptedValue = (snap.docs[0].data() as Record<string, string>)[field];
  }

  if (!encryptedValue) { res.status(404).json({ error: "Hodnota nenalezena." }); return; }

  await writeAudit(ctxFromReq(req), {
    action: "reveal",
    collection: "employees",
    resourceId: empId,
    employeeId: empId,
    extra: { fieldName: field, self: true },
  });
  res.json({ value: decrypt(encryptedValue) });
});

// ─── Change requests (own) ───────────────────────────────────────────────────

selfServiceRouter.post("/change-requests", async (req: AuthRequest, res) => {
  const empId = await getCallerEmployeeId(req.uid!);
  if (!empId) { res.status(400).json({ error: "Váš účet není propojen se zaměstnaneckým záznamem." }); return; }

  const rawChanges = Array.isArray((req.body as { changes?: unknown }).changes)
    ? (req.body as { changes: Array<Record<string, unknown>> }).changes
    : [];
  const changes = buildStoredChanges(rawChanges);
  if (!changes.length) { res.status(400).json({ error: "Žádné platné změny k odeslání." }); return; }

  const ref = await db().collection("employeeChangeRequests").add({
    employeeId: empId,
    requestedByUid: req.uid,
    requestedByName: await getUserName(req.uid!),
    status: "pending",
    changes,
    requestedAt: FieldValue.serverTimestamp(),
    reviewedByUid: null,
    reviewedByName: null,
    reviewedAt: null,
    rejectionReason: null,
  });

  await logCreate(ctxFromReq(req), {
    collection: "employeeChangeRequests",
    resourceId: ref.id,
    employeeId: empId,
    summary: { fields: changes.map((c) => c.field) },
  });
  res.status(201).json({ id: ref.id });
});

selfServiceRouter.get("/change-requests", async (req: AuthRequest, res) => {
  const empId = await getCallerEmployeeId(req.uid!);
  if (!empId) { res.json([]); return; }
  const snap = await db()
    .collection("employeeChangeRequests")
    .where("requestedByUid", "==", req.uid)
    .get();
  const rows = snap.docs
    .map((d) => {
      const data = d.data() as Record<string, unknown>;
      return {
        id: d.id,
        status: data.status,
        requestedAt: data.requestedAt,
        reviewedAt: data.reviewedAt ?? null,
        rejectionReason: data.rejectionReason ?? null,
        changes: ((data.changes as StoredChange[]) ?? []).map(redactChangeForResponse),
      };
    })
    .sort((a, b) => msOf(b.requestedAt) - msOf(a.requestedAt));
  res.json(rows);
});

selfServiceRouter.delete("/change-requests/:id", async (req: AuthRequest, res) => {
  const ref = db().collection("employeeChangeRequests").doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists) { res.status(404).json({ error: "Žádost nenalezena." }); return; }
  const data = snap.data() as Record<string, unknown>;
  if (data.requestedByUid !== req.uid) { res.status(403).json({ error: "Nelze zrušit cizí žádost." }); return; }
  if (data.status !== "pending") { res.status(409).json({ error: "Lze zrušit pouze čekající žádost." }); return; }

  await ref.delete();
  await logDelete(ctxFromReq(req), {
    collection: "employeeChangeRequests",
    resourceId: req.params.id,
    employeeId: data.employeeId as string | undefined,
    summary: { fields: ((data.changes as StoredChange[]) ?? []).map((c) => c.field) },
  });
  res.json({ ok: true });
});

/** Firestore Timestamp → epoch ms (tolerant of nulls for client-side sort). */
function msOf(ts: unknown): number {
  const t = ts as { toMillis?: () => number } | null;
  return t && typeof t.toMillis === "function" ? t.toMillis() : 0;
}
