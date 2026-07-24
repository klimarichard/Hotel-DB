/**
 * Dokumenty — standalone printable document templates.
 *
 * A `documentTemplates/{id}` doc is a TipTap-authored HTML document with up to
 * twenty-five custom variable slots ({{var1}}..{{var25}}). A viewer fills the
 * slots in and prints; the filled document is rendered to PDF by the SAME
 * Puppeteer service the contracts use and streamed straight back to the
 * browser.
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

/**
 * Whether this request may see a given document at all.
 *
 * This replaced the five per-hotel "sections", each with its own permission key.
 * Sections existed to gate a document per hotel, and the custom-variable work
 * removed the need: one document now serves all four hotels through a
 * Seznam/Obrázek slot plus {{#case}} blocks, so there is no per-hotel audience
 * left to gate. What remains is a single public/private flag.
 *
 * ⚠️ `public` is OPTIONAL and ABSENT MEANS PRIVATE — read it as `=== true`,
 * never for truthiness, and never default it to public. Every document written
 * before the field existed therefore reads as private the moment this ships,
 * which is precisely the intended migration ("everything → private") achieved
 * with ZERO writes to production. Do not add a backfill and do not "tidy" this
 * into an absent-means-public read.
 *
 * Compare `active` on this same collection, where absent means ACTIVE: same
 * shape, opposite default, both deliberate.
 *
 * `dokumenty.manage` short-circuits to seeing everything, exactly as it did for
 * sections: an editor who could not see a private document could neither fix nor
 * delete it.
 *
 * `system.admin` is checked EXPLICITLY even though the permission resolver
 * already expands it to the full static permission set (so an admin does hold
 * `dokumenty.manage` anyway). The explicit check exists so this gate does not
 * rest on a coincidence of how the resolver happens to expand wildcards — a
 * resolver change could otherwise silently open or close every private document
 * for admins. The reasoning is unchanged from the section gate it replaces.
 */
function maySeeDocument(req: AuthRequest, data: Record<string, unknown> | undefined): boolean {
  const perms = req.permissions ?? new Set<string>();
  if (perms.has("system.admin") || perms.has("dokumenty.manage")) return true;
  return data?.public === true;
}

/**
 * `Veřejný` – validated as a REAL boolean, never coerced, exactly like `active`
 * on PATCH below. A truthy string ("false", "0", "ano") must not be able to
 * publish a document to everyone holding `nav.dokumenty.view`.
 */
function isValidPublic(v: unknown): boolean {
  return v === undefined || typeof v === "boolean";
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
 * Per-template configuration of the twenty-five custom variable slots
 * {{var1}}..{{var25}}. Each slot a template uses gets a display label and a
 * value type here; the same slot means different things in different
 * templates, which is why this lives on the template document.
 *
 * ⚠️ These constants are a hand-maintained mirror of the shared engine in
 * `frontend/src/lib/contractVariables.ts` (DOCUMENT_VAR_COUNT, CustomVarType,
 * CUSTOM_VAR_FORMULA_MAX, CUSTOM_VAR_DECIMALS_MAX, CUSTOM_VAR_MAX_IMAGES,
 * CUSTOM_VAR_IMAGE_MAX_CHARS, CUSTOM_VAR_IMAGE_WIDTHS,
 * CUSTOM_VAR_IMAGE_ALIGNS). Cloud Functions cannot
 * import from `frontend/src`, so the duplication is deliberate — but the two
 * must be changed TOGETHER, or the server silently rejects definitions the
 * editor happily produces. `contractTemplates.ts` keeps a third copy; keep all
 * three in lockstep (see the note on its CUSTOM_VAR_KEYS about the slot-count
 * asymmetry, which is the one intended difference).
 *
 * Shape: { var1: { label, type: "text"|"longtext"|"date"|"number"|"bool"|
 *                        "list"|"condition"|"math"|"image",
 *                  default?, condition?, options?, images?, formula?,
 *                  decimals?, optional? }, … }
 *
 * where images (only meaningful on an "image" slot) is
 *   [{ label: string, src: "data:image/…;base64,…", width?: "25%"|"50%"|"75%"|
 *      "100%", align?: "left"|"center"|"right" }, …]
 */
const CUSTOM_VAR_KEYS = new Set(Array.from({ length: 25 }, (_, i) => `var${i + 1}`));
// "condition" used to be refused here, unlike contractTemplates, on the
// grounds that a condition slot is computed by comparing built-in employee
// variables and a document binds no employee. That reasoning is obsolete: a
// document condition compares custom slots against each other or against a
// literal, which needs no employee at all, and the Dokumenty editor now offers
// the type. `isValidCondition` below was already written for exactly this case
// (its operands can only be other custom slots), so it needs no change.
const CUSTOM_VAR_TYPES = new Set([
  "text",
  "longtext",
  "date",
  "number",
  "bool",
  "list",
  "condition",
  "math",
  // "Obrázek" — a list whose choices each carry a picture. See
  // `isValidCustomImages` below for what may be stored in `images`.
  "image",
]);
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

/**
 * Picture choices of an "image" slot: a `list` where picking a choice
 * substitutes that choice's PICTURE into the document instead of its text.
 *
 * The counts are low on purpose. Every picture is stored inline as base64 on
 * THIS Firestore document, because the PDF renderer's SSRF guard aborts every
 * non-`data:` request — a Storage URL would render as a broken image in every
 * PDF. Eight choices × 120 000 characters is already ~960 KB inside a 1 MiB
 * document; see the size note on the write guard in `PUT /:id` below.
 */
const CUSTOM_VAR_MAX_IMAGES = 8;
const CUSTOM_VAR_IMAGE_MAX_CHARS = 120_000;
const CUSTOM_VAR_IMAGE_WIDTHS = new Set(["25%", "50%", "75%", "100%"]);
const CUSTOM_VAR_IMAGE_ALIGNS = new Set(["left", "center", "right"]);
/** The only keys an image choice may carry — see the allowlist rationale below. */
const CUSTOM_VAR_IMAGE_FIELDS = new Set(["label", "src", "width", "align"]);

/**
 * Whether a value is an inline raster image `data:` URI.
 *
 * This is the SECURITY check of this file, not a formatting one. The stored
 * string is interpolated verbatim into an `<img src="…">` that gets parsed
 * TWICE: by the browser in the fill-in preview, and by Puppeteer when the
 * document is rendered to PDF. Everything that is not an inline raster image is
 * therefore refused:
 *  - a remote URL (`https://…`) — an outbound fetch from the renderer, which its
 *    SSRF guard aborts anyway, leaving a broken picture in the PDF;
 *  - `javascript:` and `data:text/html` — script, not a picture;
 *  - anything containing `"` or `>` — it would close the `src="` attribute and
 *    turn the remainder of the string into markup. The base64 alphabet baked
 *    into the pattern is what makes a breakout impossible, rather than escaping
 *    after the fact;
 *  - SVG, despite genuinely being an image: an SVG can carry `<script>` and
 *    event handlers. An `<img>` context does not execute those today, but
 *    permitting SVG would make that guarantee an accident of how the file
 *    happens to be embedded instead of something this validator enforces.
 *
 * This is deliberately NOT "the same check the client already does". The
 * client's `isImageDataUri` is a convenience for the editor; anyone can skip it
 * by calling this endpoint directly. THIS check is the one that actually holds,
 * and it is the last gate before the string is persisted and later rendered.
 */
const IMAGE_DATA_URI_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
function isImageDataUri(v: unknown): boolean {
  return (
    typeof v === "string" &&
    v.length <= CUSTOM_VAR_IMAGE_MAX_CHARS &&
    IMAGE_DATA_URI_RE.test(v)
  );
}

/**
 * Validate the `images` array. Unknown keys and out-of-range width/align values
 * are REJECTED rather than quietly dropped: a def carrying fields this
 * validator does not understand is a def the renderer has never been checked
 * against, and silently storing it would let the next reader of the document
 * assume it had been vetted.
 */
function isValidCustomImages(v: unknown): boolean {
  if (v === undefined) return true;
  if (!Array.isArray(v)) return false;
  if (v.length > CUSTOM_VAR_MAX_IMAGES) return false;
  return v.every((o) => {
    if (!o || typeof o !== "object" || Array.isArray(o)) return false;
    const img = o as Record<string, unknown>;
    if (Object.keys(img).some((k) => !CUSTOM_VAR_IMAGE_FIELDS.has(k))) return false;
    // The label doubles as the slot's raw value (what a condition or a
    // {{#case}} compares against), so it is bounded like a list option.
    if (typeof img.label !== "string" || img.label.length > CUSTOM_VAR_OPTION_MAX) return false;
    if (!isImageDataUri(img.src)) return false;
    if (img.width !== undefined && !CUSTOM_VAR_IMAGE_WIDTHS.has(img.width as string)) return false;
    if (img.align !== undefined && !CUSTOM_VAR_IMAGE_ALIGNS.has(img.align as string)) return false;
    return true;
  });
}

/**
 * Arithmetic formula of a "math" slot, e.g. "var1 + var2" or
 * "(var1 - var2) * 0,21". The real grammar lives in the shared frontend engine
 * (`tokenizeFormula`); reproducing a parser here would be a second thing to
 * keep in sync. What the server does instead is a character allowlist — only
 * identifiers, digits, `+ - * / ( )`, and the two decimal separators. That is
 * defence in depth: whatever the client sends, nothing that even resembles
 * code (quotes, brackets, semicolons, backticks, `$`) can ever be persisted,
 * so a formula string is inert no matter who later evaluates it.
 */
const CUSTOM_VAR_FORMULA_MAX = 200;
const FORMULA_ALLOWED_RE = /^[A-Za-z0-9_+\-*/(),.\s]*$/;
function isValidCustomFormula(v: unknown): boolean {
  if (v === undefined) return true;
  if (typeof v !== "string") return false;
  if (v.length > CUSTOM_VAR_FORMULA_MAX) return false;
  return FORMULA_ALLOWED_RE.test(v);
}

/**
 * Decimal places a "math" result is rounded to. Bounded rather than free so a
 * hand-crafted request cannot ask for a formatting width that the renderer
 * would have to cope with (or a fractional/negative one that `toFixed` throws
 * on).
 */
const CUSTOM_VAR_DECIMALS_MAX = 4;
function isValidCustomDecimals(v: unknown): boolean {
  if (v === undefined) return true;
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= CUSTOM_VAR_DECIMALS_MAX;
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
      isValidCustomImages(d.images) &&
      isValidCustomFormula(d.formula) &&
      isValidCustomDecimals(d.decimals) &&
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
      .filter((d) => maySeeDocument(req, d.data()))
      .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: data.name,
        // Absent = PRIVATE (see maySeeDocument). Normalised to a real boolean
        // here so the client never has to know that, and never sees `undefined`.
        public: data.public === true,
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
 * Create an empty document template. Body: { id, name, public? }.
 * `id` must be a snake_case slug not already in use.
 *
 * A new document is NOT public unless the author says so — the safe default,
 * and the one the create dialog's unticked "Veřejný" checkbox sends.
 */
dokumentyRouter.post(
  "/",
  requireAuth,
  requirePermission("dokumenty.manage"),
  async (req: AuthRequest, res: Response) => {
    // `public` is a reserved word, hence the rename. Typed `unknown` so the
    // boolean check below is the only thing that can let a value through.
    const { id, name, public: isPublic } = req.body as {
      id?: string;
      name?: string;
      public?: unknown;
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
    if (!isValidPublic(isPublic)) {
      res.status(400).json({ error: "public musí být boolean." });
      return;
    }
    // Written explicitly (even when false) because this is a NEW document: the
    // author has just answered the question, so "private" here is a decision
    // rather than the absence of one. Existing documents are never touched —
    // their missing `public` is what makes them private, and backfilling it
    // would be a production write for no gain. See maySeeDocument.
    await ref.set({
      name: name.trim(),
      public: isPublic === true,
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
      summary: { name: name.trim(), public: isPublic === true },
    });
    res.status(201).json({
      id,
      name: name.trim(),
      public: isPublic === true,
    });
  }
);

/**
 * POST /api/dokumenty/:id/duplicate
 * Copy an existing document under a new id. Body: { id, name, public? }.
 *
 * Server-side rather than a client-orchestrated GET + POST + PUT because those
 * three calls are not atomic: a failure between them leaves an empty document
 * behind that looks like a real one. Here the copy either lands whole or not at
 * all.
 *
 * Copies the CONTENT (htmlContent, variableDefs, margins) and nothing else.
 * Deliberately NOT copied:
 *  - `active` — a duplicate always starts active, even if the source was
 *    deactivated; you copy a document in order to use it.
 *  - `public` — taken from the body, not the source. Duplicating is the moment
 *    you decide who the copy is for, and silently inheriting the source's
 *    audience is the kind of default that quietly publishes a document. The UI
 *    pre-fills the source's value as a visible, editable suggestion.
 */
dokumentyRouter.post(
  "/:id/duplicate",
  requireAuth,
  requirePermission("dokumenty.manage"),
  async (req: AuthRequest, res: Response) => {
    const { id: newId, name, public: isPublic } = req.body as {
      id?: string;
      name?: string;
      public?: unknown;
    };
    if (!newId || !name || !name.trim()) {
      res.status(400).json({ error: "id a name jsou povinné." });
      return;
    }
    if (!SLUG_RE.test(newId)) {
      res.status(400).json({
        error: "id musí být snake_case (písmena, číslice, podtržítka), 2–40 znaků, začínat písmenem.",
      });
      return;
    }
    if (!isValidPublic(isPublic)) {
      res.status(400).json({ error: "public musí být boolean." });
      return;
    }

    const sourceSnap = await db().collection(COLLECTION).doc(req.params.id).get();
    if (!sourceSnap.exists) {
      res.status(404).json({ error: "Dokument neexistuje." });
      return;
    }
    const source = sourceSnap.data() as Record<string, unknown>;

    const targetRef = db().collection(COLLECTION).doc(newId);
    if ((await targetRef.get()).exists) {
      res.status(409).json({ error: "Dokument s tímto id již existuje." });
      return;
    }

    const payload: Record<string, unknown> = {
      name: name.trim(),
      // Same as POST / above: a brand-new document records the answer either
      // way. Absent would also read as private, but here the author was asked.
      public: isPublic === true,
      htmlContent: source.htmlContent ?? "",
      variables: source.variables ?? [],
      createdAt: FieldValue.serverTimestamp(),
      createdBy: req.uid,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: req.uid,
    };
    // Only carry these when the source actually had them, so the copy doesn't
    // gain an explicit `variableDefs: undefined` / default margins the original
    // never stored.
    if (source.variableDefs !== undefined) payload.variableDefs = source.variableDefs;
    if (source.margins !== undefined) payload.margins = source.margins;

    await targetRef.set(payload);
    await logCreate(ctxFromReq(req), {
      collection: COLLECTION,
      resourceId: newId,
      summary: {
        name: name.trim(),
        public: isPublic === true,
        duplicatedFrom: req.params.id,
      },
    });
    res.status(201).json({
      id: newId,
      name: name.trim(),
      public: isPublic === true,
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
    // existence confirmed by the status code. A private document is therefore
    // indistinguishable from one that was never created.
    if (!maySeeDocument(req, doc.data())) {
      res.status(404).json({ error: "Dokument neexistuje." });
      return;
    }
    // `public` normalised the same way the list does, so an old document
    // (no field at all) arrives at the client as an explicit `false`.
    //
    // The spread may still carry a stale `section` string on documents written
    // before sections were removed. Nothing reads it — on either side — and it
    // is left in place deliberately: stripping the field from every stored
    // document would be a bulk production write bought for tidiness alone.
    res.json({ id: doc.id, ...doc.data(), public: doc.data()?.public === true });
  }
);

/**
 * PUT /api/dokumenty/:id
 * Upsert a template. Body: { name, htmlContent, margins?, variableDefs?,
 * public? }.
 */
dokumentyRouter.put(
  "/:id",
  requireAuth,
  requirePermission("dokumenty.manage"),
  async (req: AuthRequest, res: Response) => {
    const { name, htmlContent, margins, variableDefs, public: isPublic } = req.body as {
      name?: string;
      htmlContent?: string;
      margins?: unknown;
      variableDefs?: unknown;
      public?: unknown;
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
          "variableDefs musí být objekt {var1..var25: {label, type, optional?, options?, images?, formula?, decimals?}}, kde type je text|longtext|date|number|bool|list|condition|math|image, optional je true|false, options je seznam nejvýše 30 textových hodnot, images je seznam nejvýše 8 položek {label, src, width?, align?}, kde src musí být vložený obrázek (data:image/png|jpeg|webp|gif;base64, nejvýše 120 000 znaků – SVG ani odkaz na web nejsou povoleny), width je 25%|50%|75%|100% a align je left|center|right, formula je vzorec do 200 znaků (jen písmena, číslice, _ + - * / ( ) , .) a decimals je celé číslo 0–4.",
      });
      return;
    }

    // Firestore caps a single document at 1 MiB. The htmlContent is by far the
    // largest field and balloons when the editor inlines base64 images, so a
    // too-large template is the usual cause of a silent write failure. Reject
    // it up front with a clear Czech message rather than letting the Firestore
    // error bubble up as an opaque 500.
    //
    // ⚠️ This pre-check measures htmlContent ONLY, and `variableDefs.images`
    // now puts a second pile of base64 in the same document: eight pictures at
    // CUSTOM_VAR_IMAGE_MAX_CHARS each is ~960 KB, enough to blow the 1 MiB
    // ceiling on its own even with modest HTML. That case slips past here — but
    // it does NOT surface as a raw error: `ref.set` below is wrapped in a
    // try/catch whose /maximum|too large|exceeds|size/i test matches Firestore's
    // rejection ("…cannot be written because its size (N bytes) exceeds the
    // maximum allowed size of 1048576 bytes"), so the author still gets the same
    // Czech 413, just after a round-trip instead of before it. Widening this
    // pre-check to serialize variableDefs would only move the message earlier,
    // at the cost of JSON.stringify-ing ~1 MB on every single save.
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
    // Publishing / unpublishing is an audience change in disguise, so it travels
    // with the same Uložit as the text. Omitting the field leaves the current
    // value untouched (the write is a merge) — which is what keeps a document
    // that predates the field private: nothing writes it until an editor
    // deliberately ticks the box.
    if (isPublic !== undefined) {
      if (typeof isPublic !== "boolean") {
        res.status(400).json({ error: "public musí být boolean." });
        return;
      }
      payload.public = isPublic;
    }

    const ref = db().collection(COLLECTION).doc(req.params.id);
    const beforeSnap = await ref.get();
    const before = beforeSnap.exists ? (beforeSnap.data() as Record<string, unknown>) : {};
    try {
      await ref.set(payload, { merge: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // Firestore rejects oversized writes — surface a clear Czech message
      // instead of a generic 500. This is also the net that catches a document
      // pushed over 1 MiB by its `variableDefs.images` rather than by its HTML,
      // which the htmlContent-only pre-check above cannot see.
      if (/maximum|too large|exceeds|size/i.test(message)) {
        res.status(413).json({
          error:
            "Dokument se nepodařilo uložit – je příliš velký (limit 1 MB). Pravděpodobně obsahuje vložené obrázky (base64). Zmenšete nebo odstraňte obrázky a uložte znovu.",
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
        // Normalised, so an old document's missing field logs as `false`
        // rather than as an empty diff against an explicit `false` after.
        public: before.public === true,
        htmlContentLength: typeof before.htmlContent === "string" ? before.htmlContent.length : 0,
      },
      after: {
        name,
        variables,
        margins: payload.margins ?? before.margins,
        public: payload.public !== undefined ? payload.public : before.public === true,
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
