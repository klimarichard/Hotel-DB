import * as admin from "firebase-admin";
import { HotelSlug } from "./hotels";

/**
 * Card-terminal payment types. Each id maps to a Czech label shown in the UI.
 * The reference workbook ("TERMINÁL bar.xlsx") is dominated by "late C/O", with
 * a long tail of one-off items that live under "Jiné…" plus a free-text note.
 */
export const TERMINAL_TYPES = [
  "late-co",
  "laundry",
  "snidane",
  "extra-bed",
  "parking",
  "tour",
  "other",
] as const;
export type TerminalType = (typeof TERMINAL_TYPES)[number];
export function isTerminalType(v: unknown): v is TerminalType {
  return typeof v === "string" && (TERMINAL_TYPES as readonly string[]).includes(v);
}

/** Czech labels for the payment types (id → label). */
export const TERMINAL_TYPE_LABELS: Record<TerminalType, string> = {
  "late-co": "late C/O",
  laundry: "laundry",
  snidane: "snídaně",
  "extra-bed": "extra bed",
  parking: "parking",
  tour: "tour",
  other: "Jiné…",
};

export function isDateStr(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/**
 * A single card-terminal payment. Amounts are CZK only (there is no currency
 * column). `note` is an optional free-text detail available on every type
 * (e.g. "hračka", "(Hop-On, Hop-Off)"). `settled` mirrors the "Předáno" column;
 * it can only be flipped by a manage user, who is recorded in settledBy/At.
 */
export interface TerminalPayment {
  date: string; // YYYY-MM-DD
  amount: number; // CZK, whole number
  type: TerminalType;
  note: string;
  settled: boolean; // "Předáno" — OK vs blank
  settledBy?: string | null;
  settledAt?: admin.firestore.Timestamp | null;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: admin.firestore.Timestamp;
  updatedAt?: admin.firestore.Timestamp;
}

/**
 * Per-hotel visible date range that terminal.manage users impose on everyone
 * else. A null bound is open (−∞ / +∞); both null (or unset doc) = no restriction.
 */
export interface TerminalRange {
  from: string | null;
  to: string | null;
}

export function terminalCol(hotel: HotelSlug): admin.firestore.CollectionReference {
  return admin.firestore().collection("hotels").doc(hotel).collection("terminalPayments");
}

/** Config doc holding the visible range: hotels/{hotel}/config/terminal. */
export function terminalRangeRef(hotel: HotelSlug): admin.firestore.DocumentReference {
  return admin.firestore().collection("hotels").doc(hotel).collection("config").doc("terminal");
}

/** Whether a date falls inside a range (open bounds count as satisfied). */
export function inRange(date: string, range: TerminalRange): boolean {
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}
