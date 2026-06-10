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
   * `data-tour` anchors to CLICK (once each, if present) before resolving this
   * step's anchor — used to reveal controls behind tabs/expanders (e.g. click a
   * tab button so its content mounts). Clicked in order as they appear; missing
   * ones are skipped. The engine then waits for `anchor` and falls back to a
   * centered card if it never appears.
   */
  reveal?: string[];
  /**
   * Permission key(s) gating this step. The step is included when the user holds
   * the permission — or, if an array is given, ANY of them (OR semantics, used
   * for steps that merge two near-identical permission variants such as
   * employees.view.all / employees.view.nonManagement). Omit for always-shown
   * steps (welcome / outro). Steps whose `permission` lives on a section without
   * a dedicated on-page anchor spotlight that section's sidebar nav item instead.
   */
  permission?: Permission | Permission[];
  /**
   * Inverse ("superset") gate: hide this step when the user holds ANY of these
   * permissions. For steps that are redundant or inapplicable for a
   * higher-privileged user — e.g. the "Schválené dovolené kolegů" step is
   * superseded by `vacation.view.all` (which already lists ALL requests), and the
   * "Moje žádosti" shift step is hidden in-app for anyone who can publish
   * (`shifts.plan.transition`), so it's pointless to show it to them. The
   * effective rule is: HAS `permission` AND NOT any `excludeIfPermission`.
   */
  excludeIfPermission?: Permission | Permission[];
  /**
   * Hide this step in the production build (`import.meta.env.MODE === "production"`).
   * Used for steps that describe non-prod-only tooling (e.g. the test clock,
   * which is inert in prod). Filtered out in buildAppTour().
   */
  hideInProd?: boolean;
  /**
   * Hide this step when the current user has NO linked employee record. Used for
   * steps that spotlight a control that only renders for employee-linked users —
   * e.g. the "Moje směny" overview tile (`!!employeeId`), which never appears for
   * an admin account with no employee. Without this gate such a step would
   * spotlight a missing anchor and time out to a centered card. Filtered out in
   * buildAppTour() when `hasEmployee` is false.
   */
  requiresEmployee?: boolean;
  /**
   * How the engine scrolls the anchor into view (`scrollIntoView({ block })`).
   * Defaults to "center". Set "start" for tall anchors (e.g. the employees table)
   * so the user lands on the TOP of the element rather than its middle.
   */
  scrollBlock?: ScrollLogicalPosition;
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
