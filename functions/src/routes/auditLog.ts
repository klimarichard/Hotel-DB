import { Router, Response } from "express";
import * as admin from "firebase-admin";
import { requireAuth, requireRole, AuthRequest } from "../middleware/auth";

export const auditLogRouter = Router();

const db = () => admin.firestore();

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

/**
 * GET /api/audit
 * Admin-only. Lists audit-log entries newest-first with optional filters
 * and cursor-based pagination.
 *
 * Query params (all optional):
 *   employeeId, userId, collection, action — equality filters
 *   from, to                                — ISO datetimes (timestamp range)
 *   limit                                   — page size, default 100, max 500
 *   cursor                                  — last doc id from previous page
 */
auditLogRouter.get(
  "/",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res: Response) => {
    const {
      employeeId,
      userId,
      collection,
      action,
      from,
      to,
      limit: limitParam,
      cursor,
    } = req.query as Record<string, string | undefined>;

    const limit = Math.min(
      Math.max(parseInt(limitParam ?? "") || DEFAULT_LIMIT, 1),
      MAX_LIMIT
    );

    let query: admin.firestore.Query = db().collection("auditLog");

    if (employeeId) query = query.where("employeeId", "==", employeeId);
    if (userId) query = query.where("userId", "==", userId);
    if (collection) query = query.where("collection", "==", collection);
    if (action) query = query.where("action", "==", action);

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

    const snap = await query.get();
    const docs = snap.docs.slice(0, limit);
    const nextCursor =
      snap.docs.length > limit ? snap.docs[limit - 1].id : undefined;

    const entries = docs.map((d) => ({ id: d.id, ...d.data() }));

    res.json({ entries, nextCursor });
  }
);

/**
 * GET /api/audit/:id
 * Fetch a single audit-log entry by id (for the row-expansion view).
 */
auditLogRouter.get(
  "/:id",
  requireAuth,
  requireRole("admin", "director"),
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
  requireRole("admin", "director"),
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
