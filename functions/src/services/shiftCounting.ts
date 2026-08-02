/**
 * Shift COUNTING — the single source of truth for "how much of shift-type T did
 * this cell cover".
 *
 * Two shapes of cell can credit a shift type:
 *   1. a parsed CODE cell (`DA`, `NS+2`, …) whose segments carry {code, hotel},
 *   2. a bare NUMERIC cell (`8`) TAGGED with a type (`typeTag: "DS"`), which
 *      credits only the hours actually worked.
 * Everything that counts shifts (the 4D Recepce summary, the shiftSplits cap
 * check) must go through `cellHoursForType` so the two shapes can never drift
 * apart again.
 *
 * ⚠️ MIRROR: `frontend/src/lib/shiftConstants.ts` carries a hand-maintained copy
 * of `cellHoursForType` (and of the counted-tag list) so the grid can show the
 * remaining hours without a round-trip. Same convention the shift parser already
 * uses — see `docs/shifts.md`. Change one, change the other.
 */
import { sanitizeTypeTag } from "./shiftParser";

/** The only type-tags that count toward a hotel (desk day/night; no porters/trainees). */
export const COUNTED_TAGS = ["DA", "DS", "DQ", "DK", "NA", "NS", "NQ", "NK"] as const;
export type CountedTag = (typeof COUNTED_TAGS)[number];
export const COUNTED_TAG_SET: Set<string> = new Set<string>(COUNTED_TAGS);

/** A full reception shift is 12h; a tagged numeric cell counts as hours/12 of one. */
export const FULL_SHIFT_HOURS = 12;

export function isCountedTag(v: unknown): v is CountedTag {
  return typeof v === "string" && COUNTED_TAG_SET.has(v);
}

/** The subset of a stored `shifts/{id}` doc that counting cares about. */
export interface ShiftCellLike {
  segments?: Array<{ code?: unknown; hotel?: unknown }> | unknown;
  isDouble?: unknown;
  typeTag?: unknown;
  hoursComputed?: unknown;
}

/**
 * Hours of shift-type `type` that this cell credits (12 = a whole shift).
 * This is the ONE rule; recepceSummary divides by FULL_SHIFT_HOURS to get shifts.
 *
 * - Code cells: every matching segment adds a FULL shift. A composite `DA+DA`
 *   therefore adds 24 — historically the summary likewise added 1 per matching
 *   segment, so this is deliberate, not an oversight. A DOUBLE cell (`DA²`)
 *   counts as 0.
 * - Tagged numeric cells: add `hoursComputed` when the tag equals `type`.
 * Both branches sum, because a cell can in principle be both.
 *
 * `includeDouble` counts a DOUBLE cell as its full hours instead of 0. Nothing
 * on the server passes it — this side is the payout accounting, where the
 * historical rule is that a double credits nothing. It exists so the frontend
 * mirror can stay a verbatim copy: the occupancy tally DOES pass it, because
 * that table answers "is this shift covered", and a double is covered.
 */
export function cellHoursForType(
  cell: ShiftCellLike,
  type: CountedTag,
  opts?: { includeDouble?: boolean }
): number {
  const code = type.slice(0, -1); // "D" | "N"
  const hotel = type.slice(-1); // "A" | "S" | "Q" | "K"
  let hours = 0;

  const countSegments = opts?.includeDouble === true || cell.isDouble !== true;
  if (countSegments && Array.isArray(cell.segments)) {
    for (const seg of cell.segments as Array<{ code?: unknown; hotel?: unknown }>) {
      if (seg && seg.code === code && seg.hotel === hotel) hours += FULL_SHIFT_HOURS;
    }
  }

  if (sanitizeTypeTag(cell.typeTag) === type) {
    const h = cell.hoursComputed;
    if (typeof h === "number" && Number.isFinite(h) && h > 0) hours += h;
  }

  return hours;
}
