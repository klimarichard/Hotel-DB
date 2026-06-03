import type { UserRole } from "@/hooks/useAuth";
import type { Permission } from "@/lib/permissions/catalog";

/**
 * Single source of truth for sidebar menu items. Each item carries:
 *  - `permission`: the nav.* permission that gates sidebar visibility + the
 *    matching route guard in App.tsx (the real driver since Phase 3).
 *  - `roles`: the legacy role list, still used by the per-role menu-order
 *    configurator in Settings (Settings → Menu). Kept in sync with `permission`
 *    for built-in roles; the configurator becomes user-type-based in Phase 4-5.
 *
 * IDs are stable strings used as Firestore array keys at settings/menuOrder.
 * Add a new item here AND a matching <Route> in App.tsx; the sidebar will
 * pick it up automatically (appended at the end of any saved order until
 * the admin reorders it).
 */
export interface MenuItem {
  id: string;
  label: string;
  path: string;
  permission: Permission;
  roles: ReadonlyArray<UserRole>;
}

export const ALL_ROLES: ReadonlyArray<UserRole> = ["admin", "director", "manager", "employee", "accountant", "hr"];
export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  director: "Director",
  manager: "FOM",
  employee: "Employee",
  accountant: "Accountant",
  hr: "HR",
};

export const MENU_ITEMS: ReadonlyArray<MenuItem> = [
  { id: "prehled",     label: "Přehled",         path: "/prehled",     permission: "nav.dashboard.view",         roles: ["admin", "director", "manager", "employee", "hr", "accountant"] },
  { id: "smeny",       label: "Směny",           path: "/smeny",       permission: "nav.shifts.view",            roles: ["admin", "director", "manager", "employee", "hr"] },
  { id: "dovolena",    label: "Dovolená",        path: "/dovolena",    permission: "nav.vacation.view",          roles: ["admin", "director", "manager", "employee", "hr"] },
  { id: "zamestnanci", label: "Zaměstnanci",     path: "/zamestnanci", permission: "nav.employees.view",         roles: ["admin", "director", "accountant", "hr"] },
  { id: "mzdy",        label: "Mzdy",            path: "/mzdy",        permission: "nav.payroll.view",           roles: ["admin", "director"] },
  { id: "upozorneni",  label: "Upozornění",      path: "/upozorneni",  permission: "nav.alerts.view",            roles: ["admin", "director"] },
  { id: "smlouvy",     label: "Šablony smluv",   path: "/smlouvy",     permission: "nav.contractTemplates.view", roles: ["admin", "director"] },
  { id: "audit",       label: "Log změn",        path: "/audit",       permission: "nav.audit.view",             roles: ["admin", "director"] },
  { id: "nastaveni",   label: "Nastavení",       path: "/nastaveni",   permission: "nav.settings.view",          roles: ["admin"] },
  { id: "mujProfil",   label: "Můj profil",      path: "/muj-profil",  permission: "nav.profile.view",           roles: ["admin", "director", "manager", "employee", "hr"] },
];

/**
 * Default visual order matches MENU_ITEMS declaration order. Used when no
 * settings doc exists or for new items the admin hasn't reordered yet.
 */
export function defaultOrderForRole(role: UserRole): string[] {
  return MENU_ITEMS.filter((m) => m.roles.includes(role)).map((m) => m.id);
}

/**
 * Resolve a role's effective order: take the saved id list, drop ids the
 * role can't access (or that don't exist anymore), then append any
 * permitted items the saved list is missing (so newly-added menu items
 * automatically appear).
 */
export function resolveOrderForRole(role: UserRole, savedOrder?: string[] | null): MenuItem[] {
  const allowed = MENU_ITEMS.filter((m) => m.roles.includes(role));
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
  // Append any allowed items missing from the saved order (default order).
  for (const item of allowed) {
    if (!seen.has(item.id)) out.push(item);
  }
  return out;
}

/**
 * Permission-based sidebar resolver (Phase 3) — the actual driver of sidebar
 * visibility. Takes the user's `can()` and the saved order: keeps only items
 * the user can see (via each item's `permission`), applies the saved order,
 * then appends any visible items missing from it. Mirrors resolveOrderForRole
 * but gates on permission instead of role, so it works for any user type.
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

export type MenuOrderMap = Partial<Record<UserRole, string[]>>;
