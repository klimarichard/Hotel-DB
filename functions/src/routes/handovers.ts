import { Router, Response, NextFunction } from "express";
import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { resolveEffectivePermissions } from "../auth/permissions";
import { ctxFromReq, logCreate, logUpdate, logDelete, writeAudit } from "../services/auditLog";
import {
  isHotelSlug,
  HotelSlug,
  handoverViewPerm,
  handoverEditPerm,
  handoverCreatePerm,
  handoverDeletePerm,
  handoverManagePerm,
  SM_MANAGE_PERM,
} from "../services/hotels";
import {
  HandoverDoc,
  NoteRow,
  AccountRow,
  StampedSignature,
  SignatureSlot,
  isSignatureSlot,
  isShiftDate,
  isShiftType,
  docId,
  handoverCol,
  previousShift,
  nextShift,
} from "../services/handoverShared";
import { scheduledSigner } from "../services/scheduleLookup";
import {
  HandoverContent,
  diffHandover,
  createdChange,
  applyChange,
  appendHistory,
  readCursor,
  planUndo,
  planRedo,
  markUndone,
  canUndoRedo,
} from "../services/handoverHistory";
import { actorCtx, resolveRecepceActor } from "../services/recepceActor";

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

/**
 * Epoch millis of a Firestore Timestamp — the optimistic-concurrency token for the
 * content PUT. Computed from seconds+nanoseconds (NOT toMillis) so it matches the
 * client's own `tsMillis` formula exactly (client & server agree bit-for-bit).
 * Tolerates the already-serialized `_seconds`/`_nanoseconds` shape as well.
 */
function tsMillis(ts: unknown): number | null {
  if (!ts || typeof ts !== "object") return null;
  const t = ts as { seconds?: number; nanoseconds?: number; _seconds?: number; _nanoseconds?: number };
  const seconds = typeof t.seconds === "number" ? t.seconds : t._seconds;
  const nanos = typeof t.nanoseconds === "number" ? t.nanoseconds : t._nanoseconds;
  if (typeof seconds !== "number") return null;
  return seconds * 1000 + Math.floor((nanos ?? 0) / 1e6);
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

function idOf(entry: object): string | undefined {
  const id = (entry as { id?: unknown }).id;
  return typeof id === "string" && id !== "" ? id : undefined;
}

/**
 * Coerce arbitrary input into a length-3 tuple of finite numbers. Used for the
 * global sm rates, the per-protocol sm counts, and transfer amounts (all ≥ 0 —
 * decimals allowed). Missing/invalid entries collapse to 0.
 */
function sanitizeTriple(raw: unknown, opts?: { allowNegative?: boolean }): [number, number, number] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: number[] = [];
  for (let i = 0; i < 3; i++) {
    const v = arr[i];
    let n = typeof v === "number" && Number.isFinite(v) ? v : 0;
    if (!opts?.allowNegative && n < 0) n = 0;
    out.push(n);
  }
  return out as [number, number, number];
}

/** A single finite scalar (any sign), else fallback. For the wata delta. */
function finiteOr(raw: unknown, fallback: number): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

const SM_SETTINGS_REF = () => db().collection("settings").doc("sm");

/** The three GLOBAL sm rates (settings/sm). Absent doc → [0,0,0]. */
async function readSmRates(): Promise<[number, number, number]> {
  const snap = await SM_SETTINGS_REF().get();
  const raw = snap.exists ? (snap.data() as { rates?: unknown }).rates : undefined;
  return sanitizeTriple(raw);
}

/** Σ aᵢ·bᵢ — the sm dot product (rates·counts, or rates·transfer amounts). */
function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function sanitizeNotes(raw: unknown): NoteRow[] {
  if (!Array.isArray(raw)) return [];
  const out: NoteRow[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const text = (entry as { text?: unknown }).text;
    if (typeof text !== "string") continue;
    const done = (entry as { done?: unknown }).done === true;
    const locked = (entry as { locked?: unknown }).locked === true;
    const row: NoteRow = { text, done, locked };
    const id = idOf(entry);
    if (id) row.id = id;
    out.push(row);
  }
  return out;
}

function sanitizeAccounts(raw: unknown): AccountRow[] {
  if (!Array.isArray(raw)) return [];
  const out: AccountRow[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const name = (entry as { name?: unknown }).name;
    const amount = (entry as { amount?: unknown }).amount;
    if (typeof name !== "string" || name.trim() === "") continue;
    if (typeof amount !== "number" || !Number.isFinite(amount)) continue;
    const locked = (entry as { locked?: unknown }).locked === true;
    const row: AccountRow = { name: name.trim(), amount: Math.round(amount), locked };
    const id = idOf(entry);
    if (id) row.id = id;
    out.push(row);
  }
  return out;
}

/**
 * Lock enforcement: a manage/admin caller may change anything; a non-manage
 * caller can't edit, delete, or (un)lock a LOCKED row, nor lock a new row. We
 * merge by id — locked stored rows are preserved verbatim, everything else comes
 * from the (already-sanitized) incoming with `locked` forced off.
 */
function mergeLockable<T extends { id?: string; locked?: boolean }>(
  stored: T[],
  incoming: T[],
  isManage: boolean
): T[] {
  if (isManage) return incoming;
  const storedById = new Map<string, T>();
  for (const s of stored) if (s.id) storedById.set(s.id, s);
  const result: T[] = [];
  const used = new Set<string>();
  for (const inc of incoming) {
    const s = inc.id ? storedById.get(inc.id) : undefined;
    if (s && s.locked) {
      result.push(s);
      used.add(inc.id as string);
    } else {
      result.push({ ...inc, locked: false });
    }
  }
  for (const s of stored) {
    if (s.locked && s.id && !used.has(s.id)) result.push(s);
  }
  return result;
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
function requireHotelPerm(kind: "view" | "edit" | "delete" | "manage") {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const hotel = req.params.hotel as HotelSlug;
    const set = req.permissions ?? new Set<string>();
    const needed =
      kind === "view"
        ? handoverViewPerm(hotel)
        : kind === "edit"
          ? handoverEditPerm(hotel)
          : kind === "manage"
            ? handoverManagePerm(hotel)
            : handoverDeletePerm(hotel);
    if (set.has("system.admin") || set.has(needed)) {
      next();
      return;
    }
    res.status(403).json({ error: "Nemáte oprávnění k této akci." });
  };
}

/** Static-permission gate (system.admin always passes). For the GLOBAL sm keys. */
function requirePerm(perm: string) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const set = req.permissions ?? new Set<string>();
    if (set.has("system.admin") || set.has(perm)) {
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

// ─── Global sm rates (settings/sm) ───────────────────────────────────────────
// Shared across all four hotels. Registered BEFORE the `/:hotel` middleware so
// the "sm" segment isn't validated as a hotel slug. GET is readable by anyone
// who can see the Recepce area (needed to render the sm row's CZK value); PUT is
// gated on the global recepce.sm.manage key.
handoversRouter.get(
  "/sm/rates",
  requireAuth,
  requirePerm("nav.recepce.view"),
  async (_req: AuthRequest, res: Response) => {
    res.json({ rates: await readSmRates() });
  }
);

handoversRouter.put(
  "/sm/rates",
  requireAuth,
  requirePerm(SM_MANAGE_PERM),
  async (req: AuthRequest, res: Response) => {
    const before = await readSmRates();
    const rates = sanitizeTriple((req.body as { rates?: unknown }).rates);
    await SM_SETTINGS_REF().set({ rates, updatedBy: req.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await logUpdate(ctxFromReq(req), {
      collection: "settings",
      resourceId: "sm",
      before: { rates: before },
      after: { rates },
    });
    res.json({ rates });
  }
);

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
    const hotel = req.params.hotel as HotelSlug;
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
    // Dedupe by employeeId — if several accounts link to the same employee (a data
    // anomaly, but nothing prevents it) they'd otherwise appear as identical rows.
    const usersSnap = await db().collection("users").get();
    const out: Array<{ uid: string; name: string; label: string }> = [];
    const seenEmp = new Set<string>();
    for (const d of usersSnap.docs) {
      const u = d.data() as { name?: unknown; employeeId?: unknown; active?: unknown };
      if (u.active === false) continue;
      const name = typeof u.name === "string" ? u.name : "";
      if (name.trim() === "") continue; // no username → can't derive the login email
      const empId = typeof u.employeeId === "string" ? u.employeeId : null;
      if (usePlan) {
        if (!empId || !planLabels.has(empId)) continue;
        if (seenEmp.has(empId)) continue;
        seenEmp.add(empId);
        out.push({ uid: d.id, name, label: planLabels.get(empId) ?? name });
      } else {
        if (empId) {
          if (seenEmp.has(empId)) continue;
          seenEmp.add(empId);
        }
        out.push({ uid: d.id, name, label: name });
      }
    }
    out.sort((a, b) => a.label.localeCompare(b.label, "cs"));

    // Default signers: whoever is scheduled for THIS shift (Předal) and the NEXT
    // shift (Převzal) in the plan. null when nobody is scheduled → no default.
    const shift = isShiftType(req.query.shift) ? (req.query.shift as "den" | "noc") : null;
    let scheduled: { predal: string | null; prevzal: string | null } = { predal: null, prevzal: null };
    if (shift) {
      const next = nextShift(dateStr, shift);
      const [cur, nxt] = await Promise.all([
        scheduledSigner(hotel, dateStr, shift),
        scheduledSigner(hotel, next.date, next.shift),
      ]);
      scheduled = { predal: cur?.uid ?? null, prevzal: nxt?.uid ?? null };
    }

    res.json({ signers: out, scheduled });
  }
);

/**
 * GET /api/handovers/:hotel/signers is for signing; this is for REVERTING a
 * signature — a narrower pool: the person who signed it (`?signer=<uid>`, always
 * allowed to self-unsign) plus everyone holding the per-hotel manage permission
 * (or system.admin). Returns `[{ uid, name, label }]` with employee-name labels.
 * Registered BEFORE `/:hotel/:id` so "revokers" isn't captured as a doc id.
 */
handoversRouter.get(
  "/:hotel/revokers",
  requireAuth,
  requireHotelPerm("view"),
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const signerUid = typeof req.query.signer === "string" ? req.query.signer : null;
    const managePerm = handoverManagePerm(hotel);

    const usersSnap = await db().collection("users").get();
    const included: Array<{ uid: string; name: string; employeeId: string | null }> = [];
    const seenEmp = new Set<string>();
    for (const d of usersSnap.docs) {
      const u = d.data() as {
        name?: unknown;
        employeeId?: unknown;
        active?: unknown;
        roleType?: unknown;
        extraPermissions?: unknown;
        revokedPermissions?: unknown;
      };
      if (u.active === false) continue;
      const name = typeof u.name === "string" ? u.name : "";
      if (name.trim() === "") continue;
      let ok = d.id === signerUid; // the signer may always self-unsign
      if (!ok) {
        const perms = await resolveEffectivePermissions({
          roleType: typeof u.roleType === "string" ? u.roleType : undefined,
          extra: Array.isArray(u.extraPermissions) ? (u.extraPermissions as string[]) : [],
          revoked: Array.isArray(u.revokedPermissions) ? (u.revokedPermissions as string[]) : [],
        });
        ok = perms.has("system.admin") || perms.has(managePerm);
      }
      if (!ok) continue;
      const empId = typeof u.employeeId === "string" ? u.employeeId : null;
      if (empId) {
        if (seenEmp.has(empId)) continue;
        seenEmp.add(empId);
      }
      included.push({ uid: d.id, name, employeeId: empId });
    }

    // Resolve employee-name labels for the (few) included users.
    const out = await Promise.all(
      included.map(async (e) => {
        let label = e.name;
        if (e.employeeId) {
          try {
            const emp = await db().collection("employees").doc(e.employeeId).get();
            if (emp.exists) {
              const ed = emp.data() as Record<string, unknown>;
              const dn =
                typeof ed.displayName === "string" && ed.displayName.trim() !== ""
                  ? ed.displayName
                  : `${(ed.lastName as string) ?? ""} ${(ed.firstName as string) ?? ""}`.trim();
              if (dn) label = dn;
            }
          } catch {
            // keep username as the label
          }
        }
        return { uid: e.uid, name: e.name, label };
      })
    );
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
      smCounts?: unknown;
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

    // Optimistic concurrency. The client sends the `updatedAt` (millis) of the
    // version it holds; `baseUpdatedAt` is null when it believes it is CREATING.
    // If the stored doc has moved since then, reject with 409 instead of silently
    // clobbering a colleague's edit — the client reloads / notifies on 409. This
    // runs BEFORE the freeze + create-permission checks so "someone signed/created/
    // deleted while I edited" surfaces as a reload-conflict, not a confusing 403.
    const baseUpdatedAt =
      typeof (body as { baseUpdatedAt?: unknown }).baseUpdatedAt === "number"
        ? (body as { baseUpdatedAt: number }).baseUpdatedAt
        : null;
    if (beforeSnap.exists && baseUpdatedAt === null) {
      res.status(409).json({
        error: "Protokol byl mezitím vytvořen jiným uživatelem.",
        conflict: true,
        current: { id, ...before },
      });
      return;
    }
    if (!beforeSnap.exists && baseUpdatedAt !== null) {
      // The doc the client held was deleted since — do NOT resurrect it from stale state.
      res.status(409).json({
        error: "Protokol byl mezitím smazán jiným uživatelem.",
        conflict: true,
        current: null,
      });
      return;
    }
    if (beforeSnap.exists && baseUpdatedAt !== null) {
      const currentMs = tsMillis((before as { updatedAt?: unknown }).updatedAt);
      if (currentMs !== null && currentMs !== baseUpdatedAt) {
        res.status(409).json({
          error: "Protokol byl mezitím upraven jiným uživatelem.",
          conflict: true,
          current: { id, ...before },
        });
        return;
      }
    }

    // On create, the previous shift's doc drives two things: the create-permission
    // exception (a handover continuation from a fully-signed previous shift needs
    // no create key) AND the carry-over of the running balances — sm trezor + wata
    // ALWAYS follow the money into the next shift. Seeded server-side from the
    // previous shift, never from the client body, so the manage-gating on those
    // fields can't be bypassed at creation.
    let seedSmTrezor = 0;
    let seedWata = 0;
    let prevClosed = false;
    if (!beforeSnap.exists) {
      const set = req.permissions ?? new Set<string>();
      const prev = previousShift(body.shiftDate, body.shiftType);
      const prevSnap = await handoverCol(hotel).doc(docId(prev.date, prev.shift)).get();
      const prevDoc = prevSnap.exists ? (prevSnap.data() as HandoverDoc) : null;
      seedSmTrezor = finiteOr(prevDoc?.smTrezor, 0);
      seedWata = finiteOr(prevDoc?.wata, 0);
      prevClosed = !!(prevDoc?.predal && prevDoc?.prevzal);

      const hasCreate = set.has("system.admin") || set.has(handoverCreatePerm(hotel));
      if (!hasCreate && !prevClosed) {
        res.status(403).json({ error: "Nemáte oprávnění vytvořit protokol." });
        return;
      }
    }

    // Freeze on ANY signature (Předal or Převzal). Content edits keep the admin
    // override (an admin can still correct a signed protocol directly); undo/redo
    // does NOT — see stepHandler. Non-admins must revert the signature to edit.
    if ((before?.predal || before?.prevzal) && !isAdmin(req)) {
      res.status(403).json({ error: "Podepsaný protokol nelze upravit." });
      return;
    }

    const set = req.permissions ?? new Set<string>();
    const isManage = set.has("system.admin") || set.has(handoverManagePerm(hotel));
    // A brand-new protocol never starts with finished poznámky. The next shift
    // carries the outstanding ones forward; the ones ticked off in the shift that
    // just ended stay behind with it — not even struck through. Enforced here so
    // it holds no matter what the client sends.
    const incomingNotes = sanitizeNotes(body.notes);
    const after = {
      shiftDate: body.shiftDate,
      shiftType: body.shiftType,
      notes: mergeLockable<NoteRow>(
        before?.notes ?? [],
        beforeSnap.exists ? incomingNotes : incomingNotes.filter((n) => !n.done),
        isManage
      ),
      cashCounts: sanitizeCashCounts(body.cashCounts),
      accounts: mergeLockable<AccountRow>(before?.accounts ?? [], sanitizeAccounts(body.accounts), isManage),
      // sm counts flow through the normal content PUT (any protocol-edit user).
      // smTrezor + wata are NOT touched here — they move only via their dedicated
      // endpoints, so omitting them from the merge preserves the stored values.
      smCounts: sanitizeTriple(body.smCounts),
      updatedBy: req.uid,
    };

    // Element-level history: diff the stored content against this save so every
    // changed note / účet / cash denomination / sm count is recorded on its own
    // (drives the in-protocol history panel + undo/redo). Computed BEFORE the
    // write, from the doc as it currently stands.
    //
    // Creation is the exception: it is NOT diffed against an empty document. A
    // protocol carried over from the previous shift arrives with all of its
    // notes, účty and cash already populated, and diffing that against nothing
    // recorded dozens of "Přidáno…" entries. One "Protokol vytvořen" instead.
    const afterContent: HandoverContent = {
      notes: after.notes,
      accounts: after.accounts,
      cashCounts: after.cashCounts,
      smCounts: after.smCounts,
    };
    const changes = beforeSnap.exists
      ? diffHandover(
          { notes: before?.notes, accounts: before?.accounts, cashCounts: before?.cashCounts, smCounts: before?.smCounts },
          afterContent
        )
      : [createdChange(prevClosed)];
    const actor = await resolveRecepceActor(req, hotel, body.shiftDate, body.shiftType);
    const newCursor = await appendHistory(
      hotel,
      id,
      readCursor((before as unknown as Record<string, unknown>) ?? undefined),
      changes,
      actor,
      afterContent
    );

    if (!beforeSnap.exists) {
      await ref.set({
        ...after,
        // Running balances carried from the previous shift (server-sourced).
        smTrezor: seedSmTrezor,
        wata: seedWata,
        histSeq: newCursor.histSeq,
        histCursor: newCursor.histCursor,
        createdBy: req.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await logCreate(actorCtx(actor), {
        collection: "shiftHandovers",
        resourceId: id,
        subResourceId: hotel,
        summary: { shiftDate: body.shiftDate, shiftType: body.shiftType, authorUid: actor.uid },
      });
    } else {
      // update() (NOT set-merge): a set with { merge:true } deep-merges the
      // cashCounts map, so a denomination dropped to 0 (absent from the payload)
      // would linger in Firestore. update() replaces each named field wholesale.
      await ref.update({
        ...after,
        histSeq: newCursor.histSeq,
        histCursor: newCursor.histCursor,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    // One compact audit entry per save — the element-level detail lives in the
    // protocol's history subcollection, not duplicated into auditLog. Skipped on
    // a no-op flush (autosave can fire with nothing actually changed), and on
    // creation, where logCreate above already stands for the whole document.
    if (beforeSnap.exists && changes.length > 0) {
      await writeAudit(actorCtx(actor), {
        action: "update",
        collection: "shiftHandovers",
        resourceId: id,
        event: "recepce.protokol.edit",
        extra: {
          hotel,
          shift: body.shiftType,
          date: body.shiftDate,
          changeLabels: changes.slice(0, 6).map((c) => c.label),
        },
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

/**
 * Keep a protocol's "non-consecutive handover" (nenavazující předání) warning in
 * sync: if this shift's Předal signer differs from the PREVIOUS shift's Převzal
 * signer, flag it in `handoverWarnings` (one doc per protocol, deterministic id);
 * otherwise clear any stale flag. Self-healing on re-sign/revert.
 */
async function syncChainWarning(hotel: HotelSlug, id: string): Promise<void> {
  const warnRef = db().collection("handoverWarnings").doc(`${hotel}_${id}`);
  const snap = await handoverCol(hotel).doc(id).get();
  const doc = snap.exists ? (snap.data() as HandoverDoc) : null;
  if (!doc || !doc.predal) {
    await warnRef.delete().catch(() => undefined);
    return;
  }
  const prev = previousShift(doc.shiftDate, doc.shiftType);
  const prevSnap = await handoverCol(hotel).doc(docId(prev.date, prev.shift)).get();
  const prevPrevzal = prevSnap.exists ? (prevSnap.data() as HandoverDoc).prevzal : null;
  if (prevPrevzal && prevPrevzal.uid !== doc.predal.uid) {
    await warnRef.set({
      hotel,
      handoverId: id,
      shiftDate: doc.shiftDate,
      shiftType: doc.shiftType,
      actorUid: doc.predal.uid,
      actorName: doc.predal.displayName,
      expectedUid: prevPrevzal.uid,
      expectedName: prevPrevzal.displayName,
      createdAt: FieldValue.serverTimestamp(),
      read: false,
      readAt: null,
      readBy: null,
    });
  } else {
    await warnRef.delete().catch(() => undefined);
  }
}

/** After a predal/prevzal change, resync the affected protocol's chain warning:
 *  a predal change affects THIS protocol; a prevzal change affects the NEXT one. */
async function resyncChainAfter(hotel: HotelSlug, doc: HandoverDoc, slot: SignatureSlot): Promise<void> {
  if (slot === "predal") {
    await syncChainWarning(hotel, docId(doc.shiftDate, doc.shiftType));
  } else {
    const next = nextShift(doc.shiftDate, doc.shiftType);
    await syncChainWarning(hotel, docId(next.date, next.shift));
  }
}

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

    await resyncChainAfter(hotel, before, slot);

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

    await resyncChainAfter(hotel, before, slot);

    const saved = await ref.get();
    res.json({ id, ...saved.data() });
  };
}

// ─── sm trezor / wata mutations ──────────────────────────────────────────────
// Per-field money moves, each returning the full saved doc. Registered BEFORE the
// generic `/:hotel/:id/:slot` signature routes so their literal path segments
// aren't captured as a signature slot. All obey the freeze rule (loadForFieldMutation).

/**
 * Load a protocol doc for a per-field mutation, enforcing the same freeze rule as
 * content edits: once signed (predal) only an admin may mutate. Returns null after
 * responding on any error, so callers just `if (!loaded) return;`.
 */
async function loadForFieldMutation(
  req: AuthRequest,
  res: Response,
  hotel: HotelSlug,
  id: string
): Promise<{ ref: admin.firestore.DocumentReference; before: HandoverDoc } | null> {
  const ref = handoverCol(hotel).doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    res.status(404).json({ error: "Předání nenalezeno." });
    return null;
  }
  const before = snap.data() as HandoverDoc;
  // Any signature freezes money moves — with the admin override (same as content).
  if ((before.predal || before.prevzal) && !isAdmin(req)) {
    res.status(403).json({ error: "Podepsaný protokol nelze upravit." });
    return null;
  }
  return { ref, before };
}

// POST /:hotel/:id/sm-transfer  body { transfer: [t1,t2,t3] }
// MOVE from sm counts to sm trezor: subtract the (clamped) transfer amounts from
// smCounts, add their CZK product (Σ transferᵢ·rateᵢ) to smTrezor. sm.manage only.
handoversRouter.post(
  "/:hotel/:id/sm-transfer",
  requireAuth,
  requireHotelPerm("edit"),
  requirePerm(SM_MANAGE_PERM),
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const loaded = await loadForFieldMutation(req, res, hotel, req.params.id);
    if (!loaded) return;
    const { ref, before } = loaded;

    const rates = await readSmRates();
    const counts = sanitizeTriple(before.smCounts);
    const wanted = sanitizeTriple((req.body as { transfer?: unknown }).transfer);
    // Clamp each transfer to what's available so counts can't go negative.
    const moved: [number, number, number] = [
      Math.min(wanted[0], counts[0]),
      Math.min(wanted[1], counts[1]),
      Math.min(wanted[2], counts[2]),
    ];
    const newCounts: [number, number, number] = [
      counts[0] - moved[0],
      counts[1] - moved[1],
      counts[2] - moved[2],
    ];
    const newTrezor = finiteOr(before.smTrezor, 0) + dot(rates, moved);

    await ref.set(
      { smCounts: newCounts, smTrezor: newTrezor, updatedBy: req.uid, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    await logUpdate(actorCtx(await resolveRecepceActor(req, hotel, before.shiftDate, before.shiftType)), {
      collection: "shiftHandovers",
      resourceId: req.params.id,
      subResourceId: hotel,
      before: { smCounts: counts, smTrezor: finiteOr(before.smTrezor, 0) },
      after: { smCounts: newCounts, smTrezor: newTrezor },
    });
    const saved = await ref.get();
    res.json({ id: req.params.id, ...saved.data() });
  }
);

// POST /:hotel/:id/sm-trezor/clear — reset smTrezor to 0. sm.manage only.
handoversRouter.post(
  "/:hotel/:id/sm-trezor/clear",
  requireAuth,
  requireHotelPerm("edit"),
  requirePerm(SM_MANAGE_PERM),
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const loaded = await loadForFieldMutation(req, res, hotel, req.params.id);
    if (!loaded) return;
    const { ref, before } = loaded;

    const prev = finiteOr(before.smTrezor, 0);
    await ref.set(
      { smTrezor: 0, updatedBy: req.uid, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    await logUpdate(actorCtx(await resolveRecepceActor(req, hotel, before.shiftDate, before.shiftType)), {
      collection: "shiftHandovers",
      resourceId: req.params.id,
      subResourceId: hotel,
      before: { smTrezor: prev },
      after: { smTrezor: 0 },
    });
    const saved = await ref.get();
    res.json({ id: req.params.id, ...saved.data() });
  }
);

// POST /:hotel/:id/wata  body { delta } — add/subtract from wata (may go negative).
// Gated on the hotel's protokol.manage ("Spravovat protokol").
handoversRouter.post(
  "/:hotel/:id/wata",
  requireAuth,
  requireHotelPerm("manage"),
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const loaded = await loadForFieldMutation(req, res, hotel, req.params.id);
    if (!loaded) return;
    const { ref, before } = loaded;

    const delta = finiteOr((req.body as { delta?: unknown }).delta, 0);
    const prev = finiteOr(before.wata, 0);
    const next = prev + delta;
    await ref.set(
      { wata: next, updatedBy: req.uid, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    await logUpdate(actorCtx(await resolveRecepceActor(req, hotel, before.shiftDate, before.shiftType)), {
      collection: "shiftHandovers",
      resourceId: req.params.id,
      subResourceId: hotel,
      before: { wata: prev },
      after: { wata: next },
    });
    const saved = await ref.get();
    res.json({ id: req.params.id, ...saved.data() });
  }
);

// ─── History panel + undo / redo ─────────────────────────────────────────────
// Registered BEFORE the generic /:hotel/:id/:slot signature route so "history",
// "undo" and "redo" aren't captured as a signature slot. All content-only,
// freeze-aware, and scoped to a single protocol doc (never reach across shifts).

/** Extract the four undoable content fields from a stored protocol doc. */
function contentOf(doc: HandoverDoc): HandoverContent {
  return {
    notes: Array.isArray(doc.notes) ? doc.notes : [],
    accounts: Array.isArray(doc.accounts) ? doc.accounts : [],
    cashCounts: (doc.cashCounts as Record<string, Record<string, number>>) ?? {},
    smCounts: sanitizeTriple(doc.smCounts),
  };
}

/**
 * GET /:hotel/:id/history — the protocol's change history (newest first) plus the
 * undo/redo availability. Display names are resolved per distinct author.
 */
handoversRouter.get(
  "/:hotel/:id/history",
  requireAuth,
  requireHotelPerm("view"),
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const id = req.params.id;
    const ref = handoverCol(hotel).doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Předání nenalezeno." });
      return;
    }
    const cursor = readCursor(snap.data() as Record<string, unknown>);
    const histSnap = await ref.collection("history").orderBy("seq", "desc").get();

    // Resolve author display names once per distinct uid.
    const uids = [...new Set(histSnap.docs.map((d) => (d.data() as { byUid?: string }).byUid).filter(Boolean) as string[])];
    const names = new Map<string, string>();
    await Promise.all(
      uids.map(async (uid) => {
        const entry = histSnap.docs.find((d) => (d.data() as { byUid?: string }).byUid === uid);
        const email = (entry?.data() as { byEmail?: string })?.byEmail ?? "";
        names.set(uid, await resolveDisplayName(uid, email));
      })
    );

    const entries = histSnap.docs.map((d) => {
      const e = d.data() as { seq: number; at: unknown; byUid: string; label: string; undone: boolean };
      return {
        seq: e.seq,
        at: e.at,
        label: e.label,
        by: names.get(e.byUid) ?? e.byUid,
        undone: e.undone === true,
        applied: e.seq <= cursor.histCursor,
      };
    });
    res.json({ entries, ...(await canUndoRedo(hotel, id, cursor)) });
  }
);

/** Shared undo/redo handler: `dir` selects the direction. */
function stepHandler(dir: "undo" | "redo") {
  return async (req: AuthRequest, res: Response): Promise<void> => {
    const hotel = req.params.hotel as HotelSlug;
    const id = req.params.id;
    const ref = handoverCol(hotel).doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Předání nenalezeno." });
      return;
    }
    const before = snap.data() as HandoverDoc;
    // Undo/redo is frozen on ANY signature for EVERYONE — no admin override
    // (unlike content edits). A signed protocol's history is locked; revert the
    // signature to re-enable undo/redo.
    if (before.predal || before.prevzal) {
      res.status(403).json({ error: "Podepsaný protokol nelze vrátit zpět." });
      return;
    }
    const cursor = readCursor(before as unknown as Record<string, unknown>);
    const plan = dir === "undo" ? await planUndo(hotel, id, cursor) : await planRedo(hotel, id, cursor);
    if (!plan) {
      res.status(409).json({ error: dir === "undo" ? "Není co vrátit zpět." : "Není co obnovit." });
      return;
    }

    const content = contentOf(before);
    applyChange(content, plan.change, dir);
    await ref.update({
      notes: content.notes,
      accounts: content.accounts,
      cashCounts: content.cashCounts,
      smCounts: content.smCounts,
      histCursor: plan.cursor.histCursor,
      updatedBy: req.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await markUndone(hotel, id, plan.seq, dir === "undo");
    await writeAudit(actorCtx(await resolveRecepceActor(req, hotel, before.shiftDate, before.shiftType)), {
      action: "update",
      collection: "shiftHandovers",
      resourceId: id,
      event: dir === "undo" ? "recepce.protokol.undo" : "recepce.protokol.redo",
      extra: { hotel, shift: before.shiftType, date: before.shiftDate, label: plan.change.label },
    });

    const saved = await ref.get();
    res.json({ id, ...saved.data(), ...(await canUndoRedo(hotel, id, plan.cursor)) });
  };
}

handoversRouter.post("/:hotel/:id/undo", requireAuth, requireHotelPerm("edit"), (req: AuthRequest, res: Response) => {
  void stepHandler("undo")(req, res);
});
handoversRouter.post("/:hotel/:id/redo", requireAuth, requireHotelPerm("edit"), (req: AuthRequest, res: Response) => {
  void stepHandler("redo")(req, res);
});

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
