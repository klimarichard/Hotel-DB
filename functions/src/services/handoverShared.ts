import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { HotelSlug } from "./hotels";

export const SHIFT_TYPES = ["den", "noc"] as const;
export type ShiftType = (typeof SHIFT_TYPES)[number];

export type SignatureSlot = "predal" | "prevzal";

export interface StampedSignature {
  uid: string;
  displayName: string;
  email: string;
  at: Timestamp;
}

export interface HandoverDoc {
  shiftDate: string;
  shiftType: ShiftType;
  notes?: Array<{ text: string; done: boolean }>;
  cashCounts?: Record<string, Record<string, number>>;
  accounts?: Array<{ name: string; amount: number }>;
  smBreakdown?: { EUR: number; USD: number; GBP: number };
  predal?: StampedSignature | null;
  prevzal?: StampedSignature | null;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
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
