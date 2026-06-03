/**
 * Test-clock settings route, mounted at /api/settings/time-override.
 *
 * GET    — any authenticated user (the frontend reads the offset to apply the
 *          same fake clock and show the "fake time" banner).
 * PUT    — admin only, NON-PRODUCTION only: jump the clock to a chosen instant.
 * DELETE — admin only, NON-PRODUCTION only: clear the override (back to real).
 *
 * See services/clock.ts for the safety model (prod always uses real time).
 */
import { Router } from "express";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { requirePermission } from "../auth/permissions";
import {
  overrideDocRef,
  getState,
  refresh,
  isOverrideAllowed,
  now,
} from "../services/clock";

export const timeOverrideRouter = Router();

timeOverrideRouter.get("/", requireAuth, async (_req: AuthRequest, res) => {
  await refresh(true);
  const state = await getState();
  res.json({
    ...state,
    allowed: isOverrideAllowed(),
    serverNowISO: now().toISOString(),
    realNowISO: new Date().toISOString(),
  });
});

timeOverrideRouter.put(
  "/",
  requireAuth,
  requirePermission("system.timeOverride"),
  async (req: AuthRequest, res) => {
    if (!isOverrideAllowed()) {
      res.status(403).json({ error: "Úprava času je v produkci zakázána." });
      return;
    }
    const { targetISO } = req.body as { targetISO?: string };
    const target = targetISO ? Date.parse(targetISO) : NaN;
    if (!Number.isFinite(target)) {
      res.status(400).json({ error: "Neplatné datum/čas." });
      return;
    }
    const real = Date.now();
    await overrideDocRef().set({
      enabled: true,
      offsetMs: target - real, // signed: keeps ticking from `target`
      targetISO: new Date(target).toISOString(),
      setAtISO: new Date(real).toISOString(),
      setBy: req.userEmail ?? req.uid ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await refresh(true);
    res.json({ ok: true, ...(await getState()) });
  }
);

timeOverrideRouter.delete(
  "/",
  requireAuth,
  requirePermission("system.timeOverride"),
  async (_req: AuthRequest, res) => {
    if (!isOverrideAllowed()) {
      res.status(403).json({ error: "Úprava času je v produkci zakázána." });
      return;
    }
    await overrideDocRef().set(
      { enabled: false, offsetMs: 0, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    await refresh(true);
    res.json({ ok: true });
  }
);
