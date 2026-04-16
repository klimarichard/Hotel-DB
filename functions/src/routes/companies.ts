import { Router, Response } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, requireRole, AuthRequest } from "../middleware/auth";

export const companiesRouter = Router();

const db = () => admin.firestore();

/**
 * GET /api/companies
 * List all companies. Admin + director only.
 */
companiesRouter.get(
  "/",
  requireAuth,
  requireRole("admin", "director"),
  async (_req: AuthRequest, res: Response) => {
    const snap = await db().collection("companies").get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }
);

/**
 * GET /api/companies/:id
 * Fetch a single company by code (e.g. "HPM", "STP"). Admin + director only.
 */
companiesRouter.get(
  "/:id",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res: Response) => {
    const doc = await db().collection("companies").doc(req.params.id).get();
    if (!doc.exists) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    res.json({ id: doc.id, ...doc.data() });
  }
);

/**
 * PUT /api/companies/:id
 * Upsert a company. Admin + director only.
 * Body: { name, address, ic, dic, fileNo }
 */
companiesRouter.put(
  "/:id",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res: Response) => {
    const { name, address, ic, dic, fileNo } = req.body as {
      name: string;
      address: string;
      ic: string;
      dic: string;
      fileNo?: string;
    };

    await db()
      .collection("companies")
      .doc(req.params.id)
      .set(
        {
          name: name ?? "",
          address: address ?? "",
          ic: ic ?? "",
          dic: dic ?? "",
          fileNo: fileNo ?? "",
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: req.uid,
        },
        { merge: true }
      );

    res.json({ id: req.params.id });
  }
);
