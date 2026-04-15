import { Router, Response } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, requireRole, AuthRequest } from "../middleware/auth";

export const jobPositionsRouter = Router();

const db = () => admin.firestore();

/**
 * GET /api/jobPositions
 * List all job positions, ordered by displayOrder ascending.
 * Optional query: ?departmentId=xxx
 */
jobPositionsRouter.get(
  "/",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res: Response) => {
    const { departmentId } = req.query as { departmentId?: string };
    let query: FirebaseFirestore.Query = db().collection("jobPositions");
    if (departmentId) {
      query = query.where("departmentId", "==", departmentId);
    }
    const snap = await query.orderBy("displayOrder", "asc").get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }
);

/**
 * POST /api/jobPositions
 * Create a new job position.
 * Body: { name, departmentId, defaultSalary, displayOrder? }
 */
jobPositionsRouter.post(
  "/",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res: Response) => {
    const { name, departmentId, defaultSalary, hourlyRate, displayOrder } = req.body as {
      name: string;
      departmentId: string;
      defaultSalary: number;
      hourlyRate?: number | null;
      displayOrder?: number;
    };
    if (!name || !departmentId) {
      res.status(400).json({ error: "Název a oddělení jsou povinné." });
      return;
    }
    const ref = await db().collection("jobPositions").add({
      name,
      departmentId,
      defaultSalary: Number(defaultSalary) || 0,
      hourlyRate: hourlyRate != null ? Number(hourlyRate) : null,
      displayOrder: typeof displayOrder === "number" ? displayOrder : 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    res.json({ id: ref.id });
  }
);

/**
 * PATCH /api/jobPositions/:id
 * Update a job position.
 */
jobPositionsRouter.patch(
  "/:id",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res: Response) => {
    const { name, departmentId, defaultSalary, hourlyRate, displayOrder } = req.body as {
      name?: string;
      departmentId?: string;
      defaultSalary?: number;
      hourlyRate?: number | null;
      displayOrder?: number;
    };
    const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (typeof name === "string") update.name = name;
    if (typeof departmentId === "string") update.departmentId = departmentId;
    if (defaultSalary !== undefined) update.defaultSalary = Number(defaultSalary) || 0;
    if (hourlyRate !== undefined) update.hourlyRate = hourlyRate != null ? Number(hourlyRate) : null;
    if (typeof displayOrder === "number") update.displayOrder = displayOrder;
    await db().collection("jobPositions").doc(req.params.id).update(update);
    res.json({ ok: true });
  }
);

/**
 * DELETE /api/jobPositions/:id
 */
jobPositionsRouter.delete(
  "/:id",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res: Response) => {
    await db().collection("jobPositions").doc(req.params.id).delete();
    res.json({ ok: true });
  }
);
