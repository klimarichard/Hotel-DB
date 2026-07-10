import * as admin from "firebase-admin";
import { HotelSlug } from "./hotels";

/** Lobby bar sale currency. Amounts are never converted between the two. */
export type Currency = "CZK" | "EUR";
export const CURRENCIES: readonly Currency[] = ["CZK", "EUR"];
export function isCurrency(v: unknown): v is Currency {
  return v === "CZK" || v === "EUR";
}

export function isDateStr(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/**
 * One item in the lobby bar catalogue (hotels/{hotel}/config/lobbyBarItems).
 * Each item carries TWO unit prices — one per currency — and a sale picks the
 * one matching its own currency. The two prices are never derived from each
 * other; they are independent list prices (e.g. voda 50 / 2).
 */
export interface LobbyBarItem {
  id: string;
  name: string;
  priceCZK: number;
  priceEUR: number;
}

/**
 * The catalogue document: the item list plus the per-currency provision rates
 * used to split every sale between the seller (`provision`) and the shared pot
 * (`doSpolecne`). Rates default to DEFAULT_PROVISION_CZK / _EUR when absent.
 */
export interface LobbyBarConfig {
  items: LobbyBarItem[];
  provisionCZK: number;
  provisionEUR: number;
}

/** Default per-unit provision the seller keeps, one per currency. */
export const DEFAULT_PROVISION_CZK = 20;
export const DEFAULT_PROVISION_EUR = 1;

/**
 * A single lobby bar sale.
 *
 * `itemName` and every money field (`unitPrice`, `price`, `provision`,
 * `doSpolecne`) are SNAPSHOTTED onto the row at sale time and computed
 * server-side. Editing the catalogue later (renaming an item, changing a price
 * or a provision rate) must NOT retro-change past sales, so the row keeps its
 * own copy rather than re-deriving from the live catalogue on read. All money
 * fields are in the sale's own `currency`; nothing is ever converted.
 */
export interface LobbyBarSale {
  date: string; // YYYY-MM-DD
  itemId: string;
  itemName: string; // snapshot of the item name at sale time
  quantity: number; // Excel "Počet", positive integer
  currency: Currency;
  employeeId: string;
  employeeName: string; // snapshot from the dropdown
  unitPrice: number; // list price for `currency`, snapshotted
  price: number; // quantity * unitPrice
  provision: number; // quantity * provision rate for `currency`
  doSpolecne: number; // price - provision
  createdBy?: string;
  updatedBy?: string;
  createdAt?: admin.firestore.Timestamp;
  updatedAt?: admin.firestore.Timestamp;
}

/**
 * Per-hotel visible date range that lobbyBar.manage users impose on everyone
 * else. A null bound is open (−∞ / +∞); both null (or unset doc) = no restriction.
 */
export interface LobbyBarRange {
  from: string | null;
  to: string | null;
}

export function lobbyBarCol(hotel: HotelSlug): admin.firestore.CollectionReference {
  return admin.firestore().collection("hotels").doc(hotel).collection("lobbyBarSales");
}

/** Config doc holding the visible range: hotels/{hotel}/config/lobbyBar. */
export function lobbyBarRangeRef(hotel: HotelSlug): admin.firestore.DocumentReference {
  return admin.firestore().collection("hotels").doc(hotel).collection("config").doc("lobbyBar");
}

/** Config doc holding the item catalogue + provision rates: hotels/{hotel}/config/lobbyBarItems. */
export function lobbyBarItemsRef(hotel: HotelSlug): admin.firestore.DocumentReference {
  return admin.firestore().collection("hotels").doc(hotel).collection("config").doc("lobbyBarItems");
}

/** Whether a date falls inside a range (open bounds count as satisfied). */
export function inRange(date: string, range: LobbyBarRange): boolean {
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}

/** Round money: whole CZK, two decimals for EUR. */
function roundMoney(x: number, currency: Currency): number {
  return currency === "CZK" ? Math.round(x) : Math.round(x * 100) / 100;
}

/**
 * Derive the money fields for a sale from the catalogue. `quantity` is a
 * positive integer; the unit price + provision rate are picked by `currency`.
 * All results are in `currency` — no conversion ever happens.
 */
export function computeSale(
  item: LobbyBarItem,
  quantity: number,
  currency: Currency,
  cfg: LobbyBarConfig
): { unitPrice: number; price: number; provision: number; doSpolecne: number } {
  const unitPrice = currency === "CZK" ? item.priceCZK : item.priceEUR;
  const rate = currency === "CZK" ? cfg.provisionCZK : cfg.provisionEUR;
  const price = roundMoney(quantity * unitPrice, currency);
  const provision = roundMoney(quantity * rate, currency);
  const doSpolecne = roundMoney(price - provision, currency);
  return { unitPrice, price, provision, doSpolecne };
}
