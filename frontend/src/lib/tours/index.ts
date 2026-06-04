import type { UserRole } from "@/hooks/useAuth";
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
 * Which tour (if any) auto-runs for a given role. Employee + manager ship in
 * v1; the other roles return null (no auto-tour) until their tours are added.
 */
export function resolveTourIdForRole(role: UserRole | null): string | null {
  switch (role) {
    case "employee":
      return "employee";
    case "manager":
      return "manager";
    default:
      return null;
  }
}

export type { TourDefinition, TourStep } from "./types";
