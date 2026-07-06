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

/** `recepce.<stem>.protokol.delete` — required to DELETE a hotel's handover protocol. */
export function handoverDeletePerm(slug: HotelSlug): string {
  return `recepce.${SLUG_TO_STEM[slug]}.protokol.delete`;
}
