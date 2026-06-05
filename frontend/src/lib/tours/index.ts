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

export function buildAppTour(can: (perm: Permission) => boolean): TourDefinition {
  return {
    ...appTour,
    steps: APP_TOUR_STEPS.filter((step) => !step.permission || can(step.permission)),
  };
}

export { appTour, APP_TOUR_STEPS };
export type { TourDefinition, TourStep } from "./types";
