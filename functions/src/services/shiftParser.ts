export const SHIFT_HOURS: Record<string, number> = {
  D: 12,
  N: 12,
  R: 8,
  ZD: 12,
  ZN: 12,
  DP: 12,
  NP: 12,
  HO: 6,
  X: 0,
};

export const HOTEL_CODES = ["A", "S", "Q", "K", "P", "M"] as const;
export type HotelCode = typeof HOTEL_CODES[number];

// Allowed shift-type tags for numeric ("worked hours") cells (#29). A bare number
// like "8" carries no shift type, so it can't be attributed in the per-type
// occupancy tally ("Přehled obsazení"). Tagging records which type those hours
// were worked as — it does NOT affect pay.
//
// The first 12 are the occupancy types (label = code+hotel) and mirror the
// frontend COUNTER_ROWS — a cell tagged with one counts in the tally / covers a
// free-shift slot. The last 4 (R, HO, ZD, ZN) are annotation-only labels: they
// are accepted and stored, but never equal any free-slot `code+hotel`, so they
// add no tally row and affect no coverage. Mirrors ALL_TYPE_TAGS in the frontend.
export const SHIFT_TYPE_TAGS = [
  "DA", "DS", "DQ", "DK", "NA", "NS", "NQ", "NK", "DPQ", "NPQ", "DPA", "NPA",
  "R", "HO", "ZD", "ZN",
] as const;
export type ShiftTypeTag = typeof SHIFT_TYPE_TAGS[number];

/** A "worked hours" cell: valid, non-empty, every segment a bare number (no hotel). */
export function isPureNumericExpression(parsed: ParseResult): boolean {
  return (
    parsed.isValid &&
    parsed.segments.length > 0 &&
    parsed.segments.every((s) => /^\d+(\.\d+)?$/.test(s.code))
  );
}

/** Coerce an incoming type-tag value to a known tag, or null if invalid/absent. */
export function sanitizeTypeTag(value: unknown): ShiftTypeTag | null {
  return typeof value === "string" && (SHIFT_TYPE_TAGS as readonly string[]).includes(value)
    ? (value as ShiftTypeTag)
    : null;
}

export interface ShiftSegment {
  code: string;
  hotel: string | null;
  hours: number;
}

export interface ParseResult {
  rawInput: string;
  segments: ShiftSegment[];
  hoursComputed: number;
  isDouble: boolean;
  isValid: boolean;
  error?: string;
}

function parseSegment(token: string): ShiftSegment | { error: string } {
  token = token.trim();

  // Detect and strip ² (U+00B2)
  const isDouble = token.includes("\u00B2");
  if (isDouble) {
    token = token.replace(/\u00B2/g, "");
  }

  if (token === "") {
    return { error: "Prázdný segment" };
  }

  // Numeric literal
  if (/^\d+(\.\d+)?$/.test(token)) {
    const hours = parseFloat(token);
    if (hours < 0 || hours > 24) {
      return { error: "Neplatný počet hodin: " + token };
    }
    return { code: token, hotel: null, hours };
  }

  // Shift code — check multi-char codes first
  let code: string;
  let remainder: string;

  if (token.startsWith("ZD")) {
    code = "ZD";
    remainder = token.slice(2);
  } else if (token.startsWith("ZN")) {
    code = "ZN";
    remainder = token.slice(2);
  } else if (token.startsWith("DP")) {
    code = "DP";
    remainder = token.slice(2);
  } else if (token.startsWith("NP")) {
    code = "NP";
    remainder = token.slice(2);
  } else if (token.startsWith("HO")) {
    code = "HO";
    remainder = token.slice(2);
  } else if (token.length >= 1 && ["D", "N", "R", "X"].includes(token[0])) {
    code = token[0];
    remainder = token.slice(1);
  } else {
    return { error: "Neznámý kód: " + token };
  }

  if (!(code in SHIFT_HOURS)) {
    return { error: "Neznámý kód: " + code };
  }

  // D, N, ZD, ZN require a hotel code (e.g. DA, NS, ZDA, ZNQ); HO, R and X are valid standalone only
  if ((code === "D" || code === "N" || code === "ZD" || code === "ZN") && remainder === "") {
    return { error: "Kód " + code + " vyžaduje hotel (např. " + code + "A)" };
  }

  if (code === "HO" && remainder !== "") {
    return { error: "Kód HO nepřijímá hotel" };
  }

  // Remainder must be a valid hotel code or empty
  if (remainder !== "" && !(HOTEL_CODES as readonly string[]).includes(remainder)) {
    return { error: "Neznámý hotel: " + remainder };
  }

  return {
    code,
    hotel: remainder || null,
    hours: SHIFT_HOURS[code],
  };
}

export function parseShiftExpression(input: string): ParseResult {
  const trimmed = input.trim();

  if (trimmed === "") {
    return {
      rawInput: input,
      segments: [],
      hoursComputed: 0,
      isDouble: false,
      isValid: true,
    };
  }

  const normalized = trimmed.toUpperCase();
  const tokens = normalized.split("+");

  const segments: ShiftSegment[] = [];
  let isDouble = false;

  for (const token of tokens) {
    // Re-check for ² after uppercase (it's not affected by toUpperCase)
    if (token.includes("\u00B2")) {
      isDouble = true;
    }
    const result = parseSegment(token);
    if ("error" in result) {
      return {
        rawInput: input,
        segments: [],
        hoursComputed: 0,
        isDouble: false,
        isValid: false,
        error: result.error,
      };
    }
    segments.push(result);
  }

  const hoursComputed = segments.reduce((sum, s) => sum + s.hours, 0);

  return {
    rawInput: input,
    segments,
    hoursComputed,
    isDouble,
    isValid: true,
  };
}
