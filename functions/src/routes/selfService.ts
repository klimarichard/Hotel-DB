import { Router } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { requirePermission } from "../auth/permissions";
import { redactFields, decrypt } from "../services/encryption";
import { ctxFromReq, writeAudit, logCreate, logDelete } from "../services/auditLog";
import {
  getCallerEmployeeId,
  getUserName,
  buildStoredChanges,
  redactChangeForResponse,
  StoredChange,
} from "../services/employeeChangeRequests";
import { readLedger } from "../services/vacationLedger";

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
 * GET /me/employee/contracts
 * Self-scoped contract METADATA (no PDF bytes / storage paths) for the caller's
 * own record: used to hide history entries whose contract is still being
 * prepared, and to know which entries have a downloadable signed contract.
 * Auth-only (no `contracts.view`) — it's the caller's own data. The signed PDF
 * itself streams from GET /me/employee/contracts/:id/download below.
 */
selfServiceRouter.get("/employee/contracts", async (req: AuthRequest, res) => {
  const empId = await getCallerEmployeeId(req.uid!);
  if (!empId) { res.json([]); return; }
  const snap = await db()
    .collection("employees").doc(empId)
    .collection("contracts").orderBy("generatedAt", "desc").get();
  res.json(snap.docs.map((d) => {
    const c = d.data() as Record<string, unknown>;
    return {
      id: d.id,
      type: c.type ?? null,
      status: c.status ?? null,
      employmentRowId: c.employmentRowId ?? null,
      generatedAt: c.generatedAt ?? null,
      displayName: c.displayName ?? null,
    };
  }));
});

/**
 * GET /me/employee/contracts/:contractId/download
 * Streams the caller's OWN SIGNED contract PDF for download. Self-scoped and
 * signed-only: the contract must live under the caller's employee record and
 * carry a signedStoragePath (employees never download unsigned / being-prepared
 * PDFs). Auth-only — no contracts.view, unlike the admin download route.
 * storage.rules deny direct client access, so the read goes through Admin SDK.
 */
selfServiceRouter.get("/employee/contracts/:contractId/download", async (req: AuthRequest, res) => {
  const empId = await getCallerEmployeeId(req.uid!);
  if (!empId) { res.status(400).json({ error: "Váš účet není propojen se zaměstnaneckým záznamem." }); return; }

  const snap = await db()
    .collection("employees").doc(empId)
    .collection("contracts").doc(req.params.contractId).get();
  if (!snap.exists) { res.status(404).json({ error: "Smlouva nenalezena." }); return; }

  const data = snap.data() as Record<string, unknown>;
  const path = data.signedStoragePath;
  if (data.status !== "signed" || typeof path !== "string" || !path) {
    res.status(404).json({ error: "Podepsaná smlouva není k dispozici." });
    return;
  }

  const file = admin.storage().bucket().file(path);
  const [exists] = await file.exists();
  if (!exists) { res.status(404).json({ error: "Soubor smlouvy chybí v úložišti." }); return; }

  const displayBase = typeof data.displayName === "string" && data.displayName
    ? data.displayName
    : `smlouva_${req.params.contractId}`;
  const filenameBase = `${displayBase} - podepsaná`;
  // UTF-8 filename with an ASCII fallback for legacy clients (mirrors the admin
  // download route in routes/contracts.ts).
  const asciiFallback = filenameBase
    .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, "_");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${asciiFallback}.pdf"; filename*=UTF-8''${encodeURIComponent(filenameBase)}.pdf`
  );
  file.createReadStream()
    .on("error", (e) => {
      if (!res.headersSent) res.status(500).json({ error: (e as Error).message });
      else res.end();
    })
    .pipe(res);
});

/**
 * GET /me/employee/vacation-ledger?year=2026
 * Self-scoped mirror of GET /employees/:id/vacation-ledger: the caller's own
 * vacation-hour ledger for one year (nárok / čerpáno / zůstatek), READ-ONLY.
 * Shown on Můj profil.
 *
 * Gated on vacation.balance.view.self, which nobody holds by default (it is
 * deliberately absent from BASE_SELF) — an admin grants it per user type. The
 * frontend hides the section without it, but that is only cosmetic; this gate is
 * the real one. Same shape as `sensitive.reveal.self` on /employee/reveal below.
 *
 * A linked employee can only ever see its own ledger — the employeeId is
 * resolved from the token, never the URL. The admin route cannot be reused here:
 * it is gated on employees.view.all / employees.view.nonManagement, which a plain
 * employee does not hold, and it trusts the id in the path.
 *
 * There is deliberately NO self PATCH counterpart — editing stays behind
 * employees.vacationBalance.manage on the admin route.
 */
selfServiceRouter.get("/employee/vacation-ledger", requirePermission("vacation.balance.view.self"), async (req: AuthRequest, res) => {
  const year = parseInt(String(req.query.year ?? ""), 10);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    res.status(400).json({ error: "Neplatný rok." });
    return;
  }
  const empId = await getCallerEmployeeId(req.uid!);
  if (!empId) {
    res.json(null);
    return;
  }
  res.json(await readLedger(empId, year));
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
  // Exclude OP (idCardExpiry): "platnost OP" was deliberately hidden from the
  // employee's own view, kept admin-only. Employees see only passport +
  // residence-permit alerts; admins still see all three on the detail page.
  res.json(
    snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((a) => (a as { field?: string }).field !== "idCardExpiry")
  );
});

// ─── Reveal own sensitive field ──────────────────────────────────────────────

selfServiceRouter.post("/employee/reveal", requirePermission("sensitive.reveal.self"), async (req: AuthRequest, res) => {
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
