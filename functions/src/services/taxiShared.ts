import * as admin from "firebase-admin";
import { HotelSlug } from "./hotels";

export function isDateStr(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/**
 * A common taxi route in the GLOBAL price list (settings/taxiRoutes). `roundtrip`
 * marks routes for which the ride time may be left empty.
 */
export interface TaxiRoute {
  id: string;
  name: string;
  price: number;
  provision: number;
  roundtrip: boolean;
}

/**
 * A single taxi ride booked at reception. `routeName === ""` marks an "Other"
 * (custom) ride, whose amount/provision are entered manually and whose note is
 * mandatory. For a common route these three are snapshotted from the route.
 */
export interface TaxiRideDoc {
  date: string; // YYYY-MM-DD
  time: string; // "HH:MM" or "" (roundtrips may omit it)
  room: string; // "" allowed
  pax: number | null; // null allowed
  routeName: string; // "" = Other
  amount: number;
  provision: number;
  note: string; // required for Other
  createdBy?: string;
  updatedBy?: string;
  createdAt?: admin.firestore.Timestamp;
  updatedAt?: admin.firestore.Timestamp;
}

/** Per-hotel visible date range imposed on non-taxi.manage users. */
export interface TaxiRange {
  from: string | null;
  to: string | null;
}

export function taxiRideCol(hotel: HotelSlug): admin.firestore.CollectionReference {
  return admin.firestore().collection("hotels").doc(hotel).collection("taxiRides");
}

/** Config doc holding the visible range: hotels/{hotel}/config/taxi. */
export function taxiRangeRef(hotel: HotelSlug): admin.firestore.DocumentReference {
  return admin.firestore().collection("hotels").doc(hotel).collection("config").doc("taxi");
}

/** The GLOBAL routes doc, shared by all hotels: settings/taxiRoutes. */
export function taxiRoutesRef(): admin.firestore.DocumentReference {
  return admin.firestore().collection("settings").doc("taxiRoutes");
}

export function inRange(date: string, range: TaxiRange): boolean {
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}
