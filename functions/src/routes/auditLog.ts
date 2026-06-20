import { Router, Response } from "express";
import * as admin from "firebase-admin";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { requirePermission } from "../auth/permissions";

export const auditLogRouter = Router();

const db = () => admin.firestore();

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

/** Parse a comma-separated multi-value query param into a trimmed string list. */
function multi(v: string | undefined): string[] {
  if (!v) return [];
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * GET /api/audit
 * Admin-only. Lists audit-log entries newest-first with optional filters
 * and cursor-based pagination.
 *
 * Query params (all optional):
 *   userId, category   — multi-value (comma-separated → Firestore `in`, ≤10)
 *   employeeId, collection, action, event, templateId, settingsArea — equality
 *   year, month        — numeric equality (period filters)
 *   from, to           — ISO datetimes (timestamp range)
 *   limit              — page size, default 100, max 500
 *   cursor             — last doc id from previous page
 *
 * Filtering follows the change-log page's "pick a page (category), then one
 * sub-filter" model — the supported (equality…, timestamp) shapes are covered
 * by composite indexes in firestore.indexes.json. To stay within Firestore's
 * disjunction rules, at most ONE field may be multi-valued per request. An
 * unsupported combination (missing index) returns a clean 400 rather than
 * hanging — this is the fix for the "combined filters 500/hang" prod bug.
 */
auditLogRouter.get(
  "/",
  requireAuth,
  requirePermission("nav.audit.view"),
  async (req: AuthRequest, res: Response) => {
    const q = req.query as Record<string, string | undefined>;
    const {
      employeeId,
      collection,
      action,
      event,
      templateId,
      settingsArea,
      year,
      month,
      from,
      to,
      limit: limitParam,
      cursor,
    } = q;
    const userIds = multi(q.userId);
    const categories = multi(q.category);

    // Firestore allows only one disjunction (`in`) per query reliably; the UI
    // never multi-selects two facets at once, so reject it explicitly.
    if (userIds.length > 1 && categories.length > 1) {
      res.status(400).json({
        error: "Nelze najednou filtrovat více uživatelů i více stránek. Zúžte jeden z filtrů.",
      });
      return;
    }

    const limit = Math.min(
      Math.max(parseInt(limitParam ?? "") || DEFAULT_LIMIT, 1),
      MAX_LIMIT
    );

    let query: admin.firestore.Query = db().collection("auditLog");

    // Multi-value facets → equality (1 value) or `in` (2–10 values).
    if (userIds.length === 1) query = query.where("userId", "==", userIds[0]);
    else if (userIds.length > 1) query = query.where("userId", "in", userIds.slice(0, 10));
    if (categories.length === 1) query = query.where("category", "==", categories[0]);
    else if (categories.length > 1) query = query.where("category", "in", categories.slice(0, 10));

    if (employeeId) query = query.where("employeeId", "==", employeeId);
    if (collection) query = query.where("collection", "==", collection);
    if (action) query = query.where("action", "==", action);
    if (event) query = query.where("event", "==", event);
    if (templateId) query = query.where("templateId", "==", templateId);
    if (settingsArea) query = query.where("settingsArea", "==", settingsArea);
    if (year && !isNaN(Number(year))) query = query.where("year", "==", Number(year));
    if (month && !isNaN(Number(month))) query = query.where("month", "==", Number(month));

    if (from) {
      const fromDate = new Date(from);
      if (!isNaN(fromDate.getTime())) {
        query = query.where("timestamp", ">=", fromDate);
      }
    }
    if (to) {
      const toDate = new Date(to);
      if (!isNaN(toDate.getTime())) {
        query = query.where("timestamp", "<=", toDate);
      }
    }

    query = query.orderBy("timestamp", "desc").limit(limit + 1);

    if (cursor) {
      const cursorSnap = await db().collection("auditLog").doc(cursor).get();
      if (cursorSnap.exists) {
        query = query.startAfter(cursorSnap);
      }
    }

    try {
      const snap = await query.get();
      const docs = snap.docs.slice(0, limit);
      const nextCursor =
        snap.docs.length > limit ? snap.docs[limit - 1].id : undefined;
      const entries = docs.map((d) => ({ id: d.id, ...d.data() }));
      res.json({ entries, nextCursor });
    } catch (err) {
      // A missing composite index throws FAILED_PRECONDITION (the error text
      // carries the index-creation URL). Surface a clean 400 instead of letting
      // the request hang for 60s — the historical "combined filters" prod bug.
      const code = (err as { code?: number | string }).code;
      if (code === 9 || code === "failed-precondition") {
        console.error("[audit] missing index for filter combination", err);
        res.status(400).json({
          error: "Tato kombinace filtrů zatím není podporována.",
        });
        return;
      }
      throw err;
    }
  }
);

/**
 * GET /api/audit/:id
 * Fetch a single audit-log entry by id (for the row-expansion view).
 */
auditLogRouter.get(
  "/:id",
  requireAuth,
  requirePermission("nav.audit.view"),
  async (req: AuthRequest, res: Response) => {
    const doc = await db().collection("auditLog").doc(req.params.id).get();
    if (!doc.exists) {
      res.status(404).json({ error: "Záznam nenalezen" });
      return;
    }
    res.json({ id: doc.id, ...doc.data() });
  }
);

/**
 * GET /api/audit/meta/collections
 * Lightweight helper for the frontend filter dropdown — returns the distinct
 * collection values currently present in auditLog. Capped at the most recent
 * 5000 entries to keep it cheap; this is just to populate a select.
 */
auditLogRouter.get(
  "/meta/collections",
  requireAuth,
  requirePermission("nav.audit.view"),
  async (_req: AuthRequest, res: Response) => {
    const snap = await db()
      .collection("auditLog")
      .orderBy("timestamp", "desc")
      .limit(5000)
      .get();
    const set = new Set<string>();
    for (const d of snap.docs) {
      const c = (d.data() as Record<string, unknown>).collection;
      if (typeof c === "string" && c) set.add(c);
    }
    res.json([...set].sort());
  }
);
