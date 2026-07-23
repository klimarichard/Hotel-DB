/**
 * Odvody — end-of-month cash transfer from the reception's cash register/vault
 * to the bank.
 *
 * Physically: banknotes of both currencies are taken out of the vault, the paper
 * receipts (účty) that have been entered into the accounting system are pulled
 * out of the protocol, and the whole lot is deposited. In Protel the deposit is
 * booked against four registers per hotel (CZK cash, CZK cash depozit, EUR cash,
 * EUR cash depozit).
 *
 * The four rules, straight from the business:
 *   1) CZK nominals + ticked receipts = TOTAL CZK to be cashed out
 *   2) EUR nominals                   = TOTAL EUR to be cashed out
 *   3) both `depozit` items are always cashed out IN FULL
 *   4) whatever is left over comes out of the `cash` item
 *
 * Amigo & Alqush is the awkward one: the two hotels share one physical safe but
 * keep two separate Protel registers, so rule 4 has to be split between them.
 * The split is chosen so that what REMAINS in the two cash registers afterwards
 * lands in the room-count ratio (70:24 today) — not so that the amounts taken
 * out are in that ratio. Room counts change, so the weights are editable.
 *
 * This module is pure: no Firestore reads, no request context. It is mirrored
 * on the client by `frontend/src/lib/odvody.ts` so the modal can preview the
 * same numbers live as they are typed — keep the two in sync.
 */
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { HotelSlug } from "./hotels";
import { AccountRow, ShiftType, CZK_DENOMS, EUR_DENOMS } from "./handoverShared";

export type OdvodCurrency = "CZK" | "EUR";

/** The name of the locked účty row an odvod writes into the protocol. */
export const ODVOD_LINE_NAME = "odvod + účty";

// ─────────────────────────────────────────────────────────────────────────────
// Registers
// ─────────────────────────────────────────────────────────────────────────────

/** One Protel register: four values are entered against it. */
export interface OdvodRegister {
  key: string;
  label: string;
}

/** The four values the user copies out of Protel for one register. */
export interface ProtelValues {
  czkCash: number;
  czkDeposit: number;
  eurCash: number;
  eurDeposit: number;
}

/**
 * Which Protel registers each hotel has. Every hotel has exactly one, except
 * `amigo-alqush` — a single Recepce hotel (shared cash) fronting two separate
 * Protel registers, hence eight input values instead of four.
 */
export const ODVOD_REGISTERS: Record<HotelSlug, readonly OdvodRegister[]> = {
  ambiance: [{ key: "ambiance", label: "Ambiance" }],
  superior: [{ key: "superior", label: "Superior" }],
  "amigo-alqush": [
    { key: "amigo", label: "Amigo" },
    { key: "alqush", label: "Alqush" },
  ],
  ankora: [{ key: "ankora", label: "Ankora" }],
};

/**
 * Default split weights = number of rooms per hotel. Only meaningful where a
 * hotel has more than one register; single-register hotels take the whole
 * remainder anyway, so their weight is a formality.
 */
export const DEFAULT_SPLIT_WEIGHTS: Record<HotelSlug, Record<string, number>> = {
  ambiance: { ambiance: 1 },
  superior: { superior: 1 },
  "amigo-alqush": { amigo: 70, alqush: 24 },
  ankora: { ankora: 1 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Money helpers
// ─────────────────────────────────────────────────────────────────────────────

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Smallest unit an odvod can actually hand over, per currency.
 *
 * EUR is 1, not 0.01, and that is a physical fact rather than a preference: the
 * vault holds banknotes (500…1) and no cent coins, so a cash-out figure with
 * cents could not be counted out. It matters most in the Amigo/Alqush split,
 * which would otherwise land on amounts like 1 289,36 €.
 */
const MONEY_STEP: Record<OdvodCurrency, number> = { CZK: 1, EUR: 1 };

/** Rounding is applied at every step so the printed figures always add up
 *  exactly to the totals above them. */
export function roundMoney(n: number, currency: OdvodCurrency): number {
  if (!Number.isFinite(n)) return 0;
  const step = MONEY_STEP[currency];
  return Math.round(n / step) * step;
}

/** Face value of a denomination map: Σ denom × pieces. */
export function denomTotal(map: Record<string, number> | undefined, allowed: readonly string[]): number {
  if (!map) return 0;
  let total = 0;
  for (const denom of allowed) {
    const pieces = map[denom];
    if (typeof pieces !== "number" || !Number.isFinite(pieces) || pieces <= 0) continue;
    total += Number(denom) * Math.floor(pieces);
  }
  return total;
}

export function czkNominalTotal(map: Record<string, number> | undefined): number {
  return denomTotal(map, CZK_DENOMS);
}

export function eurNominalTotal(map: Record<string, number> | undefined): number {
  return denomTotal(map, EUR_DENOMS);
}

// ─────────────────────────────────────────────────────────────────────────────
// The plan
// ─────────────────────────────────────────────────────────────────────────────

export interface RegisterPlan {
  key: string;
  label: string;
  /** Rule 3 — the Protel depozit, always cashed out in full. */
  deposit: number;
  /** Rule 4 — what this register contributes out of its Protel cash. */
  cash: number;
  /** What is left standing in this register's Protel cash afterwards. */
  cashRemaining: number;
}

export interface CurrencyPlan {
  currency: OdvodCurrency;
  /** Rules 1 & 2 — everything that has to leave for this currency. */
  total: number;
  depositTotal: number;
  /** total − depositTotal: the part rule 4 has to source from cash. */
  cashRemainder: number;
  registers: RegisterPlan[];
  /** Human-readable problems. Non-blocking: the user may know better. */
  warnings: string[];
}

/**
 * Apply rules 3 and 4 for one currency.
 *
 * Single register: it swallows the whole remainder.
 *
 * Multiple registers: solve for the leftovers rather than the withdrawals. If S
 * is what will remain across both cash registers after the odvod, then each
 * register keeps `S × wᵢ / Σw`, and therefore hands over `cashᵢ − keepᵢ`. The
 * last register absorbs the rounding residue so the parts always re-sum to S
 * exactly — and hence the withdrawals to `cashRemainder` exactly.
 */
export function computeCurrencyPlan(
  currency: OdvodCurrency,
  total: number,
  registers: readonly OdvodRegister[],
  protel: Record<string, ProtelValues>,
  weights: Record<string, number>
): CurrencyPlan {
  const warnings: string[] = [];
  const isCzk = currency === "CZK";
  const fmt = (n: number) => `${n.toLocaleString("cs-CZ")} ${isCzk ? "Kč" : "€"}`;

  const cashOf = (k: string) => roundMoney(num(isCzk ? protel[k]?.czkCash : protel[k]?.eurCash), currency);
  const depOf = (k: string) => roundMoney(num(isCzk ? protel[k]?.czkDeposit : protel[k]?.eurDeposit), currency);

  const deposits = registers.map((r) => depOf(r.key));
  const cashes = registers.map((r) => cashOf(r.key));

  const roundedTotal = roundMoney(total, currency);
  const depositTotal = roundMoney(
    deposits.reduce((a, b) => a + b, 0),
    currency
  );
  const cashRemainder = roundMoney(roundedTotal - depositTotal, currency);

  if (cashRemainder < 0) {
    warnings.push(
      `Depozity (${fmt(depositTotal)}) převyšují částku k odvodu (${fmt(roundedTotal)}). Zkontrolujte hodnoty z Protelu.`
    );
  }

  let taken: number[];
  if (registers.length <= 1) {
    taken = [cashRemainder];
  } else {
    const cashTotal = roundMoney(
      cashes.reduce((a, b) => a + b, 0),
      currency
    );
    // S — what stays across both registers once the remainder has been taken.
    const stays = roundMoney(cashTotal - cashRemainder, currency);
    if (stays < 0) {
      warnings.push(
        `V pokladnách není dost hotovosti – chybí ${fmt(Math.abs(stays))}. Zkontrolujte hodnoty z Protelu.`
      );
    }

    let weightSum = 0;
    const w = registers.map((r) => {
      const raw = num(weights[r.key]);
      return raw > 0 ? raw : 0;
    });
    weightSum = w.reduce((a, b) => a + b, 0);
    if (weightSum <= 0) {
      warnings.push("Poměr rozdělení musí být kladný alespoň u jednoho hotelu. Použit rovnoměrný poměr.");
      for (let i = 0; i < w.length; i++) w[i] = 1;
      weightSum = w.length;
    }

    // Every register but the last takes its proportional share; the last one
    // closes the gap, so rounding can never leak a crown.
    const keep: number[] = [];
    let assigned = 0;
    for (let i = 0; i < registers.length - 1; i++) {
      const k = roundMoney((stays * w[i]) / weightSum, currency);
      keep.push(k);
      assigned = roundMoney(assigned + k, currency);
    }
    keep.push(roundMoney(stays - assigned, currency));

    taken = registers.map((_, i) => roundMoney(cashes[i] - keep[i], currency));
  }

  const plan: RegisterPlan[] = registers.map((r, i) => ({
    key: r.key,
    label: r.label,
    deposit: deposits[i],
    cash: taken[i],
    cashRemaining: roundMoney(cashes[i] - taken[i], currency),
  }));

  for (let i = 0; i < plan.length; i++) {
    if (plan[i].cash < 0) {
      warnings.push(
        `${plan[i].label}: z hotovosti by se odvádělo záporně (${fmt(plan[i].cash)}). Zkontrolujte poměr a hodnoty z Protelu.`
      );
    } else if (plan[i].cash > cashes[i]) {
      warnings.push(
        `${plan[i].label}: odvod z hotovosti (${fmt(plan[i].cash)}) převyšuje stav v Protelu (${fmt(cashes[i])}).`
      );
    }
  }

  return { currency, total: roundedTotal, depositTotal, cashRemainder, registers: plan, warnings };
}

/** Both currencies at once — what the modal previews and the print renders. */
export interface OdvodPlan {
  czkNominals: number;
  eurNominals: number;
  receipts: number;
  /** Rule 1: CZK nominals + receipts. This is the locked line's amount. */
  totalCZK: number;
  /** Rule 2: EUR nominals. */
  totalEUR: number;
  czk: CurrencyPlan;
  eur: CurrencyPlan;
  warnings: string[];
}

export function computeOdvodPlan(args: {
  hotel: HotelSlug;
  nominalsCZK: Record<string, number>;
  nominalsEUR: Record<string, number>;
  receiptsTotal: number;
  protel: Record<string, ProtelValues>;
  weights: Record<string, number>;
}): OdvodPlan {
  const registers = ODVOD_REGISTERS[args.hotel];
  const czkNominals = czkNominalTotal(args.nominalsCZK);
  const eurNominals = eurNominalTotal(args.nominalsEUR);
  const receipts = Math.round(num(args.receiptsTotal));

  const totalCZK = czkNominals + receipts;
  const totalEUR = eurNominals;

  const czk = computeCurrencyPlan("CZK", totalCZK, registers, args.protel, args.weights);
  const eur = computeCurrencyPlan("EUR", totalEUR, registers, args.protel, args.weights);

  return {
    czkNominals,
    eurNominals,
    receipts,
    totalCZK,
    totalEUR,
    czk,
    eur,
    warnings: [...czk.warnings, ...eur.warnings],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistence
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Everything an applied odvod did to the protocol, recorded verbatim so it can
 * be undone exactly. This is what makes an odvod editable: re-saving reverses
 * the stored effect and applies a freshly computed one, rather than trying to
 * work out a diff against a protocol receptionists have been editing meanwhile.
 */
export interface OdvodEffect {
  /** The protocol the effect landed on (the current shift at save time). */
  shiftDate: string;
  shiftType: ShiftType;
  /** denom → pieces subtracted from `trezorCZK`, to be added back on reverse. */
  trezorCzkTaken: Record<string, number>;
  /** denom → pieces to subtract from `trezorEUR` when "Provést odvod" runs. */
  trezorEurPending: Record<string, number>;
  /** Full copies of the deleted účty rows, with their original array position. */
  removedAccounts: Array<AccountRow & { index: number }>;
  /** The locked "odvod + účty" row written into účty. */
  lineId: string;
  lineAmount: number;
  appliedAt: Timestamp;
}

export interface OdvodDoc {
  month: string;
  nominalsCZK: Record<string, number>;
  nominalsEUR: Record<string, number>;
  receiptIds: string[];
  protel: Record<string, ProtelValues>;
  weights: Record<string, number>;
  effect: OdvodEffect | null;
  /** True once the night receptionist has pressed "Provést odvod". */
  eurSettled: boolean;
  eurSettledAt?: Timestamp | null;
  eurSettledBy?: string;
  eurSettledOn?: { shiftDate: string; shiftType: ShiftType };
  createdBy?: string;
  updatedBy?: string;
  createdAt?: admin.firestore.Timestamp;
  updatedAt?: admin.firestore.Timestamp;
}

export function odvodCol(hotel: HotelSlug): admin.firestore.CollectionReference {
  return admin.firestore().collection("hotels").doc(hotel).collection("odvody");
}

// ─────────────────────────────────────────────────────────────────────────────
// Month / date helpers
// ─────────────────────────────────────────────────────────────────────────────

export function isMonthStr(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

/** "YYYY-MM-DD" → "YYYY-MM". */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** Last calendar day of a month, as "YYYY-MM-DD". Local-time arithmetic only. */
export function lastDayOfMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  // Day 0 of the following month == last day of this one.
  const d = new Date(y, m, 0);
  const dd = String(d.getDate()).padStart(2, "0");
  return `${month}-${dd}`;
}

/**
 * Is this protocol the month's closing night shift — the one that gets the
 * "Provést odvod" button? A night shift is filed under the date it STARTS, so
 * the last night of July is `2026-07-31_noc` even though it ends on 1 August.
 */
export function isLastNightOfMonth(shiftDate: string, shiftType: ShiftType): boolean {
  return shiftType === "noc" && shiftDate === lastDayOfMonth(monthOf(shiftDate));
}

// ─────────────────────────────────────────────────────────────────────────────
// Input sanitising
// ─────────────────────────────────────────────────────────────────────────────

/** Whole, positive piece counts against a known denomination list; 0 dropped. */
export function sanitizeNominals(raw: unknown, allowed: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const denom of allowed) {
    const v = (raw as Record<string, unknown>)[denom];
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) continue;
    out[denom] = Math.floor(v);
  }
  return out;
}

export function sanitizeProtel(
  raw: unknown,
  registers: readonly OdvodRegister[]
): Record<string, ProtelValues> {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Record<string, ProtelValues> = {};
  for (const r of registers) {
    const v = (src[r.key] && typeof src[r.key] === "object" ? src[r.key] : {}) as Record<string, unknown>;
    out[r.key] = {
      czkCash: roundMoney(num(v.czkCash), "CZK"),
      czkDeposit: roundMoney(num(v.czkDeposit), "CZK"),
      eurCash: roundMoney(num(v.eurCash), "EUR"),
      eurDeposit: roundMoney(num(v.eurDeposit), "EUR"),
    };
  }
  return out;
}

export function sanitizeWeights(
  raw: unknown,
  registers: readonly OdvodRegister[],
  fallback: Record<string, number>
): Record<string, number> {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const r of registers) {
    const v = src[r.key];
    out[r.key] = typeof v === "number" && Number.isFinite(v) && v > 0 ? v : num(fallback[r.key]) || 1;
  }
  return out;
}
