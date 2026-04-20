# Hotel HR App — Implementation Reference

This file contains implementation details, feature notes, and post-merge fix history for the Hotel HR App. For Claude's working instructions see `CLAUDE.md`.

---

## Firestore Data Model

**Top-level collections:** `employees`, `users`, `companies`, `jobPositions`, `departments`, `alerts`, `notifications`, `shiftPlans`, `vacationRequests`, `payrollPeriods`, `auditLog`

**Sub-collections under `employees/{id}`:** `documents`, `contact`, `employment`, `benefits`, `contracts`

**Sub-collections under `shiftPlans/{id}`:** `planEmployees`, `shifts`, `rules`, `unavailabilityRequests`, `shiftOverrideRequests`, `shiftChangeRequests`, `shiftsSnapshot`

**Sub-collections under `payrollPeriods/{id}`:** `entries`

**Denormalized fields on `employees` root doc** (for querying): `currentCompanyId`, `currentDepartment`, `currentContractType`, `currentJobTitle`

---

## Build Phases

| Phase | Status | Description |
|---|---|---|
| 1 | ✅ | Foundation — scaffold, Firebase project, encryption service, employee CRUD + frontend shell |
| 2 | ✅ | Auth — user management UI, role assignment, create/deactivate/reactivate, role change |
| 3 | ✅ | Employee module — detail page, add/edit form, sub-collections, employment history, document expiry alerts |
| 4 | ✅ | Contract module — TipTap editor, html2pdf.js PDF export, Firebase Storage, companies API |
| 5 | ✅ | Shift planner — `parseShiftExpression()`, monthly grid, availability rules, X-limit overrides |
| 6 | ✅ | Vacation — request workflow, pendingEdit pattern, auto-X in shift plans, user↔employee linking |
| 7 | ✅ | Payroll — calculation engine (replicates MZDY.xlsx), editable overrides, sick leave, food voucher rate |
| 8 | 🚧 | Polish — dashboard (`Přehled` — today's staffing, MOD, absent managers) ✅, stats, audit log UI |

---

## Contract Types

9 contract types: `nastup_hpp`, `nastup_ppp`, `nastup_dpp`, `ukonceni_hpp_ppp`, `ukonceni_dpp`, `ukonceni_zkusebni`, `zmena_smlouvy`, `hmotna_odpovednost`, `multisport`.
- 7 are history-tied (triggered from employment history rows)
- 2 are standalone (`hmotna_odpovednost`, `multisport`)

Templates stored as HTML in `contractTemplates/{type}` (doc ID = contract type string).
PDFs generated client-side via `html2pdf.js` — Puppeteer was too large for Gen 1 functions.

### Template variables (`frontend/src/lib/contractVariables.ts`)
`firstName`, `lastName`, `fullName`, `birthDate`, `birthNumber`, `idCardNumber`, `passportNumber`, `visaNumber`, `currentJobTitle`, `currentDepartment`, `address`, `city`, `zip`, `contractType`, `salary`, `startDate`, `endDate`, `companyName`, `companyAddress`, `ic`, `dic`, `companyFileNo`, `signatoryName`, `signatoryTitle`, `today`, `contractNumber`

---

## Phase-level Implementation Notes

### Phase 6 — Vacation
- `vacationRequests` is a top-level collection (not a sub-collection).
- **pendingEdit pattern**: approved vacation edits store `pendingEdit: { startDate, endDate, reason }` on the doc; original dates stay until admin approves/rejects.
- `PATCH /vacation/:id` detects mode by body shape: `{ startDate }` → employee edit; `{ status }` → admin approve/reject.
- `removeVacationXsFromPlans(employeeId, startDate, endDate)` in `shifts.ts` — called on deletion and approved-edit transitions.
- User↔employee link: `employeeId` field on `users/{uid}`. Set via `PATCH /auth/users/:uid/employee`.
- Notifications on plan publish intentionally skipped.
- `GET /vacation/approved-upcoming` — all authenticated users, returns name + date fields for approved vacations whose `endDate >= today` (Prague TZ). Powers the `Schválené dovolené (všichni zaměstnanci)` section on `VacationPage`, shown to employees and managers only — admin/director already see every request in `Všechny žádosti`.

### Phase 5 — Shift Planner
- `parseShiftExpression` is duplicated verbatim in `functions/src/services/shiftParser.ts` AND `frontend/src/lib/shiftConstants.ts` — they cannot share code across packages. Keep in sync manually.
- Shift cell composite doc ID: `${employeeId}_${date}`.
- `ShiftGrid.module.css` wrapper must use `overflow-x: auto` (NOT `overflow: hidden`) — required for sticky employee name column.
- Plan status transitions: `created → opened → closed → published` (one-way, server-enforced). All three forward transitions run on the same 5-minute `checkPlanDeadlines` scheduler in `planTransitions.ts` — each checks a deadline field (`openedAt` / `closedAt` / `publishedAt`) against `Date.now()`.
- **CREATED visibility:** employees do not see plans in `created` state (filtered in `GET /shifts/plans` and 404 from `GET /shifts/plans/:planId`). The plan only appears once it auto-opens on `openedAt`. Admin/director/manager always see all statuses.
- One plan per (month, year) — enforced in `POST /shifts/plans` with a Firestore query.
- Employee `status` field: `"active"` or `"terminated"` (string).
- X limits: HPP = 8/month, PPP = 13/month, DPP = unlimited. Day/night recepce coverage minimum = 5 active employees.
- **Consecutive X limit**: max 6 X in a row for employees/managers (hard block, no override). Admins/directors exempt.
- **Real-time reload**: `ShiftPlannerPage` uses Firestore `onSnapshot` on the plan doc. Every mutation bumps `updatedAt`, triggering a full `loadPlan()` on all clients within ~1 s.
- `ShiftOverridesContext` provides global pending override count for the "Směny" nav badge.
- **Shift legend**: mandatory work-law legend (shift types D/N/R/ZD/ZN, hotel codes A/S/Q/K, break rule) displayed below the grid on `ShiftPlannerPage`.
- **PDF export** (admin/director): "Exportovat PDF" button builds a standalone HTML table from plan data with inline light-mode styles (6pt compact fonts, `table-layout:fixed`, colgroup percentages) and renders to single-page landscape A4 via `html2pdf.js`. Includes title, full grid with cell colors, MOD badges on vedoucí names, and legend. No DOM cloning — built programmatically from `plan.shifts`, `plan.employees`, `plan.modShifts`.

### Phase 4 — Contracts
- Company data in `companies/{companyId}` (e.g. `companies/HPM`, `companies/STP`).
- TipTap extensions: StarterKit, Underline, TextStyle, FontFamily, FontSize (custom), TextAlign, Color, Image, TabParagraph (custom), ListItemIndent (custom).

### Phase 3 — Employee Module
- `idCardExpiry` removed from UI — deprecated, stays `null` in Firestore.
- Pracovní zařazení (job title/department/contract/company) set exclusively via employment history modal — not on the add/edit form.
- `jobPositions` and `departments` Firestore collections managed from Settings.
- Employment history modal: linked dropdowns (Oddělení → Pracovní pozice), auto-fills `salary` and `hourlyRate` from position defaults.
- `jobPositions` docs carry optional `clothingAllowance` and `homeOfficeAllowance` (Kč/h, nullable). Seeded from `pozice.csv` columns "Náhrady - oblečení" and "Náhrady - HO"; editable in Settings → Pracovní pozice. Displayed as `N Kč/h` behind the same eye-toggle as salary + hourly rate.
- Czech date formatting: `frontend/src/lib/dateFormat.ts` — `formatDateCZ(iso)`, `formatTimestampCZ(ts)`, `formatDatetimeCZ(ts)`.
- Gendered marital status: `frontend/src/lib/genderDisplay.ts` — `displayGendered(value, gender)`.

---

## Phase 7 — Payroll Implementation Notes

**Core files:**
- `functions/src/services/payrollCalculator.ts` — `getCzechHolidays`, `getBaseHours`, `calculateEntry`, `createOrUpdatePayrollPeriod`. `FieldValue` from `firebase-admin/firestore` (NOT `admin.firestore.FieldValue` — undefined in modern firebase-admin).
- `functions/src/routes/payroll.ts` — `GET/PATCH /payroll/settings`, `GET /payroll/periods`, `GET /payroll/periods/by-month/:year/:month`, `PATCH /payroll/periods/:id` (lock/unlock, admin), `PATCH /payroll/periods/:id/entries/:employeeId`, `POST /payroll/periods/:id/recalculate`, `POST /payroll/trigger`.
- Scheduled `refreshPayroll` in `functions/src/index.ts` runs daily.

**Calculation rules (from MZDY.xlsx):**
- Base hours = `(Mon–Fri days in month) × 8`. Holidays on workdays count toward base.
- Max night hours = `FLOOR(baseHours/12) × 8`.
- Max holiday hours = `12 × (Czech public holidays in month)`.
- Night hours per shift = 8 for each N/NP/ZN segment.
- HODINY = sum of `hoursComputed` for `"assigned"` shifts. Both `totalHours` and `weekendHours` are `Math.ceil()`'d before downstream calculations.
- VÝKAZ = `MIN(baseHours, totalHours)`. Manager credit: `+countMonFriHolidays × 8` for `section === "vedoucí"`.
- DOVOLENÁ (HPP) = `MAX(0, baseHours − reportHours)`. PPP = `MAX(0, baseHours/2 − reportHours)`. DPP = null.
- NAVÍC = `CEIL((hourlyRate × extraHours) / 100) × 100`. Tiered display: <5000 → gross-up; =5000 → 6000; >5000 → two lines.
- STRAVENKY = `workingDays × foodVoucherRate`. Working day = shift with `hoursComputed > 6`.
- DPP/FAKT = `totalHours × hourlyRate` (unmasked).

**Firestore schema:**
- `payrollPeriods/{id}`: `{ year, month, shiftPlanId, baseHours, maxNightHours, maxHolidayHours, foodVoucherRate, locked, lockedAt?, lockedBy? }`.
- `payrollPeriods/{id}/entries/{employeeId}`: calculated entry + `sickLeaveHours` (manual) + `overrides` (manual per-field) + `autoOverrides` (cascade-computed).
- `settings/payroll`: `{ foodVoucherRate }`. Default 129.5 CZK/day.

**Food voucher rate — retroactive safety:** `createOrUpdatePayrollPeriod` reads `foodVoucherRate` from the existing period first; only falls back to `settings/payroll` when the period is being created for the first time. Changing the rate in Settings therefore only affects future periods, never already-generated ones.

**Locking:** Admins can lock a period via `PATCH /payroll/periods/:id` (`{ locked: true }`). Locked periods reject entry PATCHes (409), recalc requests (409), and skip the scheduled recalculation. Frontend hides the "Přepočítat" button and disables cell editing. Director can toggle lock on-screen labels but only admin role may actually flip it.

**Manual recalc:** `POST /payroll/periods/:id/recalculate` re-runs `createOrUpdatePayrollPeriod(shiftPlanId, year, month)`. Triggered from the "Přepočítat" button — lets admin/director reflect shift-plan edits without waiting for the scheduled run. Rejected with 409 on locked periods.

**PDF export:** `handleExportPdf` in `PayrollPage.tsx` builds an inline-styled HTML table via `html2pdf.js` and saves as `HPM_MZDY_YYMM.pdf`. A4 portrait, all employees on one page, Dovolená + Nemoc in one cell (NEMOC badge stacks beneath when > 0), NAVÍC unmasked and shown in its tiered form, contract badge next to the name, base/max metadata at the top. Effective-value precedence matches the on-screen table: `overrides` → `autoOverrides` → computed.

**Override mechanism:** Double-click any numeric cell (admin/director). `overrides` are preserved across recalcs; `autoOverrides` are always recomputed. Overridden cells: amber `*` (user) or blue `↺` (auto-cascade).

**Cascade rules** (`calculateEntry` backend + `computeCascades` frontend — keep in sync, marked "MIRROR"):
- Req 1: Manual Výkaz → auto-recalc Dovolená + NAVÍC if Hodiny > Výkaz.
- Req 2: Nemoc → deduct from Dovolená; excess → deduct from Výkaz → generate NAVÍC.
- Req 3: NAVÍC > 0 + unworked holiday hours → transfer into SVÁTEK.
- Req 4: Manager holiday credit (see above).
- Resolution order: `overrides` > `autoOverrides` > computed.

**Poznámky column (admin + director):** Notes live as an array on each
`payrollPeriods/{id}/entries/{employeeId}` doc. Each note tracks
`{ id, sourceNoteId, text, carryForward, createdBy, createdByName, createdAt, editedBy?, editedByName?, editedAt? }`. Endpoints on `functions/src/routes/payroll.ts`:
`POST/PATCH/DELETE /payroll/periods/:id/entries/:employeeId/notes[/:noteId]`.
Rejected (409) on locked periods. Adding a note with `carryForward: true`
also copies it into every existing future period for that employee (new
id, same `sourceNoteId`). Edits and deletes affect only the current
period — past and future copies stay put. When a brand-new period is
generated by `createOrUpdatePayrollPeriod`, carry-forward notes from the
most recent prior period are seeded automatically. The `PayrollNotesModal`
(frontend) reuses `ConfirmModal` for delete confirmation.

**Multisport column:** Shows `ANO` when the employee is enrolled for the
payroll's month, otherwise `—`. Computed in
`createOrUpdatePayrollPeriod` from `employees/{id}/benefits` using
`multisport === true && (multisportFrom ?? -∞) <= lastDay && (multisportTo ?? +∞) >= firstDay`.
Persisted on the entry as `multisportActive`. Included in the PDF export;
the Poznámky column is intentionally PDF-excluded.

**Multisport date range (employee form + detail):** `multisportFrom` and
`multisportTo` (plaintext, `YYYY-MM-DD`) live on the one benefits doc
alongside the existing `multisport` boolean. Both may be null (open-ended
start or end). `EmployeeFormPage` exposes them as `<input type="date">`
fields next to the existing checkbox; `EmployeeDetailPage` shows the
range as e.g. `Ano · 1.5.2026 – 31.8.2026`. Scheduled function
`sweepMultisport` in `functions/src/index.ts` runs daily, compares
Europe/Prague today vs. `multisportTo`, and unticks `multisport` for
expired rows (dates are preserved for history). Manual trigger for
emulator: `POST /benefits/trigger-multisport-sweep`.

---

## Shift Planner — Additional Notes

### MOD badge + shift counts
- `showModCounts` prop (admin/director): shows `MOD: N (X PD, Y V+S)` below vedoucí name. PD = Mon–Fri non-holiday; V+S = weekend or holiday (counted once).
- MOD letter per manager is per-plan: stored in `shiftPlans/{id}.modPersons` (letter → employeeId). Falls back to static `MOD_PERSONS` name match.
- Editable badge: click → inline text input (1 char, any A–Z not taken by another manager in the plan). `PATCH /shifts/plans/:planId/mod-persons` batch-renames all `modRow` entries for the old letter.
- `VALID_MOD_CODE = /^[A-Z]$/` in `shifts.ts`.
- Badge only shown for `vedoucí` section (not recepce/portýři).
- Name cell layout: `[nameLines: name + MOD count] [badge] [edit/delete actions on hover]`.

### Shift change requests
- `shiftChangeRequests` sub-collection under `shiftPlans/{id}`.
- Employees double-click any cell on a published plan to open `ShiftChangeRequestModal`.
- Approving does NOT automatically update the shift — admin handles that manually.
- `ShiftChangeRequestsContext` mirrors `ShiftOverridesContext`; fetches `GET /shifts/changeRequests/pending-count`.
- `alwaysReadOnlySections` prop on `ShiftGrid` locks specified sections. Employees get `["vedoucí"]`.
- Employees can set/delete **X only** (enforced frontend + backend).

### Shift types
- Bare `D` and `N` are invalid — hotel code required (e.g. `DA`, `NS`). `R` and `X` are valid standalone.
- `ZD`/`ZN` also require hotel code (e.g. `ZDA`). Hour dotation: 12h.
- `HO` (Home Office): 6h, standalone, admin/director/manager only.
- Cell IDs: `${employeeId}_${date}`.

---

## Auth — Login & Password Reset

**Login**: username + password. The login form accepts a bare username (e.g. `vondra`) and appends `@hotel.local` automatically. Typing a full email also works as a fallback.

Two password-reset flows using Firebase Auth built-in email:
- **Self-service**: "Zapomenuté heslo?" on login → `sendPasswordResetEmail(auth, email)`.
- **Admin-initiated**: "Resetovat heslo" button in Settings → Uživatelé → calls `sendPasswordResetEmail` from frontend with user's email. Inline feedback clears after 4 s.

---

## Contract Templates — Editor (TipTap)

### Custom extensions in `ContractTemplatesPage.tsx`
- **`FontSize`** (`addGlobalAttributes` on `textStyle`): dropdown 8–72 pt.
- **`TabParagraph`** (extends `Paragraph`): bakes `white-space:pre-wrap; tab-size:1.27cm` as inline style on every `<p>`. Tab key inserts `\t` → always lands on next 1.27 cm stop from left edge.
- **`ListItemIndent`** (priority 200, `addGlobalAttributes` on `bulletList`/`orderedList`): Tab/Shift-Tab inside a list adjusts `margin-left` on the parent `<ul>/<ol>` — moves bullets and text together. `handleKeyDown` returns `false` for list items to let this extension's `addKeyboardShortcuts` handle them.

### A4 page preview
The editor renders inside a `.a4Page` div (210 mm wide, padding 1.5 cm top/bottom, 1 cm left/right) centered on a gray "desk" background. A `repeating-linear-gradient` makes the bottom 1.5 cm of every 297 mm repeat match the desk color — creating the visual of separate pages with a gray gap between them, without JavaScript pagination. Limitation: text that falls in the bottom-margin zone renders on the gray band.

### Template variables — new additions
- `{{birthDate}}`: formatted date of birth (`formatDateCZ(employee.dateOfBirth)`).
- `{{passportNumber}}`, `{{visaNumber}}`: from `documents` sub-collection.
- `{{companyFileNo}}`: Spisová značka from `company.fileNo` (new field, editable in Settings → Společnosti).

---

## Dark Mode

- `ThemeContext.tsx`: `ThemeProvider` + `useTheme()`. Persists per-user in `localStorage` (`hotel_hr_theme_{uid}`). Guest (pre-login) preference stored under `hotel_hr_theme_guest`. Applies `data-theme="dark"` to `<html>`.
- **Default theme is dark** — both the login page and the initial load before any user preference is read start in dark mode.
- Login page has its own sun/moon theme toggle inside the card header (next to "Hotel HR" title).
- All CSS uses variables from `frontend/src/index.css`. `[data-theme="dark"]` overrides the full variable set.
- Sidebar stays permanently dark (intentional).
- `getCellColor(parsed, dark?)` in `shiftConstants.ts` — second arg selects light vs dark palette from `CELL_COLORS_DARK`.

---

## Companies

`companies/{companyId}` fields: `name`, `address`, `ic`, `dic`, `fileNo` (Spisová značka).

---

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
- **Tile row** — below the day cards, a grid of five equal-width tiles (`repeat(5, 1fr)`, stacks at narrow viewports):
  - **Moje směny** (leftmost, square) — 7-day list of the current user's shifts. Raw shift is hidden when the cell is empty or `X`; approved vacations render as `dovolená`, pending vacations as `dovolená (čeká na schválení)`. Vacation state comes from `/vacation` filtered to the signed-in employee.
  - **Neplatné doklady / Úpravy směn / Výměny směn / Dovolenky** — square count tiles visible only to admin/director. Counts come from `useAlertsContext`, `useShiftOverridesContext`, `useShiftChangeRequestsContext`, and a new `GET /vacation/pending-count` endpoint (sums `status == "pending"` and `status == "approved" && pendingEdit != null`). Zero-count tiles render in a muted style; each tile is a `<Link>` to the relevant page.
- **Labels** — the alerts inbox is labelled **Neplatné doklady** on both the sidebar and the dashboard tile. The route (`/upozorneni`) and the `AlertsPage` header are unchanged.
Managed in Settings → Společnosti tab. Only one card in edit mode at a time.
