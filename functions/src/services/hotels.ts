/**
 * Reception (Recepce) hotel registry — backend mirror of frontend/src/lib/hotels.ts.
 *
 * Maps a hotel's URL slug → shift code, label, and RBAC permission-key stem.
 * Handover routes are gated by a DYNAMIC per-hotel permission (the required key
 * depends on the `:hotel` URL param), so a static requirePermission() can't be
 * used — `handoverViewPerm(slug)` / `handoverEditPerm(slug)` build the key and a
 * small middleware checks it against req.permissions.
 *
 * NOTE the slug↔stem asymmetry: slug `amigo-alqush` → key stem `amigo`.
 */
import type { HotelCode } from "./shiftParser";

export const HOTEL_SLUGS = ["ambiance", "superior", "amigo-alqush", "ankora"] as const;
export type HotelSlug = (typeof HOTEL_SLUGS)[number];

export const SLUG_TO_CODE: Record<HotelSlug, Extract<HotelCode, "A" | "S" | "Q" | "K">> = {
  ambiance: "A",
  superior: "S",
  "amigo-alqush": "Q",
  ankora: "K",
};

export const HOTEL_LABELS: Record<HotelSlug, string> = {
  ambiance: "Ambiance",
  superior: "Superior",
  "amigo-alqush": "Amigo & Alqush",
  ankora: "Ankora",
};

/** Permission-key stem for each hotel — `recepce.<stem>.*`. Differs from slug for Amigo. */
export const SLUG_TO_STEM: Record<HotelSlug, string> = {
  ambiance: "ambiance",
  superior: "superior",
  "amigo-alqush": "amigo",
  ankora: "ankora",
};

export function isHotelSlug(value: unknown): value is HotelSlug {
  return typeof value === "string" && (HOTEL_SLUGS as readonly string[]).includes(value);
}

/** `recepce.<stem>.protokol.view` — required to READ a hotel's handover protocol. */
export function handoverViewPerm(slug: HotelSlug): string {
  return `recepce.${SLUG_TO_STEM[slug]}.protokol.view`;
}

/**
 * Permission required to WRITE (create/update) a hotel's handover protocol. The
 * `protokol.view` key confers edit — anyone who can open the tab can fill it in.
 * Kept as its own helper so the edit gate has a single call site.
 */
export function handoverEditPerm(slug: HotelSlug): string {
  return `recepce.${SLUG_TO_STEM[slug]}.protokol.view`;
}

/** `recepce.<stem>.protokol.create` — required to CREATE a new protocol (bootstrap
 *  or duplicate-to-next-shift). Editing an existing protocol needs only view. */
export function handoverCreatePerm(slug: HotelSlug): string {
  return `recepce.${SLUG_TO_STEM[slug]}.protokol.create`;
}

/** `recepce.<stem>.protokol.delete` — required to DELETE a hotel's handover protocol. */
export function handoverDeletePerm(slug: HotelSlug): string {
  return `recepce.${SLUG_TO_STEM[slug]}.protokol.delete`;
}

/** `recepce.<stem>.protokol.manage` ("Spravovat protokol") — broad per-hotel
 *  protocol-management grant. Confers: reverting SOMEONE ELSE's signature
 *  (self-unsign needs no permission — only a valid password), locking/unlocking
 *  individual Poznámky/Účty rows, and adding/subtracting the "wata" scalar. */
export function handoverManagePerm(slug: HotelSlug): string {
  return `recepce.${SLUG_TO_STEM[slug]}.protokol.manage`;
}

/** `recepce.sm.manage` ("Spravovat sm") — GLOBAL (not per-hotel): edit the shared
 *  sm rates, transfer sm→sm trezor, and clear sm trezor, across all hotels. */
export const SM_MANAGE_PERM = "recepce.sm.manage";

/** `recepce.<stem>.walkiny.view` — required to see the Walkiny tab and to
 *  add/edit/delete walk-in entries (subject to the visible range for non-managers). */
export function walkinViewPerm(slug: HotelSlug): string {
  return `recepce.${SLUG_TO_STEM[slug]}.walkiny.view`;
}

/** `recepce.<stem>.walkiny.manage` ("Spravovat walkiny") — set the visible date
 *  range and see/add entries with no range restriction. */
export function walkinManagePerm(slug: HotelSlug): string {
  return `recepce.${SLUG_TO_STEM[slug]}.walkiny.manage`;
}

/** `recepce.<stem>.taxi.view` — see the Taxi tab + add/edit/delete rides. */
export function taxiViewPerm(slug: HotelSlug): string {
  return `recepce.${SLUG_TO_STEM[slug]}.taxi.view`;
}

/** `recepce.<stem>.taxi.manage` ("Spravovat taxi") — set the taxi visible date
 *  range and see/add rides with no range restriction. */
export function taxiManagePerm(slug: HotelSlug): string {
  return `recepce.${SLUG_TO_STEM[slug]}.taxi.manage`;
}

/** `recepce.taxi.manageRates` ("Spravovat ceník taxi") — GLOBAL: edit the shared
 *  common-routes price/provision table (settings/taxiRoutes) for all hotels. */
export const TAXI_MANAGE_RATES_PERM = "recepce.taxi.manageRates";
