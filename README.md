# HPM Intranet — Implementation Reference

This file contains implementation details, feature notes, and post-merge fix history for the HPM Intranet (formerly "Hotel HR App"). For Claude's working instructions see `CLAUDE.md`.

---

## Firestore Data Model

**Top-level collections:** `employees`, `users`, `companies`, `jobPositions`, `departments`, `educationLevels`, `alerts`, `notifications`, `shiftPlans`, `vacationRequests`, `payrollPeriods`, `auditLog`

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
- **Shift-collision check:** vacation requests/approvals can't silently overwrite pre-scheduled work.
  - `findShiftCollisions(employeeId, startDate, endDate)` in `shifts.ts` returns every shift cell whose `status === "assigned"` in the range (X / blank cells are not collisions).
  - `POST /vacation` and the employee-edit branch of `PATCH /vacation/:id` return `409 { error: "shift_collision", collisions }` if any assigned shift sits in the range — hard block, surfaced as a read-only `VacationCollisionInfoModal`.
  - `PATCH /vacation/:id` on admin approval accepts optional `excludeDates: string[]` in the body. If the field is **absent**, the endpoint re-checks collisions and 409s to force the UI to open the resolution dialog. If **present** (even empty), the user's picks are trusted — `excludedDates` is persisted on the request doc, and `applyVacationXs` skips those days when repainting X cells on every overlapping plan.
  - `GET /vacation/check-collisions` is the UI pre-check used by `handleApprove` in `VacationPage.tsx` before opening `VacationCollisionResolutionModal`. Employees are scoped to their own `employeeId`; admin/director can check anyone.
  - `api.ts` throws `ApiError { status, body, message }` so the page can extract the structured 409 payload instead of relying on the message string.
- **Optimistic insert on self-request:** `POST /vacation` returns `{ id, firstName, lastName }`. `handleSubmit` in `VacationPage.tsx` uses those values when prepending the new row — otherwise admin/director self-requests appeared nameless in `Všechny žádosti` until the next refetch.

### Phase 5 — Shift Planner
- `parseShiftExpression` is duplicated verbatim in `functions/src/services/shiftParser.ts` AND `frontend/src/lib/shiftConstants.ts` — they cannot share code across packages. Keep in sync manually.
- Shift cell composite doc ID: `${employeeId}_${date}`.
- `ShiftGrid.module.css` wrapper must use `overflow-x: auto` (NOT `overflow: hidden`) — required for sticky employee name column.
- Plan status transitions: `created → opened → closed → published` (one-way, server-enforced). All three forward transitions run on the same 5-minute `checkPlanDeadlines` scheduler in `planTransitions.ts` — each checks a deadline field (`openedAt` / `closedAt` / `publishedAt`) against `Date.now()`.
- **Workflow gate (admin/director only):** creating a plan, transitioning its status (open/close/publish), setting auto-deadlines, and copying employees from a prior plan are all restricted to admin + director. Managers can view every status and fill shifts inside an opened plan, but cannot move it through the workflow. Enforced both in the backend (`requireRole` on `POST /plans`, `PATCH /plans/:id`, `PATCH /plans/:id/deadlines`, `POST /plans/:id/copy-employees`) and the frontend (`canPublish` gate on the corresponding buttons in `ShiftPlannerPage.tsx`).
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
- Settings → Pracovní pozice: editing `hourlyRate` cascades the new value to every active employment record where `currentJobTitle === position.name` AND `currentDepartment === position.department.name` (denormalized fields on `employees/{id}`). PATCH `/jobPositions/:id` returns `409 { requiresConfirmation, fieldChange, affectedEmployees, affectedUnlockedPayrolls }` when the change would touch employees; the UI shows a confirmation dialog flagging employees whose current rate already differs from the position default (`isManualOverride`), plus any unlocked `payrollPeriods` that contain those employees and would need a manual Recount. On confirm, re-PATCH with `confirmCascade: true`. Cascade only covers `hourlyRate` — `defaultSalary` is intentionally excluded (driven by signed contracts), and `clothingAllowance`/`homeOfficeAllowance` are not yet snapshotted onto employment records.
- Employee list always sorted by `lastName` then `firstName` (Czech locale) — new employees appear in correct position immediately.
- Settings → Oddělení: clickable "Název" header sorts asc/desc. Settings → Pracovní pozice: clickable "Název" and "Oddělení" headers with asc/desc toggle. Active column shows ▲/▼, inactive ⇅.
- **Education levels (`educationLevels`)**: admin-managed catalogue used by the EmployeeFormPage Vzdělání dropdown. Each doc carries `code` (e.g. `K`) + `name` (e.g. `úplné střední všeobecné vzdělání`) + `displayOrder`. Backend route `/api/educationLevels`: GET open to any authenticated user (form needs the list); POST/PATCH/DELETE admin-only. Settings → Vzdělání tab shows two sortable columns (Název, Kód) with inline edit + create modal + delete confirm. Seeded from `scripts/seeds/vzdelani.csv` (one `"<code> - <name>"` line per level) by `scripts/seed-education-levels.js`. EmployeeFormPage composes the option label as `${code} - ${name}` to match the legacy hardcoded format, so already-saved `employee.education` values keep selecting the right option; a saved value not in the catalogue is still rendered as an extra option to avoid silent loss on save.
- **CSV export** (admin + director): "Exportovat CSV" button on `EmployeesPage` opens `ExportEmployeesModal`. Users pick which of 36 seed-compatible columns to include, filter by status / company / contract type / nationality / job title, and name the output file (defaults to `zamestnanci_YYYY-MM-DD.csv`; `sanitizeFilename()` strips Windows-illegal characters and appends `.csv` on blur and at submit). Backend endpoint `GET /api/employees/export` merges each employee with their `contact`, `documents`, `benefits`, and latest `employment` sub-docs in parallel, redacting the five encrypted fields (`birthNumber`, `idCardNumber`, `insuranceNumber`, `bankAccount`, `idCardExpiry`) by default. Opting in via `?includeSensitive=true` decrypts them and writes ONE `auditLog/` entry per export (action `"export"`), not one per field per employee. CSV assembly lives client-side in `frontend/src/lib/csvExport.ts` — semicolon-delimited, CRLF, UTF-8 BOM, dates `"DD. MM. YYYY"`, booleans `"ANO"`/empty, salary with space thousands separator. Column order mirrors `scripts/seeds/employees.csv` so a full-column export is round-trip compatible with the seed loader. **Excel text-literal escape:** columns flagged `forceText` (`idCardNumber`, `passportNumber`, `visaNumber`, `birthNumber`, `insuranceNumber`, `bankAccount`, `phone`) emit as `="value"` so Excel preserves leading zeros on visa numbers, keeps `+420` phone prefixes, and doesn't interpret `/` in bank accounts as division. Future: the `accountant` role is in the plan for this allow list but not yet in `UserRole`; a TODO at `functions/src/routes/employees.ts` tags the handler.
- Shift plan export: "Exportovat ▾" button opens a PDF/CSV dropdown. CSV is semicolon-delimited UTF-8 BOM, one row per employee (name, rawInput per day, monthly shift count), section separator rows, MOD row after vedoucí. All employees included regardless of active flag. Filename: `smeny_{year}_{month}.csv`.
- Shift plan page: month nav and plan bar are individually sticky (`position: sticky`) within `.main`; ShiftGrid thead sticks within the wrapper (`overflow-y: auto`, bounded `max-height`). Layout `.shell` uses `height: 100vh` so `.main` is the real scroll container.
- Czech date formatting: `frontend/src/lib/dateFormat.ts` — `formatDateCZ(iso)`, `formatTimestampCZ(ts)`, `formatDatetimeCZ(ts)`.
- Gendered marital status: `frontend/src/lib/genderDisplay.ts` — `displayGendered(value, gender)`.

---

## Phase 7 — Payroll Implementation Notes

**Core files:**
- `functions/src/services/payrollCalculator.ts` — `getCzechHolidays`, `getBaseHours`, `calculateEntry`, `createOrUpdatePayrollPeriod`. `FieldValue` and `Timestamp` are imported from `firebase-admin/firestore` (NOT `admin.firestore.FieldValue` / `admin.firestore.Timestamp` — both are undefined in modern firebase-admin and throw `TypeError: Cannot read properties of undefined (reading 'now')` at runtime). The same trap bit `routes/payroll.ts` later for the notes endpoints — apply the same import pattern in any new payroll surface.
- `functions/src/routes/payroll.ts` — `GET/PATCH /payroll/settings`, `GET /payroll/periods`, `GET /payroll/periods/by-month/:year/:month`, `POST /payroll/periods/by-month/:year/:month` (manual create from already-published plan, admin/director), `PATCH /payroll/periods/:id` (lock/unlock, admin), `PATCH /payroll/periods/:id/entries/:employeeId`, `POST /payroll/periods/:id/recalculate`, `POST /payroll/trigger`.
- Scheduled `refreshPayroll` in `functions/src/index.ts` runs daily.

**Calculation rules (from MZDY.xlsx):**
- Base hours = `(Mon–Fri days in month) × 8`. Holidays on workdays count toward base.
- Max night hours = `FLOOR(baseHours/12) × 8`.
- Max holiday hours = `12 × (Czech public holidays in month)`.
- Night hours per shift = 8 for each N/NP/ZN segment.
- HODINY = sum of `hoursComputed` for `"assigned"` shifts. Both `totalHours` and `weekendHours` are `Math.ceil()`'d before downstream calculations.
- VÝKAZ = `MIN(baseHours, totalHours)`. Manager credit: `+countMonFriHolidays × 8` for `section === "vedoucí"`.
- DOVOLENÁ (HPP) = `MAX(0, baseHours − reportHours)`. PPP = `MAX(0, baseHours/2 − reportHours)`. DPP = null.
- NAVÍC (`extraPay`, raw net) = `hourlyRate × extraHours`. Stored unrounded — editing reveals the raw net value. Display rounding (gross-up + ceil to nearest 100) lives only in `formatNavic` / `navicText`. Tiered display: <5000 net → gross-up; =5000 → 6000; >5000 → two lines.
- STRAVENKY = `workingDays × foodVoucherRate`. Working day = shift with `hoursComputed > 6`.
- DPP/FAKT = `totalHours × hourlyRate` (unmasked).

**Firestore schema:**
- `payrollPeriods/{id}`: `{ year, month, shiftPlanId, baseHours, maxNightHours, maxHolidayHours, foodVoucherRate, locked, lockedAt?, lockedBy? }`.
- `payrollPeriods/{id}/entries/{employeeId}`: calculated entry + `sickLeaveHours` (manual) + `overrides` (manual per-field) + `autoOverrides` (cascade-computed).
- `settings/payroll`: `{ foodVoucherRate }`. Default 129.5 CZK/day.

**Food voucher rate — retroactive safety:** `createOrUpdatePayrollPeriod` reads `foodVoucherRate` from the existing period first; only falls back to `settings/payroll` when the period is being created for the first time. Changing the rate in Settings therefore only affects future periods, never already-generated ones.

**Locking:** Admins can lock a period via `PATCH /payroll/periods/:id` (`{ locked: true }`). Locked periods reject entry PATCHes (409), recalc requests (409), and skip the scheduled recalculation. Frontend hides the "Přepočítat" button and disables cell editing. Director can toggle lock on-screen labels but only admin role may actually flip it.

**Manual recalc:** `POST /payroll/periods/:id/recalculate` re-runs `createOrUpdatePayrollPeriod(shiftPlanId, year, month)`. Triggered from the "Přepočítat" button — lets admin/director reflect shift-plan edits without waiting for the scheduled run. Rejected with 409 on locked periods.

**Manual create:** `POST /payroll/periods/by-month/:year/:month` looks up the published shift plan for that month and runs `createOrUpdatePayrollPeriod` for it. Used by the "Vytvořit mzdy ručně" button on the empty state of `PayrollPage` — covers seeded plans where the publish trigger never fired. 404 when no published plan exists for the month, 409 when a period already exists (use recalc instead).

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

### Route & menu role gating

Role visibility is enforced in two layers in the frontend, both mirroring the backend role checks:

- **Menu (`frontend/src/components/Layout.tsx`)** — `navItems` render for everyone; `staffItems` (`Zaměstnanci`, `Mzdy`) and `adminItems` (`Neplatné doklady`, `Šablony smluv`, `Nastavení`) render only for `admin`/`director`.
- **Routes (`frontend/src/App.tsx`)** — `RequireRole allow={[…]}` wraps every privileged route and redirects unauthorized roles to `/`. Allow lists:
  - all roles: `/prehled`, `/smeny`, `/dovolena`
  - `admin` + `director`: `/zamestnanci/*`, `/mzdy`, `/smlouvy`, `/upozorneni`
  - `admin` only: `/nastaveni`

The route guard is the source of truth — the menu is just for discoverability. Backend endpoints are the final gate regardless.

---

## Contract Templates — Editor (TipTap)

### Custom extensions in `ContractTemplatesPage.tsx`
- **`FontSize`** (`addGlobalAttributes` on `textStyle`): dropdown 8–72 pt.
- **`TabParagraph`** (extends `Paragraph`): bakes `white-space:pre-wrap; tab-size:1.27cm` as inline style on every `<p>`. Tab key inserts `\t` → always lands on next 1.27 cm stop from left edge.
- **`ListItemIndent`** (priority 200, `addGlobalAttributes` on `bulletList`/`orderedList`): Tab/Shift-Tab inside a list adjusts `margin-left` on the parent `<ul>/<ol>` — moves bullets and text together. `handleKeyDown` returns `false` for list items to let this extension's `addKeyboardShortcuts` handle them.

### A4 page preview
The editor renders inside a `.a4Page` div (210 mm wide, padding 1.5 cm top/bottom, 1 cm left/right) centered on a gray "desk" background. A `repeating-linear-gradient` makes the bottom 1.5 cm of every 297 mm repeat match the desk color — creating the visual of separate pages with a gray gap between them, without JavaScript pagination. Limitation: text that falls in the bottom-margin zone renders on the gray band.

### Multipage canvas + measured page break (2026-04-27)
The editor canvas (`.a4Page`) now has `min-height: 297mm` so an empty template always shows one full A4 page. A `repeating-linear-gradient` paints a 12 mm grey "desk gap" every 309 mm (297 + 12) to suggest stacked pages. The ↧ page-break node is no longer just a dashed divider: a `useEffect` on the editor's `transaction` event walks every `[data-page-break]` element in DOM order, resets heights to 0, then sets each break's height so the next content starts at `(floor(Y / 309) + 1) * 309 + 15mm` — i.e. at the top of the next A4 page with a proper top margin. Saved HTML still serialises `height: 0` and `page-break-before: always`; the dynamic height is purely editor-side, so html2pdf's PDF output uses its own pagination.

### Word-like editor polish (2026-04-27)
Toolbar additions to make the editor feel closer to Microsoft Word:
- **Undo/redo buttons** at the leftmost toolbar slot.
- **Find & Replace** (`Ctrl+F`) with a custom `SearchHighlight` extension that decorates matches via a ProseMirror plugin; the panel runs `editor.chain().insertContentAt(...)` for replacements, collecting ranges in reverse so positions stay stable.
- **Tables** — `@tiptap/extension-table` family with contextual +R/+C/−R/−C/×T buttons that appear when the cursor is in a table. The base extension's column-resize NodeView wraps `<table>` in a `<div class="tableWrapper">`, so any class applied via `Decoration.node` lands on the wrapper, not the table — CSS uses a descendant selector (`.hpm-borderless td/th`) so it matches whichever element carries the class.
- **▦ borderless toggle**: `Table.extend({ addAttributes: { borderless } })` plus a ProseMirror plugin that adds `class="hpm-borderless"` via `Decoration.node`. `useContractGeneration` injects matching `<style>` rules into the html2pdf wrapper so PDF output respects the toggle (the editor's CSS module is scoped to `.a4Page` and isn't present on the detached PDF wrapper).
- **Line spacing** dropdown (1.0 / 1.15 / 1.5 / 2.0 / 3.0) — custom `LineHeight` extension adds a `lineHeight` attribute to `paragraph`/`heading`.
- **List-marker font size**: browsers render `::marker` using the `<li>`'s font-size, not the inline `<span style="font-size:…">` inside the `<p>`. Custom `ListItemStyle` extension registers a `style` attribute on `listItem`; the FontSize dropdown handler propagates the chosen size onto the parent `<li>` via `setNodeMarkup` so the marker matches.
- **Page break** node ↧ — `<div data-page-break style="page-break-before:always">…</div>` in saved HTML so html2pdf forces a new page.
- **Paste-from-Word cleanup** — ProseMirror plugin's `transformPastedHTML` strips `<o:p>` tags, `MsoNormal` classes, `mso-*` styles, `<font>` tags, and StartFragment/EndFragment markers before TipTap parses the clipboard.
- **Reactivity fix**: TipTap React v3's `useEditor` doesn't subscribe to selection changes by default, so `isActive(...)`-driven toolbar state was stale. A `useEffect` on the editor's `transaction` event forces a rerender via `useReducer`. Without this, contextual buttons (like the table-context controls) wouldn't appear when the cursor entered a table.

### First-load preview fix
The "load template into editor" effect depends on `templates[selected]?.id` (computed as `selectedTemplateId`), not on `selected` alone. Initial mount has `templates = {}` while `fetchTemplates()` is still in flight, so `selectedTemplateId` starts undefined; the effect renders an empty `<p></p>` and re-fires once the id materializes. Saving doesn't bounce the editor because the id stays the same after `fetchTemplates()` re-populates the map.

### Template variables — new additions
- `{{birthDate}}`: formatted date of birth (`formatDateCZ(employee.dateOfBirth)`).
- `{{passportNumber}}`, `{{visaNumber}}`: from `documents` sub-collection.
- `{{companyFileNo}}`: Spisová značka from `company.fileNo` (new field, editable in Settings → Společnosti).

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
  - **Neplatné doklady / Úpravy směn / Výměny směn / Dovolenky** — square count tiles visible only to admin/director. Counts come from `useAlertsContext`, `useShiftOverridesContext`, `useShiftChangeRequestsContext`, and `useVacationContext` (which fetches `GET /vacation/pending-count`, summing `status == "pending"` and `status == "approved" && pendingEdit != null`). Zero-count tiles render in a muted style; each tile is a `<Link>` to the relevant page. The same contexts also drive sidebar badges in `Layout.tsx` for `/smeny` (sum of overrides + change requests across all plans) and `/dovolena` (pending vacations) — keep mutations in `VacationPage.tsx` calling `refresh()` so the badge stays in sync after approve/reject/create/delete/edit.
  - **Per-plan badges in `ShiftPlannerPage`** — the `Výjimky` and `Žádosti o změny` buttons each show a count limited to the *currently selected month* (`planOverrideCount`, `planChangeRequestCount`, fetched alongside the plan). The sidebar `/smeny` badge is the global cross-month sum, so a request submitted in May still pages the admin from any month, but only the May plan view highlights the actionable button.
- **Labels** — the alerts inbox is labelled **Neplatné doklady** on both the sidebar and the dashboard tile. The route (`/upozorneni`) and the `AlertsPage` header are unchanged.
- **HR přehled (admin/director statistics, bottom of Přehled)** — `frontend/src/components/HeadcountStats.tsx` renders inside the existing `showTasks` guard on `OverviewPage.tsx`, after the task tiles so the page ends on the stats. Fetches `GET /stats/headcount` once on mount (see `functions/src/routes/stats.ts` — the dedicated stats router, mounted at `/stats` in `functions/src/index.ts`). One endpoint returns four reconciled slices of active-employee headcount: `byJobPosition`, `byNationality`, `byAge` (5 fixed buckets — `<20`, `20-30`, `30-40`, `40-50`, `50+`), and `byTenure` (8 fixed buckets — `<1m`, `1-3m`, `3-6m`, `6-12m`, `1-2y`, `2-5y`, `5-10y`, `10+y`). Null `currentJobTitle`, `nationality`, or `dateOfBirth` bucket to `"Nezadáno"` so all slices sum to `total`. Tenure reads each employee's `employment` subcollection (via a single `collectionGroup("employment")` query), treats each entry as a transition event (`status = "active"` starts a run, `status = "inactive"` ends one, contract-change events with `status = "active"` don't restart the clock), sums active→inactive intervals in days, and extends any still-open run to today in the Europe/Prague timezone — so termination gaps are correctly excluded from total tenure. Rendering uses `recharts` (`BarChart` with `layout="vertical"` for position / nationality / tenure; plain vertical for age). Axis / grid / bar colors are resolved from `--color-primary`, `--color-text-muted`, `--color-border` at mount and re-read on theme toggle. Horizontal tiles auto-grow in height at 40 px per bar (`interval={0}` keeps every category tick visible). Czech display labels live client-side; the endpoint emits terse ASCII bucket keys.
Managed in Settings → Společnosti tab. Only one card in edit mode at a time.

### planEmployee displayOrder auto-management (feature/shift-plan-auto-position)

`displayOrder` is kept contiguous (1..N) per section automatically — no manual bookkeeping needed.

**Add employee** — the dialog defaults to `count(section) + 1`. Changing the section resets the default to the next free slot in the new section. If the user types an existing position, the new employee inserts there and existing employees shift down.

**Edit position** — typing a new `displayOrder` moves the employee to that slot. Moving up (lower number): collisions shift down. Moving down (higher number): the vacated slot closes and the employee lands at the requested position. Section changes compact the leaving section and insert into the new one.

**Delete** — the section is compacted after removal so no gaps remain.

**Backend** — `renumberSection(planRef, section, target?)` in `shifts.ts` handles all three cases. Uses ±0.5 tiebreak offsets so the targeted doc always lands at exactly the requested position regardless of move direction. POST/PUT/DELETE all bump `shiftPlans/{id}.updatedAt` so connected clients reload.

**Frontend** — mutations call `loadPlan(true)` (silent reload — no `setPlan(null)` blank flash) immediately after the API responds, giving instant correct feedback. The `onSnapshot` listener also uses silent mode for background changes from other users.
