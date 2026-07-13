import { Router, Response } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { requirePermission } from "../auth/permissions";
import { ctxFromReq, logCreate, logUpdate, logDelete } from "../services/auditLog";

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
  requirePermission("nav.contractTemplates.view"),
  async (_req: AuthRequest, res: Response) => {
    const snap = await db().collection("contractTemplates").get();
    const docs = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        type: data.type,
        name: data.name,
        kind: data.kind ?? null,
        // Absent = active. Only an explicit `active:false` marks a template
        // inactive (deactivated built-in) — see PATCH /:id below.
        active: data.active !== false,
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
  requirePermission("contractTemplates.manage"),
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
    await logCreate(ctxFromReq(req), {
      collection: "contractTemplates",
      resourceId: id,
      summary: { type: id, name: name.trim(), kind: "standalone" },
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
  requirePermission("nav.contractTemplates.view"),
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

/**
 * Per-template configuration of the ten custom variable slots {{var1}}..{{var10}}
 * (see frontend/src/lib/contractVariables.ts). Each slot a template uses gets a
 * display label and a value type here; the same slot means different things in
 * different templates, which is why this lives on the template document rather
 * than in a global catalog.
 *
 * Shape: { var1: { label: string, type: "text"|"date"|"number"|"bool" }, … }
 */
const CUSTOM_VAR_KEYS = new Set(
  Array.from({ length: 10 }, (_, i) => `var${i + 1}`)
);
const CUSTOM_VAR_TYPES = new Set(["text", "date", "number", "bool"]);
const CUSTOM_VAR_LABEL_MAX = 60;

function isValidVariableDefs(v: unknown): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  return Object.entries(v as Record<string, unknown>).every(([key, def]) => {
    if (!CUSTOM_VAR_KEYS.has(key)) return false;
    if (!def || typeof def !== "object") return false;
    const d = def as Record<string, unknown>;
    return (
      typeof d.label === "string" &&
      d.label.length <= CUSTOM_VAR_LABEL_MAX &&
      typeof d.type === "string" &&
      CUSTOM_VAR_TYPES.has(d.type)
    );
  });
}

contractTemplatesRouter.put(
  "/:id",
  requireAuth,
  requirePermission("contractTemplates.manage"),
  async (req: AuthRequest, res: Response) => {
    const { type, name, htmlContent, margins, variableDefs } = req.body as {
      type: string;
      name: string;
      htmlContent: string;
      margins?: unknown;
      variableDefs?: unknown;
    };

    if (!type || !name || htmlContent === undefined) {
      res.status(400).json({ error: "type, name, and htmlContent are required" });
      return;
    }

    if (margins !== undefined && !isValidMargins(margins)) {
      res.status(400).json({ error: "margins must be {top,bottom,left,right} numbers in mm (0–100)" });
      return;
    }

    if (variableDefs !== undefined && !isValidVariableDefs(variableDefs)) {
      res.status(400).json({
        error:
          "variableDefs musí být objekt {var1..var10: {label, type}}, kde type je text|date|number|bool.",
      });
      return;
    }

    // Firestore caps a single document at 1 MiB. The htmlContent is by far the
    // largest field and balloons when the editor inlines base64 images, so a
    // too-large template is the usual cause of a silent write failure. Reject
    // it up front with a clear Czech message rather than letting the Firestore
    // error bubble up as an opaque 500.
    const FIRESTORE_DOC_LIMIT = 1_048_576; // 1 MiB
    // Leave headroom for the other fields + Firestore's own per-field overhead.
    const HTML_LIMIT = FIRESTORE_DOC_LIMIT - 64 * 1024;
    const htmlBytes = Buffer.byteLength(htmlContent, "utf8");
    if (htmlBytes > HTML_LIMIT) {
      res.status(413).json({
        error:
          "Šablona je příliš velká (přesahuje limit 1 MB). Nejčastější příčinou jsou vložené obrázky uložené přímo v textu (base64). Zmenšete nebo odstraňte obrázky a uložte znovu.",
      });
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
    if (variableDefs !== undefined) payload.variableDefs = variableDefs;

    const ref = db().collection("contractTemplates").doc(req.params.id);
    const beforeSnap = await ref.get();
    const before = beforeSnap.exists ? (beforeSnap.data() as Record<string, unknown>) : {};
    try {
      await ref.set(payload, { merge: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // Firestore rejects oversized writes (e.g. exceeds the maximum allowed
      // size) — surface a clear Czech message instead of a generic 500.
      if (/maximum|too large|exceeds|size/i.test(message)) {
        res.status(413).json({
          error:
            "Šablonu se nepodařilo uložit — je příliš velká (limit 1 MB). Pravděpodobně obsahuje vložené obrázky (base64). Zmenšete nebo odstraňte obrázky a uložte znovu.",
        });
        return;
      }
      res.status(500).json({
        error: `Šablonu se nepodařilo uložit: ${message}`,
      });
      return;
    }

    // The htmlContent is verbose; record only what changed semantically by
    // logging a compact diff on type/name/variables/margins, plus a flag
    // whether htmlContent itself changed.
    await logUpdate(ctxFromReq(req), {
      collection: "contractTemplates",
      resourceId: req.params.id,
      before: {
        type: before.type,
        name: before.name,
        variables: before.variables,
        margins: before.margins,
        htmlContentLength: typeof before.htmlContent === "string" ? before.htmlContent.length : 0,
      },
      after: {
        type,
        name,
        variables,
        margins: payload.margins ?? before.margins,
        htmlContentLength: htmlContent.length,
      },
    });

    res.json({ id: req.params.id, variables });
  }
);

/**
 * GET /api/contractTemplates/:id/usage
 * How many generated contracts reference this template (by `type`). Used to
 * warn before deleting a custom template — the generated PDFs survive the
 * delete, they just lose the link back to the template name.
 *
 * Generated contracts live at employees/{id}/contracts/{cid} and store the
 * template id in `type`, so this is a collection-group count over `contracts`.
 * (Requires the `contracts.type` COLLECTION_GROUP field override in
 * firestore.indexes.json.)
 */
contractTemplatesRouter.get(
  "/:id/usage",
  requireAuth,
  requirePermission("contractTemplates.manage"),
  async (req: AuthRequest, res: Response) => {
    const agg = await db()
      .collectionGroup("contracts")
      .where("type", "==", req.params.id)
      .count()
      .get();
    res.json({ id: req.params.id, count: agg.data().count });
  }
);

/**
 * DELETE /api/contractTemplates/:id
 * Hard-delete a CUSTOM (user-created, kind:"standalone") template. Built-in
 * templates cannot be deleted — the seed would recreate them and the
 * employment-tied ones are structural — they can only be deactivated (PATCH).
 * Already-generated contracts are left untouched (their PDFs persist).
 */
contractTemplatesRouter.delete(
  "/:id",
  requireAuth,
  requirePermission("contractTemplates.manage"),
  async (req: AuthRequest, res: Response) => {
    const id = req.params.id;
    if (BUILTIN_IDS.has(id)) {
      res.status(409).json({
        error: "Vestavěnou šablonu nelze smazat — lze ji pouze deaktivovat.",
      });
      return;
    }
    const ref = db().collection("contractTemplates").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Šablona neexistuje." });
      return;
    }
    const data = snap.data() as Record<string, unknown>;
    await ref.delete();
    await logDelete(ctxFromReq(req), {
      collection: "contractTemplates",
      resourceId: id,
      summary: { type: data.type ?? id, name: data.name, kind: data.kind ?? null },
    });
    res.json({ id, deleted: true });
  }
);

/**
 * PATCH /api/contractTemplates/:id
 * Toggle a template's active flag. Deactivating hides it from the contract
 * generation surfaces (the "+ Adhoc dokument" picker and — defensively — the
 * GenerateContractModal) and sorts it to the bottom of the templates list.
 * Reversible. Used mainly for built-in templates (which can't be deleted).
 * Body: { active: boolean }.
 */
contractTemplatesRouter.patch(
  "/:id",
  requireAuth,
  requirePermission("contractTemplates.manage"),
  async (req: AuthRequest, res: Response) => {
    const { active } = req.body as { active?: unknown };
    if (typeof active !== "boolean") {
      res.status(400).json({ error: "active musí být boolean." });
      return;
    }
    const ref = db().collection("contractTemplates").doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Šablona neexistuje." });
      return;
    }
    const before = snap.data() as Record<string, unknown>;
    const beforeActive = before.active !== false;
    await ref.set(
      { active, updatedAt: FieldValue.serverTimestamp(), updatedBy: req.uid },
      { merge: true }
    );
    await logUpdate(ctxFromReq(req), {
      collection: "contractTemplates",
      resourceId: req.params.id,
      before: { active: beforeActive },
      after: { active },
    });
    res.json({ id: req.params.id, active });
  }
);
