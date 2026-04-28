import { Router, Response } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, requireRole, AuthRequest } from "../middleware/auth";
import type { ContractType } from "./contractTemplates";

export const contractsRouter = Router();

const db = () => admin.firestore();

type ContractStatus = "unsigned" | "signed" | "archived";

/**
 * GET /api/employees/:employeeId/contracts
 * List all contracts for an employee. Admin/director/manager only.
 */
contractsRouter.get(
  "/employees/:employeeId/contracts",
  requireAuth,
  requireRole("admin", "director", "manager"),
  async (req: AuthRequest, res: Response) => {
    const snap = await db()
      .collection("employees")
      .doc(req.params.employeeId)
      .collection("contracts")
      .orderBy("generatedAt", "desc")
      .get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }
);

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
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res: Response) => {
    const {
      type,
      pdfBase64,
      status = "unsigned",
      employmentRowId,
      notes,
    } = req.body as {
      type: ContractType;
      pdfBase64?: string;
      status?: ContractStatus;
      employmentRowId?: string;
      notes?: string;
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

    await docRef.set(docData);
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
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res: Response) => {
    const { status, signedStoragePath, notes } = req.body as {
      status?: ContractStatus;
      signedStoragePath?: string;
      notes?: string;
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

    await ref.update(update);
    res.json({ ok: true });
  }
);

/**
 * DELETE /api/employees/:employeeId/contracts/:contractId
 * Deletes the Firestore record. Frontend is responsible for deleting Storage files.
 */
contractsRouter.delete(
  "/employees/:employeeId/contracts/:contractId",
  requireAuth,
  requireRole("admin", "director"),
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

    await ref.delete();
    res.json({ ok: true });
  }
);
