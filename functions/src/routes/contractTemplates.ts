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
 * Extract {key} placeholders from a DOCX file's text content. Reads the
 * primary `word/document.xml` entry from the zip, joins all <w:t> text runs,
 * then matches single-brace tokens (the docxtemplater default delimiter).
 * Word may split a placeholder across multiple <w:t> elements after a save —
 * the join handles that for us.
 */
function extractDocxVariables(docxBuffer: Buffer): string[] {
  // Lazy-load to keep cold start light; pizzip is already a frontend dep but
  // it's pure JS so it works in Functions without a separate install.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PizZip = require("pizzip");
  const zip = new PizZip(docxBuffer);
  const xml = zip.file("word/document.xml")?.asText();
  if (!xml) return [];
  // Strip everything except <w:t>...</w:t> contents to get the readable text.
  const textRuns: string[] = [];
  const re = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    textRuns.push(m[1]);
  }
  const fullText = textRuns.join("");
  const keys = new Set<string>();
  // Single braces, alphanumeric + underscore. Skip Word's curly-brace artifacts
  // by requiring a word char at both ends.
  for (const km of fullText.matchAll(/\{(\w+)\}/g)) keys.add(km[1]);
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
        templateFormat: data.templateFormat ?? "html",
        docxStoragePath: data.docxStoragePath ?? null,
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

/**
 * POST /api/contractTemplates/:id/docx
 * Upload a .docx template. Body: { type, name, docxBase64 }.
 * Stores the file at contractTemplates/docx/{id}.docx via Admin SDK and
 * sets templateFormat="docx" + docxStoragePath + variables on the doc.
 */
contractTemplatesRouter.post(
  "/:id/docx",
  requireAuth,
  requireRole("admin"),
  async (req: AuthRequest, res: Response) => {
    const { type, name, docxBase64 } = req.body as {
      type: ContractType;
      name: string;
      docxBase64: string;
    };
    if (!type || !name || !docxBase64) {
      res.status(400).json({ error: "type, name, and docxBase64 are required" });
      return;
    }

    const buf = Buffer.from(docxBase64, "base64");
    // Sanity check: a .docx is a zip; first two bytes are 'PK'.
    if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
      res.status(400).json({ error: "Soubor není platný .docx (chybí ZIP signatura)." });
      return;
    }

    const variables = extractDocxVariables(buf);

    const storagePath = `contractTemplates/docx/${req.params.id}.docx`;
    const file = admin.storage().bucket().file(storagePath);
    await file.save(buf, {
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      metadata: { metadata: { uploadedBy: req.uid ?? "" } },
    });

    await db()
      .collection("contractTemplates")
      .doc(req.params.id)
      .set(
        {
          type,
          name,
          templateFormat: "docx",
          docxStoragePath: storagePath,
          variables,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: req.uid,
        },
        { merge: true }
      );

    res.json({ id: req.params.id, variables, docxStoragePath: storagePath });
  }
);

/**
 * GET /api/contractTemplates/:id/docx
 * Returns the raw .docx bytes. Used both for re-editing (admin/director) and
 * by the contract generation flow (frontend fills tags client-side via
 * docxtemplater + pizzip).
 */
contractTemplatesRouter.get(
  "/:id/docx",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res: Response) => {
    const doc = await db().collection("contractTemplates").doc(req.params.id).get();
    if (!doc.exists) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    const data = doc.data() as { templateFormat?: string; docxStoragePath?: string };
    if (data.templateFormat !== "docx" || !data.docxStoragePath) {
      res.status(404).json({ error: "Template has no DOCX file" });
      return;
    }
    const file = admin.storage().bucket().file(data.docxStoragePath);
    const [exists] = await file.exists();
    if (!exists) {
      res.status(404).json({ error: "DOCX file missing from storage" });
      return;
    }
    const [buf] = await file.download();
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${req.params.id}.docx"`);
    res.send(buf);
  }
);

/**
 * DELETE /api/contractTemplates/:id/docx
 * Reverts the template to HTML format: deletes the .docx file and clears
 * templateFormat/docxStoragePath. The htmlContent (if any) stays intact.
 */
contractTemplatesRouter.delete(
  "/:id/docx",
  requireAuth,
  requireRole("admin"),
  async (req: AuthRequest, res: Response) => {
    const ref = db().collection("contractTemplates").doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    const data = doc.data() as { docxStoragePath?: string };
    if (data.docxStoragePath) {
      const file = admin.storage().bucket().file(data.docxStoragePath);
      const [exists] = await file.exists();
      if (exists) await file.delete();
    }
    await ref.set(
      {
        templateFormat: "html",
        docxStoragePath: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: req.uid,
      },
      { merge: true }
    );
    res.json({ ok: true });
  }
);
