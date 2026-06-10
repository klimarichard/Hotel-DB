# Other Features & UI

This document collects the remaining cross-cutting features and UI conventions of the HPM Intranet: the dashboard (Přehled), the audit log, the Upozornění hub, dark mode, shared UI components, and company records.

## Dashboard — Přehled

- `frontend/src/pages/OverviewPage.tsx` — route `/prehled`, visible to all roles (first entry in `navItems`, no role gate). Also the default post-login landing page — the index route in `App.tsx` redirects `/` to `/prehled` for every role.
- First version is today-only and read-only; reuses `GET /shifts/plans` + `GET /shifts/plans/:id` (no new backend endpoint).
- Date comparison builds `YYYY-MM-DD` via `getFullYear/Month/Date` — never `toISOString()`.
- **Sections:**
  - **Směny dnes** — a fixed-layout table (`table-layout: fixed`) with one column per hotel. Hotel headers are colored via `getCellColor(parseShiftExpression("D"+hotel), isDark)` so they match the shift-plan palette and react to dark-mode. Rows: `DENNÍ` (segments `D`/`ZD`/`DP`) and `NOČNÍ` (`N`/`ZN`/`NP`). Double shifts (`DA+NS`) appear in both columns.
  - **MOD** — letter from `modRow/{todayYMD}.code`. Name resolution: `plan.modPersons[letter]` first (per-plan override), then falls back to the static `MOD_PERSONS` mapping in `shiftConstants.ts` and finds the employee by full-name match.
  - **Manažeři mimo (X)** — rendered only when at least one vedoucí has `rawInput === "X"` today.
- **Per-item flags** (segment-driven, not emp.section):
  - `(portýr)` when segment code is `DP` or `NP`.
  - `(zaučování)` when segment code is `ZD` or `ZN`.
  - Both can combine. Small faded `.flag` span.
- **Sort order per hotel cell:** non-porter slots (isPorter=false) first, then porter slots; within each group by `displayOrder`, then `localeCompare(…, "cs")`.
- **Empty states:** no plan for today's month → friendly notice (also shown to employees when the plan is still `created` since the backend filters those out for them).

### Additions
- **DNES + ZÍTRA cards** — each day renders as a single bordered card with sub-blocks (Směny table, MOD, Manažeři mimo). `ZÍTRA` is collapsible with a chevron header; default state is collapsed.
- **Hotel day rollover at 07:00** — `hotelDayStart(new Date())` in `OverviewPage.tsx` treats 00:00–06:59 as the previous calendar day, so the displayed "dnes" only flips at 07:00. All date derivations (today, tomorrow, 7-day window) branch off this.
- **DENNÍ / NOČNÍ badge** — pill next to the date header showing the current shift: DENNÍ 07:00–18:59, NOČNÍ 19:00–06:59. Background uses `SHIFT_COLORS[code]` for the D/N palette.
- **Tour anchors** — the date header carries `data-tour="overview-date-header"`, the staffing cards `data-tour="overview-staffing"`, the "Moje směny" tile `data-tour="overview-my-shifts"`, the task-tiles group `data-tour="overview-task-tiles"`, and the stats section `data-tour="overview-stats"`. The task tile area is wrapped in a `.taskTilesGroup` container so the tour can spotlight it as a group regardless of which tiles render.
- **Tile row** — below the day cards, a grid of five equal-width tiles (`repeat(5, 1fr)`, stacks at narrow viewports):
  - **Moje směny** (leftmost, square) — 7-day list of the current user's shifts. Raw shift is hidden when the cell is empty or `X`; approved vacations render as `dovolená`, pending vacations as `dovolená (čeká na schválení)`. Vacation state comes from `/vacation` filtered to the signed-in employee.
  - **Neplatné doklady / Úpravy směn / Výměny směn / Dovolenky** — square count tiles visible only to admin/director. Counts come from `useAlertsContext`, `useShiftOverridesContext`, `useShiftChangeRequestsContext`, and `useVacationContext` (which fetches `GET /vacation/pending-count`, summing `status == "pending"` and `status == "approved" && pendingEdit != null`). Zero-count tiles render in a muted style; each tile is a `<Link>` to the relevant page. The same contexts also drive sidebar badges in `Layout.tsx` for `/smeny` (sum of overrides + change requests across all plans) and `/dovolena` (pending vacations) — keep mutations in `VacationPage.tsx` calling `refresh()` so the badge stays in sync after approve/reject/create/delete/edit.
  - **Per-plan badges in `ShiftPlannerPage`** — the `Výjimky` and `Žádosti o změny` buttons each show a count limited to the *currently selected month* (`planOverrideCount`, `planChangeRequestCount`, fetched alongside the plan). The sidebar `/smeny` badge is the global cross-month sum, so a request submitted in May still pages the admin from any month, but only the May plan view highlights the actionable button.
- **Labels** — the alerts inbox is labelled **Neplatné doklady** on both the sidebar and the dashboard tile. The route (`/upozorneni`) and the `AlertsPage` header are unchanged.
- **HR přehled (admin/director statistics, bottom of Přehled)** — `frontend/src/components/HeadcountStats.tsx` renders inside the existing `showTasks` guard on `OverviewPage.tsx`, after the task tiles so the page ends on the stats. Fetches `GET /stats/headcount` once on mount (see `functions/src/routes/stats.ts` — the dedicated stats router, mounted at `/stats` in `functions/src/index.ts`). One endpoint returns four reconciled slices of active-employee headcount: `byJobPosition`, `byNationality`, `byAge` (5 fixed buckets — `<20`, `20-30`, `30-40`, `40-50`, `50+`), and `byTenure` (8 fixed buckets — `<1m`, `1-3m`, `3-6m`, `6-12m`, `1-2y`, `2-5y`, `5-10y`, `10+y`). Null `currentJobTitle`, `nationality`, or `dateOfBirth` bucket to `"Nezadáno"` so all slices sum to `total`. Tenure reads each employee's `employment` subcollection (via a single `collectionGroup("employment")` query), treats each entry as a transition event (`status = "active"` starts a run, `status = "inactive"` ends one, contract-change events with `status = "active"` don't restart the clock), sums active→inactive intervals in days, and extends any still-open run to today in the Europe/Prague timezone — so termination gaps are correctly excluded from total tenure. Rendering uses `recharts` (`BarChart` with `layout="vertical"` for position / nationality / tenure; plain vertical for age). Axis / grid / bar colors are resolved from `--color-primary`, `--color-text-muted`, `--color-border` at mount and re-read on theme toggle. Horizontal tiles auto-grow in height at 40 px per bar (`interval={0}` keeps every category tick visible). Czech display labels live client-side; the endpoint emits terse ASCII bucket keys.
Managed in Settings → Společnosti tab. Only one card in edit mode at a time.

---

## Audit log

**Goal:** every business-data write is recorded so an admin can answer "who changed what, when" — most often "show me every change ever made to employee X."

**Storage** — the existing `auditLog/` collection. Pre-existing actions (`reveal`, `export`, `manual-trigger`) keep their original shapes and are preserved. New per-mutation entries are written by `functions/src/services/auditLog.ts`:

```
{
  userId, userEmail, userRole,
  action: "create" | "update" | "delete" | "reveal" | "export" | "manual-trigger",
  collection,                 // e.g. "employees", "shiftPlans/shifts", "settings"
  resourceId, subResourceId?,
  fieldPath?, oldValue?, newValue?, redacted?,   // for update entries (one entry per changed field)
  summary?,                                      // for create / delete entries
  employeeId?,                               // denormalized for "all changes for X" filtering
  timestamp                                  // serverTimestamp
}
```

**Helper module** — `functions/src/services/auditLog.ts` exposes `logCreate`, `logUpdate`, `logDelete`, and `writeAudit`. `logUpdate` deep-diffs the pre/post snapshots and writes one entry per changed top-level field. Routes capture the pre-write doc, perform their normal write, then call the helper. **Every helper call is wrapped in try/catch internally** — an audit-log write failure must never abort the user's write. `IGNORED_FIELD_SUFFIXES` skips bookkeeping fields (`updatedAt`, `createdAt`, `lastLogin`).

**Sensitive-field handling** — `birthNumber`, `idCardNumber`, `idCardExpiry`, `insuranceNumber`, `bankAccount` are recognized by leaf name. When one of these changes, the entry has `redacted: true` and **no** `oldValue` / `newValue` — never plaintext, never ciphertext. Routes can pass an additional `sensitiveFields` list when the field name doesn't make the redaction rule obvious. Snapshots in `summary` get sensitive keys replaced with the literal `"[redacted]"`.

**Auth context** — `functions/src/middleware/auth.ts` was extended to populate `req.userEmail` from the verified Firebase ID token, so audit writes don't need an extra Firestore lookup per call. Helper consumes `ctxFromReq(req)`.

**Instrumented surface** — every PATCH/PUT/POST/DELETE in: `employees` (root + contact + employment + documents + benefits + delete + the legacy reveal/export, now migrated through the helper), `contracts` (CRUD + signed PDF upload/delete), `shifts` (~22 mutations: plans, planEmployees, per-shift cells, rules, unavailability, overrides, change requests, MOD row), `vacationRequests`, `payroll` (period create/lock/copy, per-entry edits, notes, recalc, **stravenkový paušál at PATCH /payroll/settings**), `auth` (set-role, create-user, deactivate, reactivate, employee link), `contractTemplates` (create + put), `departments`, `jobPositions`, `educationLevels`, `companies`. **Skipped on purpose:** `PUT /api/auth/me/theme` — cosmetic per-user preference, not worth the noise.

**Per-shift edits** — `PUT /shifts/plans/:planId/shifts/:employeeId/:date` only logs when `rawInput` actually changed; re-saves with the same value are silently no-op for the audit log (otherwise a tab-out-tab-in flow would generate spam). The shift entry denormalizes `employeeId`, so per-shift edits are filterable by employee in the same `employeeId` query as employee-doc edits.

**Read endpoint** — `functions/src/routes/auditLog.ts` mounts `GET /api/audit` (admin + director). Filters: `employeeId`, `userId`, `collection`, `action`, `from`, `to`. Cursor pagination via `cursor=<lastDocId>`, default page 100, max 500. `GET /api/audit/meta/collections` returns the distinct `collection` values seen in the most recent 5000 entries to populate the filter dropdown without enumerating all docs.

**Composite indexes** — `firestore.indexes.json` declares `(employeeId, timestamp desc)`, `(userId, timestamp desc)`, `(collection, timestamp desc)`, `(action, timestamp desc)`. The combined-filter case (e.g. employee + date range) is served by these indexes plus the inequality on `timestamp`.

**Frontend** — `frontend/src/pages/AuditLogPage.tsx` (admin + director, `/audit`) shows a filterable, paginated table modeled on `EmployeesPage`. Filter state is mirrored to URL query params so deep-links work. Each row shows actor + action + collection + resource (linked to `/zamestnanci/:id` when `employeeId` is present) + field + old → new diff. Sensitive-field updates render as italic "citlivé pole změněno" without values. Clicking a row expands the full JSON entry. `EmployeeDetailPage` gains a "Historie změn" section (admin + director) with the 10 most recent entries for that employee plus a "Zobrazit všechny změny →" link to `/audit?employeeId=…`.

**Nav** — added under `adminItems` in `Layout.tsx` (visible to both admin and director, like the other admin items).

**Retention** — none. Entries persist forever per the user's choice. If volume becomes a problem later, add a scheduled prune in `functions/src/index.ts`.

### Log změn — human-readable redesign (2026-05-28)

The `/audit` page ("Log změn") was reworked from a flat one-row-per-changed-field table (the "Frontend" paragraph above describes the old layout) into a **date-sectioned timeline of grouped event cards**. The backend stream is unchanged — still one doc per changed field — so the grouping is done **client-side**, making this a frontend-only change with no schema or data impact.

- **Label layer** (`frontend/src/lib/audit/`): `labels.ts` (collection + field labels, action verbs/glyphs, section derivation, and the `fieldLabel`/`collectionLabel`/`subjectNoun` resolvers — `fieldLabel` walks the collection path most-specific-first so `employees/contracts` resolves the contract field map, not the employee one); `fields.employee/payroll/shifts/misc.ts` (Czech field-label maps per collection family, ~255 fields total); `format.ts` (value formatters — ISO dates, Ano/Ne, enums, generic, with sensitive values kept redacted); `grouping.ts` (`groupEntries` folds the flat per-field stream into one event per author + record + action within a ~20s window, sub-grouped by area; `bucketByDate` → Dnes / Včera / explicit date; `eventTitle`).
- **`AuditEventCard`** (`frontend/src/components/AuditEventCard.tsx`): one collapsed-by-default line per event (chevron, verb + accusative subject noun e.g. "Vytvořil dokument", record title/link, change count, author, time); expands to the changed fields as `popisek: old → new` grouped by area, plus a "Technický detail" raw-JSON escape hatch. The filter bar (now with Czech collection labels) and cursor pagination are retained. `EmployeeDetailPage`'s "Historie změn" reuses the same card (compact); there a `resolveRef` prop turns the contract's `employmentRowId` into the human employment-session header.

---

## Upozornění hub

`/upozorneni` (admin + director) is a tabbed page that aggregates everything that needs admin attention. The menu label is **Upozornění** (was "Neplatné doklady").

**Tabs**
1. **Doklady** — document-expiry alerts from the `alerts/` collection (existing).
2. **Zkušební doba** — probation-end alerts from `probationAlerts/`.
3. **Dovolená** — pending vacation requests (status `pending` or approved-with-pendingEdit). Sourced from `GET /vacation` filtered client-side. Workflow-driven (approve/reject in `VacationPage` makes the row disappear).
4. **Výjimky** — pending shift override requests across all plans. New endpoint `GET /api/shifts/overrides/pending` runs a `collectionGroup` query and denormalizes `planId/planYear/planMonth` per row.
5. **Žádosti o změny** — same pattern via `GET /api/shifts/changeRequests/pending`.

Tab labels show pending counts as red pill badges.

**Read-state (Doklady + Zkušební doba)** — shared and server-side. Each `alerts/` and `probationAlerts/` doc carries `read` / `readAt` / `readBy`; marking read/unread goes through `POST /api/alerts/read` and `POST /api/alerts/probation/read` (`{ ids, read }`, admin/director), so a dismissal is shared across all admins/directors and survives the daily/manual refreshes. The refreshers **preserve** the flag when the underlying deadline (`expiryDate` / `probationEndDate`) is unchanged and **reset** it to unread only when the date moves (a renewed document / edited probation date). Read alerts stay in a muted **Přečtené** archive with an "Označit jako nepřečtené" un-mark action and don't count toward the badge. `AlertsContext` derives the unread badge counts purely from the server flag — the old `localStorage` keys (`hotel_hr_read_alert_ids_v2` / `hotel_hr_read_probation_alert_ids_v1`) are gone.

**Probation alert generator** — `functions/src/services/probationAlerts.ts`. Mirrors `updateDocumentAlerts`: parses the free-form `probationPeriod` string (e.g., "3 měsíce", "30 dní", "2 týdny", or a bare number defaulting to months — accent-insensitive match), computes the calendar-correct end-date, and upserts an alert iff end-date is within `PROBATION_ALERT_DAYS = 14`. Triggered on every employment row create + edit (best-effort, never blocks the response), cascade-deleted on employee delete, and re-scanned daily by `refreshProbationAlerts`. Manual emulator trigger: `POST /api/employees/trigger-probation-refresh`. Unparseable / zero values delete any existing alert. **Suppression**: the alert is also deleted when the active row's employment session is **terminated** (an `ukončení` row exists, or the effective `endDate` is in the past) or **already has a salary Dodatek** (`změna smlouvy` carrying a `mzda` change). `refreshProbationAlertsForEmployee` loads the full employment history (single-field `orderBy`, no composite index) and a server-side session walk (`sessionFlagsByNastup`, mirroring the frontend `groupBySession`) decides suppression per active row.

**Alert suppression for terminated employees (both alert types):** `status === "terminated"` is the canonical suppression signal for both document-expiry alerts and probation alerts:
- **Document-expiry alerts** (`refreshDocumentAlerts` scheduled + manual trigger in `functions/src/index.ts`): when building the expiry-fields body for `updateDocumentAlerts`, every field is set to `null` for terminated employees, causing all existing alerts to be deleted and none to be created. Active **and** `before-start` (upcoming) employees keep their document-expiry alerts.
- **Probation alerts** (`refreshProbationAlertsForEmployee`): the canonical `empData.status === "terminated"` check overrides the per-session flags — if the employee root says terminated, the alert is suppressed regardless of session state. `before-start` employees (status not `"terminated"`) are not suppressed — a new hire awaiting day one can still have a ticking probation clock.

The distinction matters because the employment-row `status` field can lag the derived employee-level `status` field; checking the employee root avoids stale alerts surviving after a status transition.

**Manual refresh (admin)** — a rotating-arrow `IconButton` (`refresh` variant) next to the page title, rendered only for `admin`, re-triggers both refreshers (`POST /api/employees/trigger-alert-refresh` + `…/trigger-probation-refresh`) in parallel, spins while in flight, then calls `AlertsContext.refresh()` for the badges and bumps a `refreshKey` to remount the active tab so it re-fetches the regenerated alerts. Each call writes its usual `manual-trigger` audit entry; failures surface via `ConfirmModal`. Directors don't see the button (the trigger endpoints are `admin`-only).

**Sidebar badge for `/upozorneni`** — sums **only** unread document + unread probation counts. Vacation/overrides/changes already have their own badges on `/dovolena` and `/smeny`; double-counting them here would be confusing.

**Cross-plan list endpoints** — `GET /api/shifts/overrides/pending` and `GET /api/shifts/changeRequests/pending` use `collectionGroup` queries on `(status == "pending", requestedAt desc)`. Both composite indexes are declared in `firestore.indexes.json`. Per-plan modals on `ShiftPlannerPage` are unchanged — they remain the primary action surface for approve/reject; the Upozornění hub is the cross-plan read-only/list view.

**Audit log** — probation-alert writes are system-generated (scheduled refresh + on-employment-edit cascade) and intentionally NOT in the audit log. The triggering employment row create/edit is already audited, which is the user-meaningful event.

---

## Dark Mode

- `ThemeContext.tsx`: `ThemeProvider` + `useTheme()`. Authoritative preference is the `theme` field on `users/{uid}` Firestore doc, fetched on login via `GET /api/auth/me/theme` and written on toggle via `PUT /api/auth/me/theme` (`functions/src/routes/auth.ts`). `localStorage` (`hotel_hr_theme_{uid}`) is kept as a flash-prevention cache — applied immediately on mount, then reconciled when the backend response lands. Guest (pre-login) preference stored under `hotel_hr_theme_guest` in `localStorage` only. Applies `data-theme="dark"` to `<html>`.
- **Why the round-trip**: `firestore.rules` blocks all direct client Firestore access, so the preference must travel through Cloud Functions. Bonus side effects: themes follow users across browsers/devices, and the `seed-admin.js` script can pre-set `theme: "dark"` on the seeded admin doc so the dev login lands in dark mode out of the box.
- **Default theme is dark** — both the login page and the initial load before any user preference is read start in dark mode.
- Login page has its own sun/moon theme toggle inside the card header (next to the "HPM Intranet" title).
- All CSS uses variables from `frontend/src/index.css`. `[data-theme="dark"]` overrides the full variable set.
- Sidebar stays permanently dark in both themes (intentional). Background is a subtle vertical gradient `#1e2a3a → #192432` (`Layout.module.css` → `.sidebar`).
- `getCellColor(parsed, dark?)` in `shiftConstants.ts` — second arg selects light vs dark palette from `CELL_COLORS_DARK`.

---

## UI components

- **`frontend/src/components/Button.tsx`** — shared button primitive with variants `primary` | `secondary` | `danger` | `ghost` and sizes `sm` | `md`. Wraps `<button>`, passes native props through (`type`, `disabled`, `onClick`, `style`). `block` prop for full-width. All modal actions, form submits, and page/toolbar actions use it. The CSS module (`Button.module.css`) reads shared tokens (`--color-primary`, `--radius-md`, `--space-*`, `--font-weight-*`) from `index.css`. Focus ring comes from the global `:focus-visible` rule.
- **`frontend/src/components/IconButton.tsx`** — shared icon-only button primitive. Single variant `close` today, covering every modal-header ✕ (7 call sites across `AddEmployeeToPlanModal`, `EditEmployeeInPlanModal`, `GenerateContractModal`, `ShiftChangeRequestModal`, `VacationCollisionInfoModal`, `VacationCollisionResolutionModal`, `XOverrideModal`). `aria-label` is a *required* prop (TS-enforced) because the visible content is a glyph. Passes native props through. Focus ring from the global `:focus-visible`.
- **Intentionally not migrated** (local CSS per-file):
  - Icon-only buttons that are genuinely one-off or use non-standard patterns: `empActionBtn` (✎/✕ on shift-grid hover, 7px on-hover row action), `revealBtn` / `navicRevealBtn` (opacity-based field togglers, not hover-bg), `lockBtn` / `nemocBtn` / `notesDashBtn` / `removeChangeBtn` (single-use micro-actions), the shift-grid MOD badge inputs (text inputs, not buttons).
  - Text-bearing buttons with misleading CSS names (not actually icon-only): `themeToggle` (contains "Světlý"/"Tmavý" label + SVG), `logoutBtn` (contains "Odhlásit"), `iconBtn`/`iconBtnDanger` in `PayrollNotesModal` (contain "Zrušit"/"Uložit"/"Upravit"/"Smazat"). If these ever migrate, they go to `<Button>`, not `<IconButton>`.
  - TipTap toolbar: `toolBtn`, `varBtn` in `ContractTemplatesPage`.
  - Row-level status pills: `approveBtn` (green), `rejectBtn` (red-outline), `deleteBtn` (gray→red on hover), `editBtn` (blue info-style) — kept because they encode status via color.
  - Month/period nav: `navBtn` in `ShiftPlannerPage` and `PayrollPage`.
  - Other text-bearing single-use buttons: `clearBtn`/`unclearBtn` (EmployeeForm sensitive-field clear), `postSaveBannerBtn`, `addChangeBtn`, `editRowBtn`.
  - `<Link>` elements styled as buttons: `EmployeesPage` addBtn Link, `EmployeeFormPage` cancelBtn Link — the shared primitives only wrap `<button>`.
- **Typography & tokens**: Inter loaded from `fonts.bunny.net` via `<link>` in `frontend/index.html`. Spacing scale (`--space-1…7`), radius scale (`--radius-sm|md|lg`), font-weights (`--font-weight-regular|medium|semibold|bold`) live in `index.css` `:root`.
- **Favicon / logo**: single source of truth at `frontend/src/assets/logo.svg` (real OTH gold brand mark, viewBox tightened to `210 300 195 195` so the glyph fills its box at any size — path data untouched from the Illustrator export). Referenced from `frontend/index.html` as `<link rel="icon" href="./src/assets/logo.svg">` (relative path so Vite processes and fingerprints it in production), imported into `Layout.tsx` at 26×26px in the sidebar via `styles.logoMark`, and rendered at 72×72px above the heading on both login and forgot-password views via `LoginPage.module.css` → `.logo`. The earlier placeholder `public/favicon.svg` was removed in `feature/unified-logo`; `assets/logo-mark.svg` (unimported placeholder) is retained as a backup.
- **Active nav link**: `Layout.module.css` → `.active` combines the existing `#3b82f6` 3px left-border and `#2d3f54` fill with a soft primary-tinted inner shadow (`box-shadow: inset 0 0 18px rgba(59, 130, 246, 0.12)`) so the selected row reads as "lit up" rather than merely shaded.
- **Sidebar user bar**: `.userBar` uses `gap: var(--space-2)` between email, role, logout and theme toggle (no per-element `margin-top` rules). `.userEmail` is `0.8125rem`.

---

## Companies

`companies/{companyId}` fields: `name`, `address`, `ic`, `dic`, `fileNo` (Spisová značka).

---

## UI tweaks (2026-06-10)

- **Shift-plan section labels** — the first shift section (formerly labelled "FOM") is now labelled **"Management"** in `SECTION_LABELS` in `frontend/src/lib/shiftConstants.ts`. The three sections remain `vedoucí`, `recepce`, `portýři`; only the display name of `vedoucí` changed. (The audit-log label in `frontend/src/lib/audit/fields.misc.ts` still says "FOM" for the `manager` menu-order field — a separate label not tied to shift sections.)
- **Shift-plan Σ summary rows removed** — per-section subtotal rows (showing the daily Σ employee count per section) have been removed from the shift grid. Sections are now separated by header rows only.
- **Sidebar footer button order** — in `Layout.tsx`, the footer `userBar` renders: theme toggle → **? Nápověda** → **Odhlásit** (in that order). Previously Nápověda was after Odhlásit.
- **Settings tab order** — the Settings page tab strip now starts with **Uživatelé** → **Uživatelské typy** (users first, then types), followed by the číselník tabs. The order is driven by the render order in `SettingsPage.tsx`.
