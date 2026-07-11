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
- **Document-expiry bar** — immediately below the date/shift-code header, `<DocumentExpiryBar>` renders the signed-in user's own expiring or expired documents (passport + residence permit; OP is excluded from the self view). The bar is hidden when there are no alerts. Data comes from `useSelfDocAlertsContext()`. See [Self document-expiry alerts + Můj profil badge (v3.2.0)](employees.md#self-document-expiry-alerts--můj-profil-badge-v320) in `employees.md`.
- **Tile row** — below the day cards, a grid of tiles (stacks at narrow viewports). The tile group uses an inline `--tile-count` CSS custom property to drive `grid-template-columns: repeat(var(--tile-count), 1fr)` so all task tiles always fit in one row on desktop regardless of how many are visible:
  - **Moje směny** (leftmost, square) — 7-day list of the current user's shifts. Raw shift is hidden when the cell is empty or `X`; approved vacations render as `dovolená`, pending vacations as `dovolená (čeká na schválení)`. Vacation state comes from `/vacation` filtered to the signed-in employee. A purple **MOD** tag renders next to the date on any day the user is the manager-on-duty (`isMod` on `MyShiftRow`, resolved by `modEmployeeIdForDate()` which mirrors `buildStaffing`'s MOD resolution — per-day MOD letter → `modPersons` override or static `MOD_PERSONS` name); the badge reuses the shared `--color-mod-*` colour trio so it matches the shift grid's MOD row in both themes.
  - **Neplatné doklady / Výjimky ve směnách / Změny ve směnách / Dovolenky / Změny údajů** — square count tiles visible only to users with `dashboard.tasks.view`. Counts come from `useAlertsContext`, `useShiftOverridesContext`, `useShiftChangeRequestsContext`, `useVacationContext`, and `useEmployeeChangeRequestsContext` respectively. Zero-count tiles render in a muted style; each tile is a `<Link>` to the relevant page. **"Změny údajů"** (personal-data change requests) is conditionally rendered: the tile is omitted entirely for users without `changeRequests.review` — it links to `/upozorneni`. The same contexts also drive sidebar badges in `Layout.tsx` for `/smeny` (sum of overrides + change requests across all plans) and `/dovolena` (pending vacations) — keep mutations in `VacationPage.tsx` calling `refresh()` so the badge stays in sync after approve/reject/create/delete/edit.
  - **Per-plan badges in `ShiftPlannerPage`** — the `Výjimky` and `Žádosti o změny` buttons each show a count limited to the *currently selected month* (`planOverrideCount`, `planChangeRequestCount`, fetched alongside the plan). The sidebar `/smeny` badge is the global cross-month sum, so a request submitted in May still pages the admin from any month, but only the May plan view highlights the actionable button.
- **Labels** — the alerts inbox is labelled **Neplatné doklady** on both the sidebar and the dashboard tile. The shift-override tiles are labelled **Výjimky ve směnách** (was "Úpravy směn") and **Změny ve směnách** (was "Výměny směn"). The route (`/upozorneni`) and the `AlertsPage` header are unchanged.
- **HR přehled (admin/director statistics, bottom of Přehled)** — `frontend/src/components/HeadcountStats.tsx` renders inside the existing `showTasks` guard on `OverviewPage.tsx`, after the task tiles so the page ends on the stats. Fetches `GET /stats/headcount` once on mount (see `functions/src/routes/stats.ts` — the dedicated stats router, mounted at `/stats` in `functions/src/index.ts`). One endpoint returns four reconciled slices of active-employee headcount: `byJobPosition`, `byNationality`, `byAge` (5 fixed buckets — `<20`, `20-30`, `30-40`, `40-50`, `50+`), and `byTenure` (8 fixed buckets — `<1m`, `1-3m`, `3-6m`, `6-12m`, `1-2y`, `2-5y`, `5-10y`, `10+y`). Null `currentJobTitle`, `nationality`, or `dateOfBirth` bucket to `"Nezadáno"` so all slices sum to `total`. Tenure reads each employee's `employment` subcollection (via a single `collectionGroup("employment")` query), treats each entry as a transition event (`status = "active"` starts a run, `status = "inactive"` ends one, contract-change events with `status = "active"` don't restart the clock), sums active→inactive intervals in days, and extends any still-open run to today in the Europe/Prague timezone — so termination gaps are correctly excluded from total tenure. Rendering uses `recharts` (`BarChart` with `layout="vertical"` for position / nationality / tenure; plain vertical for age). Axis / grid / bar colors are resolved from `--color-primary`, `--color-text-muted`, `--color-border` at mount and re-read on theme toggle. Horizontal tiles auto-grow in height at 40 px per bar (`interval={0}` keeps every category tick visible). Czech display labels live client-side; the endpoint emits terse ASCII bucket keys.
- **Cross-browser layout fixes (2026-06-22).** Two intrinsic-sizing bugs were fixed: (1) **Chrome chart scaling** — the stat `.tile` grid items lacked `min-width: 0`, so the SVG's large min-content width stopped the `repeat(auto-fit, minmax(420px, 1fr))` tracks from shrinking and recharts squashed the axis text; added `min-width: 0` to `.tile`, and the `ResponsiveContainer` now lives in an absolutely-positioned `.chartFill` (`inset:0`) inside a `position:relative` `.chartArea`, so it measures a definite box instead of feeding its own width back into the grid. (2) **Safari tiny tiles** — the dashboard `.taskTile` / `.myShiftsTile` used `aspect-ratio: 1/1` with no explicit height; Safari resolves a flex/grid item's cross-size from empty content before applying `aspect-ratio`, collapsing them. Replaced with a definite `min-height` (120 px / 140 px).
Managed in Settings → Společnosti tab. Only one card in edit mode at a time.

---

## Audit log / Log změn

**Goal:** every business-data write is recorded so an admin can answer "who changed what, when" — most often "show me every change ever made to employee X."

### Firestore schema

The `auditLog/` collection stores one document per changed field for `update` actions, and one document per event for `create`, `delete`, `reveal`, `export`, and `manual-trigger` actions. The full shape after the v2.3.0 overhaul:

```
{
  userId,          // Firebase Auth UID, or "system" for automated actions
  userEmail,       // at time of write; "" for system actions
  userRole,        // user-type id at time of write (stored as "userRole" for back-compat)
  viaUid?,         // shared-terminal session uid, when userId was substituted (Recepce only)
  viaEmail?,       // shared-terminal session email, alongside viaUid
  action: "create" | "update" | "delete" | "reveal" | "export" | "manual-trigger",
  collection,      // e.g. "employees", "shiftPlans/shifts", "employees/contact"
  resourceId?,     // top-level doc id
  subResourceId?,  // e.g. employeeId_YYYY-MM-DD for shift cells
  fieldPath?,      // for update entries: changed field (one entry per field)
  oldValue?,       // absent for sensitive fields
  newValue?,       // absent for sensitive fields
  redacted?,       // true when fieldPath is a sensitive field; oldValue/newValue omitted
  summary?,        // create/delete: redacted snapshot of the document
  extra?,          // reveal/export/manual-trigger: free-form extras
  employeeId?,     // denormalized: present whenever the change concerns an employee
  // Change-log overhaul additions (v2.3.0) — all optional; absent on legacy entries
  event?,          // semantic event id, e.g. "vacation.approve", "plan.autoTransition"
  category?,       // page bucket: smeny|dovolena|zamestnanci|mzdy|sablony|mujProfil|nastaveni|system
  year?,           // period filter for smeny/mzdy/dovolena
  month?,
  templateId?,     // sablony filter — auto-derived from resourceId for contractTemplates
  settingsArea?,   // nastaveni sub-tab: uzivatele|spolecnosti|oddeleni|pozice|vzdelani|mzdy
  timestamp        // serverTimestamp
}
```

All new fields are additive. Legacy entries lack them and fall back to client-side render-derivation (see `deriveLegacyEventId` below).

**`viaUid`/`viaEmail`** are only ever populated for **Recepce** writes made from a
`sharedTerminal`-flagged user type's session, where `userId`/`userEmail` are the
*resolved on-shift person* (whoever signed Převzal) rather than the logged-in
account — `via*` preserves which shared-terminal session the write physically
came through, so the substitution never loses information. See
[Recepce — Shared-terminal write attribution](recepce.md#shared-terminal-write-attribution).
Absent (stripped by `stripUndefined`) for every ordinary login.

### Backend helper — `functions/src/services/auditLog.ts`

Public API:

| Export | Purpose |
|---|---|
| `logCreate(ctx, args)` | Write a `create` entry with a redacted summary snapshot. |
| `logUpdate(ctx, args)` | Deep-diff `before`/`after`; write one entry per changed field. |
| `logDelete(ctx, args)` | Write a `delete` entry with a redacted summary snapshot. |
| `writeAudit(ctx, args)` | Free-form entry — used for `reveal`, `export`, `manual-trigger`. |
| `logSystemEvent(args)` | Automated actions with no human actor. Writes with `SYSTEM_CONTEXT` (userId `"system"`) and defaults `category` to `"system"`. |
| `ctxFromReq(req)` | Build an `AuditContext` from an `AuthRequest`. Routes call this once per handler. |
| `categoryForCollection(collection, override?)` | Resolves `AuditCategory` from the `COLLECTION_CATEGORY` map. Tries the full path first, then the parent segment, so sub-doc collections (e.g. `shiftPlans/unavailabilityRequests`) inherit their parent's category without explicit enumeration. |
| `settingsAreaForCollection(collection)` | Resolves `SettingsArea` from `SETTINGS_AREA_BY_COLLECTION`; same full-path-then-parent lookup. |

`filterKeyFields` is an internal helper called by all four write functions. It auto-derives `category`, `settingsArea`, and `templateId` from the collection and resourceId, so call sites only pass the values that their handler has explicitly in hand (`year`, `month`, `event`, and `category` overrides). Callers never have to pass `settingsArea` or `templateId` — those default centrally.

`SYSTEM_CONTEXT` is a sentinel `AuditContext` with `uid: "system"`. Use `logSystemEvent(...)` for all automated ("Systém") writes; it handles the context internally.

**Write safety:** every helper call is `try/catch`-wrapped. An audit-log write failure prints to console but never aborts the caller's response.

**Bookkeeping fields skipped:** `updatedAt`, `createdAt`, `lastLogin` are listed in `IGNORED_FIELD_SUFFIXES` and never diff'd by `logUpdate`. The `id` field is also excluded (it's the document path, not data).

**Null-equivalence in `logUpdate`:** `null`, `undefined`, and `""` are all treated as "absent" by `isNullish()`, so saving an unchanged form with blank optional fields produces no audit entries.

### Sensitive-field handling

`SENSITIVE_FIELD_NAMES` = `{ birthNumber, idCardNumber, idCardExpiry, insuranceNumber, bankAccount }`. Matched by leaf name so nested paths (`documents.idCardNumber`) are caught automatically. When a sensitive field changes, the entry has `redacted: true` with no `oldValue`/`newValue` — never plaintext, never ciphertext. Routes may also pass an explicit `sensitiveFields` override list. Create/delete `summary` snapshots get sensitive keys replaced with `"[redacted]"`.

### Category and settings-area mapping

`COLLECTION_CATEGORY` maps root collections and select sub-paths to `AuditCategory`. `categoryForCollection` exports this so the one-time backfill derives the same value as live writes:

| Collections | Category |
|---|---|
| `shiftPlans`, `shiftPlans/*` | `smeny` |
| `vacationRequests` | `dovolena` |
| `employees`, `employees/*`, `contracts`, `otherDocuments` | `zamestnanci` |
| `payrollPeriods`, `payrollPeriods/*` | `mzdy` |
| `contractTemplates` | `sablony` |
| `employeeChangeRequests` | `mujProfil` |
| `users`, `roleTypes`, `companies`, `departments`, `jobPositions`, `educationLevels`, `settings` | `nastaveni` |
| (written via `logSystemEvent`) | `system` |

`employeeChangeRequests` is in `mujProfil` by default (the submit side). The approve/reject handlers in `routes/employeeChangeRequests.ts` pass `category: "zamestnanci"` as an override so review actions land in the Zaměstnanci bucket, not Můj profil.

`SETTINGS_AREA_BY_COLLECTION` drives the `settingsArea` sub-filter within the `nastaveni` category:

| Collections | SettingsArea |
|---|---|
| `users`, `roleTypes`, `settings/menuOrder` | `uzivatele` |
| `companies` | `spolecnosti` |
| `departments` | `oddeleni` |
| `jobPositions` | `pozice` |
| `educationLevels` | `vzdelani` |
| `settings` (payroll settings) | `mzdy` |

### Semantic events

When a route performs a workflow action (approve/reject/claim) or an automated job runs, it passes an `event` string alongside the normal audit fields. The frontend maps these to Czech header phrases in `EVENT_LABELS`. Defined events:

| Event id | Trigger |
|---|---|
| `vacation.approve` / `.reject` | Vacation request approve/reject |
| `vacation.approveEdit` / `.rejectEdit` | Vacation edit approve/reject |
| `shift.unavailability.approve` / `.reject` | Unavailability request approve/reject |
| `shift.override.approve` / `.reject` | Shift override request approve/reject |
| `shift.change.approve` / `.reject` | Shift change request approve/reject |
| `shift.freeClaim.approve` / `.reject` | Free-shift claim approve/reject |
| `shift.freeClaim.autoReject` | Competing free-shift claim auto-rejected by the system (previously silent) |
| `employeeChange.approve` / `.reject` | Employee self-edit change-request approve/reject |
| `plan.autoTransition` | Automatic shift-plan lifecycle transition |
| `multisport.autoStart` / `.autoEnd` | Multisport period automatic start/end |
| `employee.autoTerminate` / `.autoReactivate` | Nightly derived-status sweep |
| `employee.autoStatusChange` | Generic automatic employee status change |

Event ids are emitted by: `routes/vacation.ts`, `routes/shifts.ts` (including the previously-silent competing-claim auto-rejection, now `shift.freeClaim.autoReject` via `SYSTEM_CONTEXT`), `routes/employeeChangeRequests.ts`, `services/planTransitions.ts`, `services/multisportSweep.ts`, and the nightly `applyDerivedStatus` sweep.

Note: auto-fill of manager "R" shifts does not emit a system event because that feature is not yet built (open TODO #12).

### Shift-cell year/month denormalization

`PUT /shifts/plans/:planId/shifts/:employeeId/:date` now writes `year` and `month` alongside the existing `employeeId` on each shift-cell audit entry. The cell date is encoded in `subResourceId` as `employeeId_YYYY-MM-DD`. Only logs when `rawInput` actually changed (no-op re-saves are skipped to avoid tab-in/tab-out spam).

### Instrumented surface

Every PATCH/PUT/POST/DELETE in: `employees` (root + contact + employment + documents + benefits + delete + reveal/export), `contracts` (CRUD + signed PDF upload/delete), `shifts` (~22 mutations: plans, planEmployees, per-shift cells, rules, unavailability, overrides, change requests, MOD row), `vacationRequests`, `payroll` (period create/lock/copy, per-entry edits, notes, recalc, stravenkový paušál at `PATCH /payroll/settings`), `auth` (set-role, create-user, deactivate, reactivate, employee link), `contractTemplates` (create + put), `departments`, `jobPositions`, `educationLevels`, `companies`, `settings`.

Skipped on purpose: `PUT /api/auth/me/theme` — cosmetic per-user preference, not business data.

### Read endpoint — `GET /api/audit`

`functions/src/routes/auditLog.ts`, gated by `nav.audit.view` (admin + director).

Query parameters (all optional):

| Param | Type | Notes |
|---|---|---|
| `category` | comma-separated | Multi-value → Firestore `in` (≤10 values) |
| `userId` | comma-separated | Multi-value → Firestore `in` (≤10 values) |
| `employeeId` | equality | |
| `collection` | equality | |
| `action` | equality | |
| `event` | equality | |
| `templateId` | equality | |
| `settingsArea` | equality | |
| `year` | numeric equality | |
| `month` | numeric equality | |
| `from` / `to` | ISO datetime | Timestamp range |
| `limit` | number | Default 100, max 500 |
| `cursor` | last doc id | Cursor-based pagination |

At most one multi-valued facet per request (Firestore allows only one `in` per query). If both `userId` and `category` are multi-valued, the endpoint returns `400` rather than hanging — this is the fix for the historical "combined filters 500/hang" prod bug. A missing composite index (`FAILED_PRECONDITION`) also returns a clean `400` instead of hanging.

Results are ordered `timestamp desc`. Response: `{ entries: AuditEntry[], nextCursor?: string }`.

`GET /api/audit/:id` — fetch a single entry by id (for the card raw-detail escape hatch).

`GET /api/audit/meta/collections` — still present for backward compat; returns distinct `collection` values from the most recent 5000 entries. (The overhauled UI no longer uses the collection dropdown, but the endpoint is retained.)

### Composite indexes (`firestore.indexes.json`)

Pre-overhaul indexes (still in place):

- `(employeeId, timestamp desc)`
- `(userId, timestamp desc)`
- `(collection, timestamp desc)`
- `(action, timestamp desc)`

Added in v2.3.0 for the "pick a page (category), then one sub-filter" query model:

- `(category, timestamp desc)`
- `(event, timestamp desc)`
- `(category, employeeId, timestamp desc)`
- `(category, year, timestamp desc)`
- `(category, year, month, timestamp desc)`
- `(category, settingsArea, timestamp desc)`
- `(category, templateId, timestamp desc)`

These seven cover every filter combination the UI exposes. Any unsupported combination (no matching index) surfaces the clean `400` described above.

### One-time backfill

`scripts/_backfill-audit-categories.js` (gitignored, local) back-fills `category`, `settingsArea`, and `templateId` onto existing `auditLog` docs that predate the v2.3.0 schema. It calls `categoryForCollection` and `settingsAreaForCollection` directly, so it derives identical values to live writes. Only fills absent fields (idempotent). It does NOT back-fill `year`/`month` onto shift/period entries where the `resourceId` is not a `YYYY-MM` string (plan and period ids are not always month strings, so the backfill cannot reliably derive them). Run on staging before promotion; run on prod at promotion time.

### Frontend — `frontend/src/lib/audit/` and `AuditLogPage.tsx`

The page (`/audit`) is a date-sectioned timeline of grouped event cards. The backend stream is unchanged (one doc per changed field). All grouping is client-side.

**Label layer** (`frontend/src/lib/audit/`):

- `labels.ts` — all type definitions (`AuditCategory`, `SettingsArea`, `AuditAction`) mirroring the backend; `CATEGORIES`/`CATEGORY_LABELS`; `SETTINGS_AREAS`/`SETTINGS_AREA_LABELS`; `COLLECTION_LABELS`/`SUBAREA_LABELS`; `ACTION_LABELS`; `EVENT_LABELS` (event id → full Czech phrase, e.g. `"vacation.approve"` → `"Schválení žádosti o dovolenou"`); `eventLabel(event)` → phrase or `undefined`; `deriveLegacyEventId(collection, statusValue)` → render-derives an event id for pre-v2.3.0 entries from their `status` field change (no data migration required); `fieldLabel(collection, fieldPath)` walks the label map most-specific-path-first; `subjectNoun(collection)` → Czech genitive noun for the generic header phrase; `actionVerb(action)` → verbal noun (Vytvoření / Upravení / Smazání / Zobrazení citlivého údaje / Export dat / Spuštění úlohy).
- `fields.employee.ts`, `fields.payroll.ts`, `fields.shifts.ts`, `fields.misc.ts` — Czech field-label maps per collection family (~255 fields total). Merged into `FIELD_LABELS` in `labels.ts`, keyed by root collection name.
- `format.ts` — value formatters: ISO dates, Ano/Ne booleans, enum display strings, generic fallback. Sensitive values remain redacted (no formatting applied).
- `grouping.ts` — `groupEntries(entries)` folds the flat per-field stream into one `AuditEvent` per (author + action + record) within a 20-second window, with field changes sub-grouped by section (area label). Employee sections are sorted in canonical order (Osobní údaje → Kontakt → Doklady → Pojištění a banka → Pracovní poměr → Smlouvy). `bucketByDate(events)` partitions events into date headers (Dnes / Včera / explicit Czech date). `eventTitle(ev, employeeName?)` derives the record identifier (employee name with link, payroll month, snapshot name, or empty).

**Shift-cell label:** `grouping.ts` parses the date from `subResourceId` (`employeeId_YYYY-MM-DD`) and labels each shift-cell change row with its formatted date (e.g. `"5. 5. 2025"`) instead of the generic field name. A grouped multi-day edit reads as one dated row per day.

**Filter UI:** multi-select "Stránka" (category) chip group + "Autor změny" (userId) chip group. Selecting a category reveals per-page sub-filters: Zaměstnanec (employeeId) for Zaměstnanci/Směny/Dovolená/Mzdy; Rok/Měsíc for Směny/Mzdy; Šablona for Šablony smluv; Oblast nastavení for Nastavení. Date-range picker applies to all. The old collection/action dropdowns are removed from the UI (the backend still accepts `collection` and `action` as query params for direct API use). Filter state is mirrored to URL query params.

**`AuditEventCard`** (`frontend/src/components/AuditEventCard.tsx`):

- Collapsed-by-default: chevron + header phrase + record title (linked) + change count (suppressed for semantic events) + author + time.
- Header phrase: uses `eventLabel(event.event)` when a semantic event id is present; falls back to `actionVerb(action) + " " + subjectNoun(collection)` otherwise. Multi-area employee edits use the root collection noun; single-area edits use the specific area noun.
- Expanded body: changed fields as `label: old → new` rows within section sub-headers; create/delete snapshot rows; reveal/export/trigger `extra` rows; "Technický detail" toggle revealing raw JSON.
- Sensitive-field rows render as `"citlivý údaj změněn"` without values.
- Reused by `EmployeeDetailPage`'s "Historie změn" section in compact mode; the `resolveRef` prop resolves internal foreign keys (e.g. `employmentRowId`) to human labels before display.
- `HIDDEN_FIELDS` (`rowSnapshot`, `htmlContent`, `htmlContentLength`, `unsignedStoragePath`, `signedStoragePath`, `hasUnsignedPdf`) are suppressed from the readable view but visible in the raw-JSON escape hatch.

**Deferred (not yet shipped):** permission-key add/remove diff rendering. Permission changes on `roleTypes` entries currently render as labelled key arrays without a human-readable +/- diff.

**Nav / gating** — `nav.audit.view` permission (admin + director by default). Route is `/audit`. `EmployeeDetailPage` "Historie změn" section is also gated by `nav.audit.view`.

**Retention** — none. Entries persist forever. If volume becomes a problem, add a scheduled prune in `functions/src/index.ts`.

---

## Upozornění hub

`/upozorneni` (admin + director, plus anyone else holding the relevant per-tab review permission) is a tabbed page that aggregates everything that needs admin attention. The menu label is **Upozornění** (was "Neplatné doklady").

**Tabs** (`frontend/src/pages/AlertsPage.tsx`)
1. **Doklady** — document-expiry alerts from the `alerts/` collection (existing).
2. **Zkušební doba** — probation-end alerts from `probationAlerts/`.
3. **Dovolená** — pending vacation requests (status `pending` or approved-with-pendingEdit). Sourced from `GET /vacation` filtered client-side. Workflow-driven (approve/reject in `VacationPage` makes the row disappear). Gated `vacation.review`.
4. **Výjimky** — pending shift override requests across all plans. Endpoint `GET /api/shifts/overrides/pending` runs a `collectionGroup` query and denormalizes `planId/planYear/planMonth` per row. Gated `shifts.override.review`.
5. **Žádosti o změny** — same pattern via `GET /api/shifts/changeRequests/pending`. Gated `shifts.changeRequest.review`.
6. **Žádosti o úpravu údajů** — pending employee self-service data-change requests (`EmployeeDataChangeRequestsTab`, gated `changeRequests.review`).
7. **Předávací protokol** — Recepce handover warnings (`HandoverWarningsTab`, `GET/POST /api/handover-warnings`, gated `changeRequests.review` — no separate key), in two unread sections plus a shared **Přečtené**: **Nenavazující předání** (handover chain break) and **Pozdní příchody** (Převzal after the next shift's start — 19:00 night / 07:00 day). Detailed in [Recepce — Handover warnings](recepce.md#handover-warnings-předávací-protokol-tab). The combined unread count (both types) feeds the tab pill and the sidebar `/upozorneni` badge via `HandoverWarningsContext` (`GET /handover-warnings/unread-count`).

Tab labels show pending counts as red pill badges.

**Read-state (Doklady + Zkušební doba)** — shared and server-side. Each `alerts/` and `probationAlerts/` doc carries `read` / `readAt` / `readBy`; marking read/unread goes through `POST /api/alerts/read` and `POST /api/alerts/probation/read` (`{ ids, read }`, admin/director), so a dismissal is shared across all admins/directors and survives the daily/manual refreshes. The refreshers **preserve** the flag when the underlying deadline (`expiryDate` / `probationEndDate`) is unchanged and **reset** it to unread only when the date moves (a renewed document / edited probation date). Read alerts stay in a muted **Přečtené** archive with an "Označit jako nepřečtené" un-mark action and don't count toward the badge. `AlertsContext` derives the unread badge counts purely from the server flag — the old `localStorage` keys (`hotel_hr_read_alert_ids_v2` / `hotel_hr_read_probation_alert_ids_v1`) are gone.

**Probation alert generator** — `functions/src/services/probationAlerts.ts`. Mirrors `updateDocumentAlerts`: parses the free-form `probationPeriod` string (e.g., "3 měsíce", "30 dní", "2 týdny", or a bare number defaulting to months — accent-insensitive match), computes the calendar-correct end-date, and upserts an alert iff end-date is within `PROBATION_ALERT_DAYS = 14`. Triggered on every employment row create + edit (best-effort, never blocks the response), cascade-deleted on employee delete, and re-scanned daily by `refreshProbationAlerts`. Manual emulator trigger: `POST /api/employees/trigger-probation-refresh`. Unparseable / zero values delete any existing alert. **Suppression**: the alert is also deleted when the active row's employment session is **terminated** (an `ukončení` row exists, or the effective `endDate` is in the past) or **already has a salary Dodatek** (`změna smlouvy` carrying a `mzda` change). `refreshProbationAlertsForEmployee` loads the full employment history (single-field `orderBy`, no composite index) and a server-side session walk (`sessionFlagsByNastup`, mirroring the frontend `groupBySession`) decides suppression per active row.

**Alert suppression for terminated employees (both alert types):** `status === "terminated"` is the canonical suppression signal for both document-expiry alerts and probation alerts:
- **Document-expiry alerts** (`refreshDocumentAlerts` scheduled + manual trigger in `functions/src/index.ts`): when building the expiry-fields body for `updateDocumentAlerts`, every field is set to `null` for terminated employees, causing all existing alerts to be deleted and none to be created. Active **and** `before-start` (upcoming) employees keep their document-expiry alerts.
- **Probation alerts** (`refreshProbationAlertsForEmployee`): the canonical `empData.status === "terminated"` check overrides the per-session flags — if the employee root says terminated, the alert is suppressed regardless of session state. `before-start` employees (status not `"terminated"`) are not suppressed — a new hire awaiting day one can still have a ticking probation clock.

The distinction matters because the employment-row `status` field can lag the derived employee-level `status` field; checking the employee root avoids stale alerts surviving after a status transition.

**Manual refresh (admin)** — a rotating-arrow `IconButton` (`refresh` variant) next to the page title, rendered only for `admin`, re-triggers both refreshers (`POST /api/employees/trigger-alert-refresh` + `…/trigger-probation-refresh`) in parallel, spins while in flight, then calls `AlertsContext.refresh()` for the badges and bumps a `refreshKey` to remount the active tab so it re-fetches the regenerated alerts. Each call writes its usual `manual-trigger` audit entry; failures surface via `ConfirmModal`. Directors don't see the button (the trigger endpoints are `admin`-only).

**Sidebar badge for `/upozorneni`** — sums **all seven** review queues shown on the Upozornění page, so the badge equals the page's tab counts: unread documents + unread probation + pending vacation + pending shift overrides + pending shift change-requests + pending employee data-change requests + unread Předávací protokol warnings (chain + late). Each addend is gated by the same permission as its page tab (`vacation.review` / `shifts.override.review` / `shifts.changeRequest.review` / `changeRequests.review` — the handover warnings reuse `changeRequests.review`; documents/probation are already 0 without `nav.alerts.view`). Vacation and the shift queues **also** keep their dedicated `/dovolena` and `/smeny` badges — the dedicated badge says WHERE, this total says overall outstanding load. (Earlier this summed only documents + probation, so a pending vacation request appeared on the page's Dovolená tab but never in the sidebar total — fixed v2.1.3.)

**Badge freshness** — the count contexts (`AlertsContext`, `VacationContext`, `ShiftOverridesContext`, `ShiftChangeRequestsContext`, `EmployeeChangeRequestsContext`, `HandoverWarningsContext`) otherwise fetch once on mount, so a request submitted by *another* user never appeared until a full reload. `Layout.tsx` re-pulls all of them **on every navigation** (`location.pathname`) and on a **60s interval**. Each `refresh()` is a permission-gated no-op, so non-reviewers issue zero extra requests; a reviewer's own approve/reject still calls `refresh()` locally for an immediate update (added v2.1.3).

**Cross-plan list endpoints** — `GET /api/shifts/overrides/pending` and `GET /api/shifts/changeRequests/pending` use `collectionGroup` queries on `(status == "pending", requestedAt desc)`. Both composite indexes are declared in `firestore.indexes.json`. Per-plan modals on `ShiftPlannerPage` are unchanged — they remain the primary action surface for approve/reject; the Upozornění hub is the cross-plan read-only/list view.

**Pending-count endpoints** (`GET /shifts/overrides/pending-count`, `GET /shifts/changeRequests/pending-count`) feed the nav-badge and dashboard-tile counts for Výjimky and Žádosti o změny. **Both must include `.orderBy("requestedAt","desc")`** — a bare `collectionGroup("…").where("status","==","pending")` with no `orderBy` is not served by the `(status, requestedAt)` composite index on real Firestore and throws `FAILED_PRECONDITION`. The badge contexts swallow that error silently (`.catch(() => {})`), leaving the count stuck at 0 with no visible indication. The list endpoints have always included the `orderBy` (which is why listing worked while counting did not); the count endpoints were fixed to mirror them in v3.5.1. Every pending request always writes `requestedAt` at creation, so adding the `orderBy` does not drop any records. **Do not remove the `orderBy` from either count query** — it is required by the index, not merely cosmetic.

**Audit log** — probation-alert writes are system-generated (scheduled refresh + on-employment-edit cascade) and intentionally NOT in the audit log. The triggering employment row create/edit is already audited, which is the user-meaningful event.

---

## Async error forwarding (never-hang)

The backend runs on **Express 4**, whose router predates `async` handlers. Its
`Layer.handle_request` wraps the handler in a `try/catch` that catches only
**synchronous** throws; when an `async` handler *rejects*, the returned promise
is dropped and **no response is ever sent** — the client's `fetch` hangs until it
times out. (Symptom seen in the wild: a Lobby bar save whose "Ukládám…" never
finished when a cold Firestore read rejected.)

`functions/src/middleware/asyncRouteErrors.ts` fixes this globally.
`installAsyncRouteErrorForwarding()` is called **first** in `index.ts`, before any
route is registered. It patches `Layer.prototype.handle_request` / `handle_error`
so that when a handler returns a thenable, its rejection is routed to `next(err)`
and reaches the JSON-500 error middleware at the bottom of `index.ts`. This is the
same mechanism as the `express-async-errors` package, reimplemented locally to
avoid adding a Cloud Functions dependency.

- **No per-handler `try/catch` for the hang** — every one of the ~200 async
  handlers is covered by the single patch. Handlers still `try/catch` where they
  need *specific* error semantics (a tailored 400/409), but they no longer need a
  catch-all just to avoid hanging.
- **Fails safe on an Express upgrade.** It reaches an internal module path
  (`express/lib/router/layer`) that has no public API. If a future Express moves
  or reshapes it, the patch quietly no-ops (stock behavior) instead of crashing
  startup — it can only reintroduce the original hang risk, which the behavior
  test guards against. Re-verify the patch when bumping Express major.
- Idempotent (guarded by an `__asyncErrorsPatched` flag); a normally-resolving
  async handler is unaffected and still returns its own response.

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

- **`frontend/src/components/DocumentExpiryBar.tsx`** — shared, pure-display banner listing an employee's expired / soon-to-expire documents. Accepts a `DocumentExpiryAlert[]` prop and renders nothing when the array is empty. The 30-day classification and `"expiring"` / `"expired"` status values are computed server-side; this component is only a renderer. Used on three pages: admin employee detail, Můj profil, and the dashboard. See [Self document-expiry alerts + Můj profil badge (v3.2.0)](employees.md#self-document-expiry-alerts--můj-profil-badge-v320).
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
- **Dash convention**: visible frontend text uses **en dashes (`–`), never em dashes (`—`)** — e.g. date-range labels ("Od – Do"), page-subtitle separators ("Recepce – Ambiance"). Keep this when writing new UI copy.
- **Favicon / logo**: single source of truth at `frontend/src/assets/logo.svg` (real OTH gold brand mark, viewBox tightened to `210 300 195 195` so the glyph fills its box at any size — path data untouched from the Illustrator export). Referenced from `frontend/index.html` as `<link rel="icon" href="./src/assets/logo.svg">` (relative path so Vite processes and fingerprints it in production), imported into `Layout.tsx` at 26×26px in the sidebar via `styles.logoMark`, and rendered at 72×72px above the heading on both login and forgot-password views via `LoginPage.module.css` → `.logo`. The earlier placeholder `public/favicon.svg` was removed in `feature/unified-logo`; `assets/logo-mark.svg` (unimported placeholder) is retained as a backup.
- **Active nav link**: `Layout.module.css` → `.active` combines the existing `#3b82f6` 3px left-border and `#2d3f54` fill with a soft primary-tinted inner shadow (`box-shadow: inset 0 0 18px rgba(59, 130, 246, 0.12)`) so the selected row reads as "lit up" rather than merely shaded.
- **Sidebar user bar**: `.userBar` uses `gap: var(--space-2)` between email, role, logout and theme toggle (no per-element `margin-top` rules). `.userEmail` is `0.8125rem`.

---

## Companies

`companies/{companyId}` fields: `name`, `address`, `ic`, `dic`, `fileNo` (Spisová značka).

---

---

## Mobile responsiveness / responsive layout (v3.0.0)

The app targets down to 360 px width. The three canonical breakpoints are documented as a comment in the `frontend/src/index.css` `:root` block (CSS Modules cannot share JS variables inside `@media`, so the convention is prose rather than a token):

| Breakpoint | Range | Navigation |
|---|---|---|
| Desktop | ≥ 900 px | 220 px sidebar, multi-column layouts |
| Tablet | 560–900 px | Sidebar; minor padding trim (`1.5rem`) |
| Phone | < 560 px | Fixed bottom tab bar; single-column layouts; scrollable tables |

Phone-only media queries use `max-width: 559.98px` (not `559px`) to avoid a 560 px double-match seam.

The `--bottom-nav-height` CSS token (`56px`) is defined in `index.css` `:root`. It is consumed only inside phone `@media` blocks and by `BottomNav.module.css` for the bar's height calculation.

### Shell switch: sidebar ↔ BottomNav

`frontend/src/components/Layout.tsx` always mounts **both** the 220 px sidebar (`<nav className={styles.sidebar}>`) and `<BottomNav>`. The switch is CSS-only:

- `Layout.module.css` hides `.sidebar` (`display: none`) at `max-width: 559.98px` and adds bottom padding to `.main` (`var(--bottom-nav-height) + env(safe-area-inset-bottom) + 1rem`) so content clears the fixed bar.
- `BottomNav.module.css` hides `.bar` (`display: none`) by default and makes it `position: fixed; bottom: 0` at `max-width: 559.98px`.
- At phone width, `Layout.module.css` also switches `.shell` to `height: 100dvh` (dynamic viewport height — avoids the mobile browser chrome gap).

### BottomNav component

`frontend/src/components/BottomNav.tsx` + `BottomNav.module.css`.

**Single source of truth.** `Layout.tsx` computes the permission-gated, user-ordered `items` (from `resolveOrderByPermission`) and the `badgeFor` function, then passes them into both the sidebar render loop and `<BottomNav>` as props. `BottomNav` never re-derives permissions.

**Four fixed anchors** — registry ids `prehled`, `smeny`, `dovolena`, `mujProfil`. Their bottom-bar labels are: Přehled, Směny, Dovolená, Profil (the full "Můj profil" label is too wide for a 360 px tab slot — see `LABEL_OVERRIDE` in `BottomNav.tsx`). Anchors are filtered from the incoming `items` list and silently drop out if a user lacks the permission for that item.

**"Více" tab** — any permitted items not in the four anchor slots appear in a slide-up sheet. The tab is **always rendered** (`showMore = true`), even when a user has no non-anchor pages: the sheet footer holds the theme toggle, Nápověda and **Odhlásit**, which on phones live *only* here — so the tab is the sole path to logout and must never be hidden. (Regular employees are exactly this case — their permitted pages are the four anchors Přehled/Směny/Dovolená/Profil — and an earlier `moreItems.length > 0` gate left them with no way to log out.) The item list inside the sheet is only rendered when there is at least one non-anchor item. "Více" is marked active whenever the current route belongs to any non-anchor page, including nested routes (e.g. `/zamestnanci/:id`). It shows an aggregate pending dot when any non-anchor item has a non-zero badge.

**"Více" sheet** (`styles.sheetOverlay` / `styles.sheet`):
- Slides up from the bottom (`align-items: flex-end`). Max height `80dvh`, scrollable item list.
- Header with "Více" title and a ✕ close button; sheet footer with theme toggle, Nápověda, Odhlásit, `<TimeOverrideControl>` (renders only in emulator/staging), and the version string (gated by `system.version.view`; **display-only on mobile** — the clickable changelog is desktop-only, so `BottomNav` never renders it as a button).
- Dismisses via the ✕ button, selecting a list item, or Escape key. **Not on backdrop click** — consistent with the project modal-dismissal rule. The overlay `<div>` has no `onClick` handler.
- Body scroll is locked (`document.body.style.overflow = "hidden"`) while the sheet is open; restored (to whatever the previous value was) on close/unmount.
- Footer utilities are passed to `BottomNav` as plain values and handlers (`theme`, `onToggleTheme`, `onLogout`, `versionLabel`, `timeControl`) rather than reusing the dark sidebar JSX — this lets the sheet render them against the themed `--color-surface` background instead of the always-dark sidebar palette.

**Badge dots** — a small red dot (`styles.dot`, 8 px, `--color-danger` fill) floats top-right of the icon when `badgeFor(id) > 0`. The bottom bar uses a dot (not a count) because there is no room for a number in a compact tab slot. The "Više" sheet does display numeric badge counts next to each item label (`styles.sheetBadge`).

**Props:**

```ts
interface BottomNavProps {
  items: MenuItem[];
  badgeFor: (id: string) => number;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onLogout: () => void;
  versionLabel: string | null; // e.g. "v3.0.0"; null when not permitted
  timeControl?: ReactNode;      // <TimeOverrideControl/> — self-styled
}
```

### Card-on-mobile pattern

Two approaches are used, for different reasons:

**1. CSS `data-label` + `.cardsOnMobile` modifier (two surfaces)**

Used when CSS can restyle rows without changing markup topology:

- **`MyRequestsPanel.tsx`** (Shifts "Moje žádosti" table) — table gets `className={styles.cardsOnMobile}` alongside its base class. Scoped to `.cardsOnMobile` in `ShiftOverridePanel.module.css` so the manager-review table on the same page (sharing the stylesheet) keeps its normal table layout.
- **`VacationPage.tsx`** (Vacation "Moje žádosti" table) — same pattern, scoped in `VacationPage.module.css`. Handles an extra case: the inline edit row (`.editRow`) becomes its own info-tinted card with stacked inputs and no `::before` labels.

The CSS pattern: at `max-width: 559.98px`, `.cardsOnMobile thead` is hidden; table / tbody / tr / td are all set to `display: block`. Each `tr` becomes a bordered, rounded card. Each `td` renders as a flex row with `td::before { content: attr(data-label) }` as the label on the left and the value right-aligned. Every `<td>` in these tables carries a `data-label="…"` attribute with its column name.

**2. Explicit second markup block (Overview StaffingTable)**

Used when CSS alone cannot restructure the data:

`OverviewPage.tsx` renders **two** elements for the staffing table:
- `<table className={styles.hotelTable}>` — hotels as columns, DENNÍ/NOČNÍ as rows (desktop/tablet).
- `<div className={styles.staffingCards}>` — one card per hotel, DENNÍ and NOČNÍ stacked vertically (phone).

`OverviewPage.module.css` hides `.hotelTable` and shows `.staffingCards` at `max-width: 559.98px`.

**Why different techniques?** CSS can restyle a table's `tr` rows into cards, but it cannot transpose the data — the staffing table's column dimension (hotels) would need to become cards, which CSS cannot do without duplicating or reordering the DOM. The two-block approach lets each markup block be semantically correct for its viewport. The tradeoff is maintaining two render paths in sync; the single-block `data-label` trick is preferred whenever the transposition problem does not arise.

### Best-effort table scroll (admin-heavy pages)

Wide admin tables are bounded with `max-width: 100%` + `overflow-x: auto` scroll wrappers so they scroll horizontally inside their container rather than widening the page (which would push content behind the fixed bottom bar):

- **`EmployeesPage.module.css`** — `.tableScroll` wrapper (newly added in this pass).
- **`PayrollPage.module.css`** — the table container already had `overflow-x: auto; max-width: 100%`.
- **`ShiftGrid.module.css`** — existing horizontal scroll retained.

These pages are not redesigned into cards. Admin-heavy, fixed-layout tables benefit more from scrollability than from a card reflow. They are "works but may scroll" — a later pass will refine them if needed.

### Modal width caps

Fixed-width modal panels use `width: min(Npx, 100vw - 2rem)` so they always keep a 1 rem gutter on phones:

| Modal / element | Width |
|---|---|
| `ConfirmModal.module.css` | `min(380px, 100vw - 2rem)` |
| `AddEmployeeToPlanModal.module.css` | `min(480px, 100vw - 2rem)` |
| `GenerateContractModal.module.css` | `min(560px, 100vw - 2rem)` |
| `SettingsPage.module.css` (inner panel) | `min(420px, 100vw - 2rem)` |
| `UserPermissionsModal.module.css` | `min(760px, 100vw - 2rem)` |
| `VacationCollisionResolutionModal.tsx` | inline `min(560px, 95vw)` |

Settings page tab strip scrolls horizontally at `max-width: 559.98px` (`flex-wrap: nowrap; overflow-x: auto`) so tabs do not wrap or squish.

### Form single-column collapse

Two employee data forms collapse their two-column grid to one column on phones:

- `EmployeeFormPage.module.css` — `.grid` changes from `grid-template-columns: 1fr 1fr` to `1fr` at `max-width: 559.98px`.
- `EmployeeSelfPage.module.css` — same pattern for the self-edit form.

### Login card

`LoginPage.module.css` adds `padding: 1rem` to `.page` and trims `.card` to `padding: 1.75rem 1.25rem` at `max-width: 559.98px` so the card does not touch screen edges on small phones.

### Landscape phones (v3.0.1)

A phone in landscape is **wide but short** (≈667–930 px wide, ≤430 px tall), so a width-only query let the desktop sidebar reappear on rotation. Every phone `@media` block was therefore extended from `(max-width: 559.98px)` to:

```
@media (max-width: 559.98px), (orientation: landscape) and (max-height: 480px)
```

i.e. **narrow width OR (landscape AND short)**. `max-height: 480px` catches landscape phones while excluding landscape tablets (≥768 px tall). This is now the canonical phone query (documented in the `index.css` `:root` comment) and is applied to all 10 phone-aware stylesheets so the *whole* mobile layout — not just the nav — survives rotation. Components that need the breakpoint in JS (see below) mirror the same string via `window.matchMedia`.

### Full-screen shift grid on phones (v3.0.1)

On phones the Shift Planner (`ShiftPlannerPage.tsx` + `ShiftGrid`) maximizes grid space:

- **Legend hidden** outright (`.legend { display: none }` in the phone `@media`).
- **Chrome auto-collapse** — the month-nav header and plan bar collapse while the grid is scrolled and reappear at the top. The grid owns its own internal scroll (`.wrapper` is `overflow: auto` on both axes — horizontal scroll can't be decoupled from vertical), so the chrome can't scroll away on its own. `ShiftGrid` reports its wrapper's scroll-at-top state via an `onAtTopChange` callback (hysteresis: hide past 40 px, show under 8 px; fires only on a flip). `ShiftPlannerPage` holds `gridAtTop`, derives `chromeHidden = isPhone && !gridAtTop`, and:
  - adds a `.chromeHidden` class that collapses the header/plan-bar (`max-height: 0`, `opacity: 0`, `overflow: hidden` — the last applied **only** in the collapsed state so the export-menu dropdown isn't clipped at rest);
  - zeroes `--sticky-top`, which is set on the **page root** (not passed as a prop) and inherited by `ShiftGrid`'s wrapper `max-height`, so the heavy grid does not re-render on collapse — only the parent's style changes — and the grid grows into the freed space.
- **Animated** — collapse/expand eases over 0.28 s. `max-height: auto` can't transition, so the visible `max-height` is set inline to each element's **measured** pixel height (`headerHeight` / `stickyTop - headerHeight`) and transitions to 0; the grid wrapper transitions its `max-height` on the same curve so the two move in sync.
- Mobile grid wrapper height uses `100dvh - var(--sticky-top) - var(--bottom-nav-height) - 1.5rem`.

### Scope / priority

This pass prioritized **employee-facing screens**: Přehled, Můj profil, Dovolená (own requests), viewing shifts (not editing the plan grid), Upozornění (read view), and Login. Admin-heavy pages (ShiftGrid editor, Payroll, full Employees table, Settings sub-panels) are "works but may scroll" and are targeted for future refinement.

### Privileged-page pass (v3.8.0)

The admin/manager pages left as "works but may scroll" above were made phone-native. All changes are **phone-only** — gated to the canonical `@media` breakpoint or an `isPhone` `window.matchMedia` check — so desktop layout is untouched. Patterns used:

- **Foldable-accordion tables** — a variant of the card pattern for dense tables where a flat card would be too tall. The table gets a `foldTable` class; each row collapses to its **name cell (the header)**, and tapping it reveals the other columns as labelled rows. A per-row open-state `Set` in the component toggles a `foldOpen` class on the `<tr>`; a tap-guard (`closest("input,button,select,a")`) lets inner controls work without folding. Used by Settings → Uživatelé / Pracovní pozice / Vzdělání (`SettingsPage`) and the **Payroll** grid (`PayrollPage`, where the 11 metric columns are labelled by CSS `nth-child` since the columns are fixed-order). Specificity note: the hide rule must out-specify the generic `.table td { display:block }` (use `.foldTable tr:not(.foldOpen) .numCell`, not a bare class) or collapsed cells stay visible.
- **Card conversion (`data-label`/`::before`)** extended to the Upozornění review queues (`AlertsPage` + the six `upozorneni/*` tabs, shared stylesheet), the Dovolená admin tables ("Všechny žádosti", "Schválené dovolené"), and the Směny review panels (`ShiftOverridePanel`, `ShiftChangeRequestPanel`).
- **`EmployeesPage`** collapses to a **names-only list** (each name links to the detail); the detail page hero stacks one item per line and its field grids collapse.
- **HR přehled tiles** (`HeadcountStats`) drop from `minmax(420px,1fr)` to a single shrinkable column so they fit the bordered box.
- **Contract Templates** (`ContractTemplatesPage`) is not phone-viable (210 mm A4 canvas + TipTap), so an `isPhone` early-return shows a "use a larger screen" notice, and its menu entry is **hidden from the phone bottom-nav** via a new `hideOnMobile` flag on the `menuItems.ts` registry (filtered out of the `BottomNav` items in `Layout.tsx`; the desktop sidebar still shows it).
- **Bottom-nav zoom pinning** — `BottomNav.tsx` tracks `window.visualViewport` and translates + counter-scales `.bar` so it stays pinned to the visual viewport during pinch/double-tap zoom (guarded to only engage while `scale > 1`, leaving keyboard behaviour unchanged). **iOS fix (v3.8.1):** the translate delta originally used `window.innerHeight` for the layout-viewport height, but on iOS WebKit (Safari + Chrome) `window.innerHeight` tracks the *visual* viewport and shrinks as you pinch-zoom in — collapsing the delta and pushing the bar off-screen. It now uses `document.documentElement.clientHeight` (the layout-viewport height, constant through pinch-zoom), so the bar tracks the visual-viewport bottom on iOS as well.

### Collapsible employment-history entries on phones (v3.8.1)

On the Employee-detail (and Můj profil) **Historie pracovního poměru** tab, each session card was already collapsible. On phones, the individual **entries** inside an expanded session (Nástup / Dodatek / Ukončení) are now collapsible too: every entry starts **collapsed** (only its date + type + summary and a chevron show), and tapping the summary reveals the action buttons (Upravit, Zobrazit podepsanou, Stáhnout, Smazat…). This keeps the history list short and readable on a narrow screen.

- Implemented in `frontend/src/components/EmploymentRowItem.tsx`: a phone-only `expanded` state (starts `false`) with `showActions = !isPhone || expanded` — so on desktop the actions **always** render and the DOM is byte-identical to before (the toggle handler, chevron, and `.rowPhone` class are all gated behind `isPhone`).
- The interactive `<SalaryReveal>` shown in a row summary is wrapped in a `stopPropagation` span so revealing a salary doesn't also toggle the row open/closed.
- **New shared hook `frontend/src/hooks/useIsPhone.ts`** — a reactive `matchMedia` subscription against the canonical phone query (`PHONE_MEDIA_QUERY`, byte-identical to the inline `matchMedia` blocks in `ShiftPlannerPage` / `ContractTemplatesPage` and to `OnboardingContext`). Prefer this hook for any new "are we on a phone?" check instead of copying the inline block.

---

## UI tweaks (2026-06-10)

- **Shift-plan section labels** — the first shift section (formerly labelled "FOM") is now labelled **"Management"** in `SECTION_LABELS` in `frontend/src/lib/shiftConstants.ts`. The three sections remain `vedoucí`, `recepce`, `portýři`; only the display name of `vedoucí` changed. (The audit-log label in `frontend/src/lib/audit/fields.misc.ts` still says "FOM" for the `manager` menu-order field — a separate label not tied to shift sections.)
- **Shift-plan Σ summary rows removed** — per-section subtotal rows (showing the daily Σ employee count per section) have been removed from the shift grid. Sections are now separated by header rows only.
- **Sidebar footer button order** — in `Layout.tsx`, the footer `userBar` renders: theme toggle → **? Nápověda** → **Odhlásit** (in that order). Previously Nápověda was after Odhlásit.
- **Settings tab order** — the Settings page tab strip now starts with **Uživatelé** → **Uživatelské typy** (users first, then types), followed by the číselník tabs. The order is driven by the render order in `SettingsPage.tsx`.
