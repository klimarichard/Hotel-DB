/**
 * Weekend / Czech-public-holiday tests for plain ISO dates.
 *
 * The holiday list itself is NOT redefined here — it comes from
 * `getCzechHolidays` in shiftConstants (fixed holidays + Easter-derived Good
 * Friday and Easter Monday), which is the app's single source of truth and is
 * already what the shift grid shades. This module only asks the question that
 * several screens need: "is this date a non-working day?"
 */
import { getCzechHolidays } from "./shiftConstants";

/** Split an ISO YYYY-MM-DD into numbers, or null when it isn't one. */
function parts(iso: string): { y: number; m: number; d: number } | null {
  const p = iso.split("-");
  if (p.length !== 3) return null;
  const [y, m, d] = p.map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

/**
 * Whether an ISO date (YYYY-MM-DD) falls on a Saturday or Sunday.
 *
 * Builds the Date with `new Date(y, m-1, d)` — LOCAL time. `new Date(iso)`
 * would parse a date-only string as UTC, which in UTC+2 resolves to the
 * previous day and could report the wrong weekday (see the date-arithmetic
 * note in CLAUDE.md).
 */
export function isWeekend(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const p = parts(iso);
  if (!p) return false;
  const day = new Date(p.y, p.m - 1, p.d).getDay();
  return day === 0 || day === 6;
}

/** Whether an ISO date (YYYY-MM-DD) is a Czech public holiday. */
export function isCzechHoliday(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const p = parts(iso);
  if (!p) return false;
  // Re-pad rather than trusting the input's shape: getCzechHolidays keys are
  // zero-padded ("2026-07-05"), so an unpadded "2026-7-5" would silently miss.
  const key = `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
  return getCzechHolidays(p.y).has(key);
}

/**
 * Whether an ISO date is a non-working day: a weekend OR a Czech public
 * holiday. Empty / unparseable input is false — an absent date is not a
 * problem worth warning about, and the field's own required-check covers it.
 */
export function isWeekendOrHoliday(iso: string | null | undefined): boolean {
  return isWeekend(iso) || isCzechHoliday(iso);
}
