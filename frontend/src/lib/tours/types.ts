/**
 * Types for the onboarding guided tour. A tour is an ordered list of steps;
 * each step optionally spotlights a `data-tour="<anchor>"` element and may
 * navigate to a route first. anchor === null renders a centered card (used for
 * the welcome / outro steps).
 *
 * The tour is PERMISSION-DRIVEN: a single master step list covers every
 * permission in the catalog, and each user sees only the steps whose
 * `permission` they actually hold (steps with no `permission` — welcome /
 * outro — are always shown). There are no per-role tours.
 */
import type { Permission } from "@/lib/permissions/catalog";

export type TourPlacement = "top" | "bottom" | "left" | "right" | "auto";

export interface TourStep {
  /** data-tour attribute value to spotlight; null = centered card. */
  anchor: string | null;
  /** Route to navigate to before showing this step (omit if same page). */
  route?: string;
  /**
   * Permission key gating this step. The step is included only when the user's
   * `can(permission)` is true. Omit for always-shown steps (welcome / outro).
   * Steps whose `permission` lives on a section without a dedicated on-page
   * anchor spotlight that section's sidebar nav item instead.
   */
  permission?: Permission;
  title: string;
  body: string;
  placement?: TourPlacement;
}

export interface TourDefinition {
  id: string;
  /** Bump to re-show a revised tour to users who already completed it. */
  version: number;
  /** Czech label for the replay button / Help page. */
  label: string;
  steps: TourStep[];
}
