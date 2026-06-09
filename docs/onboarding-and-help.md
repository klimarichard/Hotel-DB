# Onboarding Tour & Nápověda (Help)

This document covers the guided onboarding tour, the Nápověda (Help) page, and the demo-route architecture that lets the tour safely show real pages on mock data.

## Overview

When a user logs in for the first time (or after a tour version bump) a full-app interactive tour auto-starts. The tour spotlights actual on-page controls, navigates between pages, and is filtered to exactly the permissions the current user holds — there are no per-role tours and no duplicated content. After finishing, users can replay or browse the same content from the **Nápověda** link in the sidebar footer.

---

## Source files

| Purpose | Path |
|---|---|
| Step list + tour definition | `frontend/src/lib/tours/appTour.ts` |
| TypeScript types | `frontend/src/lib/tours/types.ts` |
| Public API + filtering logic | `frontend/src/lib/tours/index.ts` |
| Mock data + demo dispatcher | `frontend/src/lib/tours/demoData.ts` |
| State management (context) | `frontend/src/context/OnboardingContext.tsx` |
| Overlay / popover renderer | `frontend/src/components/TourOverlay.tsx` |
| Demo route wrapper | `frontend/src/pages/TourDemoRoute.tsx` |
| Nápověda page | `frontend/src/pages/HelpPage.tsx` (+ `HelpPage.module.css`) |
| Help section screenshots | `frontend/src/lib/help/helpImages.ts` |
| Backend persistence | `functions/src/routes/auth.ts` → `GET/PUT /api/auth/me/tours` |

---

## Step definition — `TourStep`

Every step in `APP_TOUR_STEPS` (`appTour.ts`) is a `TourStep` object:

```ts
interface TourStep {
  anchor: string | null;         // data-tour="…" attribute to spotlight; null = centered card
  route?: string;                // navigate here before resolving the anchor
  reveal?: string[];             // data-tour anchors to click (in order) before the main anchor
                                 // (opens tabs / expanders so their content mounts)
  permission?: Permission | Permission[];
  excludeIfPermission?: Permission | Permission[];
  hideInProd?: boolean;
  title: string;
  body: string;
  placement?: "top" | "bottom" | "left" | "right" | "auto";
}
```

There is a **single master list** of roughly 91 steps covering every permission in the catalogue. The welcome and outro steps have no `permission` and are always shown.

---

## Permission gating

Three orthogonal filters, all applied in `buildAppTour(can)` inside `frontend/src/lib/tours/index.ts`:

### 1. `permission` — inclusion gate (OR semantics)
A step is included when the user holds the given permission. If `permission` is an **array**, the step is shown when the user holds **any** of them (OR semantics). This is used for steps that merge two near-identical permission variants, e.g. `["employees.view.all", "employees.view.nonManagement"]`.

Steps with no `permission` (welcome, outro) are always included.

### 2. `excludeIfPermission` — inverse "superset" gate
A step is **hidden** when the user holds **any** of these permissions, even if the `permission` gate passed. Used for steps that become redundant for higher-privileged users:
- "Schválené dovolené kolegů" (`vacation.view.approvedUpcoming`) is excluded for `vacation.view.all` holders — the "Všechny žádosti" table they already see lists every approved request.
- "Žádost o změnu směny" (`shifts.changeRequest.submit`) is excluded for `shifts.plan.transition` holders — plan managers don't use the request-a-change flow.

The effective inclusion rule is: **HAS `permission` (any) AND NOT any `excludeIfPermission`**.

### 3. `hideInProd` — environment filter
Steps flagged `hideInProd: true` are removed when `import.meta.env.MODE === "production"`. Used for the test-clock step, which describes a control that is inert in prod.

The filtering function is exported as `userHasStepPermission(step, can)` for reuse (e.g. in `HelpPage`).

---

## Tour engine — `OnboardingContext` + `TourOverlay`

### State (`OnboardingContext.tsx`)

`OnboardingProvider` wraps the entire authenticated app. It:

1. **Loads persistence** — on login, seeds from `localStorage` (`hotel_hr_tours_<uid>`) for a flash-free paint, then fetches the authoritative `toursSeen` map from `GET /api/auth/me/tours`.
2. **Auto-starts once** — after the first real page load (not `/` or `/login`), when `toursSeen[APP_TOUR_ID]` is absent or below `APP_TOUR_VERSION`, fires `startTour()`. The auto-start is guarded on `loading` (waits for `/auth/me` to resolve) to avoid the per-component `useAuth` race; `autoStartedRef` prevents double-firing on re-renders.
3. **Builds the filtered tour** — `startTour()` calls `buildAppTour(can)`, which filters `APP_TOUR_STEPS` to the current user's permissions. The same filtered tour is used for both auto-start and manual replay, so both paths see exactly the same steps.
4. **Marks seen** — `dismiss()` / reaching the last step calls `markSeen(tour)`, which merges `{ [tour.id]: tour.version }` into `toursSeen`, writes it to `localStorage`, and calls `PUT /api/auth/me/tours`.

Exposed context value: `{ activeTour, stepIndex, startTour, next, prev, dismiss }`.

### Overlay (`TourOverlay.tsx`)

`TourOverlay` is rendered inside `OnboardingProvider` and overlays the whole app. For each step it:

1. **Navigates** to `step.route` if the current pathname doesn't match (using React Router `useNavigate`).
2. **Resolves the anchor** — polls `document.querySelector('[data-tour="…"]')` every 80 ms for up to 2 000 ms. Before polling the main anchor, clicks each `reveal` anchor once as it appears (opening the right tab / expander). If the anchor is never found, the step **falls back to a centered card** — it never hangs or blocks progress.
3. **Positions the popover** — 340 px wide, placed below the anchor if there is room, otherwise above; both axes are clamped so the popover never bleeds off-screen.
4. **Keyboard bindings** — `Esc` = dismiss, `Enter` / `→` = next, `←` = prev.

When `anchor` is `null` (welcome, outro, or fallback) the overlay dims the full page and centers the popover.

---

## Tour version & re-showing

`appTour.version` is the integer in `frontend/src/lib/tours/appTour.ts`:

```ts
export const appTour: TourDefinition = {
  id: "app",
  version: 5,   // bump this to re-show the tour to everyone who already completed it
  ...
};
```

`OnboardingContext` re-shows the tour to a user when their stored version is **less than** `appTour.version`. Bump the version whenever the tour content changes substantially enough to warrant a re-run.

---

## Persistence — `users/{uid}.toursSeen`

The backend stores one Firestore field on the user document:

```
users/{uid}.toursSeen = { "app": 5 }   // tourId → completedVersion
```

Two endpoints in `functions/src/routes/auth.ts`:

| Endpoint | Body / Response | Gate |
|---|---|---|
| `GET /api/auth/me/tours` | — / `{ toursSeen: { [tourId]: number } }` | authenticated |
| `PUT /api/auth/me/tours` | `{ tourId, version }` / `{ ok: true }` | authenticated |

`PUT` uses `{ merge: true }` so sibling tour entries are preserved (future-proofing for multiple tours).

---

## Demo-route architecture

The tour spotlights real controls. Many controls only exist in a specific app state (a published shift plan, an existing payroll period, a populated employee record). Rather than relying on real data that may not exist for a new user, the tour navigates to **demo routes** that render the **real pages** fed entirely by **mock data** — no backend calls, no Firestore reads or writes.

### How it works

`frontend/src/lib/api.ts` calls `getDemoResponse(method, path)` **before every fetch**. When it returns `{ hit: true }`, the mock `value` is returned immediately and no network request is made. This intercept is the single wiring point; every component and sub-component of a demo-rendered page receives its data through the normal data-fetching code paths, making the tour robust to component refactors.

**Non-GET requests that are intercepted return `{}` and are swallowed.** The tour can never write to the database even if the user clicks Save, Submit, or Delete on a demo page.

### Sentinel employee

Any request to `/employees/tour-demo` or `/employees/tour-demo/...` is **always intercepted**, regardless of whether a demo route is mounted. `DEMO_EMP_ID = "tour-demo"` is the sentinel. The demo employee "Jan Novák" is crafted to surface every possible control simultaneously:

- Active session with **no contract** → "Generovat smlouvu" renders.
- Older terminated session **with** a signed contract → "Zobrazit / Stáhnout" and "Smazat smlouvu" render.
- Benefits with an active Multisport period + companion → MultisportEditor renders fully.
- Sensitive fields (`birthNumber`, `idCardNumber`, `insuranceNumber`, `bankAccount`) set to the mask constant → reveal eyes render.
- One pending `OtherDocument` → view/download/delete buttons render.

### Scenario-keyed fixtures

For pages where the mock depends on the app state (Směny, Mzdy, Můj profil), the scenario is derived **from the URL pathname** by `activeScenario()` — not from a mutable flag — to be race-proof when the tour navigates between two demo routes that render the same page component.

```
/napoveda/ukazka-profil          → "self"        (Můj profil, populated)
/napoveda/ukazka-mzdy            → "payroll"      (PayrollPage, populated period)
/napoveda/ukazka-mzdy-prazdne    → "payroll-empty" (PayrollPage, no period → create state)
/napoveda/ukazka-smeny           → "shifts"       (ShiftPlannerPage, opened plan)
/napoveda/ukazka-smeny-prazdne   → "shifts-empty"  (ShiftPlannerPage, no plan → create state)
/napoveda/ukazka-smeny-vytvoreny → "shifts-created" (created plan → "Smazat plán" visible)
/napoveda/ukazka-smeny-publikovane → "shifts-published" (published plan → Volné směny section)
```

Each route is registered in `App.tsx` with a per-route `key` (the path), so when the tour navigates between two demo routes that render the same page component (e.g. shifts-opened → shifts-published), React **unmounts and remounts** the page, ensuring a fresh fetch is fired with the new scenario already set.

### `TourDemoRoute` wrapper

Demo routes that need the scenario flag are wrapped in `<TourDemoRoute scenario="…">`:

```tsx
<Route path="/napoveda/ukazka-smeny" element={
  <TourDemoRoute scenario="shifts"><ShiftPlannerPage /></TourDemoRoute>
} />
```

`TourDemoRoute` sets `tourDemo.active = true` and `tourDemo.scenario` **synchronously during render** (so they are already set before the child's mount-effect fires its first fetch) and clears them on unmount. The sentinel-employee routes need no wrapper — they are keyed off the id in the path.

### `/me/*` endpoints (Můj profil demo)

The self-page calls `/me/*` endpoints that are not id-scoped. These are intercepted only while `activeScenario() === "self"` (the `/napoveda/ukazka-profil` route is mounted). The `SELF_PATHS` set in `demoData.ts` lists every path this demo handles; any path not in the set passes through normally.

---

## Nápověda (Help) page

`frontend/src/pages/HelpPage.tsx` — route `/napoveda`, accessible to every authenticated user (no permission gate).

It displays the same content as the tour, without the overlay:

1. Calls `buildAppTour(can)` and filters out the welcome/outro steps (no `permission`).
2. Groups remaining steps by their permission's catalog group (using `PERMISSION_CATALOG` from `frontend/src/lib/permissions/catalog.ts`) preserving catalog order.
3. Renders each group as a `<section>` with an optional screenshot from `helpImages.ts`.
4. A full-text search (diacritic-insensitive) filters the already-permission-filtered list — search results can never include content the user cannot access.
5. The **"Spustit prohlídku"** button calls `startTour()` from `OnboardingContext`, replaying the guided tour from step 1.

The "? Nápověda" button in the sidebar footer links to `/napoveda`.

**Single source of truth:** adding a new permission to the catalogue and a matching tour step automatically surfaces the new entry in Nápověda — no separate help content to maintain.

---

## Adding or updating tour steps

1. Add the `data-tour="<anchor>"` attribute to the relevant DOM element in the page component.
2. Add (or update) the matching `TourStep` entry in `APP_TOUR_STEPS` in `appTour.ts`. Set `permission` to the controlling permission key, `route` to the page route, and `reveal` to any tab/expander anchors that must be clicked first.
3. If the step targets a demo-only route, verify the route and scenario are registered in `App.tsx` and `demoData.ts`.
4. If the new content is significant, bump `appTour.version` so the tour re-shows to existing users.
5. No separate Nápověda update is needed — the page derives its content from the step list automatically.
6. Follow the permission-matrix rule: any **new** permission also needs to be added to the backend + frontend permission catalogue and to `BUILTIN_ROLE_PERMISSIONS` (see `docs/auth-and-permissions.md`).
