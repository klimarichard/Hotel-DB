import { Router, Response } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, requireRole, AuthRequest } from "../middleware/auth";

export const departmentsRouter = Router();

const db = () => admin.firestore();

/**
 * GET /api/departments
 * List all departments, ordered by displayOrder ascending.
 */
departmentsRouter.get(
  "/",
  requireAuth,
  requireRole("admin", "director"),
  async (_req: AuthRequest, res: Response) => {
    const snap = await db().collection("departments").orderBy("displayOrder", "asc").get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }
);

/**
 * POST /api/departments
 * Create a new department.
 * Body: { name, displayOrder? }
 */
departmentsRouter.post(
  "/",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res: Response) => {
    const { name, displayOrder } = req.body as { name: string; displayOrder?: number };
    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "Název je povinný." });
      return;
    }
    const ref = await db().collection("departments").add({
      name,
      displayOrder: typeof displayOrder === "number" ? displayOrder : 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    res.json({ id: ref.id });
  }
);

/**
 * PATCH /api/departments/:id
 * Update a department.
 * Body: partial { name?, displayOrder? }
 */
departmentsRouter.patch(
  "/:id",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res: Response) => {
    const { name, displayOrder } = req.body as { name?: string; displayOrder?: number };
    const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (typeof name === "string") update.name = name;
    if (typeof displayOrder === "number") update.displayOrder = displayOrder;
    await db().collection("departments").doc(req.params.id).update(update);
    res.json({ ok: true });
  }
);

/**
 * DELETE /api/departments/:id
 * Deletes a department. Fails if any job position references it.
 */
departmentsRouter.delete(
  "/:id",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res: Response) => {
    const posSnap = await db()
      .collection("jobPositions")
      .where("departmentId", "==", req.params.id)
      .limit(1)
      .get();
    if (!posSnap.empty) {
      res.status(400).json({ error: "Nelze smazat oddělení, které obsahuje pozice." });
      return;
    }
    await db().collection("departments").doc(req.params.id).delete();
    res.json({ ok: true });
  }
);
