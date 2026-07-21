/**
 * Dokumenty — standalone printable document templates.
 *
 * A `documentTemplates/{id}` doc is a TipTap-authored HTML document with up to
 * ten custom variable slots ({{var1}}..{{var10}}). A viewer fills the slots in
 * and prints; the filled document is rendered to PDF by the SAME Puppeteer
 * service the contracts use and streamed straight back to the browser.
 *
 * NOTHING is persisted from a render: no Storage upload, no Firestore record,
 * no history. That is why `render-pdf` writes no audit entry (matching
 * `POST /contracts/render-pdf`) and why there is no `usage` endpoint.
 *
 * Deliberately custom-variables-only — no employee binding and no
 * employee/company variable resolution. The doc shape therefore mirrors
 * `contractTemplates` minus the contract-specific `type` / `kind` fields, and
 * there are no built-in templates: every document here is user-created and
 * hard-deletable.
 */
import { Router, Response } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { requirePermission } from "../auth/permissions";
import { ctxFromReq, logCreate, logUpdate, logDelete } from "../services/auditLog";
import { renderPdf, RenderMargins } from "../services/pdfRenderer";
import {
  isDocumentSectionId,
  maySeeDocumentSection,
} from "../services/documentSections";

export const dokumentyRouter = Router();

const db = () => admin.firestore();

const COLLECTION = "documentTemplates";

/** Extract {{variableName}} keys from an HTML string */
function extractVariables(html: string): string[] {
  const matches = html.matchAll(/\{\{(\w+)\}\}/g);
  const keys = new Set<string>();
  for (const m of matches) keys.add(m[1]);
  return Array.from(keys);
}

/** Section access for THIS request. Thin wrapper so call sites stay readable. */
function maySeeSection(req: AuthRequest, section: unknown): boolean {
  return maySeeDocumentSection(req.permissions ?? new Set<string>(), section);
}

const SLUG_RE = /^[a-z][a-z0-9_]{1,39}$/;

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
    (k) =>
      typeof obj[k] === "number" &&
      Number.isFinite(obj[k]) &&
      (obj[k] as number) >= 0 &&
      (obj[k] as number) <= 100
  );
}

/**
 * Per-template configuration of the ten custom variable slots
 * {{var1}}..{{var10}}. Each slot a template uses gets a display label and a
 * value type here; the same slot means different things in different
 * templates, which is why this lives on the template document.
 *
 * Shape: { var1: { label, type: "text"|"date"|"number"|"bool"|"condition",
 *                  default?, condition?, optional? }, … }
 */
const CUSTOM_VAR_KEYS = new Set(Array.from({ length: 10 }, (_, i) => `var${i + 1}`));
// No "condition" here, unlike contractTemplates: a condition slot is computed
// by comparing built-in employee variables, and documents have none. The
// Dokumenty editor never offers it, so the server refuses it too rather than
// accepting a type that could only ever have arrived by hand-crafted request.
const CUSTOM_VAR_TYPES = new Set(["text", "date", "number", "bool", "list"]);
const COMPARE_OPS = new Set(["lt", "lte", "gt", "gte", "eq", "neq", "empty", "notEmpty"]);
// Unary operators test the left operand alone — no right operand required.
const UNARY_COMPARE_OPS = new Set(["empty", "notEmpty"]);
const CUSTOM_VAR_LABEL_MAX = 60;
const CUSTOM_VAR_DEFAULT_MAX = 200;

/**
 * Optional derived-condition definition (only meaningful on a "condition"
 * slot): a comparison { leftKey, op, right?: {kind:"var",key} |
 * {kind:"literal",value} }. Operands here can only be other custom slots —
 * there is no employee-sourced comparable catalogue on this page — so keys are
 * only length-checked, exactly as in contractTemplates.
 */
function isValidCondition(v: unknown): boolean {
  if (v === undefined) return true;
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const c = v as Record<string, unknown>;
  if (typeof c.leftKey !== "string" || !c.leftKey || c.leftKey.length > CUSTOM_VAR_LABEL_MAX) return false;
  if (typeof c.op !== "string" || !COMPARE_OPS.has(c.op)) return false;
  if (UNARY_COMPARE_OPS.has(c.op)) return true;
  if (!c.right || typeof c.right !== "object") return false;
  const r = c.right as Record<string, unknown>;
  if (r.kind === "var") return typeof r.key === "string" && !!r.key && r.key.length <= CUSTOM_VAR_LABEL_MAX;
  if (r.kind === "literal") return typeof r.value === "string" && r.value.length <= CUSTOM_VAR_DEFAULT_MAX;
  return false;
}

/** Optional per-slot default value — a literal string. */
function isValidCustomDefault(v: unknown): boolean {
  if (v === undefined) return true;
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const d = v as Record<string, unknown>;
  if (d.kind === "literal") {
    return typeof d.value === "string" && d.value.length <= CUSTOM_VAR_DEFAULT_MAX;
  }
  return false;
}

/**
 * Choices offered by a "list" slot. Shape-only validation: an empty list is
 * allowed here on purpose, because the editor lets an author pick the type
 * before typing the values and rejecting that mid-configuration save would be
 * hostile. The editor warns about an optionless list instead.
 */
const CUSTOM_VAR_MAX_OPTIONS = 30;
const CUSTOM_VAR_OPTION_MAX = 100;
function isValidCustomOptions(v: unknown): boolean {
  if (v === undefined) return true;
  if (!Array.isArray(v)) return false;
  if (v.length > CUSTOM_VAR_MAX_OPTIONS) return false;
  return v.every((o) => typeof o === "string" && o.length <= CUSTOM_VAR_OPTION_MAX);
}

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
      CUSTOM_VAR_TYPES.has(d.type) &&
      isValidCustomDefault(d.default) &&
      isValidCondition(d.condition) &&
      isValidCustomOptions(d.options) &&
      // "Nepovinná" – absent means required, so only a real boolean is
      // accepted; a truthy string would silently make a slot optional.
      (d.optional === undefined || typeof d.optional === "boolean")
    );
  });
}

/**
 * POST /api/dokumenty/render-pdf
 * Server-side PDF generation via the shared Puppeteer renderer — the same
 * service `POST /contracts/render-pdf` uses, so output matches the editor
 * preview. Gated on `nav.dokumenty.view`: a Dokumenty viewer prints documents
 * and must not need any contracts permission to do so.
 *
 * Body: { html, margins? }
 *   - html: filled HTML body content (no <html>/<body> wrapper)
 *   - margins: optional { top, bottom, left, right } in mm (defaults 15)
 *
 * Returns: application/pdf binary. Nothing is stored, so nothing is audited.
 *
 * Registered before the /:id routes so the literal path always wins.
 */
dokumentyRouter.post(
  "/render-pdf",
  requireAuth,
  requirePermission("nav.dokumenty.view"),
  async (req: AuthRequest, res: Response) => {
    const { html, margins } = req.body as { html?: string; margins?: RenderMargins };
    if (typeof html !== "string" || !html) {
      res.status(400).json({ error: "html is required" });
      return;
    }
    try {
      const pdf = await renderPdf(html, margins);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Length", pdf.length.toString());
      res.send(pdf);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      res.status(500).json({ error: `PDF rendering failed: ${msg}` });
    }
  }
);

/**
 * GET /api/dokumenty
 * List of all document templates WITHOUT htmlContent (the list view only needs
 * metadata, and htmlContent can approach 1 MB per doc).
 */
dokumentyRouter.get(
  "/",
  requireAuth,
  requirePermission("nav.dokumenty.view"),
  async (req: AuthRequest, res: Response) => {
    const snap = await db().collection(COLLECTION).get();
    const docs = snap.docs
      // Filtered server-side, not just hidden in the UI — the list is the only
      // place a document's existence is disclosed.
      .filter((d) => maySeeSection(req, d.data().section))
      .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: data.name,
        section: data.section ?? null,
        // Absent = active. Only an explicit `active:false` marks a template
        // inactive — see PATCH /:id below.
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
 * POST /api/dokumenty
 * Create an empty document template. Body: { id, name }.
 * `id` must be a snake_case slug not already in use.
 */
dokumentyRouter.post(
  "/",
  requireAuth,
  requirePermission("dokumenty.manage"),
  async (req: AuthRequest, res: Response) => {
    const { id, name, section } = req.body as {
      id?: string;
      name?: string;
      section?: unknown;
    };
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
    const ref = db().collection(COLLECTION).doc(id);
    const existing = await ref.get();
    if (existing.exists) {
      res.status(409).json({ error: "Dokument s tímto id již existuje." });
      return;
    }
    // null (not absent) so the field always exists: "unfiled" is a real state,
    // and a missing field would be indistinguishable from a doc written before
    // sections existed.
    if (section !== undefined && section !== null && section !== "" && !isDocumentSectionId(section)) {
      res.status(400).json({ error: "Neplatná sekce." });
      return;
    }
    await ref.set({
      name: name.trim(),
      section: isDocumentSectionId(section) ? section : null,
      htmlContent: "",
      variables: [],
      margins: { top: 15, bottom: 15, left: 15, right: 15 },
      createdAt: FieldValue.serverTimestamp(),
      createdBy: req.uid,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: req.uid,
    });
    await logCreate(ctxFromReq(req), {
      collection: COLLECTION,
      resourceId: id,
      summary: { name: name.trim(), section: isDocumentSectionId(section) ? section : null },
    });
    res.status(201).json({
      id,
      name: name.trim(),
      section: isDocumentSectionId(section) ? section : null,
    });
  }
);

/**
 * GET /api/dokumenty/:id
 * Full template including htmlContent.
 */
dokumentyRouter.get(
  "/:id",
  requireAuth,
  requirePermission("nav.dokumenty.view"),
  async (req: AuthRequest, res: Response) => {
    const doc = await db().collection(COLLECTION).doc(req.params.id).get();
    if (!doc.exists) {
      res.status(404).json({ error: "Dokument neexistuje." });
      return;
    }
    // 404 rather than 403: a document the caller may not see should not have its
    // existence confirmed by the status code.
    if (!maySeeSection(req, doc.data()?.section)) {
      res.status(404).json({ error: "Dokument neexistuje." });
      return;
    }
    res.json({ id: doc.id, ...doc.data() });
  }
);

/**
 * PUT /api/dokumenty/:id
 * Upsert a template. Body: { name, htmlContent, margins?, variableDefs? }.
 */
dokumentyRouter.put(
  "/:id",
  requireAuth,
  requirePermission("dokumenty.manage"),
  async (req: AuthRequest, res: Response) => {
    const { name, htmlContent, margins, variableDefs, section } = req.body as {
      name?: string;
      htmlContent?: string;
      margins?: unknown;
      variableDefs?: unknown;
      section?: unknown;
    };

    if (!name || htmlContent === undefined) {
      res.status(400).json({ error: "name a htmlContent jsou povinné." });
      return;
    }

    if (margins !== undefined && !isValidMargins(margins)) {
      res.status(400).json({ error: "margins must be {top,bottom,left,right} numbers in mm (0–100)" });
      return;
    }

    if (variableDefs !== undefined && !isValidVariableDefs(variableDefs)) {
      res.status(400).json({
        error:
          "variableDefs musí být objekt {var1..var10: {label, type, optional?, options?}}, kde type je text|date|number|bool|list, optional je true|false a options je seznam nejvýše 30 textových hodnot.",
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
          "Dokument je příliš velký (přesahuje limit 1 MB). Nejčastější příčinou jsou vložené obrázky uložené přímo v textu (base64). Zmenšete nebo odstraňte obrázky a uložte znovu.",
      });
      return;
    }

    const variables = extractVariables(htmlContent);

    const payload: Record<string, unknown> = {
      name,
      htmlContent,
      variables,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: req.uid,
    };
    if (margins !== undefined) payload.margins = margins;
    if (variableDefs !== undefined) payload.variableDefs = variableDefs;
    // Explicit null clears the section (back to visible-to-everyone); omitting
    // the field leaves the current one untouched.
    if (section !== undefined) {
      if (section !== null && section !== "" && !isDocumentSectionId(section)) {
        res.status(400).json({ error: "Neplatná sekce." });
        return;
      }
      payload.section = isDocumentSectionId(section) ? section : null;
    }

    const ref = db().collection(COLLECTION).doc(req.params.id);
    const beforeSnap = await ref.get();
    const before = beforeSnap.exists ? (beforeSnap.data() as Record<string, unknown>) : {};
    try {
      await ref.set(payload, { merge: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // Firestore rejects oversized writes — surface a clear Czech message
      // instead of a generic 500.
      if (/maximum|too large|exceeds|size/i.test(message)) {
        res.status(413).json({
          error:
            "Dokument se nepodařilo uložit — je příliš velký (limit 1 MB). Pravděpodobně obsahuje vložené obrázky (base64). Zmenšete nebo odstraňte obrázky a uložte znovu.",
        });
        return;
      }
      res.status(500).json({ error: `Dokument se nepodařilo uložit: ${message}` });
      return;
    }

    // The htmlContent is verbose; record only what changed semantically by
    // logging a compact diff on name/variables/margins, plus a flag whether
    // htmlContent itself changed.
    await logUpdate(ctxFromReq(req), {
      collection: COLLECTION,
      resourceId: req.params.id,
      before: {
        name: before.name,
        variables: before.variables,
        margins: before.margins,
        htmlContentLength: typeof before.htmlContent === "string" ? before.htmlContent.length : 0,
      },
      after: {
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
 * PATCH /api/dokumenty/:id
 * Toggle a template's active flag. Deactivating hides it from the fill-in /
 * print surface and sorts it to the bottom of the list. Reversible.
 * Body: { active: boolean }.
 */
dokumentyRouter.patch(
  "/:id",
  requireAuth,
  requirePermission("dokumenty.manage"),
  async (req: AuthRequest, res: Response) => {
    const { active } = req.body as { active?: unknown };
    if (typeof active !== "boolean") {
      res.status(400).json({ error: "active musí být boolean." });
      return;
    }
    const ref = db().collection(COLLECTION).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Dokument neexistuje." });
      return;
    }
    const before = snap.data() as Record<string, unknown>;
    const beforeActive = before.active !== false;
    await ref.set(
      { active, updatedAt: FieldValue.serverTimestamp(), updatedBy: req.uid },
      { merge: true }
    );
    await logUpdate(ctxFromReq(req), {
      collection: COLLECTION,
      resourceId: req.params.id,
      before: { active: beforeActive },
      after: { active },
    });
    res.json({ id: req.params.id, active });
  }
);

/**
 * DELETE /api/dokumenty/:id
 * Hard delete. There are no built-in documents here — every template is
 * user-created — so nothing is protected, and since renders are never stored
 * there is no downstream data to orphan.
 */
dokumentyRouter.delete(
  "/:id",
  requireAuth,
  requirePermission("dokumenty.manage"),
  async (req: AuthRequest, res: Response) => {
    const id = req.params.id;
    const ref = db().collection(COLLECTION).doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Dokument neexistuje." });
      return;
    }
    const data = snap.data() as Record<string, unknown>;
    await ref.delete();
    await logDelete(ctxFromReq(req), {
      collection: COLLECTION,
      resourceId: id,
      summary: { name: data.name },
    });
    res.json({ id, deleted: true });
  }
);
