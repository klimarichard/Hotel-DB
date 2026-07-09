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
export interface NoteRow {
  id?: string;
  text: string;
  done: boolean;
  locked?: boolean;
}
export interface AccountRow {
  id?: string;
  name: string;
  amount: number;
  locked?: boolean;
}

export interface HandoverDoc {
  shiftDate: string;
  shiftType: ShiftType;
  notes?: NoteRow[];
  cashCounts?: Record<string, Record<string, number>>;
  accounts?: AccountRow[];
  /**
   * The three "sm" counts (cᵢ) for this protocol. The sm row's CZK value is the
   * dot product Σ rateᵢ·cᵢ where the rates are GLOBAL (settings/sm), not stored
   * here. Editable by any protocol-edit user via the normal content PUT.
   */
  smCounts?: number[];
  /** Accumulated "sm trezor" scalar — grows via sm→trezor transfers (sm.manage). */
  smTrezor?: number;
  /** "wata" scalar — freely +/- by the hotel's protokol.manage holders. May be negative. */
  wata?: number;
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

/**
 * The shift immediately before this one in the den→noc chain:
 *  noc of date D → den of date D; den of date D → noc of date D-1.
 */
export function previousShift(shiftDate: string, shiftType: ShiftType): { date: string; shift: ShiftType } {
  if (shiftType === "noc") return { date: shiftDate, shift: "den" };
  const d = new Date(`${shiftDate}T00:00:00`);
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return { date: `${y}-${m}-${dd}`, shift: "noc" };
}

/** The shift immediately after this one: den of date D → noc of D; noc of D → den of D+1. */
export function nextShift(shiftDate: string, shiftType: ShiftType): { date: string; shift: ShiftType } {
  if (shiftType === "den") return { date: shiftDate, shift: "noc" };
  const d = new Date(`${shiftDate}T00:00:00`);
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return { date: `${y}-${m}-${dd}`, shift: "den" };
}

export function handoverCol(hotel: HotelSlug): admin.firestore.CollectionReference {
  return admin.firestore().collection("hotels").doc(hotel).collection("shiftHandovers");
}
