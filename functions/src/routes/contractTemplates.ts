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
 * ⚠️ These constants are a hand-maintained mirror of the shared engine in
 * `frontend/src/lib/contractVariables.ts` (CONTRACT_VAR_COUNT, CustomVarType,
 * CUSTOM_VAR_FORMULA_MAX, CUSTOM_VAR_DECIMALS_MAX, CUSTOM_VAR_MAX_IMAGES,
 * CUSTOM_VAR_IMAGE_MAX_CHARS, CUSTOM_VAR_IMAGE_WIDTHS,
 * CUSTOM_VAR_IMAGE_ALIGNS). Cloud Functions cannot
 * import from `frontend/src`, so the duplication is deliberate — but the two
 * must be changed TOGETHER, or the server silently rejects definitions the
 * editor happily produces. `dokumenty.ts` keeps a third copy; keep all three in
 * lockstep, the slot count below being the one intended difference.
 *
 * Shape: { var1: { label: string, type: "text"|"longtext"|"date"|"number"|
 *                        "bool"|"list"|"condition"|"math"|"image",
 *                  default?, condition?, options?, images?, formula?,
 *                  decimals?, optional? }, … }
 *
 * where images (only meaningful on an "image" slot) is
 *   [{ label: string, src: "data:image/…;base64,…", width?: "25%"|"50%"|"75%"|
 *      "100%", align?: "left"|"center"|"right" }, …]
 */
// Stays at 10 (= CONTRACT_VAR_COUNT) while Dokumenty offers 25. The asymmetry
// is intentional, not an oversight: a contract template ends up as a signed
// legal document, where more slots buy nothing. Note the engine RECOGNISES
// var1..var25 everywhere on purpose, so a stray "{{var15}}" in a contract is
// visible to the editor instead of printing as literal braces — this validator
// is the gate that keeps a def for it from ever being stored.
const CUSTOM_VAR_KEYS = new Set(
  Array.from({ length: 10 }, (_, i) => `var${i + 1}`)
);
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
 * Optional derived-condition definition (only meaningful on a "condition" slot):
 * a comparison { leftKey, op, right?: {kind:"var",key} | {kind:"literal",value} }.
 * The comparable-variable catalogue lives on the frontend, so keys are only
 * length-checked here. `empty` / `notEmpty` need no right operand.
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

/**
 * Optional per-slot default value. Either a literal (raw string) or a reference
 * to a built-in fixed variable by key. Absent = no default. The fixed-variable
 * catalogue lives only on the frontend, so the key is only length-checked here.
 */
function isValidCustomDefault(v: unknown): boolean {
  if (v === undefined) return true;
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const d = v as Record<string, unknown>;
  if (d.kind === "literal") {
    return typeof d.value === "string" && d.value.length <= CUSTOM_VAR_DEFAULT_MAX;
  }
  if (d.kind === "fixedVar") {
    return typeof d.key === "string" && d.key.length > 0 && d.key.length <= CUSTOM_VAR_LABEL_MAX;
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
 * substitutes that choice's PICTURE into the contract instead of its text.
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
 * TWICE: by the browser in the generate preview, and by Puppeteer when the
 * contract is rendered to PDF. Everything that is not an inline raster image is
 * therefore refused:
 *  - a remote URL (`https://…`) — an outbound fetch from the renderer, which its
 *    SSRF guard aborts anyway, leaving a broken picture in a signed contract;
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
 * against, and silently storing it would let the next reader of the template
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
          "variableDefs musí být objekt {var1..var10: {label, type, optional?, options?, images?, formula?, decimals?}}, kde type je text|longtext|date|number|bool|list|condition|math|image, optional je true|false, options je seznam nejvýše 30 textových hodnot, images je seznam nejvýše 8 položek {label, src, width?, align?}, kde src musí být vložený obrázek (data:image/png|jpeg|webp|gif;base64, nejvýše 120 000 znaků – SVG ani odkaz na web nejsou povoleny), width je 25%|50%|75%|100% a align je left|center|right, formula je vzorec do 200 znaků (jen písmena, číslice, _ + - * / ( ) , .) a decimals je celé číslo 0–4.",
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
      // size) — surface a clear Czech message instead of a generic 500. This is
      // also the net that catches a document pushed over 1 MiB by its
      // `variableDefs.images` rather than by its HTML, which the
      // htmlContent-only pre-check above cannot see.
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
