import { Router } from "express";
import * as admin from "firebase-admin";
import { requireAuth, requireRole, AuthRequest } from "../middleware/auth";

export const alertsRouter = Router();

const db = () => admin.firestore();

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
