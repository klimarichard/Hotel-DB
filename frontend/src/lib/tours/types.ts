/**
 * Types for the onboarding guided tour. A tour is an ordered list of steps;
 * each step optionally spotlights a `data-tour="<anchor>"` element and may
 * navigate to a route first. anchor === null renders a centered card (used for
 * the welcome / outro steps).
 *
 * The tour is PERMISSION-DRIVEN: a single master step list covers every
 * permission in the catalog, and each user sees only the steps whose
 * `permission` they actually hold (steps with no `permission` – welcome /
 * outro – are always shown). There are no per-role tours.
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
   * step's anchor – used to reveal controls behind tabs/expanders (e.g. click a
   * tab button so its content mounts). Clicked in order as they appear; missing
   * ones are skipped. The engine then waits for `anchor` and falls back to a
   * centered card if it never appears.
   */
  reveal?: string[];
  /**
   * Permission key(s) gating this step. The step is included when the user holds
   * the permission – or, if an array is given, ANY of them (OR semantics, used
   * for steps that merge two near-identical permission variants such as
   * employees.view.all / employees.view.nonManagement). Omit for always-shown
   * steps (welcome / outro). Steps whose `permission` lives on a section without
   * a dedicated on-page anchor spotlight that section's sidebar nav item instead.
   */
  permission?: Permission | Permission[];
  /**
   * Inverse ("superset") gate: hide this step when the user holds ANY of these
   * permissions. For steps that are redundant or inapplicable for a
   * higher-privileged user – e.g. the "Schválené dovolené kolegů" step is
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
   * The tour `version` at which this step was INTRODUCED. Drives the "what's new"
   * mini-tour: a returning user who already saw version N is shown only the steps
   * whose `addedInVersion > N` (not the whole tour again). Leave UNSET for the
   * original/baseline steps (treated as version 0 – never part of a delta). When
   * you add a step for a new feature, set this to the new `appTour.version` and
   * bump `appTour.version` to match. See buildAppTour({ sinceVersion }).
   */
  addedInVersion?: number;
  /**
   * Copy overrides used ONLY in delta ("Co je nového") mode, i.e. for a returning
   * user who already saw an earlier version.
   *
   * A step that announces a MOVED control has to speak with two voices. To a
   * returning user it is news ("Prohlášení poplatníka je nyní zde - přesunulo se
   * ze záložky Další dokumenty"). To a first-time user that same sentence is
   * nonsense: nyní as opposed to what? They have never seen the old placement.
   *
   * So `title`/`body` stay written for someone meeting the control for the FIRST
   * time (they are what the full tour and the Nápověda page show), and
   * `deltaTitle`/`deltaBody` carry the "this moved / this is new" framing that
   * only makes sense to someone who knew the previous layout. buildAppTour
   * substitutes them when `sinceVersion` is set. Omit both for an ordinary new
   * feature, where the same copy reads correctly either way.
   */
  deltaTitle?: string;
  deltaBody?: string;
  /**
   * Section label this step belongs to (e.g. "Zaměstnanci", "Mzdy"). Set it only
   * on the FIRST step of each section in the master list; buildAppTour resolves it
   * onto every following step by carry-forward (BEFORE permission filtering, so it
   * survives even when a section's first step is filtered out). Drives the
   * "Předchozí/Další sekce" jump buttons in the overlay.
   */
  section?: string;
  /**
   * Hide this step when the current user has NO linked employee record. Used for
   * steps that spotlight a control that only renders for employee-linked users –
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
  /**
   * Phone-only anchor override. On phones (the app's bottom-nav layout) the
   * sidebar is `display:none`, so steps that spotlight a sidebar control
   * (`nav-*`, footer utilities) would anchor to a zero-size hidden element.
   * Set `mobileAnchor` to the equivalent `data-tour` on the bottom nav (e.g.
   * `"bottomnav-smeny"`, `"bottomnav-more"`). Resolved in `buildAppTour` only
   * when `ctx.isPhone` – desktop is never affected. Leave unset to reuse
   * `anchor`; `null` forces a centered card on phones.
   */
  mobileAnchor?: string | null;
  /**
   * Phone-only body override (e.g. to say a section lives under the "Více"
   * sheet). Resolved in `buildAppTour` when `ctx.isPhone`; leave unset to reuse
   * `body`. Desktop copy is never changed.
   */
  mobileBody?: string;
  /**
   * Drop this step entirely on phones – for steps with no bottom-nav equivalent
   * (e.g. the logged-in-user footer line, the theme toggle, which live in the
   * "Více" sheet rather than as a spotlightable control). Filtered in
   * `buildAppTour` when `ctx.isPhone`.
   */
  hideOnMobile?: boolean;
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
