# Onboarding Tour & Nápověda (Help)

This document covers the guided onboarding tour, the Nápověda (Help) page, and the demo-route architecture that lets the tour safely show real pages on mock data.

## Overview

When a user logs in for the first time, a full-app interactive tour auto-starts. On subsequent logins, if new tour steps have been added since the user last completed the tour, a "what's new" mini-tour shows only those new steps. The tour spotlights actual on-page controls, navigates between pages, and is filtered to exactly the permissions the current user holds — there are no per-role tours and no duplicated content. After finishing, users can replay or browse the same content from the **Nápověda** link in the sidebar footer.

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
  addedInVersion?: number;       // tour version this step was introduced in (drives "what's new" delta)
  deltaTitle?: string;           // title override used ONLY in delta ("Co je nového") mode
  deltaBody?: string;            // body override used ONLY in delta mode
  section?: string;              // section label (e.g. "Zaměstnanci"); set on first step of group only
  requiresEmployee?: boolean;    // hide when the user has no linked employee record
  scrollBlock?: ScrollLogicalPosition; // how the anchor is scrolled into view; defaults to "center"
  title: string;
  body: string;
  placement?: "top" | "bottom" | "left" | "right" | "auto";
}
```

There is a **single master list** covering every permission in the catalogue. The welcome and outro steps have no `permission` and are always shown.

### New fields (added in tour revision pass)

**`addedInVersion?: number`** — the `appTour.version` value at which this step was introduced. Drives the "what's new" delta: a returning user who already completed version N sees only steps whose `addedInVersion > N`. Leave unset for baseline steps (treated as version 0 — they are never part of a delta). When you add a step for a new feature, set this to the new `appTour.version` and bump `appTour.version` to match.

**`section?: string`** — section label this step belongs to (e.g. `"Zaměstnanci"`, `"Nastavení"`). Set it only on the **first step of each section** in the master list. `buildAppTour` resolves it onto every following step by carry-forward **before** permission filtering, so a step retains its section even when its group's lead step is filtered out for the current user. Drives the "Předchozí/Další sekce" jump buttons in the overlay.

**`requiresEmployee?: boolean`** — when `true`, the step is dropped when the user has no linked employee record (`employeeId` is absent on the auth token). Used for steps that spotlight a control that only renders for employee-linked users — e.g. the "Moje směny" overview tile, which never appears for an admin account with no employee record. Without this gate the step would spotlight a missing anchor and time out to a centered fallback card.

**`deltaTitle?: string` / `deltaBody?: string`** (v4.6.0) — copy overrides applied **only** in delta ("Co je nového") mode. A step that announces a control that *moved* has to speak with two voices: to a returning user it's news ("Prohlášení poplatníka je nyní zde – přesunulo se ze záložky Další dokumenty"), but to a first-time user that framing is meaningless — they never saw the old placement. `title`/`body` stay written for someone meeting the control for the first time (what the full tour and the Nápověda page always show); `buildAppTour` substitutes `deltaTitle`/`deltaBody` for `title`/`body` only when building a delta tour (`opts.sinceVersion` set) and only for steps that set them. Omit both for an ordinary new feature, where the same copy reads correctly either way. A step whose control **moved** typically also needs its `addedInVersion` bumped to the new version even though the underlying feature is old — that's what re-enters it into the delta so existing users are told where the control went, instead of silently losing something they used to rely on (see the Prohlášení poplatníka and contract-upload-menu moves in `docs/employees.md` / `docs/contracts.md` for worked examples, `appTour.version` 14 → 15).

**`scrollBlock?: ScrollLogicalPosition`** — controls the `block` argument passed to `scrollIntoView({ block })` when the overlay scrolls the anchor into view. Defaults to `"center"`. Set to `"start"` for tall elements (e.g. the employees table) so the user lands at the top of the element rather than its middle.

**`mobileAnchor?: string | null` / `mobileBody?: string` / `hideOnMobile?: boolean`** — phone-layout overrides. On phones the sidebar is `display:none`, so a step that spotlights a sidebar control (`nav-*`, footer utilities) would otherwise anchor to a zero-size hidden element. These fields are resolved **only when `ctx.isPhone`** (see `buildAppTour` below) — the desktop tour and the Nápověda page are never affected:
- `mobileAnchor` — the `data-tour` to spotlight instead of `anchor` on phones, pointing at the bottom nav (`BottomNav.tsx` exposes `data-tour="bottomnav-<id>"` on the four fixed tabs and `data-tour="bottomnav-more"` on the "Více" button). `null` forces a centered card.
- `mobileBody` — body text used instead of `body` on phones (e.g. to note a section lives under the "Více" sheet).
- `hideOnMobile` — drop the step entirely on phones (used for the logged-in-user footer line and the theme toggle, which on phones live inside the "Více" sheet rather than as a spotlightable control; the logged-in user is shown in that sheet via `BottomNav`'s `userLabel` prop).

`OnboardingContext` computes `isPhone` from the same media query Layout uses to swap in the bottom nav (`(max-width: 559.98px), (orientation: landscape) and (max-height: 480px)`) and passes it into every `buildAppTour` call. The overlay itself stays viewport-agnostic — all phone resolution happens at build time.

---

## Permission gating

Four orthogonal filters, all applied in `buildAppTour(can, ctx?, opts?)` inside `frontend/src/lib/tours/index.ts`:

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

### 4. `requiresEmployee` — employee-linkage filter

Steps flagged `requiresEmployee: true` are removed when `ctx.hasEmployee` is `false`. `ctx` is the second argument to `buildAppTour`; `OnboardingContext` supplies `{ hasEmployee: !!employeeId }` from `useAuth().employeeId`.

The filtering function `userHasStepPermission(step, can)` (exported for reuse in `HelpPage`) covers only the permission/exclude gates; the `requiresEmployee` and `hideInProd` filters are applied in `buildAppTour` directly.

---

## `buildAppTour` — public API

```ts
function buildAppTour(
  can: (perm: Permission) => boolean,
  ctx?: TourBuildContext,   // { hasEmployee: boolean } — defaults to { hasEmployee: true }
  opts?: TourBuildOptions   // { sinceVersion?: number } — delta mode
): TourDefinition
```

Section carry-forward runs over the **master** list first (before any filtering), so every surviving step has a resolved `section` even when its group's lead step was filtered out. Then the four filters above are applied in order.

**Delta mode** (`opts.sinceVersion`): keeps only steps with `addedInVersion > sinceVersion`, and prepends the synthetic `WHATS_NEW_INTRO` ("Co je nového") card. If no step passes the delta filter for this user, the returned tour has an empty `steps` array — the caller should then skip firing and silently record the latest version.

**`sectionNavTargets(steps, index)`** — helper exported from `frontend/src/lib/tours/index.ts`. Given the filtered step list and the current step index, returns `{ prev: number | null, next: number | null }` — the step indices of the first step of the preceding and following sections respectively. Used by `TourOverlay` to drive the section-jump buttons.

---

## Tour engine — `OnboardingContext` + `TourOverlay`

### State (`OnboardingContext.tsx`)

`OnboardingProvider` wraps the entire authenticated app. It:

1. **Loads persistence** — on login, seeds from `localStorage` (`hotel_hr_tours_<uid>`) for a flash-free paint, then fetches the authoritative `toursSeen` map from `GET /api/auth/me/tours`.
2. **Auto-starts once** — after the first real page load (not `/` or `/login`), the auto-start runs a **three-way branch** (guarded on `loading` to avoid the per-component `useAuth` race; `autoStartedRef` prevents double-firing):
   - **Never seen** (`toursSeen[APP_TOUR_ID]` is absent) → full tour via `buildAppTour(can, ctx)`.
   - **Seen an older version** (`seenVersion < APP_TOUR_VERSION`) → delta tour via `buildAppTour(can, ctx, { sinceVersion: seenVersion })`. If the delta is empty for this user (no new steps match their permissions), `recordSeenVersion(APP_TOUR_VERSION)` is called silently — the tour does not fire.
   - **Up to date** (`seenVersion >= APP_TOUR_VERSION`) → nothing.
3. **Builds the filtered tour** — `startTour()` (manual replay from Nápověda) always calls `buildAppTour(can, { hasEmployee: !!employeeId })` without a `sinceVersion`, returning the full permission-filtered tour regardless of version.
4. **Records seen** — `dismiss()` / reaching the last step calls `recordSeenVersion(tour.version)`, which merges `{ [APP_TOUR_ID]: version }` into `toursSeen`, writes it to `localStorage`, and calls `PUT /api/auth/me/tours`. (`markSeen` no longer exists; `recordSeenVersion` is the current function name.)
5. **Demo-route redirect on dismiss** — if the user skips or closes the tour while parked on a tour-only demo route (`/napoveda/ukazka-*` or `/zamestnanci/tour-demo`), `dismiss` navigates to `"/"` (which resolves via `DefaultRedirect` to their landing page), so they are never stranded on a sandbox URL.

Exposed context value: `{ activeTour, stepIndex, startTour, next, prev, goToStep, dismiss }`.

`goToStep(index: number)` was added to support section-jump navigation. It clamps `index` to the valid range and updates `stepIndex` directly.

### Overlay (`TourOverlay.tsx`)

`TourOverlay` is rendered inside `OnboardingProvider` and overlays the whole app. For each step it:

1. **Navigates** to `step.route` if the current pathname doesn't match (using React Router `useNavigate`).
2. **Resolves the anchor** — polls `document.querySelector('[data-tour="…"]')` every 80 ms for up to 2 000 ms. Before polling the main anchor, clicks each `reveal` anchor once as it appears (opening the right tab / expander). Scrolls the anchor into view via `scrollIntoView({ block: step.scrollBlock ?? "center" })`. If the anchor is never found, the step **falls back to a centered card** — it never hangs or blocks progress.
3. **Positions the popover** — 340 px wide, placed below the anchor if there is room, otherwise above; both axes are clamped so the popover never bleeds off-screen.
4. **Popover header** — shows `"<sectionName> · Krok X z Y"` (the current section name is prepended when resolved).
5. **Section-jump navigation** — a second nav tier (`sectionNav`) sits above the Zpět/Další buttons. Two buttons — "‹ Předchozí sekce" and "Další sekce ›" — call `goToStep(index)` with targets from `sectionNavTargets`. Both buttons disable at the boundary of the first/last section; the entire row hides when neither target exists (single-section tours or fully degenerate cases).
6. **Keyboard bindings** — `Esc` = dismiss, `Enter` / `→` = next, `←` = prev.

When `anchor` is `null` (welcome, outro, or fallback) the overlay dims the full page and centers the popover.

---

## Tour version & "what's new" delta

`appTour.version` (currently **15** — the Employee-detail restructure + signed-contract split, v4.6.0) is the highest `addedInVersion` value present in the step list. It lives in `frontend/src/lib/tours/appTour.ts`:

```ts
export const appTour: TourDefinition = {
  id: "app",
  // Highest step `addedInVersion` in the list. Bump it (and stamp the new steps'
  // `addedInVersion`) whenever you add steps for a new feature.
  version: 15,
  ...
};
```

The model is **per-step versioning**, not whole-tour re-show. Adding a tour step for a new feature works as follows:

1. Set `addedInVersion: <N>` on the new step(s), where `<N>` is the new version number.
2. Bump `appTour.version` to `<N>`.

On the next login, `OnboardingContext` detects that `users/{uid}.toursSeen["app"]` is less than `appTour.version` and fires a **delta tour** (`buildAppTour(can, ctx, { sinceVersion: seenVersion })`). The delta contains only the new steps (filtered to the user's permissions), prefixed by the `WHATS_NEW_INTRO` ("Co je nového") card. First-time users receive the full tour and never see the delta path.

If a user's permissions don't include any of the new steps, the delta is empty and the tour does not auto-fire — `recordSeenVersion(APP_TOUR_VERSION)` is called silently to bring the stored version up to date.

**`toursSeen` Firestore field:**

```
users/{uid}.toursSeen = { "app": 15 }   // tourId → last seen version
```

The `PUT /api/auth/me/tours` body is `{ tourId, version }` and uses `merge: true` so other tour entries are preserved.

---

## Tour sections

The master step list is organised into **13 active sections** defined in the `SECTIONS` const in `appTour.ts`. The section label is set only on the first step of each group; `buildAppTour` carries it forward to every subsequent step before filtering. **Each section opens with its sidebar nav-item step** (gated on the matching `nav.*.view` permission) — e.g. `nav.employees.view` leads the Zaměstnanci section and `nav.payroll.view` leads Mzdy. There is no separate "Navigace" section; "Log změn" (`audit`) is a standalone single-step section, since the audit page has no further walkthrough steps.

| Section label | Content covered |
|---|---|
| Úvod | Welcome card, přihlášený uživatel, světlý/tmavý režim |
| Přehled | Nav-item step (Přehled) + dnešní datum header, Dnes/Zítra staffing, Moje směny tile, Úkoly, Statistiky |
| Směny | All shift-plan steps (view, edit, create, transitions, free shifts, export, …) |
| Dovolená | Vacation request form, all-requests panel, approved-colleagues view |
| Recepce | Nav-item step (Recepce, `appTour.version: 12`) + 17 further steps: Předávací protokol (shift toolbar, cash/trezor counting, Účty, sm special rows, Poznámky, signatures, next-shift creation, history/undo-redo, print, "založení protokolu"), Walkiny (table, add form), Taxi (ride table + "Jiné…", ceník), Lobby bar (add-sale button, ceník — `appTour.version: 13`, Ambiance only), Terminál (add-payment button — `appTour.version: 13`, Amigo & Alqush only). All three v13 steps are gated on the tab's `.view` key only; the manager-only surfaces (lobby-bar souhrny, Terminál "Předáno") carry `data-tour` anchors but no tour step. All deep steps `hideOnMobile: true`. See [Recepce — Guided tour & demo routes](recepce.md#guided-tour--demo-routes). |
| Zaměstnanci | Employee list + filters + create/export; employee card (edit, delete, sensitive reveal, benefits, employment history, contracts, documents) |
| Můj profil | Self-page title, Navrhnout úpravu, own sensitive reveal, pending requests |
| Šablony smluv | Template list, new template |
| Mzdy | Payroll table, create, edit, recalculate, hard-recalculate, lock, delete, export, notes |
| Upozornění | Nav-item step (Upozornění) + alerts tabs, mark-read, manual refresh |
| Log změn | Nav-item step only (standalone single-step section — the audit log page has no further walkthrough steps) |
| Nastavení | Users tab, add/edit/assign-type/per-user-perms; user types tab; the Seznamy tab (companies, departments, positions, education — one collapsible section each, since v4.8.1, see `docs/other-features-and-ui.md`); payroll settings; menu order; system triggers; test clock; superadmin card |
| Závěr | Outro card pointing to the Nápověda button |

Sections are used only for the overlay's "Předchozí/Další sekce" navigation — they have no effect on filtering or persistence.

**Note on the Směny section:** the first step ("Výběr měsíce", `anchor: "shift-month-nav"`) is gated on `["shifts.view.all", "shifts.view.self"]` (OR semantics — shown to anyone who can see shifts in any capacity). This step leads the entire Směny section, so the section is only visible to users holding at least one shift-view permission.

---

## Persistence — `users/{uid}.toursSeen`

The backend stores one Firestore field on the user document:

```
users/{uid}.toursSeen = { "app": 15 }   // tourId → last seen version
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

**Seznamy catalogue interception (v4.8.1).** The real employee-detail page validates the demo employee's *current* company/department/position/education against the live Seznamy lists (`companies`, `departments`, `jobPositions`, `educationLevels`) and shows a "neplatné údaje v číselníku" banner on any mismatch. Since the demo employee's `current*` fields don't correspond to any real Firestore document, `getDemoResponse` also intercepts those four catalogue endpoints — but **only** while the demo detail route is mounted:

- `onDemoDetailRoute()` checks `window.location.pathname === "/zamestnanci/tour-demo"` directly (this route has no `<TourDemoRoute>` wrapper/scenario flag, unlike the `/napoveda/ukazka-*` routes, so interception keys off the pathname itself).
- `DEMO_CATALOG_PATHS` = `{"/companies", "/departments", "/jobPositions", "/educationLevels"}`; `demoCatalogFixture(path)` returns the matching fixture — `demoCompanies` / `demoDepartments` / `demoJobPositions` (new fixtures whose ids/names mirror `detailEmployee`'s `current*` values exactly: company matched by id, department & position by name) plus the existing `educationLevels` fixture (already shared with the Můj profil self-edit demo, matched by "code - name" label). `Junior recepční` is included in `demoJobPositions` for the history session that references it.
- Outside the demo detail route (e.g. the real `/zamestnanci/:id` page, or the Seznamy tab itself) these four paths pass through to the real backend as normal — the interception is scoped to the one sentinel route.

### Scenario-keyed fixtures

For pages where the mock depends on the app state (Směny, Mzdy, Můj profil), the scenario is derived **from the URL pathname** by `activeScenario()` — not from a mutable flag — to be race-proof when the tour navigates between two demo routes that render the same page component.

```
/napoveda/ukazka-profil          → "self"                (Můj profil, populated)
/napoveda/ukazka-mzdy            → "payroll"             (PayrollPage, populated period)
/napoveda/ukazka-mzdy-prazdne    → "payroll-empty"       (PayrollPage, no period → create state)
/napoveda/ukazka-smeny           → "shifts"              (ShiftPlannerPage, opened plan)
/napoveda/ukazka-smeny-prazdne   → "shifts-empty"        (ShiftPlannerPage, no plan → create state)
/napoveda/ukazka-smeny-vytvoreny → "shifts-created"      (created plan → "Smazat plán" visible)
/napoveda/ukazka-smeny-publikovane → "shifts-published"  (published plan → Volné směny section)
/napoveda/ukazka-smeny-zadost    → "shifts-change-request" (published plan → change-request modal auto-opened, v3.6.0)
/napoveda/ukazka-protokol           → "protokol"           (RecepceDemoPage tab="protokol", populated unsigned protocol)
/napoveda/ukazka-protokol-prazdne   → "protokol-empty"     (no record → "Založit protokol" button)
/napoveda/ukazka-protokol-podepsany → "protokol-signed"    (both signatures present → next-shift + print buttons)
/napoveda/ukazka-walkiny            → "walkiny"            (RecepceDemoPage tab="walkiny", populated table)
/napoveda/ukazka-taxi               → "taxi"               (RecepceDemoPage tab="taxi", populated rides + ceník)
/napoveda/ukazka-lobby-bar          → "lobby-bar"          (RecepceDemoPage tab="lobbyBar", populated sales + item ceník; Ambiance only)
/napoveda/ukazka-terminal           → "terminal"           (RecepceDemoPage tab="terminal", populated payments; Amigo & Alqush only)
```

The five Recepce tabs share a single wrapper, `RecepceDemoPage.tsx`, rather than each getting its own `TourDemoRoute`-wrapped page component — it renders one real tab (`HandoverTab`/`WalkinsTab`/`TaxiTab`/`LobbyBarTab`/`TerminalTab`) for a hotel chosen from the current user's accessible hotels (preferring one where they also hold the tab's manage permission, so manager-only spotlighted controls actually render). See [Recepce — Guided tour & demo routes](recepce.md#guided-tour--demo-routes) for the full mock-hotel-selection logic.

**⚠️ Gotcha — filter by tab availability *before* preferring a manage-holding
hotel.** Unlike Předávací protokol/Walkiny/Taxi (present at every hotel),
Lobby bar only exists at Ambiance and Terminál only at Amigo & Alqush.
`RecepceDemoPage` first narrows the candidate hotel list to ones that actually
have the requested tab (`hotels.filter((h) => h.tabs.some((t) => t.id ===
tab))`) — *then* applies the manage-preference. Reversing the order (prefer-manage
first) could pick a hotel that doesn't have the tab at all whenever the user's
only manage grant for that tab lives elsewhere, rendering the wrong content or
calling an endpoint gated on a key nobody holds for that hotel.

Each route is registered in `App.tsx` with a per-route `key` (the path), so when the tour navigates between two demo routes that render the same page component (e.g. shifts-opened → shifts-published), React **unmounts and remounts** the page, ensuring a fresh fetch is fired with the new scenario already set.

**Special case — `shifts-change-request` (v3.6.0):** the shift-change-request tour step needs to spotlight `data-tour="shift-change-request-modal"`, which only exists when the modal is open. The tour engine cannot perform a double-click, so `ShiftPlannerPage` detects `tourDemo.scenario === "shifts-change-request"` in a `useEffect` and, once the mock published plan has loaded, sets `pendingChangeRequest` to the first employee's first date, auto-opening the modal. This is confined to the sandbox route (its own page instance via the `key` in `App.tsx`) and never affects the real Směny page or any other demo route.

### `TourDemoRoute` wrapper

Demo routes that need the scenario flag are wrapped in `<TourDemoRoute scenario="…">`:

```tsx
<Route path="/napoveda/ukazka-smeny" element={
  <TourDemoRoute scenario="shifts"><ShiftPlannerPage /></TourDemoRoute>
} />
```

`TourDemoRoute` sets `tourDemo.active = true` and `tourDemo.scenario` **synchronously during render** (so they are already set before the child's mount-effect fires its first fetch) and clears them on unmount. The sentinel-employee routes need no wrapper — they are keyed off the id in the path.

### `/me/*` endpoints (Můj profil demo)

The self-page calls `/me/*` endpoints that are not id-scoped. These are intercepted only while `activeScenario() === "self"` (the `/napoveda/ukazka-profil` route is mounted). The `SELF_PATHS` set in `demoData.ts` lists the paths with a named fixture; the interception itself is broader — any `/me/…` path is caught while the self scenario is active (`SELF_PATHS.has(clean) || clean.startsWith("/me/")`), so an unmatched `/me/*` path never falls through to the real backend, it just resolves to `{}` instead of a fixture. That fallback renders safely for components that null-coalesce (`… ?? {}`), but shows every figure as a dash — which is why a new fixture (`selfVacationLedger`, v4.12.1, backing `GET /me/employee/vacation-ledger`) was added alongside the read-only "Dovolená" section on Můj profil rather than relying on the `{}` fallback.

---

## Nápověda (Help) page

`frontend/src/pages/HelpPage.tsx` — route `/napoveda`, accessible to every authenticated user (no permission gate).

It displays the same content as the tour, without the overlay:

1. Calls `buildAppTour(can)` (no `ctx`/`opts` — the default no-context build) and filters out the welcome/outro steps (no `permission`), but keeps track of each surviving item's **index in the full built array** (welcome/outro included), not its position in the filtered/grouped display list.
2. Groups remaining steps by their permission's catalog group (using `PERMISSION_CATALOG` from `frontend/src/lib/permissions/catalog.ts`) preserving catalog order.
3. Renders each group as a `<section>` with an optional screenshot from `helpImages.ts`.
4. A full-text search (diacritic-insensitive) filters the already-permission-filtered list — search results can never include content the user cannot access.
5. The **"Spustit prohlídku"** button calls `startTour()` (no argument) from `OnboardingContext`, replaying the full guided tour from step 1.
6. **Clickable steps (v4.8.1)** — every listed item is itself a button. Clicking it calls `startTour(item.index)`, launching the overlay directly **at that step** instead of from the beginning.

### Jumping the overlay to a specific step

`OnboardingContext`'s `startTour` gained an optional `atStep?: number` parameter:

```ts
startTour: (atStep?: number) => void;
```

- **No argument** (`startTour()`, "Spustit prohlídku"): builds the tour with the real viewport/employee context — `buildAppTour(can, { hasEmployee: !!employeeId, isPhone: isPhoneViewport() })` — for a full, environment-aware replay, and starts at `stepIndex = 0`.
- **With `atStep`** (clicked from Nápověda): rebuilds the tour with the **same no-context call HelpPage used to compute the index** — `buildAppTour(can)` — so the array position the click captured is guaranteed to still line up with the step it points at. `stepIndex` is set to `atStep` (clamped to the valid range) and `activeTour` is set in the same pass, so the overlay mounts already on the target step with no flash of step 0.

Because the two code paths intentionally build the tour differently (context-aware vs. no-context), `atStep`-driven jumps do not reflect phone-layout anchor overrides (`mobileAnchor`/`mobileBody`) the way a normal auto-started or replayed tour does — this is an accepted trade-off for keeping the Nápověda index stable.

The "? Nápověda" button in the sidebar footer links to `/napoveda`.

**Single source of truth:** adding a new permission to the catalogue and a matching tour step automatically surfaces the new entry in Nápověda — no separate help content to maintain.

---

## Adding or updating tour steps

1. Add the `data-tour="<anchor>"` attribute to the relevant DOM element in the page component.
2. Add (or update) the matching `TourStep` entry in `APP_TOUR_STEPS` in `appTour.ts`. Set `permission` to the controlling permission key, `route` to the page route, and `reveal` to any tab/expander anchors that must be clicked first. Set `section` if this is the first step of a new section group.
3. If the step targets a demo-only route, verify the route and scenario are registered in `App.tsx` and `demoData.ts`.
4. **Set `addedInVersion` and bump `appTour.version`** — set `addedInVersion: <N>` on the new step(s) where `<N>` is one higher than the current `appTour.version`, then update `appTour.version` to `<N>`. This triggers a "what's new" delta for returning users who already completed an earlier version. First-time users always see the full tour regardless. Do **not** omit `addedInVersion` on new steps — without it they are treated as baseline (version 0) and returning users will never see them in a delta.
5. No separate Nápověda update is needed — the page derives its content from the step list automatically.
6. Follow the permission-matrix rule: any **new** permission also needs to be added to the backend + frontend permission catalogue and to `BUILTIN_TYPE_PERMISSIONS` (see `docs/auth-and-permissions.md`).
