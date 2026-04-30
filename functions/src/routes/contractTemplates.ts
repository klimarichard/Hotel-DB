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
        kind: data.kind ?? null,
        variables: data.variables ?? [],
        updatedAt: data.updatedAt,
        updatedBy: data.updatedBy,
      };
    });
    res.json(docs);
  }
);

/**
 * POST /api/contractTemplates
 * Create a new custom standalone template. Admin + director only.
 * Body: { id, name }. id must be a snake_case slug not already in use.
 */
const BUILTIN_IDS = new Set<string>([
  "nastup_hpp",
  "nastup_ppp",
  "nastup_dpp",
  "ukonceni_hpp_ppp",
  "ukonceni_dpp",
  "ukonceni_zkusebni",
  "zmena_smlouvy",
  "hmotna_odpovednost",
  "multisport",
]);
const SLUG_RE = /^[a-z][a-z0-9_]{1,39}$/;

contractTemplatesRouter.post(
  "/",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res: Response) => {
    const { id, name } = req.body as { id?: string; name?: string };
    if (!id || !name || !name.trim()) {
      res.status(400).json({ error: "id a name jsou povinné." });
      return;
    }
    if (!SLUG_RE.test(id)) {
      res.status(400).json({
        error: "id musí být snake_case (písmena, číslice, podtržítka), 2–40 znaků, začínat písmenem.",
      });
      return;
    }
    if (BUILTIN_IDS.has(id)) {
      res.status(409).json({ error: "Toto id koliduje s vestavěnou šablonou." });
      return;
    }
    const ref = db().collection("contractTemplates").doc(id);
    const existing = await ref.get();
    if (existing.exists) {
      res.status(409).json({ error: "Šablona s tímto id již existuje." });
      return;
    }
    await ref.set({
      type: id,
      name: name.trim(),
      kind: "standalone",
      htmlContent: "",
      variables: [],
      margins: { top: 15, bottom: 15, left: 15, right: 15 },
      createdAt: FieldValue.serverTimestamp(),
      createdBy: req.uid,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: req.uid,
    });
    res.status(201).json({ id, name: name.trim(), kind: "standalone" });
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
interface Margins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

function isValidMargins(m: unknown): m is Margins {
  if (!m || typeof m !== "object") return false;
  const obj = m as Record<string, unknown>;
  return (["top", "bottom", "left", "right"] as const).every(
    (k) => typeof obj[k] === "number" && Number.isFinite(obj[k]) && (obj[k] as number) >= 0 && (obj[k] as number) <= 100
  );
}

contractTemplatesRouter.put(
  "/:id",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res: Response) => {
    const { type, name, htmlContent, margins } = req.body as {
      type: string;
      name: string;
      htmlContent: string;
      margins?: unknown;
    };

    if (!type || !name || htmlContent === undefined) {
      res.status(400).json({ error: "type, name, and htmlContent are required" });
      return;
    }

    if (margins !== undefined && !isValidMargins(margins)) {
      res.status(400).json({ error: "margins must be {top,bottom,left,right} numbers in mm (0–100)" });
      return;
    }

    const variables = extractVariables(htmlContent);

    const payload: Record<string, unknown> = {
      type,
      name,
      htmlContent,
      variables,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: req.uid,
    };
    if (margins !== undefined) payload.margins = margins;

    await db()
      .collection("contractTemplates")
      .doc(req.params.id)
      .set(payload, { merge: true });

    res.json({ id: req.params.id, variables });
  }
);
