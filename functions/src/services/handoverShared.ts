import * as admin from "firebase-admin";
import { HotelSlug } from "./hotels";

export const SHIFT_TYPES = ["den", "noc"] as const;
export type ShiftType = (typeof SHIFT_TYPES)[number];

/**
 * A per-shift reception record: cash counts, free-form účty rows, and notes.
 * (The old Předal/Převzal signing + lock machinery was removed — this is now a
 * plain autosaved record with a permission-gated delete.)
 */
export interface HandoverDoc {
  shiftDate: string;
  shiftType: ShiftType;
  notes?: Array<{ text: string; done: boolean }>;
  cashCounts?: Record<string, Record<string, number>>;
  accounts?: Array<{ name: string; amount: number }>;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: admin.firestore.Timestamp;
  updatedAt?: admin.firestore.Timestamp;
}

export function isShiftDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function isShiftType(s: unknown): s is ShiftType {
  return typeof s === "string" && (SHIFT_TYPES as readonly string[]).includes(s);
}

export function docId(shiftDate: string, shiftType: ShiftType): string {
  return `${shiftDate}_${shiftType}`;
}

export function handoverCol(hotel: HotelSlug): admin.firestore.CollectionReference {
  return admin.firestore().collection("hotels").doc(hotel).collection("shiftHandovers");
}
