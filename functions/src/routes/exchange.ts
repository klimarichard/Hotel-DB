import { Router, Response } from "express";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { requirePermission } from "../auth/permissions";
import { readSmRates } from "./handovers";

export const exchangeRouter = Router();

// GET /api/exchange/rates — the three global sm rates (settings/sm), used to
// prefill "kurz NÁŠ" on Tabulky → Směnárna + ČNB.
//
// Why not reuse GET /handovers/sm/rates: that route is gated on
// nav.recepce.view. Směnárna is a standalone page whose users need not have
// Recepce access at all, so reusing it would 403 exactly the people the page is
// for. Widening the Recepce route's gate instead would make one permission mean
// two things. Same data, same helper, separate gate.
//
// Read-only by design: the rates are OWNED by the Recepce sm row and are edited
// there under recepce.sm.manage. Nothing on the Směnárna page writes them.
//
// ⚠️ The three rates are positional and deliberately unlabelled in the sm modal
// (no "Kurz"/"Kurzy" text anywhere, by requirement). This endpoint therefore
// carries no currency names either — the calculator maps [0,1,2] → € / $ / £ by
// convention and displays the symbol next to each rate so a mismatch is visible.
// If the sm badges are ever reordered, the sm row keeps totalling correctly (a
// dot product is order-independent) while this page would misprice silently.
exchangeRouter.get(
  "/rates",
  requireAuth,
  requirePermission("tabulky.smenarna.view"),
  async (_req: AuthRequest, res: Response) => {
    res.json({ rates: await readSmRates() });
  }
);
