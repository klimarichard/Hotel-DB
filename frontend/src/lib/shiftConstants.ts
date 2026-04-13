// ─── Constants ───────────────────────────────────────────────────────────────

export const SHIFT_HOURS: Record<string, number> = {
  D: 12,
  N: 12,
  R: 8,
  ZD: 8,
  ZN: 8,
  X: 0,
};

export const HOTEL_CODES = ["A", "S", "Q", "K", "P", "M"] as const;
export type HotelCode = typeof HOTEL_CODES[number];

export const HOTEL_NAMES: Record<HotelCode, string> = {
  A: "Ambiance",
  S: "Superior",
  Q: "Amigo & Alqush",
  K: "Ankora",
  P: "Perla",
  M: "Metropol",
};

export const SECTIONS = ["vedoucí", "recepce", "portýři"] as const;
export type Section = typeof SECTIONS[number];

export const SECTION_LABELS: Record<Section, string> = {
  "vedoucí": "Vedoucí",
  "recepce": "Recepce",
  "portýři": "Portýři",
};

export const SHIFT_TYPES = ["D", "N", "R"] as const;
export type ShiftType = typeof SHIFT_TYPES[number];

export const SHIFT_COLORS: Record<string, string> = {
  D:  "#dbeafe",
  N:  "#1e3a5f",
  R:  "#d1fae5",
  ZD: "#fef9c3",
  ZN: "#fde68a",
  X:  "#f3f4f6",
};

export const SHIFT_TEXT_COLORS: Record<string, string> = {
  D:  "#1d4ed8",
  N:  "#e0f2fe",
  R:  "#065f46",
  ZD: "#854d0e",
  ZN: "#92400e",
  X:  "#9ca3af",
};

// ─── Parser (mirrored from functions/src/services/shiftParser.ts) ─────────────
// Keep in sync manually — do NOT import across packages.

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

  // Shift code — multi-char first
  let code: string;
  let remainder: string;

  if (token.startsWith("ZD")) {
    code = "ZD";
    remainder = token.slice(2);
  } else if (token.startsWith("ZN")) {
    code = "ZN";
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
