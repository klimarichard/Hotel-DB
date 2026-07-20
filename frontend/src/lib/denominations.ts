/**
 * Denomination helpers shared by the Recepce cash grid and the Tabulky →
 * Směnárna calculator.
 *
 * NOTE: these are the denomination LABELS only — a build-time constant, no state
 * of any kind. The two pages never share values; the Směnárna calculator
 * persists nothing and only ever READS the sm rates.
 *
 * Values are strings because they are used directly as record keys.
 */
export const CZK_DENOMS = [
  "5000", "2000", "1000", "500", "200", "100", "50", "20", "10", "5", "2", "1",
] as const;

export const EUR_DENOMS = [
  "500", "200", "100", "50", "20", "10", "5", "2", "1",
] as const;

export type CzkDenom = (typeof CZK_DENOMS)[number];

/** Σ denomination × count over a sparse count record. */
export function denomTotal(counts: Record<string, number>): number {
  let total = 0;
  for (const [denom, n] of Object.entries(counts)) {
    total += Number(denom) * (n || 0);
  }
  return total;
}

/**
 * Greedy decomposition of `amount` into CZK notes/coins.
 *
 * `available5000` caps how many 5000 notes may be used — the calculator only
 * ever spends 5000s already received from the exchange office, it never asks for
 * more. Everything below 5000 is unbounded.
 *
 * Greedy is provably minimal for CZK because the system is CANONICAL. Capping a
 * denomination breaks that guarantee in general — it survives here only because
 * the cap applies to the largest denomination and everything below it stays
 * unbounded, so after the cap the remainder is an ordinary canonical greedy run.
 * ⚠️ Cap a second denomination and this reasoning no longer holds.
 *
 * Returns a sparse record (zero counts omitted) plus the number of 5000s used,
 * so a caller distributing a shared pool can subtract what this call consumed.
 */
export function decompose(
  amount: number,
  available5000 = 0
): { counts: Record<string, number>; used5000: number } {
  const counts: Record<string, number> = {};
  let rest = Math.max(0, Math.round(amount));

  const want5000 = Math.floor(rest / 5000);
  const used5000 = Math.min(want5000, Math.max(0, Math.floor(available5000)));
  if (used5000 > 0) {
    counts["5000"] = used5000;
    rest -= used5000 * 5000;
  }

  for (const denom of CZK_DENOMS) {
    if (denom === "5000") continue;
    const value = Number(denom);
    const n = Math.floor(rest / value);
    if (n > 0) {
      counts[denom] = n;
      rest -= n * value;
    }
  }
  return { counts, used5000 };
}

export interface DecomposeRow {
  /** Caller's identifier, echoed back so results can be matched to inputs. */
  key: string;
  amount: number;
}

export interface DecomposeResult {
  key: string;
  amount: number;
  counts: Record<string, number>;
}

/**
 * Decompose several amounts that must be formed as SEPARATE physical piles from
 * one delivery, sharing a limited pool of 5000 notes.
 *
 * The pool goes to the LARGEST amounts first. Total note count is unaffected by
 * the order (each 5000 absorbed saves the same three notes wherever it lands) —
 * what largest-first buys is that the pool actually empties: small amounts
 * cannot fit a 5000 at all, so a naive top-down pass could strand notes.
 *
 * Input order is preserved in the output.
 */
export function decomposeAll(rows: DecomposeRow[], available5000 = 0): DecomposeResult[] {
  let pool = Math.max(0, Math.floor(available5000));
  const byLargest = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => b.row.amount - a.row.amount);

  const out = new Array<DecomposeResult>(rows.length);
  for (const { row, index } of byLargest) {
    const { counts, used5000 } = decompose(row.amount, pool);
    pool -= used5000;
    out[index] = { key: row.key, amount: row.amount, counts };
  }
  return out;
}

/** Per-denomination sum across several decompositions. */
export function sumCounts(results: { counts: Record<string, number> }[]): Record<string, number> {
  const total: Record<string, number> = {};
  for (const r of results) {
    for (const [denom, n] of Object.entries(r.counts)) {
      total[denom] = (total[denom] ?? 0) + n;
    }
  }
  return total;
}
