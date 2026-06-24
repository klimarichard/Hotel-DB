import type { TourDefinition } from "./types";
import type { Permission } from "@/lib/permissions/catalog";
import { appTour, APP_TOUR_STEPS, WHATS_NEW_INTRO } from "./appTour";

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
  /**
   * Whether the current viewport is the phone (bottom-nav) layout. When true,
   * `buildAppTour` drops `hideOnMobile` steps and rewrites each step's
   * `anchor`/`body` from its `mobileAnchor`/`mobileBody` overrides. Defaults to
   * false so the desktop tour — and the Nápověda page, which lists content
   * regardless of viewport — is unaffected.
   */
  isPhone?: boolean;
}

export interface TourBuildOptions {
  /**
   * Delta ("what's new") mode: keep only steps INTRODUCED after this version
   * (`addedInVersion > sinceVersion`), prefixed with the WHATS_NEW_INTRO card.
   * Used for returning users who already saw an older version. Omit for the full
   * tour (first-time users + manual replay from Nápověda). When no new step
   * matches the user's permissions, the returned tour has an empty `steps` array
   * — the caller should then skip firing and just record the seen-version.
   */
  sinceVersion?: number;
}

export function buildAppTour(
  can: (perm: Permission) => boolean,
  ctx: TourBuildContext = { hasEmployee: true },
  opts: TourBuildOptions = {}
): TourDefinition {
  // Resolve each step's section by carry-forward over the MASTER list FIRST (only
  // the first step of each group carries an explicit `section`), THEN filter — so
  // a step keeps its section even if its group's lead step is filtered out.
  let currentSection = "";
  const withSection = APP_TOUR_STEPS.map((step) => {
    if (step.section) currentSection = step.section;
    return step.section === currentSection ? step : { ...step, section: currentSection };
  });
  let steps = withSection.filter((step) => {
    if (step.hideInProd && IS_PROD) return false;
    if (step.requiresEmployee && !ctx.hasEmployee) return false;
    if (step.hideOnMobile && ctx.isPhone) return false;
    return userHasStepPermission(step, can);
  });

  // Phone layout: rewrite sidebar-anchored steps onto their bottom-nav
  // equivalents. Done here (not in TourOverlay) so the overlay stays
  // viewport-agnostic and the desktop tour is byte-for-byte unchanged.
  if (ctx.isPhone) {
    steps = steps.map((step) => {
      if (step.mobileAnchor === undefined && step.mobileBody === undefined) return step;
      return {
        ...step,
        anchor: step.mobileAnchor !== undefined ? step.mobileAnchor : step.anchor,
        body: step.mobileBody !== undefined ? step.mobileBody : step.body,
      };
    });
  }

  // Delta mode: restrict to steps added after the user's last-seen version, and
  // lead with the "what's new" card (only when there's something new to show).
  if (opts.sinceVersion !== undefined) {
    const since = opts.sinceVersion;
    const fresh = steps.filter((step) => (step.addedInVersion ?? 0) > since);
    steps = fresh.length > 0 ? [WHATS_NEW_INTRO, ...fresh] : [];
  }

  return { ...appTour, steps };
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
