import type { TourDefinition } from "./types";
import type { Permission } from "@/lib/permissions/catalog";
import { appTour, APP_TOUR_STEPS } from "./appTour";

/**
 * There is a single, permission-driven tour. `buildAppTour(can)` returns the
 * tour with its steps filtered down to the ones the current user holds — steps
 * with no `permission` (welcome / outro) are always kept. No per-role tours.
 */
export const APP_TOUR_ID = appTour.id;
export const APP_TOUR_VERSION = appTour.version;

/**
 * Whether a step is shown for this user. The rule is:
 *   HAS `permission` (any of them if it's an array — OR semantics for merged
 *   variants)  AND NOT any `excludeIfPermission` (the inverse "superset" gate —
 *   a superseding permission hides a step that would be redundant, e.g. an admin
 *   who can see ALL vacation requests shouldn't get the approved-colleagues-only
 *   step). Steps with no `permission` (welcome / outro) are always shown unless
 *   excluded.
 */
export function userHasStepPermission(
  step: { permission?: Permission | Permission[]; excludeIfPermission?: Permission | Permission[] },
  can: (perm: Permission) => boolean
): boolean {
  if (step.excludeIfPermission) {
    const exclude = Array.isArray(step.excludeIfPermission)
      ? step.excludeIfPermission
      : [step.excludeIfPermission];
    if (exclude.some(can)) return false;
  }
  if (!step.permission) return true;
  return Array.isArray(step.permission) ? step.permission.some(can) : can(step.permission);
}

/** Production build flag — staging/dev keep non-prod-only steps (e.g. test clock). */
const IS_PROD = import.meta.env.MODE === "production";

/**
 * Context beyond the permission set that some steps gate on.
 *  - `hasEmployee`: whether the user has a linked employee record. Steps marked
 *    `requiresEmployee` (e.g. the "Moje směny" tile) are dropped when false.
 */
export interface TourBuildContext {
  hasEmployee: boolean;
}

export function buildAppTour(
  can: (perm: Permission) => boolean,
  ctx: TourBuildContext = { hasEmployee: true }
): TourDefinition {
  return {
    ...appTour,
    steps: APP_TOUR_STEPS.filter((step) => {
      if (step.hideInProd && IS_PROD) return false;
      if (step.requiresEmployee && !ctx.hasEmployee) return false;
      return userHasStepPermission(step, can);
    }),
  };
}

export { appTour, APP_TOUR_STEPS };
export type { TourDefinition, TourStep } from "./types";
