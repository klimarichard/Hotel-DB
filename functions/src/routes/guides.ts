import { Router } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { requirePermission } from "../auth/permissions";
import { ctxFromReq, logCreate, logDelete, logUpdate } from "../services/auditLog";

/**
 * Návody (guides) — reference material for staff: uploaded PDF tutorials and
 * links to external resources (Google Drive folders, videos, …), grouped into
 * categories.
 *
 * Two collections:
 *   guideCategories/{id}  { name, order }
 *   guides/{id}           { title, description, categoryId, kind, order, … }
 *                         kind "pdf"  → storagePath (+ fileName, contentType)
 *                         kind "link" → url
 *
 * PDFs live in Storage under `guides/{guideId}.pdf`. storage.rules deny direct
 * client access, so uploads land here as base64 in the JSON body and downloads
 * are streamed back by GET /:id/file — the same pattern as employee documents.
 *
 * Reading is gated by `nav.guides.view` (every built-in type has it — guides are
 * reference material for everyone); every write is gated by `guides.manage`.
 */
export const guidesRouter = Router();

const db = () => admin.firestore();

/**
 * Raw-PDF ceiling. express.json caps the body at 10mb (index.ts) and base64
 * inflates by ~33%, so a 7 MB PDF lands at ~9.3 MB of JSON — just inside the
 * limit. Anything larger must be rejected here with a readable message rather
 * than dying in the body parser with an opaque 413.
 */
const MAX_PDF_BYTES = 7 * 1024 * 1024;

/** Stored URLs are rendered as links, so only http(s) may ever be persisted. */
function isSafeHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Next order value within a category (append to the end). */
async function nextGuideOrder(categoryId: string): Promise<number> {
  const snap = await db()
    .collection("guides")
    .where("categoryId", "==", categoryId)
    .get();
  const max = snap.docs.reduce((acc, d) => {
    const o = d.data().order;
    return typeof o === "number" && o > acc ? o : acc;
  }, -1);
  return max + 1;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/guides
 * The whole page in one call: categories + guides, each already ordered.
 * No file bytes — the PDF is fetched separately by GET /:id/file when opened.
 */
guidesRouter.get(
  "/",
  requireAuth,
  requirePermission("nav.guides.view"),
  async (_req: AuthRequest, res) => {
    const [catSnap, guideSnap] = await Promise.all([
      db().collection("guideCategories").get(),
      db().collection("guides").get(),
    ]);

    const byOrder = (a: { order: number }, b: { order: number }) => a.order - b.order;

    const categories = catSnap.docs
      .map((d) => ({
        id: d.id,
        name: (d.data().name as string) ?? "",
        order: (d.data().order as number) ?? 0,
      }))
      .sort(byOrder);

    const guides = guideSnap.docs
      .map((d) => {
        const data = d.data();
        return {
          id: d.id,
          title: (data.title as string) ?? "",
          description: (data.description as string) ?? "",
          categoryId: (data.categoryId as string) ?? "",
          kind: (data.kind as "pdf" | "link") ?? "link",
          url: (data.url as string) ?? "",
          fileName: (data.fileName as string) ?? "",
          order: (data.order as number) ?? 0,
        };
      })
      .sort(byOrder);

    res.json({ categories, guides });
  }
);

/**
 * GET /api/guides/:id/file
 * Streams the PDF inline so the frontend can render it in the viewer modal.
 * Gated on view (not manage): everyone who can see the page can read the guide.
 */
guidesRouter.get(
  "/:id/file",
  requireAuth,
  requirePermission("nav.guides.view"),
  async (req: AuthRequest, res) => {
    const snap = await db().collection("guides").doc(req.params.id).get();
    if (!snap.exists) {
      res.status(404).json({ error: "Návod nenalezen." });
      return;
    }

    const data = snap.data() as Record<string, unknown>;
    const storagePath = data.storagePath;
    if (typeof storagePath !== "string" || !storagePath) {
      res.status(404).json({ error: "Tento návod nemá připojený soubor." });
      return;
    }

    const file = admin.storage().bucket().file(storagePath);
    const [exists] = await file.exists();
    if (!exists) {
      res.status(404).json({ error: "Soubor chybí v úložišti." });
      return;
    }

    // Same Content-Disposition convention as employee documents: UTF-8 filename
    // with a plain-ASCII fallback for legacy clients.
    const base =
      typeof data.title === "string" && data.title ? data.title : req.params.id;
    const asciiFallback = base
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^\x20-\x7e]/g, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${asciiFallback}.pdf"; filename*=UTF-8''${encodeURIComponent(base)}.pdf`
    );
    file.createReadStream()
      .on("error", (e) => {
        if (!res.headersSent) res.status(500).json({ error: e.message });
        else res.end();
      })
      .pipe(res);
  }
);

// ─── Categories ───────────────────────────────────────────────────────────────
// Declared before the /:id guide routes so "categories" is never swallowed by
// the :id parameter.

guidesRouter.post(
  "/categories",
  requireAuth,
  requirePermission("guides.manage"),
  async (req: AuthRequest, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name) {
      res.status(400).json({ error: "Název kategorie je povinný." });
      return;
    }

    const snap = await db().collection("guideCategories").get();
    const order = snap.docs.reduce((acc, d) => {
      const o = d.data().order;
      return typeof o === "number" && o >= acc ? o + 1 : acc;
    }, 0);

    const ref = db().collection("guideCategories").doc();
    await ref.set({
      name,
      order,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: req.uid,
    });
    await logCreate(ctxFromReq(req), {
      collection: "guideCategories",
      resourceId: ref.id,
      summary: { name },
    });
    res.status(201).json({ id: ref.id });
  }
);

guidesRouter.put(
  "/categories/order",
  requireAuth,
  requirePermission("guides.manage"),
  async (req: AuthRequest, res) => {
    const ids = req.body?.orderedIds;
    if (!Array.isArray(ids) || ids.some((i) => typeof i !== "string")) {
      res.status(400).json({ error: "orderedIds musí být pole id." });
      return;
    }

    const batch = db().batch();
    ids.forEach((id: string, idx: number) => {
      batch.update(db().collection("guideCategories").doc(id), { order: idx });
    });
    await batch.commit();
    res.json({ ok: true });
  }
);

guidesRouter.put(
  "/categories/:id",
  requireAuth,
  requirePermission("guides.manage"),
  async (req: AuthRequest, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name) {
      res.status(400).json({ error: "Název kategorie je povinný." });
      return;
    }

    const ref = db().collection("guideCategories").doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Kategorie nenalezena." });
      return;
    }

    const before = snap.data() as Record<string, unknown>;
    await ref.update({
      name,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: req.uid,
    });
    await logUpdate(ctxFromReq(req), {
      collection: "guideCategories",
      resourceId: ref.id,
      before: { name: before.name },
      after: { name },
    });
    res.json({ ok: true });
  }
);

/**
 * DELETE /api/guides/categories/:id
 * Refuses while the category still holds guides — deleting it silently would
 * orphan them (they'd vanish from a page that groups strictly by category).
 * The user must move or delete the guides first.
 */
guidesRouter.delete(
  "/categories/:id",
  requireAuth,
  requirePermission("guides.manage"),
  async (req: AuthRequest, res) => {
    const ref = db().collection("guideCategories").doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Kategorie nenalezena." });
      return;
    }

    const used = await db()
      .collection("guides")
      .where("categoryId", "==", req.params.id)
      .limit(1)
      .get();
    if (!used.empty) {
      res.status(409).json({
        error:
          "Kategorie obsahuje návody. Nejprve je přesuňte do jiné kategorie nebo smažte.",
      });
      return;
    }

    const before = snap.data() as Record<string, unknown>;
    await ref.delete();
    await logDelete(ctxFromReq(req), {
      collection: "guideCategories",
      resourceId: ref.id,
      summary: { name: before.name },
    });
    res.json({ ok: true });
  }
);

// ─── Guides ───────────────────────────────────────────────────────────────────

guidesRouter.put(
  "/order",
  requireAuth,
  requirePermission("guides.manage"),
  async (req: AuthRequest, res) => {
    const ids = req.body?.orderedIds;
    if (!Array.isArray(ids) || ids.some((i) => typeof i !== "string")) {
      res.status(400).json({ error: "orderedIds musí být pole id." });
      return;
    }

    const batch = db().batch();
    ids.forEach((id: string, idx: number) => {
      batch.update(db().collection("guides").doc(id), { order: idx });
    });
    await batch.commit();
    res.json({ ok: true });
  }
);

/**
 * POST /api/guides
 * Body: { title, description?, categoryId, kind: "pdf" | "link",
 *         url? (kind=link), pdfBase64? + fileName? (kind=pdf) }
 */
guidesRouter.post(
  "/",
  requireAuth,
  requirePermission("guides.manage"),
  async (req: AuthRequest, res) => {
    const {
      title,
      description,
      categoryId,
      kind,
      url,
      pdfBase64,
      fileName,
    } = req.body as {
      title?: string;
      description?: string;
      categoryId?: string;
      kind?: string;
      url?: string;
      pdfBase64?: string;
      fileName?: string;
    };

    const cleanTitle = typeof title === "string" ? title.trim() : "";
    if (!cleanTitle) {
      res.status(400).json({ error: "Název návodu je povinný." });
      return;
    }
    if (kind !== "pdf" && kind !== "link") {
      res.status(400).json({ error: "kind musí být 'pdf' nebo 'link'." });
      return;
    }
    if (typeof categoryId !== "string" || !categoryId) {
      res.status(400).json({ error: "Kategorie je povinná." });
      return;
    }

    const catSnap = await db().collection("guideCategories").doc(categoryId).get();
    if (!catSnap.exists) {
      res.status(400).json({ error: "Kategorie neexistuje." });
      return;
    }

    const ref = db().collection("guides").doc();
    const order = await nextGuideOrder(categoryId);

    const base = {
      title: cleanTitle,
      description: typeof description === "string" ? description.trim() : "",
      categoryId,
      kind,
      order,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: req.uid,
    };

    if (kind === "link") {
      const cleanUrl = typeof url === "string" ? url.trim() : "";
      if (!isSafeHttpUrl(cleanUrl)) {
        res.status(400).json({ error: "Zadejte platný odkaz (http:// nebo https://)." });
        return;
      }
      await ref.set({ ...base, url: cleanUrl });
    } else {
      if (!pdfBase64) {
        res.status(400).json({ error: "Vyberte PDF soubor." });
        return;
      }
      const buffer = Buffer.from(pdfBase64, "base64");
      if (buffer.length > MAX_PDF_BYTES) {
        res.status(413).json({ error: "Soubor je příliš velký (max 7 MB)." });
        return;
      }

      const storagePath = `guides/${ref.id}.pdf`;
      await admin.storage().bucket().file(storagePath).save(buffer, {
        contentType: "application/pdf",
        metadata: { metadata: { uploadedBy: req.uid ?? "unknown" } },
      });
      await ref.set({
        ...base,
        storagePath,
        contentType: "application/pdf",
        fileName: typeof fileName === "string" ? fileName : "",
      });
    }

    await logCreate(ctxFromReq(req), {
      collection: "guides",
      resourceId: ref.id,
      summary: { title: cleanTitle, kind, categoryId },
    });
    res.status(201).json({ id: ref.id });
  }
);

/**
 * PUT /api/guides/:id
 * Edits metadata; `pdfBase64` optionally replaces the file in place (same
 * storage path, so no orphaned blob). A guide never changes kind.
 */
guidesRouter.put(
  "/:id",
  requireAuth,
  requirePermission("guides.manage"),
  async (req: AuthRequest, res) => {
    const ref = db().collection("guides").doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Návod nenalezen." });
      return;
    }
    const before = snap.data() as Record<string, unknown>;

    const { title, description, categoryId, url, pdfBase64, fileName } =
      req.body as {
        title?: string;
        description?: string;
        categoryId?: string;
        url?: string;
        pdfBase64?: string;
        fileName?: string;
      };

    const cleanTitle = typeof title === "string" ? title.trim() : "";
    if (!cleanTitle) {
      res.status(400).json({ error: "Název návodu je povinný." });
      return;
    }

    const update: Record<string, unknown> = {
      title: cleanTitle,
      description: typeof description === "string" ? description.trim() : "",
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: req.uid,
    };

    // Moving to another category appends to the end of the target group.
    if (typeof categoryId === "string" && categoryId && categoryId !== before.categoryId) {
      const catSnap = await db().collection("guideCategories").doc(categoryId).get();
      if (!catSnap.exists) {
        res.status(400).json({ error: "Kategorie neexistuje." });
        return;
      }
      update.categoryId = categoryId;
      update.order = await nextGuideOrder(categoryId);
    }

    if (before.kind === "link") {
      const cleanUrl = typeof url === "string" ? url.trim() : "";
      if (!isSafeHttpUrl(cleanUrl)) {
        res.status(400).json({ error: "Zadejte platný odkaz (http:// nebo https://)." });
        return;
      }
      update.url = cleanUrl;
    } else if (pdfBase64) {
      const buffer = Buffer.from(pdfBase64, "base64");
      if (buffer.length > MAX_PDF_BYTES) {
        res.status(413).json({ error: "Soubor je příliš velký (max 7 MB)." });
        return;
      }
      const storagePath =
        typeof before.storagePath === "string" && before.storagePath
          ? before.storagePath
          : `guides/${ref.id}.pdf`;
      await admin.storage().bucket().file(storagePath).save(buffer, {
        contentType: "application/pdf",
        metadata: { metadata: { uploadedBy: req.uid ?? "unknown" } },
      });
      update.storagePath = storagePath;
      update.contentType = "application/pdf";
      if (typeof fileName === "string") update.fileName = fileName;
    }

    await ref.update(update);
    await logUpdate(ctxFromReq(req), {
      collection: "guides",
      resourceId: ref.id,
      before: {
        title: before.title,
        description: before.description,
        categoryId: before.categoryId,
        url: before.url,
      },
      after: {
        title: update.title,
        description: update.description,
        categoryId: update.categoryId ?? before.categoryId,
        url: update.url ?? before.url,
      },
    });
    res.json({ ok: true });
  }
);

guidesRouter.delete(
  "/:id",
  requireAuth,
  requirePermission("guides.manage"),
  async (req: AuthRequest, res) => {
    const ref = db().collection("guides").doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Návod nenalezen." });
      return;
    }
    const before = snap.data() as Record<string, unknown>;

    // Best-effort blob cleanup first; a missing file must not block the delete.
    if (typeof before.storagePath === "string" && before.storagePath) {
      try {
        await admin.storage().bucket().file(before.storagePath).delete();
      } catch {
        // already gone — fall through
      }
    }

    await ref.delete();
    await logDelete(ctxFromReq(req), {
      collection: "guides",
      resourceId: ref.id,
      summary: { title: before.title, kind: before.kind },
    });
    res.json({ ok: true });
  }
);
