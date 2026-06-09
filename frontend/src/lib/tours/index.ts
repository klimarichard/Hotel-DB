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

/** True when the user holds the step's permission — or ANY of them if it's an
 *  array (OR semantics for merged-variant steps). Always true when unset. */
export function userHasStepPermission(
  step: { permission?: Permission | Permission[] },
  can: (perm: Permission) => boolean
): boolean {
  if (!step.permission) return true;
  return Array.isArray(step.permission) ? step.permission.some(can) : can(step.permission);
}

export function buildAppTour(can: (perm: Permission) => boolean): TourDefinition {
  return {
    ...appTour,
    steps: APP_TOUR_STEPS.filter((step) => userHasStepPermission(step, can)),
  };
}

export { appTour, APP_TOUR_STEPS };
export type { TourDefinition, TourStep } from "./types";
