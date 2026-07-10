import * as admin from "firebase-admin";
import { HotelSlug } from "./hotels";

/**
 * The permanent built-in payment type. "Jiné…" always exists (managers can't
 * delete or rename it) and is the ONLY type that forces a note — it carries no
 * type of its own, so the note is the only record of what the payment was. Every
 * other type is manager-configurable (see `TerminalTypeItem` / `config/terminalTypes`).
 */
export const OTHER_TYPE_ID = "other";
export const OTHER_TYPE_LABEL = "Jiné…";

/**
 * A configurable payment type in the per-hotel catalogue
 * (`hotels/{hotel}/config/terminalTypes`). `id` is stable (assigned once, kept
 * across renames) so a payment referencing it survives a label change; the entry
 * `type` snapshots the label at write time regardless. The built-in "other" is
 * NOT stored here — it is appended in code.
 */
export interface TerminalTypeItem {
  id: string;
  label: string;
}

/**
 * The default catalogue used when a hotel has no `terminalTypes` doc yet — the
 * original hard-coded list (minus the built-in "other"). Keeps existing payments'
 * type ids resolving to labels and gives new hotels a sensible starting set.
 */
export const DEFAULT_TERMINAL_TYPES: readonly TerminalTypeItem[] = [
  { id: "late-co", label: "late C/O" },
  { id: "laundry", label: "laundry" },
  { id: "snidane", label: "snídaně" },
  { id: "extra-bed", label: "extra bed" },
  { id: "parking", label: "parking" },
  { id: "tour", label: "tour" },
];

/**
 * Legacy label fallback for OLD payments that predate label snapshotting (they
 * stored only a type id, no `typeLabel`). Covers the original enum ids incl.
 * "other". New payments always carry their own `typeLabel`.
 */
export const LEGACY_TYPE_LABELS: Record<string, string> = {
  "late-co": "late C/O",
  laundry: "laundry",
  snidane: "snídaně",
  "extra-bed": "extra bed",
  parking: "parking",
  tour: "tour",
  other: OTHER_TYPE_LABEL,
};

export function isDateStr(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/**
 * A single card-terminal payment. Amounts are CZK only (there is no currency
 * column). `note` is an optional free-text detail available on every type
 * (e.g. "hračka", "(Hop-On, Hop-Off)"). `settled` mirrors the "Předáno" column;
 * it can only be flipped by a manage user, who is recorded in settledBy/At.
 *
 * `type` is an id — either the built-in `other` or an id from the per-hotel
 * catalogue. `typeLabel` snapshots the catalogue label at write time so a later
 * rename or delete of a type never rewrites past rows (mirrors lobby bar's
 * `itemName`). Old payments predating this carry no `typeLabel`; the UI falls
 * back to `LEGACY_TYPE_LABELS`.
 */
export interface TerminalPayment {
  date: string; // YYYY-MM-DD
  amount: number; // CZK, whole number
  type: string; // built-in "other" or a catalogue id
  typeLabel?: string; // snapshot of the label at write time
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

/** Config doc holding the configurable payment-type catalogue: hotels/{hotel}/config/terminalTypes. */
export function terminalTypesRef(hotel: HotelSlug): admin.firestore.DocumentReference {
  return admin.firestore().collection("hotels").doc(hotel).collection("config").doc("terminalTypes");
}

/** Whether a date falls inside a range (open bounds count as satisfied). */
export function inRange(date: string, range: TerminalRange): boolean {
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}
