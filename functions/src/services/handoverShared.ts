import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { HotelSlug } from "./hotels";

export const SHIFT_TYPES = ["den", "noc"] as const;
export type ShiftType = (typeof SHIFT_TYPES)[number];

export type SignatureSlot = "predal" | "prevzal";
export const SIGNATURE_SLOTS: readonly SignatureSlot[] = ["predal", "prevzal"];

export function isSignatureSlot(s: unknown): s is SignatureSlot {
  return s === "predal" || s === "prevzal";
}

/** A virtual signature captured at Předat/Převzít time (name snapshotted). */
export interface StampedSignature {
  uid: string;
  displayName: string;
  email: string;
  at: Timestamp;
}

/**
 * A per-shift reception record: cash counts, free-form účty rows, notes, and the
 * two handover signatures (predal = outgoing, prevzal = incoming). Content is
 * frozen once `predal` is set (admin can still revert). Signatures are written
 * only by the dedicated sign/revert endpoints, never by the content PUT.
 */
export interface HandoverDoc {
  shiftDate: string;
  shiftType: ShiftType;
  notes?: Array<{ text: string; done: boolean }>;
  cashCounts?: Record<string, Record<string, number>>;
  accounts?: Array<{ name: string; amount: number }>;
  predal?: StampedSignature | null;
  prevzal?: StampedSignature | null;
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
