import type { UserRole } from "@/hooks/useAuth";

/**
 * Single source of truth for sidebar menu items. Each item knows the roles
 * that can see it (mirrors the route guards in App.tsx), so the per-role
 * order configurator in Settings can filter against this list.
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
  roles: ReadonlyArray<UserRole>;
}

export const ALL_ROLES: ReadonlyArray<UserRole> = ["admin", "director", "manager", "employee"];
export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  director: "Director",
  manager: "Manager",
  employee: "Employee",
};

export const MENU_ITEMS: ReadonlyArray<MenuItem> = [
  { id: "prehled",     label: "Přehled",         path: "/prehled",     roles: ["admin", "director", "manager", "employee"] },
  { id: "smeny",       label: "Směny",           path: "/smeny",       roles: ["admin", "director", "manager", "employee"] },
  { id: "dovolena",    label: "Dovolená",        path: "/dovolena",    roles: ["admin", "director", "manager", "employee"] },
  { id: "zamestnanci", label: "Zaměstnanci",     path: "/zamestnanci", roles: ["admin", "director"] },
  { id: "mzdy",        label: "Mzdy",            path: "/mzdy",        roles: ["admin", "director"] },
  { id: "upozorneni",  label: "Upozornění",      path: "/upozorneni",  roles: ["admin", "director"] },
  { id: "smlouvy",     label: "Šablony smluv",   path: "/smlouvy",     roles: ["admin", "director"] },
  { id: "audit",       label: "Log změn",        path: "/audit",       roles: ["admin", "director"] },
  { id: "nastaveni",   label: "Nastavení",       path: "/nastaveni",   roles: ["admin"] },
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

export type MenuOrderMap = Partial<Record<UserRole, string[]>>;
