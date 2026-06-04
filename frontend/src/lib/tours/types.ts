/**
 * Types for the onboarding guided tour. A tour is an ordered list of steps;
 * each step optionally spotlights a `data-tour="<anchor>"` element and may
 * navigate to a route first. anchor === null renders a centered card (used for
 * the welcome / outro steps).
 */
import type { Permission } from "@/lib/permissions/catalog";

export type TourPlacement = "top" | "bottom" | "left" | "right" | "auto";

export interface TourStep {
  /** data-tour attribute value to spotlight; null = centered card. */
  anchor: string | null;
  /** Route to navigate to before showing this step (omit if same page). */
  route?: string;
  title: string;
  body: string;
  placement?: TourPlacement;
  /** Show this step only if the user holds this permission. Omit = always shown.
   *  This is what makes one adaptive tour serve every user type (built-in AND
   *  custom): the engine filters steps to those the user can actually reach. */
  permission?: Permission;
}

export interface TourDefinition {
  id: string;
  /** Bump to re-show a revised tour to users who already completed it. */
  version: number;
  /** Czech label for the replay button / Help page. */
  label: string;
  steps: TourStep[];
}
