import * as admin from "firebase-admin";
import { HotelSlug } from "./hotels";

/** Walk-in sale currency. Amounts are never converted between the two. */
export type Currency = "CZK" | "EUR";
export const CURRENCIES: readonly Currency[] = ["CZK", "EUR"];
export function isCurrency(v: unknown): v is Currency {
  return v === "CZK" || v === "EUR";
}

export function isDateStr(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/**
 * A single walk-in sale (accommodation sold outside the reservation system).
 * `employeeName` is snapshotted from the dropdown so the row stays readable even
 * if the employee record changes; `employeeId` links back to the shift plan.
 */
export interface WalkinDoc {
  date: string; // YYYY-MM-DD
  employeeId: string;
  employeeName: string;
  resNo: string; // č. rez. v Protelu
  amount: number;
  currency: Currency;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: admin.firestore.Timestamp;
  updatedAt?: admin.firestore.Timestamp;
}

/**
 * Per-hotel visible date range that walkiny.manage users impose on everyone else.
 * A null bound is open (−∞ / +∞); both null (or unset doc) = no restriction.
 */
export interface WalkinRange {
  from: string | null;
  to: string | null;
}

export function walkinCol(hotel: HotelSlug): admin.firestore.CollectionReference {
  return admin.firestore().collection("hotels").doc(hotel).collection("walkins");
}

/** Config doc holding the visible range: hotels/{hotel}/config/walkins. */
export function walkinRangeRef(hotel: HotelSlug): admin.firestore.DocumentReference {
  return admin.firestore().collection("hotels").doc(hotel).collection("config").doc("walkins");
}

/** Whether a date falls inside a range (open bounds count as satisfied). */
export function inRange(date: string, range: WalkinRange): boolean {
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}
