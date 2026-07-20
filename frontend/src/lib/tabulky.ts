import type { Permission } from "./permissions/catalog";

/**
 * Registry for the Tabulky page's tabs.
 *
 * Mirrors `hotels.ts` for Recepce: the tab list and its permission gates live
 * HERE, not in the page component. The page renders whatever `visibleTabs(can)`
 * returns, so gating is by omission — a tab the user cannot see never enters the
 * array, can never be selected, and its component never mounts.
 *
 * Adding a tab = add a TabulkyTab entry + its permission key (all four catalogs,
 * see reference: PERMISSIONS_LIST.md, permissions/catalog.ts,
 * functions/src/auth/permissions.ts) + a case in TabulkyPage's TabBody.
 */
export type TabulkyTabId = "smenarna";

export interface TabulkyTab {
  readonly id: TabulkyTabId;
  readonly label: string;
  /** Gates both the tab's visibility and its backend reads. */
  readonly viewPerm: Permission;
}

export const TABULKY_TABS: readonly TabulkyTab[] = [
  { id: "smenarna", label: "Směnárna + ČNB", viewPerm: "tabulky.smenarna.view" },
];

export function visibleTabulkyTabs(can: (perm: Permission) => boolean): TabulkyTab[] {
  return TABULKY_TABS.filter((t) => can(t.viewPerm));
}

export function tabulkyTabById(id: string | undefined): TabulkyTab | undefined {
  return TABULKY_TABS.find((t) => t.id === id);
}
