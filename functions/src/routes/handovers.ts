import { Router, Response, NextFunction } from "express";
import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { resolveEffectivePermissions } from "../auth/permissions";
import { ctxFromReq, logCreate, logUpdate, logDelete } from "../services/auditLog";
import {
  isHotelSlug,
  HotelSlug,
  handoverViewPerm,
  handoverEditPerm,
  handoverCreatePerm,
  handoverDeletePerm,
  handoverManagePerm,
} from "../services/hotels";
import {
  HandoverDoc,
  StampedSignature,
  SignatureSlot,
  isSignatureSlot,
  isShiftDate,
  isShiftType,
  docId,
  handoverCol,
} from "../services/handoverShared";

const db = () => admin.firestore();

export const handoversRouter = Router();

// YYYY-MM-DD in Europe/Prague — guards against the client clock landing on the
// wrong day for late-shift records written just past midnight.
function todayPrague(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Prague" }).format(new Date());
}

const CZK_DENOMS = ["5000", "2000", "1000", "500", "200", "100", "50", "20", "10", "5", "2", "1"] as const;
const EUR_DENOMS = ["500", "200", "100", "50", "20", "10", "5", "2", "1"] as const;
type DrawerKey = "kasaCZK" | "trezorCZK" | "kasaEUR" | "trezorEUR";

function sanitizeDenomMap(raw: unknown, allowed: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const denom of allowed) {
    const v = (raw as Record<string, unknown>)[denom];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) continue;
    const n = Math.floor(v);
    if (n === 0) continue;
    out[denom] = n;
  }
  return out;
}

function sanitizeCashCounts(raw: unknown): Record<DrawerKey, Record<string, number>> {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    kasaCZK: sanitizeDenomMap(r.kasaCZK, CZK_DENOMS),
    trezorCZK: sanitizeDenomMap(r.trezorCZK, CZK_DENOMS),
    kasaEUR: sanitizeDenomMap(r.kasaEUR, EUR_DENOMS),
    trezorEUR: sanitizeDenomMap(r.trezorEUR, EUR_DENOMS),
  };
}

function sanitizeNotes(raw: unknown): Array<{ text: string; done: boolean }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ text: string; done: boolean }> = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const text = (entry as { text?: unknown }).text;
    if (typeof text !== "string") continue;
    const done = (entry as { done?: unknown }).done === true;
    out.push({ text, done });
  }
  return out;
}

function sanitizeAccounts(raw: unknown): Array<{ name: string; amount: number }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ name: string; amount: number }> = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const name = (entry as { name?: unknown }).name;
    const amount = (entry as { amount?: unknown }).amount;
    if (typeof name !== "string" || name.trim() === "") continue;
    if (typeof amount !== "number" || !Number.isFinite(amount)) continue;
    out.push({ name: name.trim(), amount: Math.round(amount) });
  }
  return out;
}

/** Validates the :hotel URL segment. Rejects unknown slugs with 404. */
function validateHotelParam(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!isHotelSlug(req.params.hotel)) {
    res.status(404).json({ error: "Neznámý hotel." });
    return;
  }
  next();
}

/**
 * Dynamic per-hotel permission gate — the required key depends on the `:hotel`
 * URL param, so a static requirePermission() can't be used. `view` gates reads,
 * `edit` gates create/update (the protokol.view key confers both), `delete`
 * gates removal (its own recepce.<stem>.protokol.delete key). Assumes requireAuth
 * ran first (req.permissions) and validateHotelParam validated the slug.
 */
function requireHotelPerm(kind: "view" | "edit" | "delete") {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const hotel = req.params.hotel as HotelSlug;
    const set = req.permissions ?? new Set<string>();
    const needed =
      kind === "view"
        ? handoverViewPerm(hotel)
        : kind === "edit"
          ? handoverEditPerm(hotel)
          : handoverDeletePerm(hotel);
    if (set.has("system.admin") || set.has(needed)) {
      next();
      return;
    }
    res.status(403).json({ error: "Nemáte oprávnění k této akci." });
  };
}

const isAdmin = (req: AuthRequest): boolean => (req.permissions ?? new Set<string>()).has("system.admin");

/**
 * Resolve the display name to snapshot into a signature: linked employee's
 * first+last name → the user's `name` → the email. Never throws (a missing user
 * must not block a signature).
 */
async function resolveDisplayName(uid: string, fallbackEmail: string): Promise<string> {
  try {
    const userDoc = await db().collection("users").doc(uid).get();
    if (userDoc.exists) {
      const data = userDoc.data() as Record<string, unknown>;
      const employeeId = data.employeeId as string | undefined;
      if (employeeId) {
        const empDoc = await db().collection("employees").doc(employeeId).get();
        if (empDoc.exists) {
          const emp = empDoc.data() as Record<string, unknown>;
          const full = `${(emp.firstName as string) ?? ""} ${(emp.lastName as string) ?? ""}`.trim();
          if (full !== "") return full;
        }
      }
      const name = (data.name as string | undefined) ?? "";
      if (name.trim() !== "") return name;
    }
  } catch {
    // never block a signature on a missing/broken user record
  }
  return fallbackEmail;
}

handoversRouter.use("/:hotel", validateHotelParam);

/**
 * GET /api/handovers/:hotel?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Defaults to the trailing 14 days ending today (Europe/Prague).
 */
handoversRouter.get(
  "/:hotel",
  requireAuth,
  requireHotelPerm("view"),
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const today = todayPrague();
    const to = isShiftDate(req.query.to) ? (req.query.to as string) : today;
    let from: string;
    if (isShiftDate(req.query.from)) {
      from = req.query.from as string;
    } else {
      const d = new Date(`${to}T00:00:00`);
      d.setDate(d.getDate() - 13);
      from = new Intl.DateTimeFormat("sv-SE").format(d);
    }

    const snap = await handoverCol(hotel)
      .where("shiftDate", ">=", from)
      .where("shiftDate", "<=", to)
      .orderBy("shiftDate", "desc")
      .get();

    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }
);

/**
 * GET /api/handovers/:hotel/signers?date=YYYY-MM-DD
 * The pool of people who may sign Předat/Převzít: users whose linked employee is
 * in that month's shift plan. Falls back to ALL active users when the month has
 * no plan (or an empty one) so signing is never dead-ended. Returns
 * `[{ uid, name, label }]` — `name` (username) drives the `${name}@hotel.local`
 * credential, `label` is the friendly display name for the dropdown.
 * Registered BEFORE `/:hotel/:id` so "signers" isn't captured as a doc id.
 */
handoversRouter.get(
  "/:hotel/signers",
  requireAuth,
  requireHotelPerm("view"),
  async (req: AuthRequest, res: Response) => {
    const dateStr =
      typeof req.query.date === "string" && isShiftDate(req.query.date)
        ? (req.query.date as string)
        : todayPrague();
    const year = Number(dateStr.slice(0, 4));
    const month = Number(dateStr.slice(5, 7));

    // employeeId → friendly label, for employees in that month's plan.
    const planLabels = new Map<string, string>();
    const planSnap = await db()
      .collection("shiftPlans")
      .where("year", "==", year)
      .where("month", "==", month)
      .limit(1)
      .get();
    if (!planSnap.empty) {
      const emps = await planSnap.docs[0].ref.collection("planEmployees").get();
      for (const d of emps.docs) {
        const data = d.data() as {
          employeeId?: unknown;
          displayName?: unknown;
          firstName?: unknown;
          lastName?: unknown;
          active?: unknown;
        };
        if (data.active === false) continue;
        if (typeof data.employeeId !== "string") continue;
        const label =
          typeof data.displayName === "string" && data.displayName.trim() !== ""
            ? data.displayName
            : `${(data.lastName as string) ?? ""} ${(data.firstName as string) ?? ""}`.trim();
        planLabels.set(data.employeeId, label || data.employeeId);
      }
    }
    const usePlan = planLabels.size > 0;

    // Map active users → signer entries; when a plan exists, keep only users whose
    // linked employee is in it. The users collection is small, so one read is fine.
    const usersSnap = await db().collection("users").get();
    const out: Array<{ uid: string; name: string; label: string }> = [];
    for (const d of usersSnap.docs) {
      const u = d.data() as { name?: unknown; employeeId?: unknown; active?: unknown };
      if (u.active === false) continue;
      const name = typeof u.name === "string" ? u.name : "";
      if (name.trim() === "") continue; // no username → can't derive the login email
      const empId = typeof u.employeeId === "string" ? u.employeeId : null;
      if (usePlan) {
        if (!empId || !planLabels.has(empId)) continue;
        out.push({ uid: d.id, name, label: planLabels.get(empId) ?? name });
      } else {
        out.push({ uid: d.id, name, label: name });
      }
    }
    out.sort((a, b) => a.label.localeCompare(b.label, "cs"));
    res.json(out);
  }
);

/** GET /api/handovers/:hotel/:id */
handoversRouter.get(
  "/:hotel/:id",
  requireAuth,
  requireHotelPerm("view"),
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const doc = await handoverCol(hotel).doc(req.params.id).get();
    if (!doc.exists) {
      res.status(404).json({ error: "Předání nenalezeno." });
      return;
    }
    res.json({ id: doc.id, ...doc.data() });
  }
);

/**
 * PUT /api/handovers/:hotel
 * Body: { shiftDate, shiftType, notes, cashCounts, accounts }. Creates the doc
 * on first write, merges on subsequent writes. RETURNS THE FULL DOCUMENT so the
 * client never needs a read-back GET (that read-after-write round-trip was racy
 * on the hosting→function path).
 */
handoversRouter.put(
  "/:hotel",
  requireAuth,
  requireHotelPerm("edit"),
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const body = req.body as {
      shiftDate?: unknown;
      shiftType?: unknown;
      notes?: unknown;
      cashCounts?: unknown;
      accounts?: unknown;
    };

    if (!isShiftDate(body.shiftDate)) {
      res.status(400).json({ error: "Neplatné datum směny (formát YYYY-MM-DD)." });
      return;
    }
    if (!isShiftType(body.shiftType)) {
      res.status(400).json({ error: "Neplatný typ směny (den|noc)." });
      return;
    }

    const id = docId(body.shiftDate, body.shiftType);
    const ref = handoverCol(hotel).doc(id);
    const beforeSnap = await ref.get();
    const before = beforeSnap.exists ? (beforeSnap.data() as HandoverDoc) : null;

    // Creating a NEW protocol (bootstrap or duplicate-to-next-shift) needs the
    // dedicated create permission; editing an existing one needs only view/edit.
    if (!beforeSnap.exists) {
      const set = req.permissions ?? new Set<string>();
      if (!set.has("system.admin") && !set.has(handoverCreatePerm(hotel))) {
        res.status(403).json({ error: "Nemáte oprávnění vytvořit protokol." });
        return;
      }
    }

    // Freeze at Předat: once the outgoing shift is signed, content is read-only
    // (an admin may still edit, e.g. after reverting a signature).
    if (before?.predal && !isAdmin(req)) {
      res.status(403).json({ error: "Podepsaný protokol nelze upravit." });
      return;
    }

    const after = {
      shiftDate: body.shiftDate,
      shiftType: body.shiftType,
      notes: sanitizeNotes(body.notes),
      cashCounts: sanitizeCashCounts(body.cashCounts),
      accounts: sanitizeAccounts(body.accounts),
      updatedBy: req.uid,
    };

    if (!beforeSnap.exists) {
      await ref.set({
        ...after,
        createdBy: req.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await logCreate(ctxFromReq(req), {
        collection: "shiftHandovers",
        resourceId: id,
        subResourceId: hotel,
        summary: { shiftDate: body.shiftDate, shiftType: body.shiftType, authorUid: req.uid },
      });
    } else {
      await ref.set({ ...after, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await logUpdate(ctxFromReq(req), {
        collection: "shiftHandovers",
        resourceId: id,
        subResourceId: hotel,
        before: (before as unknown as Record<string, unknown>) ?? undefined,
        after: { ...((before as unknown as Record<string, unknown>) ?? {}), ...after },
      });
    }

    // Return the persisted document (read-back in the SAME invocation is reliable,
    // unlike a separate client GET) so the client can update its state directly.
    const saved = await ref.get();
    res.json({ id, ...saved.data() });
  }
);

/**
 * DELETE /api/handovers/:hotel/:id
 * Gated by the per-hotel recepce.<stem>.protokol.delete permission.
 */
handoversRouter.delete(
  "/:hotel/:id",
  requireAuth,
  requireHotelPerm("delete"),
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const ref = handoverCol(hotel).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Předání nenalezeno." });
      return;
    }
    const data = snap.data() as Record<string, unknown>;
    await ref.delete();

    await logDelete(ctxFromReq(req), {
      collection: "shiftHandovers",
      resourceId: req.params.id,
      subResourceId: hotel,
      summary: { shiftDate: data.shiftDate, shiftType: data.shiftType },
    });

    res.json({ ok: true });
  }
);

// ─── Virtual signatures (Předat / Převzít + revert) ──────────────────────────
// The client verifies a colleague's username+password on a secondary Firebase
// app and posts the resulting idToken; the server verifies it and records the
// password-proven identity, independent of who is logged in. requireHotelPerm
// ("edit") gates the LOGGED-IN initiator; the signer/reverter identity comes
// from the idToken.

/** Sign an open slot. predal → freezes content; prevzal → closes (must differ from predal). */
function stampHandler(slot: SignatureSlot) {
  const otherSlot: SignatureSlot = slot === "predal" ? "prevzal" : "predal";
  return async (req: AuthRequest, res: Response): Promise<void> => {
    const hotel = req.params.hotel as HotelSlug;
    const id = req.params.id;
    const body = req.body as { idToken?: unknown };
    if (typeof body.idToken !== "string" || body.idToken.trim() === "") {
      res.status(400).json({ error: "Chybí ověření." });
      return;
    }
    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(body.idToken);
    } catch {
      res.status(401).json({ error: "Neplatné jméno nebo heslo." });
      return;
    }

    const ref = handoverCol(hotel).doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Předání nenalezeno." });
      return;
    }
    const before = snap.data() as HandoverDoc;

    if (before[slot]) {
      res.status(409).json({ error: slot === "predal" ? "Protokol už byl předán." : "Protokol už byl převzat." });
      return;
    }
    if (slot === "prevzal" && !before.predal) {
      res.status(400).json({ error: "Protokol musí být nejprve předán." });
      return;
    }
    const other = before[otherSlot] as StampedSignature | null | undefined;
    if (other && other.uid === decoded.uid) {
      res.status(400).json({ error: "Předal a převzal musí být dva různí uživatelé." });
      return;
    }

    const stamp: StampedSignature = {
      uid: decoded.uid,
      displayName: await resolveDisplayName(decoded.uid, decoded.email ?? ""),
      email: decoded.email ?? "",
      at: Timestamp.now(),
    };
    await ref.set(
      { [slot]: stamp, updatedBy: req.uid, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    await logUpdate(ctxFromReq(req), {
      collection: "shiftHandovers",
      resourceId: id,
      subResourceId: hotel,
      before: { [slot]: null },
      after: { [slot]: { uid: stamp.uid, displayName: stamp.displayName } },
    });

    const saved = await ref.get();
    res.json({ id, ...saved.data() });
  };
}

/** Revert a slot. Allowed for the signer (self) or a manage/admin holder. */
function revertHandler(slot: SignatureSlot) {
  return async (req: AuthRequest, res: Response): Promise<void> => {
    const hotel = req.params.hotel as HotelSlug;
    const id = req.params.id;
    const body = req.body as { idToken?: unknown };
    if (typeof body.idToken !== "string" || body.idToken.trim() === "") {
      res.status(400).json({ error: "Chybí ověření." });
      return;
    }
    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(body.idToken);
    } catch {
      res.status(401).json({ error: "Neplatné jméno nebo heslo." });
      return;
    }

    const ref = handoverCol(hotel).doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Předání nenalezeno." });
      return;
    }
    const before = snap.data() as HandoverDoc;
    const stamp = before[slot] as StampedSignature | null | undefined;
    if (!stamp) {
      res.status(404).json({ error: "Tento podpis neexistuje." });
      return;
    }
    // Předal can't be reverted while Převzal stands (would orphan it).
    if (slot === "predal" && before.prevzal) {
      res.status(400).json({ error: "Nejprve odeberte podpis Převzal." });
      return;
    }

    // Authorize the credential-verified identity: self, or manage/admin.
    let authorized = decoded.uid === stamp.uid;
    if (!authorized) {
      const perms = await resolveEffectivePermissions({
        roleType: typeof decoded.roleType === "string" ? decoded.roleType : undefined,
        extra: Array.isArray(decoded.extraPermissions) ? (decoded.extraPermissions as string[]) : [],
        revoked: Array.isArray(decoded.revokedPermissions) ? (decoded.revokedPermissions as string[]) : [],
      });
      authorized = perms.has("system.admin") || perms.has(handoverManagePerm(hotel));
    }
    if (!authorized) {
      res.status(403).json({ error: "Nemáte oprávnění odebrat cizí podpis." });
      return;
    }

    await ref.set(
      { [slot]: null, updatedBy: req.uid, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    await logUpdate(ctxFromReq(req), {
      collection: "shiftHandovers",
      resourceId: id,
      subResourceId: hotel,
      before: { [slot]: { uid: stamp.uid, displayName: stamp.displayName } },
      after: { [slot]: null },
    });

    const saved = await ref.get();
    res.json({ id, ...saved.data() });
  };
}

// Register the 4-segment revert routes BEFORE the 3-segment sign routes.
handoversRouter.post(
  "/:hotel/:id/:slot/revert",
  requireAuth,
  requireHotelPerm("edit"),
  (req: AuthRequest, res: Response) => {
    if (!isSignatureSlot(req.params.slot)) {
      res.status(404).json({ error: "Neznámý podpis." });
      return;
    }
    void revertHandler(req.params.slot)(req, res);
  }
);
handoversRouter.post(
  "/:hotel/:id/:slot",
  requireAuth,
  requireHotelPerm("edit"),
  (req: AuthRequest, res: Response) => {
    if (!isSignatureSlot(req.params.slot)) {
      res.status(404).json({ error: "Neznámý podpis." });
      return;
    }
    void stampHandler(req.params.slot)(req, res);
  }
);
