/**
 * Odvody — end-of-month transfer of reception cash to the bank.
 *
 * The business rules live in services/odvodyShared.ts. This file is the plumbing
 * plus the one genuinely delicate part: what an odvod DOES to the předávací
 * protokol, and how that is taken back.
 *
 * ── What saving an odvod does to the protocol ────────────────────────────────
 * The banknotes physically leave the vault and the paper receipts are filed into
 * the accounting system, so both disappear from the protocol and are replaced by
 * a single locked "odvod + účty" row worth exactly their sum:
 *
 *     trezorCZK  −= the CZK nominals counted out
 *     účty       −= the ticked receipt rows
 *     účty       += 🔒 "odvod + účty"  =  CZK nominals + ticked receipts
 *
 * Note what that preserves: the protocol's TOTAL CZK (kasa + trezor + účty) is
 * unchanged. The money has only moved from "banknotes and paper" into a single
 * claim, because it has not left the building yet — it leaves at month end.
 *
 * EUR is different: the notes stay in the vault until the closing night shift,
 * when "Provést odvod" deletes the locked row and subtracts the EUR nominals.
 * THAT is the point where both currencies actually leave, and the totals drop.
 *
 * ── Why the effect is recorded verbatim ──────────────────────────────────────
 * An odvod is editable. Rather than recompute a diff against a protocol that
 * receptionists have been editing meanwhile — the classic way to corrupt cash
 * figures — every save stores an `OdvodEffect`: which denominations were taken,
 * the full JSON of every receipt row deleted, and the id of the row created.
 * Re-saving REVERSES that stored effect and applies a freshly computed one, both
 * inside one transaction. Reversal refuses outright if the protocol no longer
 * looks the way the effect says it left it (see `reverseEffect`).
 *
 * ── Why odvod writes bypass the protocol's history/undo stack ────────────────
 * Same reason sm-transfer and wata do (see handoverHistory.ts): an odvod's
 * effect on the protocol is one half of a two-document invariant. Letting a user
 * undo the trezor subtraction on its own would desynchronise the protocol from
 * the odvod record that says the money is gone. Odvody are audited instead.
 */
import { Router, Response, NextFunction } from "express";
import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { ctxFromReq, writeAudit } from "../services/auditLog";
import {
  isHotelSlug,
  HotelSlug,
  odvodyManagePerm,
  handoverEditPerm,
  handoverManagePerm,
} from "../services/hotels";
import {
  AccountRow,
  HandoverDoc,
  ShiftType,
  DrawerKey,
  CZK_DENOMS,
  EUR_DENOMS,
  docId,
  handoverCol,
  previousShift,
  isShiftDate,
  isShiftType,
} from "../services/handoverShared";
import {
  OdvodDoc,
  OdvodEffect,
  ODVOD_LINE_NAME,
  ODVOD_REGISTERS,
  DEFAULT_SPLIT_WEIGHTS,
  computeOdvodPlan,
  allocateFromDrawers,
  allocationTotal,
  normalizeEffect,
  czkNominalTotal,
  isMonthStr,
  monthOf,
  lastDayOfMonth,
  isLastNightOfMonth,
  odvodCol,
  sanitizeNominals,
  sanitizeProtel,
  sanitizeWeights,
} from "../services/odvodyShared";
import * as clock from "../services/clock";

export const odvodyRouter = Router();

const db = () => admin.firestore();

/** Validates the :hotel URL segment. Rejects unknown slugs with 404. */
function validateHotelParam(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!isHotelSlug(req.params.hotel)) {
    res.status(404).json({ error: "Neznámý hotel." });
    return;
  }
  next();
}

/**
 * Dynamic per-hotel gate for preparing an odvod. There is no separate view
 * right: the whole feature is one button inside the protocol, shown only to
 * holders of `recepce.<stem>.odvody.manage`, so reading and writing carry the
 * same permission.
 */
function requireOdvodyManage(req: AuthRequest, res: Response, next: NextFunction): void {
  const hotel = req.params.hotel as HotelSlug;
  const set = req.permissions ?? new Set<string>();
  if (set.has("system.admin") || set.has(odvodyManagePerm(hotel))) {
    next();
    return;
  }
  res.status(403).json({ error: "Nemáte oprávnění k této akci." });
}

/**
 * Gate for the two protocol-side endpoints (`pending`, `settle-eur`). The person
 * pressing "Provést odvod" is the receptionist on the closing night shift, so
 * this is the ordinary protocol-edit right — NOT odvody.manage, which the desk
 * staff do not have.
 */
function requireProtokolEdit(req: AuthRequest, res: Response, next: NextFunction): void {
  const hotel = req.params.hotel as HotelSlug;
  const set = req.permissions ?? new Set<string>();
  if (set.has("system.admin") || set.has(handoverEditPerm(hotel)) || set.has(handoverManagePerm(hotel))) {
    next();
    return;
  }
  res.status(403).json({ error: "Nemáte oprávnění k této akci." });
}

function isAdmin(req: AuthRequest): boolean {
  return (req.permissions ?? new Set<string>()).has("system.admin");
}

// ─────────────────────────────────────────────────────────────────────────────
// The protocol content an odvod touches
// ─────────────────────────────────────────────────────────────────────────────

interface ProtoContent {
  cashCounts: Record<DrawerKey, Record<string, number>>;
  accounts: AccountRow[];
}

function emptyCash(): Record<DrawerKey, Record<string, number>> {
  return { kasaCZK: {}, trezorCZK: {}, kasaEUR: {}, trezorEUR: {} };
}

function contentOf(doc: HandoverDoc | undefined): ProtoContent {
  return {
    cashCounts: {
      kasaCZK: { ...(doc?.cashCounts?.kasaCZK ?? {}) },
      trezorCZK: { ...(doc?.cashCounts?.trezorCZK ?? {}) },
      kasaEUR: { ...(doc?.cashCounts?.kasaEUR ?? {}) },
      trezorEUR: { ...(doc?.cashCounts?.trezorEUR ?? {}) },
    },
    accounts: (doc?.accounts ?? []).map((a) => ({ ...a })),
  };
}

/** Add pieces to a drawer. A denomination that falls to 0 is dropped, matching
 *  the protocol's own sparse-map convention (see sanitizeDenomMap). */
function addPieces(drawer: Record<string, number>, delta: Record<string, number>, sign: 1 | -1): void {
  for (const [denom, pieces] of Object.entries(delta)) {
    if (!Number.isFinite(pieces) || pieces <= 0) continue;
    const next = (drawer[denom] ?? 0) + sign * Math.floor(pieces);
    if (next > 0) drawer[denom] = next;
    else delete drawer[denom];
  }
}

/**
 * Undo a previously applied effect. Deliberately strict: if the protocol no
 * longer carries the locked row this effect created, we do NOT credit the
 * banknotes back — someone has taken the protocol somewhere we cannot reason
 * about, and silently adding cash to a vault count is precisely the kind of
 * "helpful" write that corrupts money. Refuse and let a human look.
 */
function reverseEffect(
  content: ProtoContent,
  stored: OdvodEffect
): { error: string } | { content: ProtoContent } {
  // Upgrade the legacy shape HERE rather than trusting each caller to do it.
  // This is the only function that reads the per-drawer allocations, so owning
  // the invariant in one place is what makes it hold: a call site that forgot
  // crashed on a pre-till document with "Cannot read properties of undefined".
  const effect = normalizeEffect(stored);
  if (!effect) return { error: "Odvod nemá zaznamenaný zápis do protokolu." };

  const idx = content.accounts.findIndex((a) => a.id === effect.lineId);
  if (idx === -1) {
    return {
      error:
        `Řádek "${ODVOD_LINE_NAME}" už v protokolu není, takže předchozí odvod nelze bezpečně vrátit. ` +
        `Zkontrolujte protokol ${effect.shiftDate} (${effect.shiftType === "noc" ? "noční" : "denní"}) ručně.`,
    };
  }

  const accounts = content.accounts.filter((_, i) => i !== idx);
  // Put the deleted receipts back where they were. Ascending index order so each
  // splice lands at the position it originally occupied.
  const restored = [...effect.removedAccounts].sort((a, b) => a.index - b.index);
  for (const row of restored) {
    const { index, ...acc } = row;
    accounts.splice(Math.min(Math.max(index, 0), accounts.length), 0, acc);
  }

  const cashCounts = {
    kasaCZK: { ...content.cashCounts.kasaCZK },
    trezorCZK: { ...content.cashCounts.trezorCZK },
    kasaEUR: { ...content.cashCounts.kasaEUR },
    trezorEUR: { ...content.cashCounts.trezorEUR },
  };
  // Each note goes back to the drawer it came out of, which is exactly why the
  // allocation is stored per drawer rather than as one total.
  addPieces(cashCounts.trezorCZK, effect.czkTaken.trezor, +1);
  addPieces(cashCounts.kasaCZK, effect.czkTaken.kasa, +1);

  return { content: { cashCounts, accounts } };
}

/**
 * Take the counted banknotes out of the vault, pull the ticked receipts, and
 * leave the single locked row behind. Fails if the vault does not actually hold
 * the notes being counted out, or if a ticked receipt has vanished.
 */
function applyEffect(
  content: ProtoContent,
  args: {
    shiftDate: string;
    shiftType: ShiftType;
    nominalsCZK: Record<string, number>;
    nominalsEUR: Record<string, number>;
    receiptIds: string[];
    lineId: string;
  }
): { error: string } | { content: ProtoContent; effect: OdvodEffect; receiptsTotal: number } {
  // Vault first, till for whatever the vault cannot cover.
  const czk = allocateFromDrawers(args.nominalsCZK, content.cashCounts.trezorCZK, content.cashCounts.kasaCZK);
  if ("denom" in czk) {
    return {
      error:
        `Není dost bankovek ${czk.denom} Kč – k odvodu ${czk.requested} ks, ` +
        `v protokolu ${czk.trezorHas} ks v trezoru a ${czk.kasaHas} ks v kase.`,
    };
  }
  const eur = allocateFromDrawers(args.nominalsEUR, content.cashCounts.trezorEUR, content.cashCounts.kasaEUR);
  if ("denom" in eur) {
    return {
      error:
        `Není dost bankovek ${eur.denom} € – k odvodu ${eur.requested} ks, ` +
        `v protokolu ${eur.trezorHas} ks v trezoru a ${eur.kasaHas} ks v kase.`,
    };
  }

  const wanted = new Set(args.receiptIds);
  const removed: Array<AccountRow & { index: number }> = [];
  const kept: AccountRow[] = [];
  content.accounts.forEach((acc, index) => {
    if (acc.id && wanted.has(acc.id)) removed.push({ ...acc, index });
    else kept.push(acc);
  });
  if (removed.length !== wanted.size) {
    return { error: "Některý ze zaškrtnutých účtů už v protokolu není. Načtěte odvod znovu." };
  }

  const receiptsTotal = removed.reduce((sum, r) => sum + Math.round(r.amount || 0), 0);
  const lineAmount = czkNominalTotal(args.nominalsCZK) + receiptsTotal;

  // Only CZK moves now. The EUR allocation is recorded but not applied: those
  // notes stay put until "Provést odvod" on the closing night shift.
  const trezorCZK = { ...content.cashCounts.trezorCZK };
  const kasaCZK = { ...content.cashCounts.kasaCZK };
  addPieces(trezorCZK, czk.alloc.trezor, -1);
  addPieces(kasaCZK, czk.alloc.kasa, -1);
  kept.push({ id: args.lineId, name: ODVOD_LINE_NAME, amount: lineAmount, locked: true });

  return {
    content: { cashCounts: { ...content.cashCounts, trezorCZK, kasaCZK }, accounts: kept },
    effect: {
      shiftDate: args.shiftDate,
      shiftType: args.shiftType,
      czkTaken: czk.alloc,
      eurPending: eur.alloc,
      removedAccounts: removed,
      lineId: args.lineId,
      lineAmount,
      appliedAt: Timestamp.now(),
    },
    receiptsTotal,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Target protocol resolution
// ─────────────────────────────────────────────────────────────────────────────

/** Prague-local calendar day — the protocol's own day boundary. */
function todayPrague(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Prague" }).format(clock.now());
}

/** Prague-local hour, for the den/noc split (den = 07:00–18:59). */
function hourPrague(): number {
  const h = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Prague",
    hour: "2-digit",
    hour12: false,
  }).format(clock.now());
  return Number(h);
}

/** The shift happening right now — mirrors the client's defaultShiftForNow(). */
function currentShift(): { shiftDate: string; shiftType: ShiftType } {
  const h = hourPrague();
  return { shiftDate: todayPrague(), shiftType: h >= 7 && h < 19 ? "den" : "noc" };
}

interface TargetState {
  shiftDate: string;
  shiftType: ShiftType;
  exists: boolean;
  signed: boolean;
  /** Non-null when the odvod cannot be saved onto this protocol as things stand. */
  blocked: string | null;
  doc: HandoverDoc | undefined;
  prevDoc: HandoverDoc | undefined;
}

/**
 * Resolve the protocol an odvod will be written onto, and say up front whether
 * that is going to work — so the modal can warn before the user types anything.
 *
 * If the current shift has no protocol yet we will create it, seeded from the
 * previous shift exactly as the "další směna" button does. But only when the
 * previous shift is finished (both signatures) or absent: snapshotting a shift
 * that is still being edited would freeze a half-written handover, and the
 * receptionist's own "další směna" button would then silently open our stale
 * copy instead of carrying their final figures across.
 */
async function resolveTarget(hotel: HotelSlug): Promise<TargetState> {
  const cur = currentShift();
  const prev = previousShift(cur.shiftDate, cur.shiftType);
  const [snap, prevSnap] = await db().getAll(
    handoverCol(hotel).doc(docId(cur.shiftDate, cur.shiftType)),
    handoverCol(hotel).doc(docId(prev.date, prev.shift))
  );
  const doc = snap.exists ? (snap.data() as HandoverDoc) : undefined;
  const prevDoc = prevSnap.exists ? (prevSnap.data() as HandoverDoc) : undefined;

  let blocked: string | null = null;
  if (!doc && prevDoc && !(prevDoc.predal && prevDoc.prevzal)) {
    blocked =
      `Protokol pro aktuální směnu (${cur.shiftDate}, ${cur.shiftType === "noc" ? "noční" : "denní"}) ` +
      `zatím neexistuje a předchozí směna není podepsaná. Nechte směnu předat, nebo protokol založte ` +
      `v Předávacím protokolu, a odvod uložte potom.`;
  }

  return {
    shiftDate: cur.shiftDate,
    shiftType: cur.shiftType,
    exists: !!doc,
    signed: !!(doc?.predal || doc?.prevzal),
    blocked,
    doc,
    prevDoc,
  };
}

/** The content a freshly created protocol starts from — the previous shift's
 *  cash and účty, exactly as createNextShift on the client carries them. */
function seedContent(prevDoc: HandoverDoc | undefined): ProtoContent {
  if (!prevDoc) return { cashCounts: emptyCash(), accounts: [] };
  return contentOf(prevDoc);
}

function serializeOdvod(id: string, d: OdvodDoc): Record<string, unknown> {
  const effect = normalizeEffect(d.effect);
  return {
    id,
    month: d.month,
    nominalsCZK: d.nominalsCZK ?? {},
    nominalsEUR: d.nominalsEUR ?? {},
    receiptIds: d.receiptIds ?? [],
    protel: d.protel ?? {},
    weights: d.weights ?? {},
    eurSettled: !!d.eurSettled,
    eurSettledOn: d.eurSettledOn ?? null,
    effect: effect
      ? {
          shiftDate: effect.shiftDate,
          shiftType: effect.shiftType,
          lineId: effect.lineId,
          lineAmount: effect.lineAmount,
          removedAccounts: effect.removedAccounts,
          czkTaken: effect.czkTaken,
          eurPending: effect.eurPending,
        }
      : null,
  };
}

odvodyRouter.use("/:hotel", validateHotelParam);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/odvody/:hotel/pending?date=YYYY-MM-DD&shift=den|noc
// Is this protocol the closing night shift of a month that has an unsettled
// odvod waiting? Drives the "Provést odvod" button in the protocol's Účty table.
// Registered BEFORE /:hotel/:month so "pending" is not read as a month.
// ─────────────────────────────────────────────────────────────────────────────
odvodyRouter.get(
  "/:hotel/pending",
  requireAuth,
  requireProtokolEdit,
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const date = isShiftDate(req.query.date) ? (req.query.date as string) : "";
    const shift = isShiftType(req.query.shift) ? (req.query.shift as ShiftType) : null;
    if (!date || !shift || !isLastNightOfMonth(date, shift)) {
      res.json({ pending: null });
      return;
    }

    const month = monthOf(date);
    const snap = await odvodCol(hotel).doc(month).get();
    if (!snap.exists) {
      res.json({ pending: null });
      return;
    }
    const d = snap.data() as OdvodDoc;
    const eff = normalizeEffect(d.effect);
    if (!eff || d.eurSettled) {
      res.json({ pending: null });
      return;
    }
    res.json({
      pending: {
        month,
        lineId: eff.lineId,
        lineAmount: eff.lineAmount,
        eurTotal: allocationTotal(eff.eurPending, EUR_DENOMS),
      },
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/odvody/:hotel/settle-eur  { shiftDate, shiftType }
// "Provést odvod" — the money physically leaves. Deletes the locked row and
// subtracts the EUR nominals from trezorEUR on the closing night shift.
// ─────────────────────────────────────────────────────────────────────────────
odvodyRouter.post(
  "/:hotel/settle-eur",
  requireAuth,
  requireProtokolEdit,
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!isShiftDate(body.shiftDate) || !isShiftType(body.shiftType)) {
      res.status(400).json({ error: "Neplatná směna." });
      return;
    }
    const shiftDate = body.shiftDate as string;
    const shiftType = body.shiftType as ShiftType;
    if (!isLastNightOfMonth(shiftDate, shiftType)) {
      res.status(400).json({ error: "Odvod lze provést jen na poslední noční směně v měsíci." });
      return;
    }
    const month = monthOf(shiftDate);
    const admin_ = isAdmin(req);

    try {
      const result = await db().runTransaction(async (tx) => {
        const odvodRef = odvodCol(hotel).doc(month);
        const protoRef = handoverCol(hotel).doc(docId(shiftDate, shiftType));
        const [odvodSnap, protoSnap] = await tx.getAll(odvodRef, protoRef);

        if (!odvodSnap.exists) throw new Error("Pro tento měsíc není uložen žádný odvod.");
        const odvod = odvodSnap.data() as OdvodDoc;
        const effect = normalizeEffect(odvod.effect);
        if (!effect) throw new Error("Odvod není zapsán do protokolu.");
        if (odvod.eurSettled) throw new Error("Odvod už byl proveden.");
        if (!protoSnap.exists) throw new Error("Protokol pro tuto směnu neexistuje.");

        const doc = protoSnap.data() as HandoverDoc;
        if ((doc.predal || doc.prevzal) && !admin_) {
          throw new Error("Podepsaný protokol nelze upravit. Nejprve zrušte podpis.");
        }

        const content = contentOf(doc);
        const idx = content.accounts.findIndex((a) => a.id === effect.lineId);
        if (idx === -1) {
          throw new Error(`Řádek "${ODVOD_LINE_NAME}" v tomto protokolu není – zkontrolujte protokol ručně.`);
        }

        // Re-check availability now, per drawer: the notes were only earmarked
        // when the odvod was prepared, and the shifts since then could have
        // spent them. Each drawer must still hold what was booked against it.
        const pending = effect.eurPending;
        for (const [drawer, pieces] of [
          ["trezorEUR", pending.trezor] as const,
          ["kasaEUR", pending.kasa] as const,
        ]) {
          for (const [denom, want] of Object.entries(pieces)) {
            const have = content.cashCounts[drawer as DrawerKey][denom] ?? 0;
            if (want > have) {
              throw new Error(
                `V ${drawer === "trezorEUR" ? "trezoru" : "kase"} EUR není dost bankovek ${denom} € – ` +
                  `k odvodu ${want} ks, v protokolu ${have} ks.`
              );
            }
          }
        }

        const trezorEUR = { ...content.cashCounts.trezorEUR };
        const kasaEUR = { ...content.cashCounts.kasaEUR };
        addPieces(trezorEUR, pending.trezor, -1);
        addPieces(kasaEUR, pending.kasa, -1);

        tx.update(protoRef, {
          accounts: content.accounts.filter((_, i) => i !== idx),
          cashCounts: { ...content.cashCounts, trezorEUR, kasaEUR },
          updatedBy: req.uid,
          updatedAt: FieldValue.serverTimestamp(),
        });
        tx.update(odvodRef, {
          eurSettled: true,
          eurSettledAt: FieldValue.serverTimestamp(),
          eurSettledBy: req.uid,
          eurSettledOn: { shiftDate, shiftType },
          updatedAt: FieldValue.serverTimestamp(),
        });

        return { lineAmount: effect.lineAmount, eurTotal: allocationTotal(pending, EUR_DENOMS) };
      });

      await writeAudit(ctxFromReq(req), {
        action: "update",
        collection: "odvody",
        resourceId: month,
        event: "recepce.odvod.settle",
        extra: { hotel, month, shiftDate, shiftType, czk: result.lineAmount, eur: result.eurTotal },
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Odvod se nepodařilo provést." });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/odvody/:hotel/:month
// Everything the modal needs: the saved odvod, the registers to fill in, and the
// target protocol's účty + vault counts AS THEY WOULD BE with any previously
// saved effect taken back — so re-opening a saved odvod shows the receipts still
// tickable and the banknotes still countable.
// ─────────────────────────────────────────────────────────────────────────────
odvodyRouter.get(
  "/:hotel/:month",
  requireAuth,
  requireOdvodyManage,
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const month = req.params.month;
    if (!isMonthStr(month)) {
      res.status(400).json({ error: "Neplatný měsíc (YYYY-MM)." });
      return;
    }

    const [odvodSnap, target] = await Promise.all([odvodCol(hotel).doc(month).get(), resolveTarget(hotel)]);
    const saved = odvodSnap.exists ? (odvodSnap.data() as OdvodDoc) : null;

    // The pool to choose from = the target protocol (or what a new one would be
    // seeded with), minus any effect this odvod already applied.
    let content = target.exists ? contentOf(target.doc) : seedContent(target.prevDoc);
    let reverseError: string | null = null;
    if (saved?.effect && !saved.eurSettled) {
      const rev = reverseEffect(content, saved.effect);
      if ("error" in rev) reverseError = rev.error;
      else content = rev.content;
    }

    res.json({
      month,
      lastDay: lastDayOfMonth(month),
      registers: ODVOD_REGISTERS[hotel],
      defaultWeights: DEFAULT_SPLIT_WEIGHTS[hotel],
      saved: saved ? serializeOdvod(month, saved) : null,
      target: {
        shiftDate: target.shiftDate,
        shiftType: target.shiftType,
        exists: target.exists,
        signed: target.signed,
        blocked: target.blocked ?? reverseError,
      },
      accounts: content.accounts
        .filter((a) => a.id)
        .map((a) => ({ id: a.id as string, name: a.name, amount: a.amount, locked: !!a.locked })),
      // All four drawers: the vault is the normal source, but a denomination it
      // cannot cover is taken from the till, so the modal has to show both.
      drawers: {
        trezorCZK: content.cashCounts.trezorCZK,
        kasaCZK: content.cashCounts.kasaCZK,
        trezorEUR: content.cashCounts.trezorEUR,
        kasaEUR: content.cashCounts.kasaEUR,
      },
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/odvody/:hotel/:month
// Save (or re-save) the month's odvod: reverse the stored effect, apply the new
// one, write both documents — all in one transaction.
// ─────────────────────────────────────────────────────────────────────────────
odvodyRouter.put(
  "/:hotel/:month",
  requireAuth,
  requireOdvodyManage,
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const month = req.params.month;
    if (!isMonthStr(month)) {
      res.status(400).json({ error: "Neplatný měsíc (YYYY-MM)." });
      return;
    }

    const registers = ODVOD_REGISTERS[hotel];
    const body = (req.body ?? {}) as Record<string, unknown>;
    const nominalsCZK = sanitizeNominals(body.nominalsCZK, CZK_DENOMS);
    const nominalsEUR = sanitizeNominals(body.nominalsEUR, EUR_DENOMS);
    const receiptIds = Array.isArray(body.receiptIds)
      ? Array.from(new Set(body.receiptIds.filter((x): x is string => typeof x === "string" && x !== "")))
      : [];
    const protel = sanitizeProtel(body.protel, registers);
    const weights = sanitizeWeights(body.weights, registers, DEFAULT_SPLIT_WEIGHTS[hotel]);

    const target = await resolveTarget(hotel);
    if (target.blocked) {
      res.status(409).json({ error: target.blocked });
      return;
    }

    try {
      const result = await db().runTransaction(async (tx) => {
        const odvodRef = odvodCol(hotel).doc(month);
        const protoRef = handoverCol(hotel).doc(docId(target.shiftDate, target.shiftType));
        const prev = previousShift(target.shiftDate, target.shiftType);
        const prevRef = handoverCol(hotel).doc(docId(prev.date, prev.shift));
        const [odvodSnap, protoSnap, prevSnap] = await tx.getAll(odvodRef, protoRef, prevRef);

        const existing = odvodSnap.exists ? (odvodSnap.data() as OdvodDoc) : null;
        if (existing?.eurSettled) {
          throw new Error(
            "Tento odvod už byl proveden – peníze fyzicky odešly, takže ho nelze měnit. " +
              "Případnou opravu proveďte přímo v protokolu."
          );
        }

        const protoDoc = protoSnap.exists ? (protoSnap.data() as HandoverDoc) : undefined;
        const prevDoc = prevSnap.exists ? (prevSnap.data() as HandoverDoc) : undefined;

        // Re-check the freeze inside the transaction. odvody.manage deliberately
        // overrides it (an odvod is a privileged month-end operation), but the
        // override is audited below so a rewritten signed protocol is traceable.
        const wasSigned = !!(protoDoc?.predal || protoDoc?.prevzal);

        let content = protoDoc ? contentOf(protoDoc) : seedContent(prevDoc);
        const existingEffect = normalizeEffect(existing?.effect);
        if (existingEffect) {
          const rev = reverseEffect(content, existingEffect);
          if ("error" in rev) throw new Error(rev.error);
          content = rev.content;
        }

        const lineId = existingEffect?.lineId ?? odvodRef.id + "-" + Date.now().toString(36);
        const applied = applyEffect(content, {
          shiftDate: target.shiftDate,
          shiftType: target.shiftType,
          nominalsCZK,
          nominalsEUR,
          receiptIds,
          lineId,
        });
        if ("error" in applied) throw new Error(applied.error);

        const plan = computeOdvodPlan({
          hotel,
          nominalsCZK,
          nominalsEUR,
          receiptsTotal: applied.receiptsTotal,
          protel,
          weights,
        });

        if (protoSnap.exists) {
          tx.update(protoRef, {
            accounts: applied.content.accounts,
            cashCounts: applied.content.cashCounts,
            updatedBy: req.uid,
            updatedAt: FieldValue.serverTimestamp(),
          });
        } else {
          // Create the current shift's protocol, carrying the previous shift's
          // balances exactly as the client's "další směna" button does. Only
          // reached when the previous shift is closed or absent (resolveTarget).
          tx.set(protoRef, {
            shiftDate: target.shiftDate,
            shiftType: target.shiftType,
            notes: (prevDoc?.notes ?? []).filter((n) => !n.done),
            accounts: applied.content.accounts,
            cashCounts: applied.content.cashCounts,
            smCounts: prevDoc?.smCounts ?? [0, 0, 0],
            smTrezor: typeof prevDoc?.smTrezor === "number" ? prevDoc.smTrezor : 0,
            wata: typeof prevDoc?.wata === "number" ? prevDoc.wata : 0,
            histSeq: 0,
            histCursor: 0,
            createdBy: req.uid,
            createdAt: FieldValue.serverTimestamp(),
            updatedBy: req.uid,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }

        const doc: Partial<OdvodDoc> = {
          month,
          nominalsCZK,
          nominalsEUR,
          receiptIds,
          protel,
          weights,
          effect: applied.effect,
          eurSettled: false,
          updatedBy: req.uid,
        };
        if (odvodSnap.exists) {
          tx.update(odvodRef, { ...doc, updatedAt: FieldValue.serverTimestamp() });
        } else {
          tx.set(odvodRef, {
            ...doc,
            createdBy: req.uid,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }

        return { plan, effect: applied.effect, created: !protoSnap.exists, wasSigned, isUpdate: odvodSnap.exists };
      });

      await writeAudit(ctxFromReq(req), {
        action: result.isUpdate ? "update" : "create",
        collection: "odvody",
        resourceId: month,
        event: "recepce.odvod.save",
        extra: {
          hotel,
          month,
          shiftDate: target.shiftDate,
          shiftType: target.shiftType,
          totalCZK: result.plan.totalCZK,
          totalEUR: result.plan.totalEUR,
          receipts: result.effect.removedAccounts.length,
          protokolCreated: result.created,
          // Flagged explicitly: odvody.manage is allowed to rewrite a protocol
          // that has already been signed off.
          overrodeSignature: result.wasSigned,
        },
      });

      res.json({ ok: true, plan: result.plan, target: { shiftDate: target.shiftDate, shiftType: target.shiftType } });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Odvod se nepodařilo uložit." });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/odvody/:hotel/:month — take the effect back and drop the record.
// ─────────────────────────────────────────────────────────────────────────────
odvodyRouter.delete(
  "/:hotel/:month",
  requireAuth,
  requireOdvodyManage,
  async (req: AuthRequest, res: Response) => {
    const hotel = req.params.hotel as HotelSlug;
    const month = req.params.month;
    if (!isMonthStr(month)) {
      res.status(400).json({ error: "Neplatný měsíc (YYYY-MM)." });
      return;
    }
    const target = await resolveTarget(hotel);

    try {
      await db().runTransaction(async (tx) => {
        const odvodRef = odvodCol(hotel).doc(month);
        const protoRef = handoverCol(hotel).doc(docId(target.shiftDate, target.shiftType));
        const [odvodSnap, protoSnap] = await tx.getAll(odvodRef, protoRef);

        if (!odvodSnap.exists) throw new Error("Pro tento měsíc není uložen žádný odvod.");
        const existing = odvodSnap.data() as OdvodDoc;
        if (existing.eurSettled) {
          throw new Error("Provedený odvod nelze smazat – peníze už fyzicky odešly.");
        }

        const existingEffect = normalizeEffect(existing.effect);
        if (existingEffect) {
          if (!protoSnap.exists) throw new Error("Protokol pro aktuální směnu neexistuje.");
          const rev = reverseEffect(contentOf(protoSnap.data() as HandoverDoc), existingEffect);
          if ("error" in rev) throw new Error(rev.error);
          tx.update(protoRef, {
            accounts: rev.content.accounts,
            cashCounts: rev.content.cashCounts,
            updatedBy: req.uid,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
        tx.delete(odvodRef);
      });

      await writeAudit(ctxFromReq(req), {
        action: "delete",
        collection: "odvody",
        resourceId: month,
        event: "recepce.odvod.delete",
        extra: { hotel, month, shiftDate: target.shiftDate, shiftType: target.shiftType },
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Odvod se nepodařilo smazat." });
    }
  }
);
