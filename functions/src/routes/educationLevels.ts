import { Router, Response } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, requireRole, AuthRequest } from "../middleware/auth";

export const educationLevelsRouter = Router();

const db = () => admin.firestore();

/**
 * GET /api/educationLevels
 * Listed in displayOrder ascending. Available to all authenticated users
 * because the EmployeeFormPage select needs the list at edit time.
 */
educationLevelsRouter.get(
  "/",
  requireAuth,
  async (_req: AuthRequest, res: Response) => {
    const snap = await db().collection("educationLevels").orderBy("displayOrder", "asc").get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }
);

educationLevelsRouter.post(
  "/",
  requireAuth,
  requireRole("admin"),
  async (req: AuthRequest, res: Response) => {
    const { name, code, displayOrder } = req.body as { name: string; code: string; displayOrder?: number };
    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "Název je povinný." });
      return;
    }
    if (!code || typeof code !== "string" || !code.trim()) {
      res.status(400).json({ error: "Kód je povinný." });
      return;
    }
    const ref = await db().collection("educationLevels").add({
      name: name.trim(),
      code: code.trim(),
      displayOrder: typeof displayOrder === "number" ? displayOrder : 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    res.json({ id: ref.id });
  }
);

educationLevelsRouter.patch(
  "/:id",
  requireAuth,
  requireRole("admin"),
  async (req: AuthRequest, res: Response) => {
    const { name, code, displayOrder } = req.body as { name?: string; code?: string; displayOrder?: number };
    const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (typeof name === "string") update.name = name.trim();
    if (typeof code === "string") update.code = code.trim();
    if (typeof displayOrder === "number") update.displayOrder = displayOrder;
    await db().collection("educationLevels").doc(req.params.id).update(update);
    res.json({ ok: true });
  }
);

educationLevelsRouter.delete(
  "/:id",
  requireAuth,
  requireRole("admin"),
  async (req: AuthRequest, res: Response) => {
    await db().collection("educationLevels").doc(req.params.id).delete();
    res.json({ ok: true });
  }
);
