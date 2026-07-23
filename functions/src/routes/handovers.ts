import { Router, Response, NextFunction } from "express";
import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { resolveEffectivePermissions, roleTypeFromUserDoc } from "../auth/permissions";
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
  CZK_DENOMS,
  EUR_DENOMS,
  DrawerKey,
} from "../services/handoverShared";
import { scheduledSigner } from "../services/scheduleLookup";
import { resolveEmployeeDisplays, recepceDisplayName, recepceSortKey } from "../services/recepceEmployees";
import {
  HandoverContent,
  diffHandover,
  createdChange,
  applyChange,
  appendHistory,
  readCursor,
  loadHistoryEntries,
  findUndoTarget,
  findRedoTarget,
  highestAppliedSeq,
  computeCanStep,
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

/** The three GLOBAL sm rates (settings/sm). Absent doc → [0,0,0].
 *  Exported for the Tabulky → Směnárna calculator, which prefills "kurz NÁŠ"
 *  from the same three numbers but is gated on tabulky.smenarna.view rather
 *  than nav.recepce.view — see routes/exchange.ts. */
export async function readSmRates(): Promise<[number, number, number]> {
  const snap = await SM_SETTINGS_REF().get();
  const raw = snap.exists ? (snap.data() as { rates?: unknown }).rates : undefined;
  return sanitizeTriple(raw);
}

/** Σ aᵢ·bᵢ — the sm dot product (rates·counts, or rates·transfer amounts). */
function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * The client's edit-session token (one focus-to-blur pass over one input). Opaque
 * to the server — only ever compared for equality against the tip history entry's
 * — so it just has to be a short, harmless string.
 */
function sanitizeEditSession(raw: unknown): string | undefined {
  return typeof raw === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : undefined;
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

/**
 * Lock enforcement on CREATE (no stored baseline exists yet). A new protocol is
 * born by carrying the previous shift's outstanding notes / účty forward, so the
 * lock state must be INHERITED from that previous shift — not trusted from the
 * client and not stripped. A manage/admin caller controls locks directly (their
 * incoming rows pass verbatim). A non-manage caller (the receptionist taking the
 * shift over) may neither lock a new row nor unlock a carried one: each incoming
 * row's `locked` is forced to whatever it was in the previous shift (matched by
 * id), and false for anything not carried across. Without this, every handover
 * performed by a regular receptionist silently unlocked the pinned rows.
 */
function seedLockedFromPrevious<T extends { id?: string; locked?: boolean }>(
  prev: T[],
  incoming: T[],
  isManage: boolean
): T[] {
  if (isManage) return incoming;
  const prevLocked = new Set<string>();
  for (const p of prev) if (p.locked && p.id) prevLocked.add(p.id);
  return incoming.map((row) => ({ ...row, locked: !!(row.id && prevLocked.has(row.id)) }));
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
 * reception display name → the user's `name` → the email. Never throws (a missing
 * user must not block a signature).
 *
 * The employee name goes through `recepceDisplayName`, so a person who goes by a
 * custom `displayName` signs under it. Composing firstName+lastName here (as this
 * did) ignored `displayName` and stamped the legal name onto every protokol —
 * the one Recepce surface that still did.
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
          const full = recepceDisplayName(empDoc.data() as Parameters<typeof recepceDisplayName>[0]);
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

/** A stored signature stamp, or null when the slot is empty / malformed. */
function asStamp(v: unknown): StampedSignature | null {
  if (!v || typeof v !== "object") return null;
  const uid = (v as { uid?: unknown }).uid;
  return typeof uid === "string" && uid !== "" ? (v as StampedSignature) : null;
}

/**
 * Live-resolve the signer names on protocol docs about to be returned.
 *
 * A stamp freezes `displayName` at signing time and is never rewritten, so every
 * protokol signed before this fix carries the signer's LEGAL name even though
 * they go by a display name. The stamp does keep the signer's `uid`, so the label
 * is fully re-derivable (uid → users/{uid}.employeeId → live employee), and that
 * is what the rest of Recepce already does: names are display concerns resolved
 * live, snapshots are only a fallback for records that no longer exist.
 *
 * Only the LABEL is re-resolved. The signature's legal substance — who signed
 * (`uid`), the credential they proved (`email`) and when (`at`) — is the historical
 * record and stays exactly as stamped; Firestore is never rewritten here. So the
 * protokol still attests to the same person, just under the name they actually go by.
 *
 * Docs with no signatures cost zero extra reads.
 */
async function withLiveSignerNames(docs: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
  const uids = [
    ...new Set(
      docs.flatMap((d) => [asStamp(d.predal)?.uid, asStamp(d.prevzal)?.uid]).filter((u): u is string => !!u)
    ),
  ];
  if (uids.length === 0) return docs;

  const userSnaps = await db().getAll(...uids.map((u) => db().collection("users").doc(u)));
  const empByUid = new Map<string, string>();
  for (const s of userSnaps) {
    const empId = s.exists ? (s.data() as { employeeId?: unknown }).employeeId : undefined;
    if (typeof empId === "string" && empId !== "") empByUid.set(s.id, empId);
  }
  const displays = await resolveEmployeeDisplays([...empByUid.values()]);

  // Live name, or undefined when the signer's account/employee record is gone —
  // then the stamped string stays, it's the only record of who they were.
  const liveName = (v: unknown): string | undefined => {
    const stamp = asStamp(v);
    const empId = stamp ? empByUid.get(stamp.uid) : undefined;
    return (empId ? displays.get(empId)?.name : undefined) || undefined;
  };

  return docs.map((d) => {
    const predal = liveName(d.predal);
    const prevzal = liveName(d.prevzal);
    if (!predal && !prevzal) return d;
    return {
      ...d,
      ...(predal ? { predal: { ...(d.predal as object), displayName: predal } } : {}),
      ...(prevzal ? { prevzal: { ...(d.prevzal as object), displayName: prevzal } } : {}),
    };
  });
}

/** Single-doc form of {@link withLiveSignerNames}. */
async function withLiveSignerName(doc: Record<string, unknown>): Promise<Record<string, unknown>> {
  return (await withLiveSignerNames([doc]))[0];
}

/**
 * The name to record on a derived handover warning. The stamp's own `displayName`
 * may be a stale legal name (see withLiveSignerNames), and the warning docs are
 * snapshots that only get rewritten on a re-sign — so resolve the signer live at
 * write time instead of copying the stamp's string forward.
 */
async function warningActorName(stamp: StampedSignature): Promise<string> {
  return await resolveDisplayName(stamp.uid, stamp.displayName || stamp.email || "");
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

    res.json(await withLiveSignerNames(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
  }
);

/**
 * GET /api/handovers/:hotel/signers?date=YYYY-MM-DD
 * The pool of people who may sign Předat/Převzít: users whose linked employee is
 * in that month's shift plan. Falls back to ALL active users when the month has
 * no plan (or an empty one) so signing is never dead-ended. Returns
 * `[{ uid, name, email, label }]` — `email` is the account's real login, used to
 * verify the signature; `label` is the friendly display name for the dropdown;
 * `name` is the username (metadata only, no longer drives the credential).
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

    // Roster membership for this month's plan, plus a name/sort snapshot used only
    // as a fallback when a rostered employee's live record is gone.
    const planMembers = new Set<string>();
    const planSnapshot = new Map<string, { name: string; sortKey: string }>();
    const planSnap = await db()
      .collection("shiftPlans")
      .where("year", "==", year)
      .where("month", "==", month)
      .limit(1)
      .get();
    if (!planSnap.empty) {
      const emps = await planSnap.docs[0].ref.collection("planEmployees").get();
      for (const d of emps.docs) {
        const data = d.data() as { employeeId?: unknown; displayName?: unknown; firstName?: unknown; lastName?: unknown };
        // Presence in the month's roster is what makes someone an eligible signer;
        // the `active` flag only governs grid-row visibility, so we deliberately do
        // NOT skip inactive roster rows here. A receptionist who is on the plan (even
        // with an inactive row) and works shifts must still appear in the handover
        // sign dialog — otherwise they can never sign a Předat/Převzít.
        if (typeof data.employeeId !== "string") continue;
        planMembers.add(data.employeeId);
        planSnapshot.set(data.employeeId, { name: recepceDisplayName(data), sortKey: recepceSortKey(data) });
      }
    }
    const usePlan = planMembers.size > 0;

    // Map active users → signer entries; when a plan exists, keep only users whose
    // linked employee is in it. The users collection is small, so one read is fine.
    // Dedupe by employeeId — if several accounts link to the same employee (a data
    // anomaly, but nothing prevents it) they'd otherwise appear as identical rows.
    const usersSnap = await db().collection("users").get();
    // Live display names (displayName || "First Last") for every linked employee.
    const displays = await resolveEmployeeDisplays(
      usersSnap.docs.map((d) => (d.data() as { employeeId?: unknown }).employeeId as string)
    );
    const out: Array<{ uid: string; name: string; email: string; label: string; sortKey: string }> = [];
    const seenEmp = new Set<string>();
    for (const d of usersSnap.docs) {
      const u = d.data() as { name?: unknown; email?: unknown; employeeId?: unknown; active?: unknown };
      if (u.active === false) continue;
      const name = typeof u.name === "string" ? u.name : "";
      const email = typeof u.email === "string" ? u.email : "";
      // The signature is verified by signing in with this real login email; an
      // account with no email can't be authenticated, so it can never sign.
      if (email.trim() === "") continue;
      const empId = typeof u.employeeId === "string" ? u.employeeId : null;
      if (usePlan) {
        if (!empId || !planMembers.has(empId)) continue;
        if (seenEmp.has(empId)) continue;
        seenEmp.add(empId);
      } else if (empId) {
        if (seenEmp.has(empId)) continue;
        seenEmp.add(empId);
      }
      // Prefer the LIVE employee name; fall back to the plan snapshot, then the
      // user's own name / email so an entry always has a readable label.
      const disp = empId ? displays.get(empId) ?? planSnapshot.get(empId) : undefined;
      const label = disp?.name || name || email;
      const sortKey = disp?.sortKey || label.toLowerCase();
      out.push({ uid: d.id, name, email, label, sortKey });
    }
    out.sort((a, b) => a.sortKey.localeCompare(b.sortKey, "cs"));

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

    res.json({ signers: out.map(({ sortKey, ...s }) => s), scheduled });
  }
);

/**
 * GET /api/handovers/:hotel/signers is for signing; this is for REVERTING a
 * signature — a narrower pool: the person who signed it (`?signer=<uid>`, always
 * allowed to self-unsign) plus everyone holding the per-hotel manage permission
 * (or system.admin). Returns `[{ uid, name, email, label }]` with employee-name
 * labels; `email` is the real login used to verify the un-sign.
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
    const included: Array<{ uid: string; name: string; email: string; employeeId: string | null }> = [];
    const seenEmp = new Set<string>();
    for (const d of usersSnap.docs) {
      const u = d.data() as {
        name?: unknown;
        email?: unknown;
        employeeId?: unknown;
        active?: unknown;
        roleType?: unknown;
        extraPermissions?: unknown;
        revokedPermissions?: unknown;
      };
      if (u.active === false) continue;
      const name = typeof u.name === "string" ? u.name : "";
      const email = typeof u.email === "string" ? u.email : "";
      // Un-signing also re-verifies the password, so a signer needs a real email.
      if (email.trim() === "") continue;
      let ok = d.id === signerUid; // the signer may always self-unsign
      if (!ok) {
        const perms = await resolveEffectivePermissions({
          roleType: roleTypeFromUserDoc(u),
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
      included.push({ uid: d.id, name, email, employeeId: empId });
    }

    // Resolve LIVE employee-name labels (displayName || "First Last") for the
    // (few) included users, sorted surname-first — same convention as /signers.
    const displays = await resolveEmployeeDisplays(included.map((e) => e.employeeId ?? ""));
    const out = included.map((e) => {
      const disp = e.employeeId ? displays.get(e.employeeId) : undefined;
      const label = disp?.name || e.name;
      const sortKey = disp?.sortKey || label.toLowerCase();
      return { uid: e.uid, name: e.name, email: e.email, label, sortKey };
    });
    out.sort((a, b) => a.sortKey.localeCompare(b.sortKey, "cs"));
    res.json(out.map(({ sortKey, ...s }) => s));
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
    res.json(await withLiveSignerName({ id: doc.id, ...doc.data() }));
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
      editSession?: unknown;
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
    // The previous shift's stored doc — read on create for the balance carry-over
    // AND for inheriting the locked state of the carried notes / účty (see
    // seedLockedFromPrevious). Stays null on an edit (baseUpdatedAt path).
    let prevDoc: HandoverDoc | null = null;
    if (!beforeSnap.exists) {
      const set = req.permissions ?? new Set<string>();
      const prev = previousShift(body.shiftDate, body.shiftType);
      const prevSnap = await handoverCol(hotel).doc(docId(prev.date, prev.shift)).get();
      prevDoc = prevSnap.exists ? (prevSnap.data() as HandoverDoc) : null;
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
    const incomingAccounts = sanitizeAccounts(body.accounts);
    const after = {
      shiftDate: body.shiftDate,
      shiftType: body.shiftType,
      // On edit, protect locked rows against the stored doc. On create, there is no
      // stored baseline — inherit the locked state from the previous shift so a
      // handover keeps its pinned rows locked (see seedLockedFromPrevious).
      notes: beforeSnap.exists
        ? mergeLockable<NoteRow>(before?.notes ?? [], incomingNotes, isManage)
        : seedLockedFromPrevious<NoteRow>(prevDoc?.notes ?? [], incomingNotes.filter((n) => !n.done), isManage),
      cashCounts: sanitizeCashCounts(body.cashCounts),
      accounts: beforeSnap.exists
        ? mergeLockable<AccountRow>(before?.accounts ?? [], incomingAccounts, isManage)
        : seedLockedFromPrevious<AccountRow>(prevDoc?.accounts ?? [], incomingAccounts, isManage),
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
      afterContent,
      sanitizeEditSession(body.editSession)
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
    res.json(await withLiveSignerName({ id, ...saved.data() }));
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
      type: "chain",
      shiftDate: doc.shiftDate,
      shiftType: doc.shiftType,
      actorUid: doc.predal.uid,
      actorName: await warningActorName(doc.predal),
      expectedUid: prevPrevzal.uid,
      expectedName: await warningActorName(prevPrevzal),
      createdAt: FieldValue.serverTimestamp(),
      read: false,
      readAt: null,
      readBy: null,
    });
  } else {
    await warnRef.delete().catch(() => undefined);
  }
}

/**
 * "Pozdní příchod" (late arrival) warning: the incoming receptionist (Převzal) is
 * expected by the NEXT shift's start — 19:00 for the night shift, 07:00 for the
 * day shift — so a den protocol's handover is due 19:00 the same day and a noc
 * protocol's due 07:00 the next morning. Comparison is in Europe/Prague wall-clock
 * at minute precision (07:00:59 still counts as on time). The Předal stamp is
 * irrelevant. Keyed by `${hotel}_${id}_late` so it is independent of the chain
 * warning on the same protocol; self-healing on re-sign/revert.
 */
function evaluatePrevzalLateness(
  shiftDate: string,
  shiftType: HandoverDoc["shiftType"],
  at: Timestamp
): { late: boolean; cutoffLabel: string; prevzalLabel: string } {
  // The shift the Převzal signer is taking over drives the deadline.
  const next = nextShift(shiftDate, shiftType);
  const cutoffHour = next.shift === "noc" ? 19 : 7;
  const cutoffLabel = `${String(cutoffHour).padStart(2, "0")}:00`;
  const cutoffKey = `${next.date.replace(/-/g, "")}${String(cutoffHour).padStart(2, "0")}00`;

  // Prague wall-clock parts of the signature time (hourCycle h23 → 00–23, never 24).
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at.toDate());
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "00";
  const prevzalKey = `${p("year")}${p("month")}${p("day")}${p("hour")}${p("minute")}`;
  const prevzalLabel = `${p("day")}.${p("month")}.${p("year")} ${p("hour")}:${p("minute")}`;
  return { late: prevzalKey > cutoffKey, cutoffLabel, prevzalLabel };
}

async function syncLateWarning(hotel: HotelSlug, id: string): Promise<void> {
  const warnRef = db().collection("handoverWarnings").doc(`${hotel}_${id}_late`);
  const snap = await handoverCol(hotel).doc(id).get();
  const doc = snap.exists ? (snap.data() as HandoverDoc) : null;
  const at = doc?.prevzal?.at;
  if (!doc || !doc.prevzal || !at || typeof (at as { toDate?: unknown }).toDate !== "function") {
    await warnRef.delete().catch(() => undefined);
    return;
  }
  const { late, cutoffLabel, prevzalLabel } = evaluatePrevzalLateness(doc.shiftDate, doc.shiftType, at);
  if (!late) {
    await warnRef.delete().catch(() => undefined);
    return;
  }
  await warnRef.set({
    hotel,
    handoverId: id,
    type: "late",
    shiftDate: doc.shiftDate,
    shiftType: doc.shiftType,
    actorUid: doc.prevzal.uid,
    actorName: await warningActorName(doc.prevzal),
    prevzalAt: at,
    prevzalLabel,
    cutoffLabel,
    createdAt: FieldValue.serverTimestamp(),
    read: false,
    readAt: null,
    readBy: null,
  });
}

/**
 * Resync the handover warnings a signature change affects:
 *  - chain warning: a predal change affects THIS protocol; a prevzal change the NEXT.
 *  - late-arrival warning: a prevzal change affects THIS protocol (was Převzal on time?).
 * A predal change never touches the late warning (the Předal stamp is irrelevant to it).
 */
async function resyncChainAfter(hotel: HotelSlug, doc: HandoverDoc, slot: SignatureSlot): Promise<void> {
  if (slot === "predal") {
    await syncChainWarning(hotel, docId(doc.shiftDate, doc.shiftType));
  } else {
    const next = nextShift(doc.shiftDate, doc.shiftType);
    await syncChainWarning(hotel, docId(next.date, next.shift));
    await syncLateWarning(hotel, docId(doc.shiftDate, doc.shiftType));
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
    res.json(await withLiveSignerName({ id, ...saved.data() }));
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
    res.json(await withLiveSignerName({ id, ...saved.data() }));
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
    res.json(await withLiveSignerName({ id: req.params.id, ...saved.data() }));
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
    res.json(await withLiveSignerName({ id: req.params.id, ...saved.data() }));
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
    res.json(await withLiveSignerName({ id: req.params.id, ...saved.data() }));
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
    const doc = snap.data() as HandoverDoc;
    const permSet = req.permissions ?? new Set<string>();
    const isManage = permSet.has("system.admin") || permSet.has(handoverManagePerm(hotel));
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
        applied: e.undone !== true,
      };
    });
    res.json({ entries, ...(await canUndoRedo(hotel, id, { content: contentOf(doc), isManage })) });
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
    // Lock enforcement mirrors the content PUT's mergeLockable: a non-manage caller
    // may not revert a change that touches a locked row. Rather than dead-ending on
    // such a step, undo/redo SKIP it and land on the nearest change the caller may
    // touch (findUndoTarget/findRedoTarget apply the guard). Admin/manage: no guard.
    const set = req.permissions ?? new Set<string>();
    const isManage = set.has("system.admin") || set.has(handoverManagePerm(hotel));
    const content = contentOf(before);
    const guard = { content, isManage };
    const entries = await loadHistoryEntries(hotel, id);
    const target = dir === "undo" ? findUndoTarget(entries, guard) : findRedoTarget(entries, guard);
    if (!target) {
      res.status(409).json({ error: dir === "undo" ? "Není co vrátit zpět." : "Není co obnovit." });
      return;
    }

    applyChange(content, target, dir);
    // Reflect the step in the in-memory list so the post-step availability below is
    // computed against the new state without a re-read; `content` is now post-step.
    target.undone = dir === "undo";
    await ref.update({
      notes: content.notes,
      accounts: content.accounts,
      cashCounts: content.cashCounts,
      smCounts: content.smCounts,
      histCursor: highestAppliedSeq(entries),
      updatedBy: req.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await markUndone(hotel, id, target.seq, dir === "undo");
    await writeAudit(actorCtx(await resolveRecepceActor(req, hotel, before.shiftDate, before.shiftType)), {
      action: "update",
      collection: "shiftHandovers",
      resourceId: id,
      event: dir === "undo" ? "recepce.protokol.undo" : "recepce.protokol.redo",
      extra: { hotel, shift: before.shiftType, date: before.shiftDate, label: target.label },
    });

    const saved = await ref.get();
    res.json({ id, ...saved.data(), ...computeCanStep(entries, guard) });
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
