import type { TourDefinition } from "./types";
import { employeeTour } from "./employeeTour";
import { managerTour } from "./managerTour";

/**
 * Registry of all onboarding tours, keyed by tourId. New roles add a tour here
 * + a branch in resolveTourIdForRole — no engine/schema change needed.
 */
export const TOURS: Record<string, TourDefinition> = {
  [employeeTour.id]: employeeTour,
  [managerTour.id]: managerTour,
};

/**
 * Which tour (if any) auto-runs for a user. Pass the roleType id (preferred) or
 * the legacy role — for built-in types they're the same string. Employee +
 * manager ship in v1; everything else returns null (no auto-tour) for now.
 */
export function resolveTourIdForRole(roleOrType: string | null): string | null {
  switch (roleOrType) {
    case "employee":
      return "employee";
    case "manager":
      return "manager";
    default:
      return null;
  }
}

export type { TourDefinition, TourStep } from "./types";
