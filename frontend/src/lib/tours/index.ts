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
  // Resolve each step's section by carry-forward over the MASTER list FIRST (only
  // the first step of each group carries an explicit `section`), THEN filter — so
  // a step keeps its section even if its group's lead step is filtered out.
  let currentSection = "";
  const withSection = APP_TOUR_STEPS.map((step) => {
    if (step.section) currentSection = step.section;
    return step.section === currentSection ? step : { ...step, section: currentSection };
  });
  return {
    ...appTour,
    steps: withSection.filter((step) => {
      if (step.hideInProd && IS_PROD) return false;
      if (step.requiresEmployee && !ctx.hasEmployee) return false;
      return userHasStepPermission(step, can);
    }),
  };
}

/**
 * Targets for the "Předchozí/Další sekce" jump buttons, given the filtered step
 * list and the current index. `next` is the first step of the following section
 * (null on the last section); `prev` is the first step of the preceding section
 * (null on the first section). Step-granular movement stays on Zpět/Další.
 */
export function sectionNavTargets(
  steps: TourDefinition["steps"],
  index: number
): { prev: number | null; next: number | null } {
  const cur = steps[index]?.section;
  // First step of the NEXT section.
  let next: number | null = null;
  for (let i = index + 1; i < steps.length; i++) {
    if (steps[i].section !== cur) { next = i; break; }
  }
  // Walk back to the start of the CURRENT section, then to the start of the one
  // before it.
  let start = index;
  while (start > 0 && steps[start - 1].section === cur) start--;
  let prev: number | null = null;
  if (start > 0) {
    const prevSection = steps[start - 1].section;
    let p = start - 1;
    while (p > 0 && steps[p - 1].section === prevSection) p--;
    prev = p;
  }
  return { prev, next };
}

export { appTour, APP_TOUR_STEPS };
export type { TourDefinition, TourStep } from "./types";
