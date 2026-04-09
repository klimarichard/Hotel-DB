import { Router, Response } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, requireRole, AuthRequest } from "../middleware/auth";

export const contractTemplatesRouter = Router();

const db = () => admin.firestore();

export type ContractType =
  | "nastup_hpp"
  | "nastup_ppp"
  | "nastup_dpp"
  | "ukonceni_hpp_ppp"
  | "ukonceni_dpp"
  | "ukonceni_zkusebni"
  | "zmena_smlouvy"
  | "hmotna_odpovednost"
  | "multisport";

export const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  nastup_hpp: "Nástup HPP",
  nastup_ppp: "Nástup PPP",
  nastup_dpp: "Nástup DPP",
  ukonceni_hpp_ppp: "Ukončení HPP/PPP",
  ukonceni_dpp: "Ukončení DPP",
  ukonceni_zkusebni: "Ukončení ve zkušební době",
  zmena_smlouvy: "Změna smlouvy (dodatek)",
  hmotna_odpovednost: "Hmotná odpovědnost",
  multisport: "Multisport",
};

/** Extract {{variableName}} keys from an HTML string */
function extractVariables(html: string): string[] {
  const matches = html.matchAll(/\{\{(\w+)\}\}/g);
  const keys = new Set<string>();
  for (const m of matches) keys.add(m[1]);
  return Array.from(keys);
}

/**
 * GET /api/contractTemplates
 * Returns list of all templates (no htmlContent). Admin + director only.
 */
contractTemplatesRouter.get(
  "/",
  requireAuth,
  requireRole("admin", "director"),
  async (_req: AuthRequest, res: Response) => {
    const snap = await db().collection("contractTemplates").get();
    const docs = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        type: data.type,
        name: data.name,
        variables: data.variables ?? [],
        updatedAt: data.updatedAt,
        updatedBy: data.updatedBy,
      };
    });
    res.json(docs);
  }
);

/**
 * GET /api/contractTemplates/:id
 * Returns full template including htmlContent. Admin + director only.
 */
contractTemplatesRouter.get(
  "/:id",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res: Response) => {
    const doc = await db().collection("contractTemplates").doc(req.params.id).get();
    if (!doc.exists) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    res.json({ id: doc.id, ...doc.data() });
  }
);

/**
 * PUT /api/contractTemplates/:id
 * Upsert a template. Admin + director only.
 * Body: { type, name, htmlContent }
 */
contractTemplatesRouter.put(
  "/:id",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res: Response) => {
    const { type, name, htmlContent } = req.body as {
      type: ContractType;
      name: string;
      htmlContent: string;
    };

    if (!type || !name || htmlContent === undefined) {
      res.status(400).json({ error: "type, name, and htmlContent are required" });
      return;
    }

    const variables = extractVariables(htmlContent);

    await db()
      .collection("contractTemplates")
      .doc(req.params.id)
      .set(
        {
          type,
          name,
          htmlContent,
          variables,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: req.uid,
        },
        { merge: true }
      );

    res.json({ id: req.params.id, variables });
  }
);
