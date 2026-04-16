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
| 8 | 🔲 | Polish — stats dashboard, audit log UI, payroll export |

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

### Phase 5 — Shift Planner
- `parseShiftExpression` is duplicated verbatim in `functions/src/services/shiftParser.ts` AND `frontend/src/lib/shiftConstants.ts` — they cannot share code across packages. Keep in sync manually.
- Shift cell composite doc ID: `${employeeId}_${date}`.
- `ShiftGrid.module.css` wrapper must use `overflow-x: auto` (NOT `overflow: hidden`) — required for sticky employee name column.
- Plan status transitions: `created → opened → closed → published` (one-way, server-enforced).
- One plan per (month, year) — enforced in `POST /shifts/plans` with a Firestore query.
- Employee `status` field: `"active"` or `"terminated"` (string).
- X limits: HPP = 8/month, PPP = 13/month, DPP = unlimited. Day/night recepce coverage minimum = 5 active employees.
- **Consecutive X limit**: max 6 X in a row for employees/managers (hard block, no override). Admins/directors exempt.
- **Real-time reload**: `ShiftPlannerPage` uses Firestore `onSnapshot` on the plan doc. Every mutation bumps `updatedAt`, triggering a full `loadPlan()` on all clients within ~1 s.
- `ShiftOverridesContext` provides global pending override count for the "Směny" nav badge.

### Phase 4 — Contracts
- Company data in `companies/{companyId}` (e.g. `companies/HPM`, `companies/STP`).
- TipTap extensions: StarterKit, Underline, TextStyle, FontFamily, FontSize (custom), TextAlign, Color, Image, TabParagraph (custom), ListItemIndent (custom).

### Phase 3 — Employee Module
- `idCardExpiry` removed from UI — deprecated, stays `null` in Firestore.
- Pracovní zařazení (job title/department/contract/company) set exclusively via employment history modal — not on the add/edit form.
- `jobPositions` and `departments` Firestore collections managed from Settings.
- Employment history modal: linked dropdowns (Oddělení → Pracovní pozice), auto-fills `salary` and `hourlyRate` from position defaults.
- Czech date formatting: `frontend/src/lib/dateFormat.ts` — `formatDateCZ(iso)`, `formatTimestampCZ(ts)`, `formatDatetimeCZ(ts)`.
- Gendered marital status: `frontend/src/lib/genderDisplay.ts` — `displayGendered(value, gender)`.

---

## Phase 7 — Payroll Implementation Notes

**Core files:**
- `functions/src/services/payrollCalculator.ts` — `getCzechHolidays`, `getBaseHours`, `calculateEntry`, `createOrUpdatePayrollPeriod`. `FieldValue` from `firebase-admin/firestore` (NOT `admin.firestore.FieldValue` — undefined in modern firebase-admin).
- `functions/src/routes/payroll.ts` — `GET/PATCH /payroll/settings`, `GET /payroll/periods`, `GET /payroll/periods/by-month/:year/:month`, `PATCH /payroll/periods/:id/entries/:employeeId`, `POST /payroll/trigger`.
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
- `payrollPeriods/{id}`: `{ year, month, shiftPlanId, baseHours, maxNightHours, maxHolidayHours, foodVoucherRate }`.
- `payrollPeriods/{id}/entries/{employeeId}`: calculated entry + `sickLeaveHours` (manual) + `overrides` (manual per-field) + `autoOverrides` (cascade-computed).
- `settings/payroll`: `{ foodVoucherRate }`. Default 129.5 CZK/day.

**Override mechanism:** Double-click any numeric cell (admin/director). `overrides` are preserved across recalcs; `autoOverrides` are always recomputed. Overridden cells: amber `*` (user) or blue `↺` (auto-cascade).

**Cascade rules** (`calculateEntry` backend + `computeCascades` frontend — keep in sync, marked "MIRROR"):
- Req 1: Manual Výkaz → auto-recalc Dovolená + NAVÍC if Hodiny > Výkaz.
- Req 2: Nemoc → deduct from Dovolená; excess → deduct from Výkaz → generate NAVÍC.
- Req 3: NAVÍC > 0 + unworked holiday hours → transfer into SVÁTEK.
- Req 4: Manager holiday credit (see above).
- Resolution order: `overrides` > `autoOverrides` > computed.

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

## Auth — Password Reset

Two flows using Firebase Auth built-in email:
- **Self-service**: "Zapomenuté heslo?" on login → `sendPasswordResetEmail(auth, email)`.
- **Admin-initiated**: "Resetovat heslo" button in Settings → Uživatelé → calls `sendPasswordResetEmail` from frontend with user's email. Inline feedback clears after 4 s.

---

## Contract Templates — Editor (TipTap)

### Custom extensions in `ContractTemplatesPage.tsx`
- **`FontSize`** (`addGlobalAttributes` on `textStyle`): dropdown 8–72 pt.
- **`TabParagraph`** (extends `Paragraph`): bakes `white-space:pre-wrap; tab-size:1.27cm` as inline style on every `<p>`. Tab key inserts `\t` → always lands on next 1.27 cm stop from left edge.
- **`ListItemIndent`** (priority 200, `addGlobalAttributes` on `bulletList`/`orderedList`): Tab/Shift-Tab inside a list adjusts `margin-left` on the parent `<ul>/<ol>` — moves bullets and text together. `handleKeyDown` returns `false` for list items to let this extension's `addKeyboardShortcuts` handle them.

### Template variables — new additions
- `{{birthDate}}`: formatted date of birth (`formatDateCZ(employee.dateOfBirth)`).
- `{{passportNumber}}`, `{{visaNumber}}`: from `documents` sub-collection.
- `{{companyFileNo}}`: Spisová značka from `company.fileNo` (new field, editable in Settings → Společnosti).

---

## Dark Mode

- `ThemeContext.tsx`: `ThemeProvider` + `useTheme()`. Persists per-user in `localStorage` (`hotel_hr_theme_{uid}`). Applies `data-theme="dark"` to `<html>`.
- All CSS uses variables from `frontend/src/index.css`. `[data-theme="dark"]` overrides the full variable set.
- Sidebar stays permanently dark (intentional).
- `getCellColor(parsed, dark?)` in `shiftConstants.ts` — second arg selects light vs dark palette from `CELL_COLORS_DARK`.

---

## Companies

`companies/{companyId}` fields: `name`, `address`, `ic`, `dic`, `fileNo` (Spisová značka).
Managed in Settings → Společnosti tab. Only one card in edit mode at a time.
