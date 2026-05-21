import { Router } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, requireRole, AuthRequest } from "../middleware/auth";

export const alertsRouter = Router();

const db = () => admin.firestore();

/**
 * Set (or clear) the shared read-state on a batch of alert docs in one
 * collection. Read-state lives on the alert document itself so it's shared
 * across all admins/directors and survives the daily/manual refreshes (those
 * preserve `read` when the underlying deadline is unchanged). Only existing
 * docs are touched — unknown ids are skipped so we never create orphans.
 */
async function setAlertsRead(
  collection: "alerts" | "probationAlerts",
  ids: unknown,
  read: boolean,
  uid: string | undefined
): Promise<number> {
  if (!Array.isArray(ids)) return 0;
  const validIds = [...new Set(ids.filter((x): x is string => typeof x === "string" && !!x))];
  if (validIds.length === 0) return 0;

  const col = db().collection(collection);
  const snaps = await db().getAll(...validIds.map((id) => col.doc(id)));
  const batch = db().batch();
  let updated = 0;
  for (const snap of snaps) {
    if (!snap.exists) continue;
    batch.update(snap.ref, {
      read,
      readAt: read ? FieldValue.serverTimestamp() : FieldValue.delete(),
      readBy: read ? uid ?? null : FieldValue.delete(),
    });
    updated++;
  }
  if (updated > 0) await batch.commit();
  return updated;
}

/**
 * GET /api/alerts
 * Returns all active expiry alerts, ordered by daysUntilExpiry ascending.
 * Admin + director only.
 */
alertsRouter.get(
  "/",
  requireAuth,
  requireRole("admin", "director"),
  async (_req: AuthRequest, res) => {
    const snap = await db()
      .collection("alerts")
      .orderBy("daysUntilExpiry", "asc")
      .get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }
);

/**
 * GET /api/alerts/probation
 * Returns all active probation-end alerts, ordered by daysUntilEnd asc.
 */
alertsRouter.get(
  "/probation",
  requireAuth,
  requireRole("admin", "director"),
  async (_req: AuthRequest, res) => {
    const snap = await db()
      .collection("probationAlerts")
      .orderBy("daysUntilEnd", "asc")
      .get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }
);

/**
 * POST /api/alerts/read
 * Body: { ids: string[], read?: boolean }  (read defaults to true)
 * Marks document-expiry alerts read/unread for everyone. Admin + director.
 */
alertsRouter.post(
  "/read",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res) => {
    const body = (req.body ?? {}) as { ids?: unknown; read?: unknown };
    const read = body.read !== false;
    const updated = await setAlertsRead("alerts", body.ids, read, req.uid);
    res.json({ updated, read });
  }
);

/**
 * POST /api/alerts/probation/read
 * Body: { ids: string[], read?: boolean }  (read defaults to true)
 * Marks probation-end alerts read/unread for everyone. Admin + director.
 */
alertsRouter.post(
  "/probation/read",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res) => {
    const body = (req.body ?? {}) as { ids?: unknown; read?: unknown };
    const read = body.read !== false;
    const updated = await setAlertsRead("probationAlerts", body.ids, read, req.uid);
    res.json({ updated, read });
  }
);
