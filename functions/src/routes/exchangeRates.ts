import { Router } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { ctxFromReq, logUpdate } from "../services/auditLog";

export const exchangeRatesRouter = Router();

const db = () => admin.firestore();
const docRef = () => db().collection("settings").doc("exchangeRates");

const SUPPORTED = ["EUR", "USD", "GBP"] as const;
const DEFAULT_RATES: Record<(typeof SUPPORTED)[number], number> = {
  EUR: 25,
  USD: 22,
  GBP: 29,
};

/**
 * GET /api/exchange-rates
 * Any authenticated user. Returns the current EUR/USD/GBP rates (CZK per 1 unit
 * of currency). Receptionists need them to compute the sm-row CZK total for the
 * Předávací protokol.
 */
exchangeRatesRouter.get("/", requireAuth, async (_req: AuthRequest, res) => {
  const snap = await docRef().get();
  if (!snap.exists) {
    res.json(DEFAULT_RATES);
    return;
  }
  const data = snap.data() ?? {};
  res.json({
    EUR: typeof data.EUR === "number" ? data.EUR : DEFAULT_RATES.EUR,
    USD: typeof data.USD === "number" ? data.USD : DEFAULT_RATES.USD,
    GBP: typeof data.GBP === "number" ? data.GBP : DEFAULT_RATES.GBP,
  });
});

/**
 * PUT /api/exchange-rates
 * Admin only (basic version). Editing the global sm rates is a "manager
 * privilege" that gets its own per-hotel `recepce.<hotel>.protokol.manage` key
 * in a later pass; until then only admins change rates. Body: { EUR?, USD?, GBP? }
 * — partial updates accepted; missing keys keep their existing value.
 */
exchangeRatesRouter.put("/", requireAuth, async (req: AuthRequest, res) => {
  if (!(req.permissions ?? new Set<string>()).has("system.admin")) {
    res.status(403).json({ error: "Kurzy může upravit jen administrátor." });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const update: Record<string, number> = {};
  for (const key of SUPPORTED) {
    if (!(key in body)) continue;
    const v = body[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
      res.status(400).json({ error: `Kurz '${key}' musí být kladné číslo.` });
      return;
    }
    update[key] = v;
  }

  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: "Nic k uložení." });
    return;
  }

  const beforeSnap = await docRef().get();
  const before = beforeSnap.exists ? (beforeSnap.data() as Record<string, unknown>) : {};

  await docRef().set(
    { ...update, updatedAt: FieldValue.serverTimestamp(), updatedBy: req.uid },
    { merge: true }
  );

  await logUpdate(ctxFromReq(req), {
    collection: "settings",
    resourceId: "exchangeRates",
    before,
    after: { ...before, ...update },
  });

  res.json({ ok: true, rates: { ...DEFAULT_RATES, ...before, ...update } });
});
