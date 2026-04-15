# Hotel HR App — Claude Guidelines

## Git Workflow

- **Always create a new branch before making any changes.** Never work directly on `master`.
- Branch naming: `feature/short-description`, `fix/short-description`, `chore/short-description`
- You may commit and push to the feature branch freely.
- **Only the user decides when to merge.** Never merge branches yourself.
- Use clear, descriptive commit messages explaining *why*, not just *what*.
- **Before any `git push`, always update CLAUDE.md** (build phases, key implementation notes) **and project memory** (`~/.claude/projects/.../memory/`) to reflect completed work. Do this as the last commit on the branch before pushing.

## Data Safety — TOP PRIORITY

This is the single most important rule in this project.

- If there is **any suspicion** that an operation could compromise, corrupt, or delete data — **stop and tell the user immediately** before proceeding.
- This applies to: Firestore migrations, schema changes, bulk updates, deleting collections/documents, changing encryption keys, modifying Cloud Functions that write to the database, or anything touching production data.
- When in doubt: **ask first, act second.**
- Never run destructive operations (deletes, overwrites, re-encryptions) without explicit user confirmation.
- Encryption key (`ENCRYPTION_KEY`) must never be changed once data is stored — doing so would make all encrypted fields unreadable. If a key rotation is ever needed, it requires a full migration plan first.

## Database Backups

- When the app is deployed to production, **scheduled Firestore backups must be in place**.
- Backups should run at minimum daily, ideally to a separate Google Cloud Storage bucket.
- Before any migration or bulk data operation in production, a manual backup must be triggered and confirmed first.
- Remind the user to verify backup status if we are about to touch production data.

## Project Context

### What this app is
A cloud-based HR management platform for a Czech hospitality company operating multiple hotel properties (Special Tours Prague / STP, Hotel Property Management / HPM). It replaces Excel workbooks used for employee records, contract generation, shift planning, and payroll.

### Full specification
The complete technical spec lives in `HR_App_Specification.docx` (excluded from git). It was read in full at project start. Key spec sections to refer back to: roles & permissions (§3), DB schema (§4), shift expression parser (§8.3), payroll calculation rules (§9.3).

### Technology stack
| Layer | Technology |
|---|---|
| Frontend | React + TypeScript (Vite) — `frontend/` |
| Backend | Firebase Cloud Functions (Express) — `functions/` |
| Database | Firestore (NoSQL) |
| Auth | Firebase Auth with custom role claims |
| File storage | Firebase Storage |
| Contract generation | TipTap WYSIWYG editor (templates) + html2pdf.js client-side (PDF) |
| Encryption | AES-256-GCM in Cloud Functions |

### Firebase project
- Project ID: `hotel-hr-app-75581`
- Web App ID: `1:261269048570:web:9bb9e3b02efac0c31d8d43`

### Roles
`admin` → `director` → `manager` → `employee` (least privileged)
Custom claims set via Firebase Admin SDK on the `users/` Firestore collection.

### Sensitive encrypted fields
These fields are AES-256-GCM encrypted before writing to Firestore. They must **never** be stored in plaintext or returned raw to the frontend:
- `employees.birthNumber` (rodné číslo)
- `documents.idCardNumber` (`idCardExpiry` was removed from the UI — field deprecated)
- `benefits.insuranceNumber`, `benefits.bankAccount`

Every reveal of a sensitive field is logged to the `auditLog/` Firestore collection.

### Firestore data model
Top-level collections: `employees`, `users`, `companies`, `jobPositions`, `alerts`, `notifications`, `shiftPlans`, `vacationRequests`, `payrollPeriods`, `auditLog`

Sub-collections under `employees/{id}`: `documents`, `contact`, `employment`, `benefits`, `contracts`

Sub-collections under `shiftPlans/{id}`: `planEmployees`, `shifts`, `rules`, `unavailabilityRequests`, `shiftOverrideRequests`, `shiftsSnapshot`

Sub-collections under `payrollPeriods/{id}`: `entries`

Denormalized fields on `employees` root doc for querying: `currentCompanyId`, `currentDepartment`, `currentContractType`, `currentJobTitle`

### Build phases (from spec §13)
1. ✅ Foundation — scaffold, Firebase project, dependencies, encryption service, employee CRUD + frontend shell
2. ✅ Auth — user management UI, role assignment, create/deactivate/reactivate users, role change UI
3. ✅ Employee module — collapsible detail page, unified add/edit form, contact/documents/benefits sub-collections, employment history tab (add/edit with context-sensitive modal per change type), document expiry alerts with global overview + unread badge, sensitive field clear, salary masking in history
4. ✅ Contract module — TipTap template editor with variable picker, html2pdf.js PDF export, Firebase Storage, contract log UI (ContractsTab), generate from history rows, companies API + Settings tab
5. ✅ Shift planner — `parseShiftExpression()`, monthly grid UI, availability rules, X-limit overrides, unavailability requests (notifications skipped by design)
6. ✅ Vacation (Dovolená) — vacation request workflow, pendingEdit pattern for approved edits, auto-X in shift plans, user↔employee linking in Settings
7. ✅ Payroll — calculation engine (replicates MZDY.xlsx), summary UI with editable overrides, per-contract-type row tints, sick leave tracking, configurable food voucher rate (export deferred to Phase 8)
8. Polish — stats dashboard, audit log UI, daily expiry alert scheduled function, payroll export

### Important: backend changes require a build step
The Functions emulator runs compiled JavaScript from `functions/lib/`, **not** the TypeScript source directly. After any change to files under `functions/src/`, run:
```
cd functions && npm run build
```
Then restart the emulators. Forgetting this means the old compiled code keeps running silently — the TypeScript change has no effect until rebuilt.

### Running locally

The user starts emulators and the frontend manually each session.

```
# Terminal 1 — Firebase emulators
cd Hotel-DB
node "C:\Users\Richard Klima\AppData\Roaming\npm\node_modules\firebase-tools\lib\bin\firebase.js" emulators:start

# Terminal 2 — Frontend dev server
cd Hotel-DB/frontend
npm run dev
# → http://localhost:3000
```

### Environment files (not in git)
- `functions/.env` — contains `ENCRYPTION_KEY`
- `frontend/.env` — contains `VITE_FIREBASE_*` config values

### Known issues / quirks
- Firebase CLI must be run via full path until PATH is refreshed in a new terminal session: `node "C:\Users\...\firebase-tools\lib\bin\firebase.js"`
- PowerShell execution policy blocks `firebase.ps1` and `npm.ps1` — use `cmd`, or prefix with `&` in PowerShell, or use `npm.cmd` explicitly
- Node.js v24 is installed at `C:\Program Files\nodejs\node.exe` — not always on PATH, use full path if `node` is not found
- Functions emulator runs on port **5002** (not 5001 — that port is taken on this machine)
- To seed an admin user into the emulators: `"C:\Program Files\nodejs\node.exe" scripts\seed-admin.js` (from project root, emulators must be running)
- To seed employees from `scripts/seeds/employees.csv`: `"C:\Program Files\nodejs\node.exe" scripts\seed-employees.js` (from project root, emulators must be running; all seed CSVs live under `scripts/seeds/`, UTF-8 with BOM, semicolon-delimited)
- **Date arithmetic in the browser**: never use `new Date("YYYY-MM-DD").toISOString()` for date math — in UTC+ timezones (Prague = UTC+2) the ISO string parsing treats the date as UTC midnight, so `toISOString()` returns the previous day. Always use `new Date(y, m-1, d)` (numeric args = local time) and format with `getFullYear/Month/Date`.

### Phase 6 — key implementation notes
- `vacationRequests` is a top-level Firestore collection (not a sub-collection)
- **pendingEdit pattern**: when an employee edits an *approved* vacation, the new dates are stored as `pendingEdit: { startDate, endDate, reason }` on the doc; original dates stay in the shift plan until admin approves. On approval, old X shifts are removed and new ones applied. On rejection, `pendingEdit` is cleared and the original approved dates remain.
- `PATCH /vacation/:id` detects mode by body shape: `{ startDate }` → employee edit; `{ status }` → admin approve/reject
- Shift cleanup helper: `removeVacationXsFromPlans(employeeId, startDate, endDate)` in `functions/src/routes/shifts.ts` — called on vacation deletion and on approved-edit transitions
- User↔employee link: `employeeId` field on `users/{uid}` doc. Set via `PATCH /auth/users/:uid/employee` (admin only). Shown + editable in Settings → Uživatelé tab ("Propojit" button per row). Also selectable at user creation time.
- Notifications on plan publish were **intentionally skipped** (user decision).

### Phase 5 — key implementation notes
- Shift parser (`parseShiftExpression`) is duplicated verbatim in `functions/src/services/shiftParser.ts` AND `frontend/src/lib/shiftConstants.ts` — they cannot share code across packages
- Shift cell composite doc ID: `${employeeId}_${date}` — used as both Firestore doc ID and shiftMap key on frontend
- `ShiftGrid.module.css` wrapper must use `overflow-x: auto` (NOT `overflow: hidden`) — required for sticky employee name column
- Plan status transitions are one-way: draft → open → published. Enforced server-side.
- One plan per (month, year) — enforced in `POST /shifts/plans` with a Firestore query
- Employee `status` field must be `"active"` or `"terminated"` (string) — the employees list page filters by `?status=active`
- X limits: HPP = 8/month, PPP = 13/month, DPP = unlimited. Day/night recepce coverage minimum = 5 active employees. Violations require override request with mandatory reason; approved by admin/director/manager via ShiftOverridePanel.
- **Consecutive X limit**: max 6 X in a row for employees and managers (hard block, no override). Checked via `consecutiveXRun()` in `ShiftPlannerPage.tsx` before the override check. Admins/directors are exempt.
- `ShiftOverridesContext` provides global pending override count for the "Směny" nav badge (admin/director only)

### Phase 4 — key implementation notes
- Contract templates stored as HTML in `contractTemplates/{type}` (doc ID = contract type string)
- PDFs generated client-side via `html2pdf.js` — Puppeteer was too large for Gen 1 functions
- Company data in `companies/{companyId}` (e.g. `companies/HPM`, `companies/STP`) — managed in Settings → Společnosti tab
- Settings page uses a **tab-based layout** — every new settings section must be a new tab, never appended below
- 9 contract types: 7 history-tied + 2 standalone (hmotná odpovědnost, multisport)
- TipTap extensions installed: StarterKit, Underline, TextStyle, FontFamily, TextAlign, Color, Image

### Phase 3 — additional work done on branch `feature/employee-page-phase3-additions`
- Added **Benefity** collapsible section to employee detail page (multisport, home office hodin/měsíc, náhrady)
- Added **Benefity sub-section** to employee add/edit form (checkboxes + number input); benefits fields now include `multisport`, `homeOffice` (numeric), `allowances`
- Added `passportAuthority` field to both form and detail page
- Removed `idCardExpiry` from UI (form + detail page) — field deprecated; stays `null` in Firestore
- Removed **Pracovní zařazení** section from add/edit form — job title, department, contract type, company are set exclusively via employment history modal
- Expanded EDUCATIONS dropdown to full Czech KKOV classification codes (A–V)
- Contact address row hidden on detail page when same as permanent address
- Subsection labels now have border-top separator for visual clarity
- Seed scripts switched from CP1250/iconv + xlsx to UTF-8 BOM-stripped `scripts/seeds/employees.csv`; column mapping corrected; `mapMaritalStatus()` added; `seed-admin.js` added to `seed-all.js` run order. All seed CSVs (`employees.csv`, `oddeleni.csv`, `pozice.csv`, `vzdelani.csv`) now live under `scripts/seeds/` (the whole `scripts/` dir is gitignored).

### Phase 3 — deferred items
- ✅ `jobPositions` lookup table — editable from Settings → Pracovní pozice, dropdown in employment history modal, auto-fills salary
- ✅ `departments` binding — editable from Settings → Oddělení, drives the Pracovní pozice dropdown filter in the employment modal
- "změna smlouvy" — default contract text per change kind (still pending)
- ✅ Czech date formatting across the app — `frontend/src/lib/dateFormat.ts` (`formatDateCZ`, `formatTimestampCZ`, `formatDatetimeCZ`)

### Post-phase 6 fixes (session 2026-04-14)
- **Admin/director X bypass**: `admin` and `director` skip X-limit and coverage checks entirely in `ShiftPlannerPage.tsx` — no override modal shown. Managers and employees still go through the override flow.
- **Parser validation**: bare `D` and `N` are now invalid — a hotel code is required (e.g. `DA`, `NS`). Only `R` and `X` are valid standalone. Fix applied to both `frontend/src/lib/shiftConstants.ts` and `functions/src/services/shiftParser.ts` (kept in sync manually).
- **Cell colour changes** in `frontend/src/lib/shiftConstants.ts`:
  - `DPQ`/`NPQ` (Amigo portýr): changed from dark purple to light brown (`bg #fdf6ee`, `text #431407`)
  - `DP`/`NP` (Perla) and `DM`/`NM` (Metropol): changed to mid-grey (`bg #d1d5db`, `text #1f2937`)
  - `getCellColor`: portýr shifts (`DP`/`NP`) with no hotel now fall to grey instead of the blue default
- **Shift counter table** (closed plan, admin only): 12 counter rows (DA, DS, DQ, DK, NA, NS, NQ, NK, DPQ, NPQ, DPA, NPA) appended inside `ShiftGrid`'s own `<tbody>` so they share the same column widths and scroll container. `DA²` counts as `DA` (segments are parsed). Colours: 0 → red, 1 → green, 2+ → blue.
- **Seed script rewrite**: `scripts/seed-shift-plan.js` now replays a captured snapshot (`scripts/_shift_plan_snapshot.json`) of the manually configured April 2026 plan (34 employees, 679 shifts, 30 MOD row entries) instead of generating shifts algorithmically.

### Post-phase 6 fixes — shift-change-requests branch
- **Shift change requests** (`shiftChangeRequests` sub-collection under `shiftPlans/{id}`): employees **double-click** any cell (including empty ones) on a published plan to open `ShiftChangeRequestModal` with mandatory reason; admins/directors review via `ShiftChangeRequestPanel` (reuses `ShiftOverridePanel.module.css`). Timestamps shown with seconds so concurrent requests are orderable.
- Approving a change request does **not** automatically update the shift — admin handles that manually.
- New context `ShiftChangeRequestsContext` mirrors `ShiftOverridesContext` exactly; fetches `GET /shifts/changeRequests/pending-count` (collectionGroup query).
- Smart periodic reload: fetches plan list every 60 s, compares `updatedAt` + `status` via `useRef`, full reload only when something changed.
- `ShiftCell`: `onRequestChange` fires on **double-click** (not single-click); works on empty cells too; cursor is `pointer` when `onRequestChange` is provided.
- `ShiftGrid`: `alwaysReadOnlySections` prop locks specified sections for all interactions (edit + request change). Employees get `["vedoucí"]` — managers' rows are always locked.
- Employee shift rules (opened plan only): employees can set/delete **X only** on any non-vedoucí cell. Enforced on both frontend and backend (PUT/DELETE now accept `employee` role with plan-status + X-only guards).
- **Moje žádosti** (employee/manager): combined read-only panel showing their own X exception requests + shift change requests. Both endpoints filter by `requestedBy == uid` for non-privileged users. Admin/director keep separate "Výjimky" and "Žádosti o změny" buttons.
- **Vacation X delete warning**: deleting an X that overlaps an approved vacation shows a danger confirm modal for all roles. `GET /vacation/check?employeeId&date` endpoint checks approved vacation overlap.
- New button "Žádosti o změny" in plan bar (admin/director only), with red badge from `changeRequestCount`.
- `ShiftChangeRequestsProvider` added to `App.tsx` provider stack.

### Post-phase 6 fixes — employee-fixes branch (2026-04-14)
- **Delete employee** (admin/director): `DELETE /employees/:id?deleteUser=true|false` deletes all sub-collections, alerts, vacation requests, and optionally the linked Firebase Auth user. Two-step confirmation in `EmployeeDetailPage`: first confirm deletion, then if a linked user exists, ask whether to delete or just unlink. `ConfirmModal` gained `cancelLabel` prop for the "Ponechat účet" option and `showCancel` prop (default `true`) to hide the cancel button entirely for info-only modals. Also `GET /employees/:id/linked-user` endpoint.
- **Search crash fix**: null-coalescing (`?? ""`) on `firstName`, `lastName`, `currentJobTitle` in `EmployeesPage` filter — was crashing if any field was null.
- **Document expiry proactive check**: new daily scheduled Cloud Function `refreshDocumentAlerts` re-scans every employee's stored documents and refreshes expiry alerts. HTTP trigger `POST /employees/trigger-alert-refresh` for manual/emulator use. `updateDocumentAlerts` and `EXPIRY_FIELDS` exported from `employees.ts`.
- **Alerts badge stale fix**: `AlertsContext` now exposes `refresh()`, `markRead(ids[])` (additive), `markAllRead()` (parameterless), and `readIds: Set<string>`. Storage key bumped to `v2` to clear old auto-marked state.
- **Alerts page redesign**: split into Nepřečtené / Přečtené sections. Alerts are never auto-marked on page visit — user must click "Přečteno" per row or "Označit vše jako přečtené". Nav badge counts only unread.

### Post-phase 6 fixes — czech-date + departments-positions branch
- **Czech date formatting**: central helper `frontend/src/lib/dateFormat.ts` with `formatDateCZ(iso)`, `formatTimestampCZ(ts)`, `formatDatetimeCZ(ts)`. All seven duplicate local formatters consolidated. `EmployeeDetailPage` raw ISO displays (dateOfBirth, passport/visa dates, employment history rows, expiry alert banner) now render as `DD.MM.YYYY`. `<input type="date">` fields intentionally left as ISO.
- **Gendered marital status display**: `frontend/src/lib/genderDisplay.ts` exports `displayGendered(value, gender)`. Database still stores combined forms (`svobodný/á`, `ženatý/vdaná`, etc.) but the detail page shows only the gender-correct variant. Split rule: if the `/` suffix is ≤2 chars, it replaces the last chars of the male form; otherwise it is used as a full word.
- **Departments + Job Positions** (Phase 3 deferred #1 & #2):
  - Two new Firestore collections. `departments/{id}`: `{ name, displayOrder }`. `jobPositions/{id}`: `{ name, departmentId, defaultSalary, displayOrder }`. Managed via `/departments` and `/jobPositions` backend routes (admin/director only).
  - Seed scripts `scripts/seed-departments.js` (reads `scripts/seeds/oddeleni.csv`) and `scripts/seed-job-positions.js` (reads `scripts/seeds/pozice.csv`, looks up department by lowercase name). Both added to `seed-all.js` after `seed-companies`.
  - All seed CSVs live under `scripts/seeds/` — the entire `scripts/` dir is gitignored.
  - Two new inline tabs in `SettingsPage.tsx`: **Oddělení** and **Pracovní pozice**. Deleting a department that still has positions returns a friendly error.
  - Employment history modal in `EmployeeDetailPage` replaced the free-text Pracovní pozice input with two linked dropdowns (Oddělení → Pracovní pozice filtered by chosen department). Selecting a position auto-fills `salary` from `defaultSalary` (still editable). The saved payload now sets `department` to the department name (previously hardcoded `""`).

### Post-phase 6 fixes — redact-position-salary + dark-mode branch
- **Salary redaction in Settings → Pracovní pozice**: `defaultSalary` column masked as `•••••` with eye-icon toggle. `SalaryCell` component + `.revealBtn`/`.salaryCell` styles added to `SettingsPage`. Matches the reveal pattern used in employment history.
- **Dark mode** (user preference, persisted between sessions):
  - `frontend/src/context/ThemeContext.tsx` — `ThemeProvider` + `useTheme()`. Saves to `localStorage` keyed by `hotel_hr_theme_{uid}` so each user has their own preference. Applies `data-theme="dark"` to `<html>`.
  - `ThemeProvider` wraps `<Routes>` in `App.tsx`. Sun/moon toggle button added to sidebar `userBar` in `Layout.tsx`.
  - `frontend/src/index.css` extended with full CSS variable set: surfaces, borders, text, status (active/danger/warning/info), inputs, shadows, plus shift-specific vars (`--color-weekend-bg`, `--color-holiday-bg`, `--color-mod-bg/border/text`). `[data-theme="dark"]` block overrides all of them.
  - All 16 CSS module files converted from hardcoded hex colors to CSS variables. Sidebar stays permanently dark (intentional design).
  - `ShiftCell.tsx` and `ModCell.tsx` call `useTheme()` and pass `dark` flag to `getCellColor()`. `CELL_COLORS_DARK` map in `shiftConstants.ts` provides inverted palettes (dark bg + vibrant light text) per hotel/type.
  - `getCellColor(parsed, dark?)` — second argument selects light vs dark palette.
  - Counter table rows in closed plan: `[data-theme="dark"]` overrides in `ShiftGrid.module.css` swap bg/text (pastel→saturated bg, saturated→light text).
  - Current-user yellow row forces `color: #1c1917` on name cell and total cell (visible on yellow in both themes).
- **Shift cell color tweaks**: DS/NS (Superior) changed from pale `#fef3c7` to saturated gold `#fde68a`/`#78350f`. DPQ/NPQ (Amigo portýr) changed from pale cream to dark brown `#431407`/`#fed7aa` (dark mode: `#1c0a00`).

### Phase 7 — key implementation notes (session 2026-04-15/16)

**Core files:**
- `functions/src/services/payrollCalculator.ts` — calculation engine. Exports `getCzechHolidays`, `getBaseHours`, `calculateEntry`, `createOrUpdatePayrollPeriod`. `FieldValue` imported from `firebase-admin/firestore` (NOT `admin.firestore.FieldValue` — that's undefined in modern firebase-admin and was a runtime crash bug).
- `functions/src/routes/payroll.ts` — API. Endpoints: `GET/PATCH /payroll/settings`, `GET /payroll/periods`, `GET /payroll/periods/:id`, `GET /payroll/periods/by-month/:year/:month`, `PATCH /payroll/periods/:id/entries/:employeeId` (accepts `sickLeaveHours` OR `overrides` or both), `POST /payroll/trigger` (manual recalc for emulator).
- `functions/src/index.ts` — scheduled `refreshPayroll` runs daily, iterates published plans and calls `createOrUpdatePayrollPeriod`.
- `functions/src/routes/shifts.ts` — on plan status transition to `"published"`, fires `createOrUpdatePayrollPeriod` async (fire-and-forget, errors logged).
- `frontend/src/pages/PayrollPage.tsx` + `.module.css` — single-month view, sectioned table (vedoucí/recepce/portýři from shift plan).
- `frontend/src/pages/SettingsPage.tsx` — new "Mzdy" tab (food voucher rate with confirmation modal) + `hourlyRate` field on job positions form (masked with eye icon in table).

**Calculation rules (from MZDY.xlsx):**
- Base hours = `(count of Mon–Fri days in month) × 8` — state holidays on workdays are **included** (they count toward base and are paid; holiday hours tracked separately in SVÁTEK).
- Max night hours = `FLOOR(baseHours/12) × 8` (e.g. 176h → 112h).
- Max holiday hours = `12 × (count of Czech public holidays in that month)`.
- Night hours per shift = `8` for each night segment (N, NP, ZN). Matches Excel `(nightShiftHours / 3) × 2` — i.e. 2/3 of a 12h shift.
- HODINY = sum of `hoursComputed` for all shifts with status `"assigned"`.
- VÝKAZ (reportHours) = `MIN(baseHours, totalHours)`.
- DOVOLENÁ (HPP) = `MAX(0, baseHours − reportHours)`.
- DOVOLENÁ (PPP) = `MAX(0, baseHours/2 − reportHours)` (no floor, matches Excel `FR$2/2`).
- DOVOLENÁ (DPP) = null.
- NAVÍC = `CEIL((hourlyRate × extraHours) / 100) × 100` — only if `employment.hourlyRate` is set on the active employment row. `extraHours = MAX(0, totalHours − baseHours)`.
- STRAVENKY = `workingDays × foodVoucherRate`. A working day = any shift with `hoursComputed > 6` (HO at 6h does NOT count; R at 8h does).
- DPP/FAKT (`dppAmount`) = `totalHours × hourlyRate` rounded to nearest integer (CZK). Displayed unmasked.

**Firestore schema:**
- `payrollPeriods/{id}` — `{ year, month, shiftPlanId, baseHours, maxNightHours, maxHolidayHours, foodVoucherRate, createdAt, updatedAt }`.
- `payrollPeriods/{id}/entries/{employeeId}` — full calculated entry (HODINY, VÝKAZ, DOVOLENÁ, NOČNÍ, SVÁTEK, SO+NE, NAVÍC, STRAVENKY, DPP/FAKT) + `sickLeaveHours` (manual) + `overrides: Record<OverrideField, number>` (manual per-field overrides). Recalculation preserves `sickLeaveHours` and `overrides` from the previous write.
- `settings/payroll` — `{ foodVoucherRate, updatedAt, updatedBy }`. Default 129.5 CZK/day.

**Override mechanism:** Each numeric cell in the payroll table is double-click editable for admin/director. When edited:
1. Override is stored in `entry.overrides[fieldName]`.
2. Recalculation replaces the computed field but keeps the overrides map intact.
3. Setting the override to the same value as the computed clears the override (reverts to auto).
4. Overridden cells highlighted in warning-yellow with a `*` suffix; tooltip shows the original computed value.

**Job position hourly rate:** `jobPositions.hourlyRate` is optional. Employment history modal copies both `defaultSalary` → `salary` and `hourlyRate` → `hourlyRate` when a position is selected. Stored on the employment sub-collection row and read by the payroll calculator.

**Seed side effects:** `scripts/seed-employees.js` (local only) now creates an active `"nástup"` employment row for an allow-list of positions (recepční, noční recepční, portýr, noční portýr, Front Office Manager, Senior Front Office Manager, Director Of Front Office, General Manager) — enough to exercise all three contract types and test payroll. All seed CSVs moved to `scripts/seeds/`; `DTB.csv` renamed to `employees.csv`; `pozice.csv` gained a 4th column `Hodinová mzda`.

**UX notes:**
- Row tints by contract type: HPP default, PPP light blue (`#eff6ff` / dark `#1a2a4a`), DPP light amber (`#fffbeb` / dark `#2a1f0a`). Contract badges tinted to match.
- NAVÍC has a global eye-icon reveal in its column header (unmasks all rows at once). DPP/FAKT is unmasked by default.
- Sick leave (NEMOC) entered via a small pencil (✎) inline inside the DOVOLENÁ cell — stored in `sickLeaveHours`, displayed below the vacation number as a NEMOC badge.
- Header meta row: Základ · Max. nočních hodin · Max. svátků · Stravenky (CZK/den).
- DPP employees: only HODINY and DPP/FAKT render; all premium columns show `—`.

**Known open questions:**
- Premium rates (night, holiday, weekend) — still unknown. The payroll shows HOURS only; accounting applies premium rates externally. If the app needs to compute CZK totals, the rates must be confirmed (spec §14).
- Payroll export to Excel/CSV deferred to Phase 8.

### Post-phase 6 fixes — session 2026-04-15 (this session)
- **ShiftOverridePanel employee name + date fix**: was displaying raw Firestore `employeeId` and ISO date string. Added `employees: PlanEmployee[]` prop (matching `ShiftChangeRequestPanel`) + `resolveEmployeeName()` + `formatDateCZ()`.
- **Dark mode — Směny page fixes**: weekend/holiday highlights use CSS vars (`--color-weekend-bg`, `--color-holiday-bg`); grid cell borders upgraded from `border-subtle` → `border`; MOD row uses CSS vars; counter table swaps bg/text in dark mode; current-user yellow row forces `color: #1c1917`; `CELL_COLORS_DARK` + `getCellColor(parsed, dark?)` makes shift cells theme-aware; DPA/NPA dark mode upgraded from navy `#1e3a5f` (same as R default) to vivid `#1d4ed8`/`#bfdbfe`.
- **HO shift type** (Home Office): 6 hours, standalone (no hotel suffix), valid for admin/director/manager only. Employee X-only backend guard already blocks it. Indigo color (`#e0e7ff`/`#3730a3` light, `#1e1b4b`/`#a5b4fc` dark). Added to both parsers + `getCellColor`.
- **ZD/ZN require hotel code** (e.g. `ZDA`, `ZNQ`) — bare `ZD`/`ZN` now invalid, same rule as `D`/`N`. Applied to both parsers.
- **ZD/ZN hour dotation changed** from 8 → 12 hours (both parsers).
- **Shift cell color tweaks (this session)**: DS/NS → saturated gold `#fde68a`; DPQ/NPQ → dark brown `#431407`; DPA/NPA dark mode → vivid blue `#1d4ed8`.
- **March 2026 shift plan added to seed**: `scripts/_capture_shift_plan.js` utility captures any plan from the emulator (run with year + month args); `seed-shift-plan.js` now auto-discovers all `_shift_plan_snapshot_YYYY_MM.json` files and seeds chronologically.
- **scripts/ added to .gitignore**: all seed scripts and plan snapshots contain sensitive data (employee IDs, credentials, local paths) — removed from git, kept locally.
- **Functions build requirement**: after any change to `functions/src/`, run `cd functions && npm run build` before restarting emulators. The emulator runs compiled JS from `functions/lib/` (gitignored), NOT TypeScript source directly.
- **Auth after emulator restart**: restarting the Firebase Auth emulator invalidates all existing sessions. Users must log out and log back in to get a fresh token — otherwise API writes fail with `auth/invalid-refresh-token`.

### Open items from spec (§14)
- ✅ Payroll: D/N shifts use **12h gross** — confirmed. Already implemented.
- ✅ Payroll: night + holiday premium rates — **not needed**, app computes hours only; accounting applies rates externally.
- ✅ Auth: password reset — **both flows implemented** (see below).
- ✅ Shift planner: portýři — **no availability rules** for portýři. Coverage check already scoped to `section === "recepce"` only.
- ✅ Contract templates: managed via TipTap editor in app (admin/director); no external .docx files needed.

### Auth — Password reset implementation
Two flows, both using Firebase Auth built-in email:

**Self-service (login page)**:
- "Zapomenuté heslo?" link on the login form opens a forgot-password view.
- User enters their email → `sendPasswordResetEmail(auth, email)` → Firebase sends reset link.
- Success message shown; "Zpět na přihlášení" returns to login form.

**Admin-initiated (Settings → Uživatelé)**:
- "Resetovat heslo" button per user row (blue, info style).
- Calls `sendPasswordResetEmail(auth, user.email)` from the frontend using the loaded user's email.
- Inline feedback: "Odkaz odeslán" (green) or "Chyba při odesílání" (red), clears after 4 s.
- No backend changes required — Firebase handles email delivery.

### Směny — current-user row highlight fix
- Weekend and holiday `<td>` backgrounds were overriding the `<tr>` yellow, making the highlight invisible on those columns.
- Fixed with higher-specificity CSS rules: `.currentEmpRow .weekend` and `.currentEmpRow .holiday` both forced to the same `#fef9c3` yellow as the row background — uniform across all day types.
- Border thickened and darkened: `3px solid #ca8a04` (was `2px solid #eab308`) for better visibility in light mode.
- Dark mode equivalents added.

### Payroll — cascade rules, manager credit, NAVÍC tiers (feature/payroll-cascades)

**autoOverrides field**: New field on every `payrollPeriods/{id}/entries/{employeeId}` document. Always freshly computed on recalc (not preserved like `overrides`). Frontend saves it via PATCH after user actions for immediate visual feedback. Shown with blue ↺ indicator vs amber * for user-manual overrides.

**Cascade rules (backend `calculateEntry` + frontend `computeCascades` — kept in sync):**
- Req 1: Manual Výkaz override → auto-recalculate Dovolená; if Hodiny > Výkaz → auto-generate NAVÍC
- Req 2: Nemoc → deduct from Dovolená; if excess → deduct from Výkaz → generate NAVÍC (2a)
- Req 3: NAVÍC > 0 + unworked holiday hours available → transfer hours from NAVÍC into SVÁTEK (both show ↺)
- Resolution order: user `overrides` > `autoOverrides` > computed

**Manager holiday credit (Req 4):** For `section === "vedoucí"`, `reportHours = totalHours + countMonFriHolidays × 8`. HODINY unchanged. April 2026 (2 Mon–Fri holidays): manager works 160h → VÝKAZ = 176; works 1 holiday (168h) → VÝKAZ = 184.

**NAVÍC tiered display (Req 5):** HPP/PPP display-only, stored `extraPay` unchanged:
- extraPay < 5000: `ceil(extraPay / 0.85 / 100) × 100`
- extraPay = 5000: 6 000
- extraPay > 5000: two stacked lines — 6 000 / (extraPay − 5000)

**Key implementation files:**
- Backend cascade: `calculateEntry()` in `functions/src/services/payrollCalculator.ts`
- Frontend cascade: `computeCascades()` in `frontend/src/pages/PayrollPage.tsx`
- Both mirror the same algorithm — comment "MIRROR: keep in sync" marks the sections

### Payroll — CEIL on totalHours and weekendHours
- `totalHours` (HODINY) and `weekendHours` (SO+NE) are both `Math.ceil()`'d immediately after accumulation, before any downstream calculation.
- This means vacationHours, reportHours, extraHours etc. all use the rounded-up value. e.g. 167.5h → 168h HODINY → 8h DOVOLENÁ (not 8.5).
- Applied in `calculateEntry()` in `functions/src/services/payrollCalculator.ts`.

### Payroll — decimal comma input
- Override cells and the sick-leave modal now accept both `.` and `,` as decimal separator (e.g. `9,5` = `9.5`).
- Inputs switched from `type="number"` to `type="text" inputMode="decimal"`; comma normalised to dot before `Number()` parsing in both `commit()` and `handleSave()`.
