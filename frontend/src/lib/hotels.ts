import type { Permission } from "@/lib/permissions/catalog";

/**
 * Reception (Recepce) hotel registry — the single source of truth mapping a
 * hotel's URL slug to its shift code, display label, and RBAC permission keys.
 *
 * Access is entirely PERMISSION-DRIVEN: a user can reach a hotel iff they hold
 * its `recepce.<stem>.view` key, and a tab within it iff they hold the tab's
 * `recepce.<stem>.<tab>.view` key. There is no `users.hotel` field and no custom
 * claim — `accessibleHotels(can)` / `visibleTabs(hotel, can)` filter the fixed
 * registry through the caller's `can()`.
 *
 * NOTE the slug↔stem asymmetry: the URL slug `amigo-alqush` maps to the key stem
 * `amigo` (keys are `recepce.amigo.*`). Keep that mapping ONLY here.
 */

export const HOTEL_SLUGS = ["ambiance", "superior", "amigo-alqush", "ankora"] as const;
export type HotelSlug = (typeof HOTEL_SLUGS)[number];
export type HotelCode = "A" | "S" | "Q" | "K";

export type TabId = "protokol" | "walkiny" | "taxi" | "lobbyBar" | "terminal";

export interface HotelTab {
  readonly id: TabId;
  readonly label: string;
  /** `recepce.<stem>.<tab>.view` — gates the tab's visibility + backend access. */
  readonly viewPerm: Permission;
}

export interface Hotel {
  readonly slug: HotelSlug;
  readonly code: HotelCode;
  readonly label: string;
  /** Permission key stem — `recepce.<stem>.*`. Differs from slug for Amigo. */
  readonly stem: string;
  /** `recepce.<stem>.view` — gates whether the hotel is accessible at all. */
  readonly viewPerm: Permission;
  /** `recepce.<stem>.protokol.create` — gates creating a new Předávací protokol. */
  readonly protokolCreatePerm: Permission;
  /** `recepce.<stem>.protokol.delete` — gates deleting a Předávací protokol. */
  readonly protokolDeletePerm: Permission;
  /** `recepce.<stem>.protokol.manage` — gates reverting others' signatures. */
  readonly protokolManagePerm: Permission;
  readonly tabs: readonly HotelTab[];
}

/** Fixed display/nav order: Ambiance · Superior · Amigo & Alqush · Ankora. */
export const HOTELS: readonly Hotel[] = [
  {
    slug: "ambiance",
    code: "A",
    label: "Ambiance",
    stem: "ambiance",
    viewPerm: "recepce.ambiance.view",
    protokolCreatePerm: "recepce.ambiance.protokol.create",
    protokolDeletePerm: "recepce.ambiance.protokol.delete",
    protokolManagePerm: "recepce.ambiance.protokol.manage",
    tabs: [
      { id: "protokol", label: "Předávací protokol", viewPerm: "recepce.ambiance.protokol.view" },
      { id: "walkiny", label: "Walkiny", viewPerm: "recepce.ambiance.walkiny.view" },
      { id: "taxi", label: "Taxi", viewPerm: "recepce.ambiance.taxi.view" },
      { id: "lobbyBar", label: "Lobby bar", viewPerm: "recepce.ambiance.lobbyBar.view" },
    ],
  },
  {
    slug: "superior",
    code: "S",
    label: "Superior",
    stem: "superior",
    viewPerm: "recepce.superior.view",
    protokolCreatePerm: "recepce.superior.protokol.create",
    protokolDeletePerm: "recepce.superior.protokol.delete",
    protokolManagePerm: "recepce.superior.protokol.manage",
    tabs: [
      { id: "protokol", label: "Předávací protokol", viewPerm: "recepce.superior.protokol.view" },
      { id: "walkiny", label: "Walkiny", viewPerm: "recepce.superior.walkiny.view" },
      { id: "taxi", label: "Taxi", viewPerm: "recepce.superior.taxi.view" },
    ],
  },
  {
    slug: "amigo-alqush",
    code: "Q",
    label: "Amigo & Alqush",
    stem: "amigo",
    viewPerm: "recepce.amigo.view",
    protokolCreatePerm: "recepce.amigo.protokol.create",
    protokolDeletePerm: "recepce.amigo.protokol.delete",
    protokolManagePerm: "recepce.amigo.protokol.manage",
    tabs: [
      { id: "protokol", label: "Předávací protokol", viewPerm: "recepce.amigo.protokol.view" },
      { id: "walkiny", label: "Walkiny", viewPerm: "recepce.amigo.walkiny.view" },
      { id: "taxi", label: "Taxi", viewPerm: "recepce.amigo.taxi.view" },
      { id: "terminal", label: "Terminál", viewPerm: "recepce.amigo.terminal.view" },
    ],
  },
  {
    slug: "ankora",
    code: "K",
    label: "Ankora",
    stem: "ankora",
    viewPerm: "recepce.ankora.view",
    protokolCreatePerm: "recepce.ankora.protokol.create",
    protokolDeletePerm: "recepce.ankora.protokol.delete",
    protokolManagePerm: "recepce.ankora.protokol.manage",
    tabs: [
      { id: "protokol", label: "Předávací protokol", viewPerm: "recepce.ankora.protokol.view" },
      { id: "walkiny", label: "Walkiny", viewPerm: "recepce.ankora.walkiny.view" },
      { id: "taxi", label: "Taxi", viewPerm: "recepce.ankora.taxi.view" },
    ],
  },
];

export function isHotelSlug(value: unknown): value is HotelSlug {
  return typeof value === "string" && (HOTEL_SLUGS as readonly string[]).includes(value);
}

export function hotelBySlug(slug: string | undefined): Hotel | undefined {
  return HOTELS.find((h) => h.slug === slug);
}

/** Hotels the user can open, in fixed order — those they hold `recepce.<stem>.view` for. */
export function accessibleHotels(can: (perm: Permission) => boolean): Hotel[] {
  return HOTELS.filter((h) => can(h.viewPerm));
}

/** Tabs of a hotel the user can see, in fixed order — those they hold the tab's view key for. */
export function visibleTabs(hotel: Hotel, can: (perm: Permission) => boolean): HotelTab[] {
  return hotel.tabs.filter((t) => can(t.viewPerm));
}

const LAST_HOTEL_KEY = "recepce.lastHotel";

export function rememberLastHotel(slug: HotelSlug): void {
  try {
    window.localStorage.setItem(LAST_HOTEL_KEY, slug);
  } catch {
    // ignore (private mode etc.)
  }
}

export function readLastHotel(): HotelSlug | null {
  try {
    const raw = window.localStorage.getItem(LAST_HOTEL_KEY);
    return isHotelSlug(raw) ? raw : null;
  } catch {
    return null;
  }
}
