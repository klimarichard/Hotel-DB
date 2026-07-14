/**
 * Czech noun agreement after a numeral.
 *
 * Czech has three forms, not two:
 *   1        → singular nominative   ("1 strana" / "má 1 stranu")
 *   2, 3, 4  → nominative plural     ("3 strany")
 *   0, 5+    → genitive plural       ("5 stran", "0 stran")
 *
 * Writing `${n} stran` unconditionally is wrong for every n in 1..4, which is
 * exactly the range that shows up most (a 3-page scan).
 *
 * Note this is the rule for the numerals themselves; 11-14 take the genitive
 * plural ("11 stran") because the rule keys off the whole number, not its last
 * digit. Values above 4 all behave the same, so no special case is needed.
 */
export function pluralCz(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n >= 2 && n <= 4) return few;
  return many;
}

/** "1 stranu" / "3 strany" / "5 stran" — the accusative used after "Dokument má …". */
export function pagesAccusative(n: number): string {
  return `${n} ${pluralCz(n, "stranu", "strany", "stran")}`;
}

/** "strana" / "strany" — the label preceding a page number or range. */
export function pageWord(n: number): string {
  return pluralCz(n, "strana", "strany", "strany");
}
