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
 * Create a contract metadata record after the PDF is already in Storage.
 * Body: { type, status, employmentRowId?, unsignedStoragePath?, notes? }
 */
contractsRouter.post(
  "/employees/:employeeId/contracts",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res: Response) => {
    const {
      type,
      status = "unsigned",
      employmentRowId,
      unsignedStoragePath,
      notes,
    } = req.body as {
      type: ContractType;
      status?: ContractStatus;
      employmentRowId?: string;
      unsignedStoragePath?: string;
      notes?: string;
    };

    if (!type) {
      res.status(400).json({ error: "type is required" });
      return;
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

    const ref = await db()
      .collection("employees")
      .doc(req.params.employeeId)
      .collection("contracts")
      .add(docData);

    res.status(201).json({ id: ref.id });
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
