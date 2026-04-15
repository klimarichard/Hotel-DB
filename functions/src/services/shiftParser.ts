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
