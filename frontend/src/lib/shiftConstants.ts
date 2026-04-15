// ─── Constants ───────────────────────────────────────────────────────────────

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

// ─── Per-hotel cell colors ───────────────────────────────────────────────────
// Key: hotel code for regular shifts, "P"+hotel for portýr shifts, "X" for day off

export const CELL_COLORS: Record<string, { bg: string; text: string }> = {
  A:  { bg: "#dcfce7", text: "#166534" },   // Ambiance — green
  S:  { bg: "#fde68a", text: "#78350f" },   // Superior — gold
  Q:  { bg: "#fdf4ff", text: "#c026d3" },   // Amigo — fuchsia
  K:  { bg: "#ede9fe", text: "#5b21b6" },   // Ankora — purple
  P:  { bg: "#d1d5db", text: "#1f2937" },   // Perla — gray
  M:  { bg: "#d1d5db", text: "#1f2937" },   // Metropol — gray
  PA: { bg: "#dbeafe", text: "#1e40af" },   // Ambiance portýr — blue
  PQ: { bg: "#431407", text: "#fed7aa" },   // Amigo portýr — dark brown
  HO: { bg: "#e0e7ff", text: "#3730a3" },   // Home Office — indigo
  X:  { bg: "#fee2e2", text: "#dc2626" },   // X — red
};

const DEFAULT_CELL_COLOR = { bg: "#f0f9ff", text: "#0c4a6e" };
const DEFAULT_CELL_COLOR_DARK = { bg: "#1e3a5f", text: "#93c5fd" };

const CELL_COLORS_DARK: Record<string, { bg: string; text: string }> = {
  A:  { bg: "#064e3b", text: "#6ee7b7" },   // Ambiance — dark green
  S:  { bg: "#713f12", text: "#fde68a" },   // Superior — dark gold
  Q:  { bg: "#4a044e", text: "#e879f9" },   // Amigo — dark fuchsia
  K:  { bg: "#2e1065", text: "#a78bfa" },   // Ankora — dark purple
  P:  { bg: "#374151", text: "#d1d5db" },   // Perla — dark grey
  M:  { bg: "#374151", text: "#d1d5db" },   // Metropol — dark grey
  PA: { bg: "#1d4ed8", text: "#bfdbfe" },   // Ambiance portýr — vivid blue
  PQ: { bg: "#1c0a00", text: "#fed7aa" },   // Amigo portýr — very dark brown
  HO: { bg: "#1e1b4b", text: "#a5b4fc" },   // Home Office — dark indigo
  X:  { bg: "#450a0a", text: "#fca5a5" },   // X — dark red
};

export function getCellColor(parsed: ParseResult, dark = false): { bg: string; text: string } {
  const colors = dark ? CELL_COLORS_DARK : CELL_COLORS;
  const defaultColor = dark ? DEFAULT_CELL_COLOR_DARK : DEFAULT_CELL_COLOR;
  const first = parsed.segments[0];
  if (!first) return { bg: "transparent", text: dark ? "#94a3b8" : "#374151" };
  if (first.code === "X") return colors["X"];
  if (first.code === "HO") return colors["HO"] ?? defaultColor;
  const isPortyr = first.code === "DP" || first.code === "NP";
  const hotel = first.hotel;
  if (isPortyr && hotel) return colors["P" + hotel] ?? colors[hotel] ?? defaultColor;
  if (isPortyr) return colors["P"] ?? defaultColor;
  if (hotel) return colors[hotel] ?? defaultColor;
  return defaultColor;
}

// ─── MOD (Manager on Duty) ──────────────────────────────────────────────────

export const MOD_PERSONS: Record<string, string> = {
  V: "Viktor Vondra",
  R: "Richard Klíma",
  N: "Anastázie Kalinina",
  O: "Oxana Smolyak",
  K: "Kateřina Zezulková",
  A: "Aruzhan Kassimkulova",
};

export const MOD_COLORS: Record<string, { bg: string; text: string }> = {
  V: { bg: "#fef3c7", text: "#78350f" },
  R: { bg: "#dbeafe", text: "#1e40af" },
  N: { bg: "#fdf4ff", text: "#7e22ce" },
  O: { bg: "#dcfce7", text: "#166534" },
  K: { bg: "#ede9fe", text: "#5b21b6" },
  A: { bg: "#ffedd5", text: "#9a3412" },
};

// ─── Czech state holidays ────────────────────────────────────────────────────

function computeEasterSunday(year: number): Date {
  // Anonymous Gregorian algorithm
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function dateToISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getCzechHolidays(year: number): Set<string> {
  // Fixed Czech public holidays
  const fixed: [number, number][] = [
    [1, 1],   // Den obnovy samostatného českého státu / Nový rok
    [5, 1],   // Svátek práce
    [5, 8],   // Den vítězství
    [7, 5],   // Den slovanských věrozvěstů Cyrila a Metoděje
    [7, 6],   // Den upálení mistra Jana Husa
    [9, 28],  // Den české státnosti
    [10, 28], // Den vzniku samostatného československého státu
    [11, 17], // Den boje za svobodu a demokracii
    [12, 24], // Štědrý den
    [12, 25], // 1. svátek vánoční
    [12, 26], // 2. svátek vánoční
  ];
  const holidays = new Set<string>();
  for (const [m, d] of fixed) {
    holidays.add(`${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  // Easter-based movable holidays
  const easter = computeEasterSunday(year);
  // Good Friday (Easter - 2 days)
  const goodFriday = new Date(easter);
  goodFriday.setDate(goodFriday.getDate() - 2);
  holidays.add(dateToISO(goodFriday));
  // Easter Monday (Easter + 1 day)
  const easterMonday = new Date(easter);
  easterMonday.setDate(easterMonday.getDate() + 1);
  holidays.add(dateToISO(easterMonday));
  return holidays;
}

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
