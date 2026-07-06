import type { Permission } from "@/lib/permissions/catalog";

/**
 * Single source of truth for sidebar menu items. Each item's `permission` (a
 * nav.* key) gates both sidebar visibility and the matching route guard in
 * App.tsx. Visibility/order are entirely permission-driven (no roles).
 *
 * IDs are stable strings used as Firestore array keys at settings/menuOrder
 * (keyed by user-type id). Add a new item here AND a matching <Route> in
 * App.tsx; the sidebar picks it up automatically (appended at the end of any
 * saved order until reordered).
 */
export interface MenuItem {
  id: string;
  label: string;
  path: string;
  permission: Permission;
  /** Hidden from the phone bottom-nav (still in the desktop sidebar). For pages
   *  that aren't usable on a phone — e.g. the A4 contract-template editor. */
  hideOnMobile?: boolean;
}

export const MENU_ITEMS: ReadonlyArray<MenuItem> = [
  { id: "prehled",     label: "Přehled",         path: "/prehled",     permission: "nav.dashboard.view" },
  { id: "smeny",       label: "Směny",           path: "/smeny",       permission: "nav.shifts.view" },
  { id: "dovolena",    label: "Dovolená",        path: "/dovolena",    permission: "nav.vacation.view" },
  { id: "recepce",     label: "Recepce",         path: "/recepce",     permission: "nav.recepce.view" },
  { id: "zamestnanci", label: "Zaměstnanci",     path: "/zamestnanci", permission: "nav.employees.view" },
  { id: "mzdy",        label: "Mzdy",            path: "/mzdy",        permission: "nav.payroll.view" },
  { id: "upozorneni",  label: "Upozornění",      path: "/upozorneni",  permission: "nav.alerts.view" },
  { id: "smlouvy",     label: "Šablony smluv",   path: "/smlouvy",     permission: "nav.contractTemplates.view", hideOnMobile: true },
  { id: "audit",       label: "Log změn",        path: "/audit",       permission: "nav.audit.view" },
  { id: "nastaveni",   label: "Nastavení",       path: "/nastaveni",   permission: "nav.settings.view" },
  { id: "mujProfil",   label: "Můj profil",      path: "/muj-profil",  permission: "nav.profile.view" },
];

/**
 * Permission-based sidebar resolver — the driver of sidebar visibility + order.
 * Takes the user's `can()` and the saved order: keeps only items the user can
 * see (via each item's `permission`), applies the saved order, then appends any
 * visible items missing from it (so newly-added items appear automatically).
 * Works for any user type. Also used by the Settings menu-order configurator
 * (with a per-type `can`).
 */
export function resolveOrderByPermission(
  can: (perm: Permission) => boolean,
  savedOrder?: string[] | null
): MenuItem[] {
  const allowed = MENU_ITEMS.filter((m) => can(m.permission));
  const allowedById = new Map(allowed.map((m) => [m.id, m] as const));
  const seen = new Set<string>();
  const out: MenuItem[] = [];

  if (Array.isArray(savedOrder)) {
    for (const id of savedOrder) {
      const item = allowedById.get(id);
      if (item && !seen.has(id)) {
        out.push(item);
        seen.add(id);
      }
    }
  }
  for (const item of allowed) {
    if (!seen.has(item.id)) out.push(item);
  }
  return out;
}
