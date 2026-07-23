/**
 * Odvody — client mirror of `functions/src/services/odvodyShared.ts`.
 *
 * The modal previews the cash-out figures live as the user types, so the rules
 * have to exist on this side too. There is no shared package between frontend
 * and functions in this project (see `lib/hotels.ts` ↔ `services/hotels.ts`),
 * so these are hand-kept mirrors: change one, change the other.
 *
 * The rules, in full:
 *   1) CZK nominals + ticked receipts = TOTAL CZK to be cashed out
 *   2) EUR nominals                   = TOTAL EUR to be cashed out
 *   3) both `depozit` items are always cashed out IN FULL
 *   4) the rest comes out of `cash` — and where a hotel has two Protel
 *      registers (Amigo & Alqush), split so that what REMAINS lands in the
 *      configured room-count ratio.
 */

export type OdvodCurrency = "CZK" | "EUR";

export const CZK_DENOMS = ["5000", "2000", "1000", "500", "200", "100", "50", "20", "10", "5", "2", "1"] as const;
export const EUR_DENOMS = ["500", "200", "100", "50", "20", "10", "5", "2", "1"] as const;

/** The name of the locked účty row an odvod writes into the protocol. */
export const ODVOD_LINE_NAME = "odvod + účty";

export interface OdvodRegister {
  key: string;
  label: string;
}

export interface ProtelValues {
  czkCash: number;
  czkDeposit: number;
  eurCash: number;
  eurDeposit: number;
}

export function emptyProtel(): ProtelValues {
  return { czkCash: 0, czkDeposit: 0, eurCash: 0, eurDeposit: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// API shapes — must match functions/src/routes/odvody.ts exactly
// ─────────────────────────────────────────────────────────────────────────────

export interface OdvodAccount {
  id: string;
  name: string;
  amount: number;
  locked: boolean;
}

export interface SavedOdvodEffect {
  shiftDate: string;
  shiftType: "den" | "noc";
  lineId: string;
  lineAmount: number;
  removedAccounts: Array<OdvodAccount & { index: number }>;
  trezorCzkTaken: Record<string, number>;
  trezorEurPending: Record<string, number>;
}

export interface SavedOdvod {
  id: string;
  month: string;
  nominalsCZK: Record<string, number>;
  nominalsEUR: Record<string, number>;
  receiptIds: string[];
  protel: Record<string, ProtelValues>;
  weights: Record<string, number>;
  eurSettled: boolean;
  eurSettledOn: { shiftDate: string; shiftType: "den" | "noc" } | null;
  effect: SavedOdvodEffect | null;
}

/** GET /api/odvody/:hotel/:month */
export interface OdvodContext {
  month: string;
  /** Last calendar day of the month — the "před uzávěrkou" deadline. */
  lastDay: string;
  registers: OdvodRegister[];
  defaultWeights: Record<string, number>;
  saved: SavedOdvod | null;
  target: {
    shiftDate: string;
    shiftType: "den" | "noc";
    exists: boolean;
    signed: boolean;
    /** Non-null → saving will fail; show it before the user types anything. */
    blocked: string | null;
  };
  /** Účty rows available for ticking (with this odvod's effect taken back). */
  accounts: OdvodAccount[];
  trezorCZK: Record<string, number>;
  trezorEUR: Record<string, number>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Money
// ─────────────────────────────────────────────────────────────────────────────

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** CZK is whole crowns; EUR keeps cents. */
export function roundMoney(n: number, currency: OdvodCurrency): number {
  if (!Number.isFinite(n)) return 0;
  return currency === "CZK" ? Math.round(n) : Math.round(n * 100) / 100;
}

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

export const czkNominalTotal = (m?: Record<string, number>) => denomTotal(m, CZK_DENOMS);
export const eurNominalTotal = (m?: Record<string, number>) => denomTotal(m, EUR_DENOMS);

/** Display helper: "12 340 Kč" / "1 250,50 €". */
export function fmtMoney(n: number, currency: OdvodCurrency): string {
  const digits = currency === "CZK" ? 0 : 2;
  const s = n.toLocaleString("cs-CZ", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return currency === "CZK" ? `${s} Kč` : `${s} €`;
}

/** Bare number, for print columns where the unit sits in the label. */
export function fmtNum(n: number, currency: OdvodCurrency): string {
  const digits = currency === "CZK" ? 0 : 2;
  return n.toLocaleString("cs-CZ", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// ─────────────────────────────────────────────────────────────────────────────
// The plan
// ─────────────────────────────────────────────────────────────────────────────

export interface RegisterPlan {
  key: string;
  label: string;
  deposit: number;
  cash: number;
  cashRemaining: number;
}

export interface CurrencyPlan {
  currency: OdvodCurrency;
  total: number;
  depositTotal: number;
  cashRemainder: number;
  registers: RegisterPlan[];
  warnings: string[];
}

export function computeCurrencyPlan(
  currency: OdvodCurrency,
  total: number,
  registers: readonly OdvodRegister[],
  protel: Record<string, ProtelValues>,
  weights: Record<string, number>
): CurrencyPlan {
  const warnings: string[] = [];
  const isCzk = currency === "CZK";
  const fmt = (n: number) => fmtMoney(n, currency);

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
      warnings.push(`V pokladnách není dost hotovosti – chybí ${fmt(Math.abs(stays))}. Zkontrolujte hodnoty z Protelu.`);
    }

    const w = registers.map((r) => {
      const raw = num(weights[r.key]);
      return raw > 0 ? raw : 0;
    });
    let weightSum = w.reduce((a, b) => a + b, 0);
    if (weightSum <= 0) {
      warnings.push("Poměr rozdělení musí být kladný alespoň u jednoho hotelu. Použit rovnoměrný poměr.");
      for (let i = 0; i < w.length; i++) w[i] = 1;
      weightSum = w.length;
    }

    // All but the last take their proportional share; the last closes the gap so
    // rounding can never leak a crown.
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

export interface OdvodPlan {
  czkNominals: number;
  eurNominals: number;
  receipts: number;
  totalCZK: number;
  totalEUR: number;
  czk: CurrencyPlan;
  eur: CurrencyPlan;
  warnings: string[];
}

export function computeOdvodPlan(args: {
  registers: readonly OdvodRegister[];
  nominalsCZK: Record<string, number>;
  nominalsEUR: Record<string, number>;
  receiptsTotal: number;
  protel: Record<string, ProtelValues>;
  weights: Record<string, number>;
}): OdvodPlan {
  const czkNominals = czkNominalTotal(args.nominalsCZK);
  const eurNominals = eurNominalTotal(args.nominalsEUR);
  const receipts = Math.round(num(args.receiptsTotal));

  const totalCZK = czkNominals + receipts;
  const totalEUR = eurNominals;

  const czk = computeCurrencyPlan("CZK", totalCZK, args.registers, args.protel, args.weights);
  const eur = computeCurrencyPlan("EUR", totalEUR, args.registers, args.protel, args.weights);

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
// Czech dates for the printed sheet
// ─────────────────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "Leden",
  "Únor",
  "Březen",
  "Duben",
  "Květen",
  "Červen",
  "Červenec",
  "Srpen",
  "Září",
  "Říjen",
  "Listopad",
  "Prosinec",
] as const;

/**
 * Weekday in the accusative (4. pád) together with its preposition, because the
 * preposition is not constant: "ve" before the consonant clusters of *středu*
 * and *čtvrtek*, "v" everywhere else. Indexed by Date#getDay() (Sunday = 0).
 */
const WEEKDAY_IN = [
  "v neděli",
  "v pondělí",
  "v úterý",
  "ve středu",
  "ve čtvrtek",
  "v pátek",
  "v sobotu",
] as const;

/** "2026-07" → "Červenec 26" — the print sheet's subtitle. */
export function monthTitle(month: string): string {
  const y = month.slice(2, 4);
  const m = Number(month.slice(5, 7));
  if (!Number.isFinite(m) || m < 1 || m > 12) return month;
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** "2026-07-31" → "v pátek 31. 07. 2026". Local-time parsing only. */
export function deadlinePhrase(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  const date = new Date(y, m - 1, d);
  const dd = String(d).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  return `${WEEKDAY_IN[date.getDay()]} ${dd}. ${mm}. ${y}`;
}

/** "2026-07" of the current month, in Prague-local terms. */
export function currentMonth(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Prague" }).format(new Date()).slice(0, 7);
}

/** Shift a "YYYY-MM" by n months. */
export function addMonths(month: string, n: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
