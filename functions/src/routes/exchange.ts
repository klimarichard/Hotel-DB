import { Router, Response } from "express";
import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { requirePermission } from "../auth/permissions";
import { readSmRates } from "./handovers";
import { SMENARNA_SNAPSHOTS } from "../services/smenarnaRetention";
import { ctxFromReq, logCreate, logDelete } from "../services/auditLog";

export const exchangeRouter = Router();

const db = () => admin.firestore();

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

// ─── Směnárna snapshots ──────────────────────────────────────────────────────
//
// A saved copy of the whole calculator, recalled later from a datestamped list.
// SHARED: everyone holding tabulky.smenarna.view sees every snapshot regardless
// of who saved it, and may delete any of them — the same key governs read,
// write and delete, so no new permission is introduced.
//
// Swept after 6 months by the daily sweepSmenarnaSnapshots job. Nothing else
// references a snapshot, so deleting one destroys no business data; that is why
// the sweep removes the documents outright.

/** Hard ceiling on a stored snapshot. The realistic payload is a few kB (a
 *  handful of rows × 12 denominations); this only stops a malformed or hostile
 *  client from parking megabytes in Firestore. */
const MAX_SNAPSHOT_BYTES = 64 * 1024;

/** uid → display name from users/{uid}.name, resolved at READ time so a later
 *  rename is reflected in old snapshots. Falls back to the stored email, then
 *  the uid, so a deleted user still renders as something. */
async function resolveNames(uids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(uids.filter(Boolean))];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const docs = await db().getAll(...unique.map((u) => db().collection("users").doc(u)));
  docs.forEach((d) => {
    const name = d.exists ? ((d.data() as Record<string, unknown>).name as string) : undefined;
    if (name) out.set(d.id, name);
  });
  return out;
}

function tsToIso(v: unknown): string | null {
  return v instanceof Timestamp ? v.toDate().toISOString() : null;
}

// GET /api/exchange/snapshots — the list, newest first. Payload deliberately
// omitted: the list only needs a datestamp and an author.
exchangeRouter.get(
  "/snapshots",
  requireAuth,
  requirePermission("tabulky.smenarna.view"),
  async (_req: AuthRequest, res: Response) => {
    const snap = await db()
      .collection(SMENARNA_SNAPSHOTS)
      .orderBy("createdAt", "desc")
      .limit(200)
      .get();
    const names = await resolveNames(
      snap.docs.map((d) => (d.data() as { createdBy?: string }).createdBy ?? "")
    );
    res.json({
      snapshots: snap.docs.map((d) => {
        const data = d.data() as { createdAt?: unknown; createdBy?: string; createdByEmail?: string };
        return {
          id: d.id,
          createdAt: tsToIso(data.createdAt),
          createdByName:
            names.get(data.createdBy ?? "") ?? data.createdByEmail ?? data.createdBy ?? "",
        };
      }),
    });
  }
);

// GET /api/exchange/snapshots/:id — one snapshot including its payload.
exchangeRouter.get(
  "/snapshots/:id",
  requireAuth,
  requirePermission("tabulky.smenarna.view"),
  async (req: AuthRequest, res: Response) => {
    const doc = await db().collection(SMENARNA_SNAPSHOTS).doc(req.params.id).get();
    if (!doc.exists) {
      res.status(404).json({ error: "Snímek nenalezen." });
      return;
    }
    const data = doc.data() as { createdAt?: unknown; createdBy?: string; createdByEmail?: string; data?: unknown };
    const names = await resolveNames([data.createdBy ?? ""]);
    res.json({
      id: doc.id,
      createdAt: tsToIso(data.createdAt),
      createdByName: names.get(data.createdBy ?? "") ?? data.createdByEmail ?? data.createdBy ?? "",
      data: data.data ?? null,
    });
  }
);

// POST /api/exchange/snapshots — save the current calculator state.
exchangeRouter.post(
  "/snapshots",
  requireAuth,
  requirePermission("tabulky.smenarna.view"),
  async (req: AuthRequest, res: Response) => {
    const payload = (req.body as { data?: unknown }).data;
    if (payload == null || typeof payload !== "object") {
      res.status(400).json({ error: "Chybí data snímku." });
      return;
    }
    if (Buffer.byteLength(JSON.stringify(payload), "utf8") > MAX_SNAPSHOT_BYTES) {
      res.status(413).json({ error: "Snímek je příliš velký." });
      return;
    }
    const ref = await db()
      .collection(SMENARNA_SNAPSHOTS)
      .add({
        data: payload,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: req.uid ?? "",
        createdByEmail: req.userEmail ?? "",
      });
    await logCreate(ctxFromReq(req), {
      collection: SMENARNA_SNAPSHOTS,
      resourceId: ref.id,
    });
    res.status(201).json({ id: ref.id });
  }
);

// DELETE /api/exchange/snapshots/:id
exchangeRouter.delete(
  "/snapshots/:id",
  requireAuth,
  requirePermission("tabulky.smenarna.view"),
  async (req: AuthRequest, res: Response) => {
    const ref = db().collection(SMENARNA_SNAPSHOTS).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) {
      res.status(404).json({ error: "Snímek nenalezen." });
      return;
    }
    await ref.delete();
    await logDelete(ctxFromReq(req), {
      collection: SMENARNA_SNAPSHOTS,
      resourceId: req.params.id,
    });
    res.json({ ok: true });
  }
);
