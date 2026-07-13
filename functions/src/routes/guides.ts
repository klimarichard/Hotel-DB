import { Router } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { requirePermission } from "../auth/permissions";
import { ctxFromReq, logCreate, logDelete, logUpdate } from "../services/auditLog";

/**
 * Návody (guides) — reference material for staff: uploaded PDF tutorials and
 * links to external resources (Google Drive folders, videos, …).
 *
 * One collection:
 *   guides/{id}  { title, description, tags[], kind, … }
 *                kind "pdf"  → storagePath (+ fileName, contentType)
 *                kind "link" → url
 *
 * The list is always sorted alphabetically by title (Czech collation) — see
 * byTitle(). There is no stored order and no manual reordering.
 *
 * Guides are classified by free-form TAGS, not by a single category: a guide
 * routinely belongs to several topics at once ("Recepce" AND "Protel"), which a
 * one-home-per-guide category model can't express. Tags are stored on the guide
 * itself — there is no tag collection; the tag vocabulary is simply derived from
 * whatever tags the guides carry, which keeps it self-pruning (drop the last
 * guide with a tag and the tag disappears).
 *
 * PDFs live in Storage under `guides/{guideId}.pdf`. storage.rules deny direct
 * client access, so uploads land here as base64 in the JSON body and downloads
 * are streamed back by GET /:id/file — the same pattern as employee documents.
 *
 * Reading is gated by `nav.guides.view` (every built-in type has it — guides are
 * reference material for everyone); every write is gated by `guides.manage`.
 *
 * Legacy note: guides created before tags shipped carry a `categoryId` and no
 * `tags`; guides created before alphabetical sorting carry an `order`. Both
 * fields are inert — read back as untagged / ignored respectively, never deleted.
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

const MAX_TAGS_PER_GUIDE = 20;
const MAX_TAG_LENGTH = 40;

/**
 * The list is always sorted alphabetically by title, with Czech collation (so Č
 * sorts after C, Š after S, …). There is deliberately no stored `order` field
 * and no manual reordering: the order is DERIVED from the title, so it can never
 * drift out of sync with the data — adding, renaming or deleting a guide simply
 * lands it in the right place on the next read.
 */
function byTitle(a: { title: string }, b: { title: string }): number {
  return a.title.localeCompare(b.title, "cs");
}

/** Stored URLs are rendered as links, so only http(s) may ever be persisted. */
function isSafeHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Normalise a tag list: trim, collapse inner whitespace, drop empties, cap the
 * length, and de-duplicate case-insensitively (keeping the first spelling, so
 * "Recepce" and "recepce" can't both survive on one guide). Display casing is
 * preserved — only matching is case-insensitive.
 */
function normalizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim().replace(/\s+/g, " ").slice(0, MAX_TAG_LENGTH);
    if (!tag) continue;
    const key = tag.toLocaleLowerCase("cs");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS_PER_GUIDE) break;
  }
  return out;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/guides
 * The whole page in one call: every guide, ordered, plus the derived tag
 * vocabulary (for the filter chips and the tag autocomplete).
 *
 * Search is deliberately NOT done here: the guide list is small (tens of rows,
 * no file bytes) and full-text search over title/description/tags is instant in
 * the browser — no index, no query round-trip per keystroke.
 */
guidesRouter.get(
  "/",
  requireAuth,
  requirePermission("nav.guides.view"),
  async (_req: AuthRequest, res) => {
    const snap = await db().collection("guides").get();

    const guides = snap.docs
      .map((d) => {
        const data = d.data();
        return {
          id: d.id,
          title: (data.title as string) ?? "",
          description: (data.description as string) ?? "",
          tags: Array.isArray(data.tags)
            ? (data.tags as unknown[]).filter((t): t is string => typeof t === "string")
            : [],
          kind: (data.kind as "pdf" | "link") ?? "link",
          url: (data.url as string) ?? "",
          fileName: (data.fileName as string) ?? "",
        };
      })
      .sort(byTitle);

    // Tag vocabulary, de-duplicated case-insensitively (first spelling wins),
    // sorted with Czech collation.
    const byKey = new Map<string, string>();
    for (const g of guides) {
      for (const t of g.tags) {
        const key = t.toLocaleLowerCase("cs");
        if (!byKey.has(key)) byKey.set(key, t);
      }
    }
    const tags = [...byKey.values()].sort((a, b) => a.localeCompare(b, "cs"));

    res.json({ guides, tags });
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

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * POST /api/guides
 * Body: { title, description?, tags?: string[], kind: "pdf" | "link",
 *         url? (kind=link), pdfBase64? + fileName? (kind=pdf) }
 */
guidesRouter.post(
  "/",
  requireAuth,
  requirePermission("guides.manage"),
  async (req: AuthRequest, res) => {
    const { title, description, tags, kind, url, pdfBase64, fileName } =
      req.body as {
        title?: string;
        description?: string;
        tags?: unknown;
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

    const ref = db().collection("guides").doc();
    const base = {
      title: cleanTitle,
      description: typeof description === "string" ? description.trim() : "",
      tags: normalizeTags(tags),
      kind,
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
      summary: { title: cleanTitle, kind, tags: base.tags },
    });
    res.status(201).json({ id: ref.id });
  }
);

/**
 * PUT /api/guides/:id
 * Edits metadata + tags; `pdfBase64` optionally replaces the file in place (same
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

    const { title, description, tags, url, pdfBase64, fileName } = req.body as {
      title?: string;
      description?: string;
      tags?: unknown;
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
      tags: normalizeTags(tags),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: req.uid,
    };

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
        tags: Array.isArray(before.tags) ? (before.tags as string[]).join(", ") : "",
        url: before.url,
      },
      after: {
        title: update.title,
        description: update.description,
        tags: (update.tags as string[]).join(", "),
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
