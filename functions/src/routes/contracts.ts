import { Router, Response, NextFunction } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { requirePermission, hasPermission, type Permission } from "../auth/permissions";
import { renderPdf, RenderMargins } from "../services/pdfRenderer";
import type { ContractType } from "./contractTemplates";
import { ctxFromReq, logCreate, logUpdate, logDelete } from "../services/auditLog";
import { getManagementEmployeeIds, isNonManagementScoped } from "./employees";

export const contractsRouter = Router();

// Contract write permissions — holding none of these makes a caller a read-only
// contract viewer (e.g. built-in accountant), so any non-GET is rejected.
const CONTRACT_WRITE_PERMS: Permission[] = [
  "contracts.generate", "contracts.edit", "contracts.delete", "contracts.sign",
];

// This router is mounted at the app root ("/") because its routes span two
// path families with no shared prefix: "/contracts/render-pdf" and
// "/employees/:id/contracts/...". A router-level guard therefore runs for
// EVERY request in the app, so it must first short-circuit on non-contract
// paths — otherwise it would reject unrelated writes (vacation, self-service
// change requests, shifts, …) from any caller without a contract-write
// permission. Returns true only for the router's own contract endpoints.
function isContractPath(reqPath: string): boolean {
  const parts = reqPath.split("/"); // leading "" from the leading slash
  // "/contracts/..." (e.g. render-pdf)
  if (parts[1] === "contracts") return true;
  // "/employees/:id/contracts[/...]"
  if (parts[1] === "employees" && parts[3] === "contracts") return true;
  return false;
}

// Row-level access refinements layered on the per-route requirePermission gates
// (mirrors employees.ts), driven by PERMISSIONS, not the legacy role:
//   • read-only viewers (no contract-write permission) — only GET is allowed.
//   • non-management-scoped callers (hr) — blocked from any contract under a
//     management employee's record.
// requireAuth is router-level so req.permissions is set before this guard runs.
async function enforceContractAccess(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  // Mounted at root — ignore anything that isn't one of this router's own
  // contract routes so we never block unrelated (non-contract) writes.
  if (!isContractPath(req.path)) {
    next();
    return;
  }
  const perms = req.permissions ?? new Set<string>();
  if (req.method !== "GET" && !CONTRACT_WRITE_PERMS.some((p) => hasPermission(perms, p))) {
    res.status(403).json({ error: "Pouze náhledový přístup ke smlouvám." });
    return;
  }
  if (isNonManagementScoped(req.permissions)) {
    const parts = req.path.split("/"); // ["", "employees", "<id>", "contracts", ...]
    if (parts[1] === "employees" && parts[2]) {
      const mgmt = await getManagementEmployeeIds();
      if (mgmt.has(parts[2])) {
        res.status(403).json({ error: "Tento záznam není pro roli personalista přístupný." });
        return;
      }
    }
  }
  next();
}

// This router is mounted at the app root ("/"), so this guard chain sees EVERY
// request in the app. Skip it entirely for non-contract paths: those requests
// are authenticated by their own routers, and public endpoints (e.g. GET
// /health) must stay reachable WITHOUT a token. Contract routes still require
// auth. (enforceContractAccess independently short-circuits non-contract paths
// via isContractPath, but requireAuth must be skipped here too or it would 401
// unauthenticated public routes and double-authenticate everything else.)
contractsRouter.use((req: AuthRequest, res: Response, next: NextFunction) => {
  if (!isContractPath(req.path)) {
    next();
    return;
  }
  requireAuth(req, res, next);
});
contractsRouter.use(enforceContractAccess);

/**
 * POST /api/contracts/render-pdf
 * Server-side PDF generation via Puppeteer (real headless Chromium).
 * Replaces the old client-side html2pdf.js path so the PDF matches the
 * editor preview byte-for-byte — same rendering engine the user sees in
 * the browser.
 *
 * Body: { html, margins? }
 *   - html: filled HTML body content (no <html>/<body> wrapper)
 *   - margins: optional { top, bottom, left, right } in mm (defaults 15)
 *
 * Returns: application/pdf binary
 */
contractsRouter.post(
  "/contracts/render-pdf",
  requirePermission("contracts.generate"),
  async (req: AuthRequest, res: Response) => {
    const { html, margins } = req.body as {
      html?: string;
      margins?: RenderMargins;
    };
    if (typeof html !== "string" || !html) {
      res.status(400).json({ error: "html is required" });
      return;
    }
    try {
      const pdf = await renderPdf(html, margins);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Length", pdf.length.toString());
      res.send(pdf);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      res.status(500).json({ error: `PDF rendering failed: ${msg}` });
    }
  }
);

const db = () => admin.firestore();

type ContractStatus = "unsigned" | "signed" | "archived";

// NOTE: GET /employees/:id/contracts (list) lives in employees.ts; that router
// is mounted before this one, so a copy here would be dead code. Do not re-add.

/**
 * POST /api/employees/:employeeId/contracts
 * Atomically upload the PDF to Storage (via Admin SDK) and create the
 * Firestore metadata record. storage.rules deny all direct client
 * access, so the client base64-encodes the blob and the upload happens
 * server-side here.
 *
 * Body: { type, pdfBase64?, status?, employmentRowId?, notes? }
 *
 * If pdfBase64 is present, it's decoded and written to
 * contracts/{employeeId}/{generatedDocId}.pdf, and the resulting path
 * is stored as unsignedStoragePath on the metadata doc. If absent,
 * only the metadata record is created (kept for callers that upload
 * separately, e.g. the future signed-PDF upload flow).
 */
contractsRouter.post(
  "/employees/:employeeId/contracts",
  requirePermission("contracts.generate"),
  async (req: AuthRequest, res: Response) => {
    const {
      type,
      pdfBase64,
      status = "unsigned",
      employmentRowId,
      notes,
      rowSnapshot,
      displayName,
      signingDate,
      requestedAt,
      validFrom,
    } = req.body as {
      type: ContractType;
      pdfBase64?: string;
      status?: ContractStatus;
      employmentRowId?: string;
      notes?: string;
      rowSnapshot?: Record<string, unknown>;
      displayName?: string;
      // Ad-hoc rows are created PDF-less and generated later; the signing
      // date (and, for Multisport, the request/validity dates) are captured
      // up-front so the row can display the signing date and so a later
      // "Generovat" can fill the template. Plain ISO date strings.
      signingDate?: string;
      requestedAt?: string;
      validFrom?: string;
    };

    if (!type) {
      res.status(400).json({ error: "type is required" });
      return;
    }

    const employeeId = req.params.employeeId;

    // Reserve a doc id up-front so the storage path lines up with the
    // metadata record (`contracts/{employeeId}/{docId}.pdf`).
    const docRef = db()
      .collection("employees")
      .doc(employeeId)
      .collection("contracts")
      .doc();

    let unsignedStoragePath: string | undefined;
    if (pdfBase64) {
      const buffer = Buffer.from(pdfBase64, "base64");
      unsignedStoragePath = `contracts/${employeeId}/${docRef.id}.pdf`;
      const file = admin.storage().bucket().file(unsignedStoragePath);
      await file.save(buffer, {
        contentType: "application/pdf",
        metadata: { metadata: { uploadedBy: req.uid ?? "unknown" } },
      });
    }

    const docData: Record<string, unknown> = {
      type,
      status,
      generatedAt: FieldValue.serverTimestamp(),
      generatedBy: req.uid,
    };
    if (employmentRowId) docData.employmentRowId = employmentRowId;
    if (unsignedStoragePath) docData.unsignedStoragePath = unsignedStoragePath;
    if (notes) docData.notes = notes;
    if (rowSnapshot) docData.rowSnapshot = rowSnapshot;
    if (displayName) docData.displayName = displayName;
    if (signingDate) docData.signingDate = signingDate;
    if (requestedAt) docData.requestedAt = requestedAt;
    if (validFrom) docData.validFrom = validFrom;

    await docRef.set(docData);
    await logCreate(ctxFromReq(req), {
      collection: "employees/contracts",
      resourceId: employeeId,
      subResourceId: docRef.id,
      employeeId,
      summary: {
        type,
        status,
        displayName,
        employmentRowId,
        signingDate,
        hasUnsignedPdf: !!unsignedStoragePath,
      },
    });
    res.status(201).json({ id: docRef.id });
  }
);

/**
 * PATCH /api/employees/:employeeId/contracts/:contractId
 * Update status, add signedStoragePath, or archive.
 * Body: { status?, signedStoragePath?, notes? }
 */
contractsRouter.patch(
  "/employees/:employeeId/contracts/:contractId",
  requirePermission("contracts.edit"),
  async (req: AuthRequest, res: Response) => {
    const { status, signedStoragePath, notes, signingDate, requestedAt, validFrom } = req.body as {
      status?: ContractStatus;
      signedStoragePath?: string;
      notes?: string;
      signingDate?: string;
      requestedAt?: string;
      validFrom?: string;
    };

    const ref = db()
      .collection("employees")
      .doc(req.params.employeeId)
      .collection("contracts")
      .doc(req.params.contractId);

    const existing = await ref.get();
    if (!existing.exists) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }

    const update: Record<string, unknown> = {};
    if (status) update.status = status;
    if (signedStoragePath) {
      update.signedStoragePath = signedStoragePath;
      update.signedAt = FieldValue.serverTimestamp();
      update.signedUploadedBy = req.uid;
    }
    if (notes !== undefined) update.notes = notes;
    if (signingDate !== undefined) update.signingDate = signingDate;
    if (requestedAt !== undefined) update.requestedAt = requestedAt;
    if (validFrom !== undefined) update.validFrom = validFrom;

    const before = existing.data() as Record<string, unknown>;
    await ref.update(update);
    await logUpdate(ctxFromReq(req), {
      collection: "employees/contracts",
      resourceId: req.params.employeeId,
      subResourceId: req.params.contractId,
      employeeId: req.params.employeeId,
      before,
      after: { ...before, ...update },
    });
    res.json({ ok: true });
  }
);

/**
 * Resolve a contract's effective date as ISO `YYYY-MM-DD`, for filename
 * disambiguation. Mirrors the year buildContractName uses (the employment row's
 * startDate), falling back to the signing/validity date and finally the
 * generation timestamp. Returns null when no date can be determined.
 */
function contractDateIso(d: Record<string, unknown>): string | null {
  const snap = d.rowSnapshot as Record<string, unknown> | undefined;
  const candidates = [
    snap && typeof snap.startDate === "string" ? snap.startDate : "",
    typeof d.signingDate === "string" ? d.signingDate : "",
    typeof d.validFrom === "string" ? d.validFrom : "",
  ];
  for (const c of candidates) {
    if (/^\d{4}-\d{2}-\d{2}/.test(c)) return c.slice(0, 10);
  }
  const g = d.generatedAt as { seconds?: number; _seconds?: number } | undefined;
  const secs = g?.seconds ?? g?._seconds;
  if (typeof secs === "number") {
    const dt = new Date(secs * 1000);
    const y = dt.getFullYear();
    const mo = String(dt.getMonth() + 1).padStart(2, "0");
    const day = String(dt.getDate()).padStart(2, "0");
    return `${y}-${mo}-${day}`;
  }
  return null;
}

/**
 * GET /api/employees/:employeeId/contracts/:contractId/download?kind=unsigned|signed
 * Streams the requested PDF back to the client. storage.rules deny direct
 * client access, so reads must go through the Admin SDK here.
 */
contractsRouter.get(
  "/employees/:employeeId/contracts/:contractId/download",
  requirePermission("contracts.view"),
  async (req: AuthRequest, res: Response) => {
    const kind = req.query.kind === "signed" ? "signed" : "unsigned";

    const ref = db()
      .collection("employees")
      .doc(req.params.employeeId)
      .collection("contracts")
      .doc(req.params.contractId);

    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }

    const data = snap.data() as Record<string, unknown>;
    const path = kind === "signed" ? data.signedStoragePath : data.unsignedStoragePath;
    if (typeof path !== "string" || !path) {
      res.status(404).json({ error: `No ${kind} PDF for this contract` });
      return;
    }

    const file = admin.storage().bucket().file(path);
    const [exists] = await file.exists();
    if (!exists) {
      res.status(404).json({ error: "PDF file missing in storage" });
      return;
    }

    // Prefer the human-readable displayName persisted on the contract
    // doc; fall back to the contractId for older contracts that don't
    // have one.
    const displayBase = typeof data.displayName === "string" && data.displayName
      ? data.displayName
      : `${req.params.contractId}_${kind}`;
    // Disambiguate when another of this employee's contracts carries the EXACT
    // same display name (e.g. two "DODATEK2026 navýšení Jan Novák" in one year):
    // append the month, or the full date when the month also collides, so the
    // two land in the Downloads folder under distinct names. ISO-style qualifier
    // (YYYY-MM / YYYY-MM-DD) — carries the year and has no "/" (illegal in a
    // filename).
    let nameBase = displayBase;
    if (typeof data.displayName === "string" && data.displayName) {
      const siblings = (await ref.parent.get()).docs.map((d) => ({
        id: d.id,
        data: d.data() as Record<string, unknown>,
      }));
      const colliding = siblings.filter((s) => s.data.displayName === data.displayName);
      if (colliding.length > 1) {
        const myIso = contractDateIso(data);
        if (myIso) {
          const monthClash = colliding.some(
            (s) =>
              s.id !== req.params.contractId &&
              contractDateIso(s.data)?.slice(0, 7) === myIso.slice(0, 7)
          );
          nameBase = `${displayBase} (${monthClash ? myIso : myIso.slice(0, 7)})`;
        } else {
          // No usable date to disambiguate — fall back to a short id suffix.
          nameBase = `${displayBase} (${req.params.contractId.slice(0, 4)})`;
        }
      }
    }
    // Signed copies get a " - podepsaná" suffix to distinguish them from the
    // unsigned PDF in the user's Downloads folder.
    const filenameBase = kind === "signed" ? `${nameBase} - podepsaná` : nameBase;
    // Browsers accept UTF-8 filenames via filename*=UTF-8''<percent-encoded>;
    // include a plain-ASCII fallback for legacy clients via the standard
    // `filename=` parameter (diacritics replaced).
    const asciiFallback = filenameBase
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^\x20-\x7e]/g, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${asciiFallback}.pdf"; filename*=UTF-8''${encodeURIComponent(filenameBase)}.pdf`
    );
    file.createReadStream()
      .on("error", (e) => {
        if (!res.headersSent) res.status(500).json({ error: e.message });
        else res.end();
      })
      .pipe(res);
  }
);

/**
 * POST /api/employees/:employeeId/contracts/:contractId/signed-pdf
 * Upload a signed PDF (base64 in body) via Admin SDK and update the
 * contract record. storage.rules deny client uploads.
 *
 * Body: { pdfBase64 }
 */
contractsRouter.post(
  "/employees/:employeeId/contracts/:contractId/signed-pdf",
  requirePermission("contracts.sign"),
  async (req: AuthRequest, res: Response) => {
    const { pdfBase64 } = req.body as { pdfBase64?: string };
    if (!pdfBase64) {
      res.status(400).json({ error: "pdfBase64 is required" });
      return;
    }

    const employeeId = req.params.employeeId;
    const contractId = req.params.contractId;

    const ref = db()
      .collection("employees")
      .doc(employeeId)
      .collection("contracts")
      .doc(contractId);

    const existing = await ref.get();
    if (!existing.exists) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }

    const buffer = Buffer.from(pdfBase64, "base64");
    const signedStoragePath = `contracts/${employeeId}/${contractId}_signed.pdf`;
    const file = admin.storage().bucket().file(signedStoragePath);
    await file.save(buffer, {
      contentType: "application/pdf",
      metadata: { metadata: { uploadedBy: req.uid ?? "unknown" } },
    });

    const before = existing.data() as Record<string, unknown>;
    const update = {
      status: "signed",
      signedStoragePath,
      signedAt: FieldValue.serverTimestamp(),
      signedUploadedBy: req.uid,
    } as Record<string, unknown>;
    await ref.update(update);
    await logUpdate(ctxFromReq(req), {
      collection: "employees/contracts",
      resourceId: employeeId,
      subResourceId: contractId,
      employeeId,
      before,
      after: { ...before, ...update },
    });

    res.json({ ok: true, signedStoragePath });
  }
);

/**
 * POST /api/employees/:employeeId/contracts/:contractId/unsigned-pdf
 * Attach a freshly generated (unsigned) PDF to an EXISTING contract
 * record. Used by the ad-hoc "row-first" flow: the row is created
 * PDF-less, then "Generovat" generates the PDF and attaches it here,
 * preserving the row's signingDate / displayName instead of creating a
 * new record. storage.rules deny client uploads, so the base64 blob is
 * written server-side via the Admin SDK.
 *
 * Body: { pdfBase64 }
 */
contractsRouter.post(
  "/employees/:employeeId/contracts/:contractId/unsigned-pdf",
  requirePermission("contracts.generate"),
  async (req: AuthRequest, res: Response) => {
    const { pdfBase64 } = req.body as { pdfBase64?: string };
    if (!pdfBase64) {
      res.status(400).json({ error: "pdfBase64 is required" });
      return;
    }

    const employeeId = req.params.employeeId;
    const contractId = req.params.contractId;

    const ref = db()
      .collection("employees")
      .doc(employeeId)
      .collection("contracts")
      .doc(contractId);

    const existing = await ref.get();
    if (!existing.exists) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }

    const buffer = Buffer.from(pdfBase64, "base64");
    const unsignedStoragePath = `contracts/${employeeId}/${contractId}.pdf`;
    const file = admin.storage().bucket().file(unsignedStoragePath);
    await file.save(buffer, {
      contentType: "application/pdf",
      metadata: { metadata: { uploadedBy: req.uid ?? "unknown" } },
    });

    const before = existing.data() as Record<string, unknown>;
    const update = {
      unsignedStoragePath,
      generatedAt: FieldValue.serverTimestamp(),
      generatedBy: req.uid,
    } as Record<string, unknown>;
    await ref.update(update);
    await logUpdate(ctxFromReq(req), {
      collection: "employees/contracts",
      resourceId: employeeId,
      subResourceId: contractId,
      employeeId,
      before,
      after: { ...before, ...update },
    });

    res.json({ ok: true, unsignedStoragePath });
  }
);

/**
 * DELETE /api/employees/:employeeId/contracts/:contractId/signed-pdf
 * Removes the signed PDF and reverts the record back to "unsigned".
 * Clears signedStoragePath/signedAt/signedUploadedBy.
 */
contractsRouter.delete(
  "/employees/:employeeId/contracts/:contractId/signed-pdf",
  requirePermission("contracts.sign"),
  async (req: AuthRequest, res: Response) => {
    const ref = db()
      .collection("employees")
      .doc(req.params.employeeId)
      .collection("contracts")
      .doc(req.params.contractId);

    const existing = await ref.get();
    if (!existing.exists) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }

    const data = existing.data() as Record<string, unknown>;
    const signedPath = data.signedStoragePath;
    if (typeof signedPath === "string" && signedPath) {
      await admin.storage().bucket().file(signedPath).delete().catch(() => undefined);
    }

    const before = data;
    await ref.update({
      status: "unsigned",
      signedStoragePath: FieldValue.delete(),
      signedAt: FieldValue.delete(),
      signedUploadedBy: FieldValue.delete(),
    });
    await logUpdate(ctxFromReq(req), {
      collection: "employees/contracts",
      resourceId: req.params.employeeId,
      subResourceId: req.params.contractId,
      employeeId: req.params.employeeId,
      before,
      after: {
        ...before,
        status: "unsigned",
        signedStoragePath: null,
        signedAt: null,
        signedUploadedBy: null,
      },
    });

    res.json({ ok: true });
  }
);

/**
 * DELETE /api/employees/:employeeId/contracts/:contractId
 * Deletes the Firestore record and any associated Storage files (best-effort).
 */
contractsRouter.delete(
  "/employees/:employeeId/contracts/:contractId",
  requirePermission("contracts.delete"),
  async (req: AuthRequest, res: Response) => {
    const ref = db()
      .collection("employees")
      .doc(req.params.employeeId)
      .collection("contracts")
      .doc(req.params.contractId);

    const existing = await ref.get();
    if (!existing.exists) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }

    const data = existing.data() as Record<string, unknown>;
    const paths = [data.unsignedStoragePath, data.signedStoragePath].filter(
      (p): p is string => typeof p === "string" && p.length > 0
    );
    const bucket = admin.storage().bucket();
    await Promise.all(
      paths.map((p) => bucket.file(p).delete().catch(() => undefined))
    );

    await ref.delete();
    await logDelete(ctxFromReq(req), {
      collection: "employees/contracts",
      resourceId: req.params.employeeId,
      subResourceId: req.params.contractId,
      employeeId: req.params.employeeId,
      summary: {
        type: data.type,
        status: data.status,
        displayName: data.displayName,
      },
    });
    res.json({ ok: true });
  }
);
