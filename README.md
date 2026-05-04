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
| 7 | ✅ | Payroll — see local `payroll.md` for implementation notes |
| 8 | 🚧 | Polish — dashboard (`Přehled` — today's staffing, MOD, absent managers) ✅, stats, audit log UI ✅ |

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
- **`ListItemIndent`** (priority 200, `addGlobalAttributes` on `bulletList`/`orderedList`): Tab inside a list is position-sensitive — at the start of a row it adjusts `margin-left` on the parent `<ul>/<ol>` (bullet/number + text shift together), anywhere else it inserts a literal `\t` into the paragraph (`TabParagraph`'s `tab-size: 1.27cm` paints the gap, so the bullet and text to the left of the caret stay put). Shift-Tab always outdents the whole row. `handleKeyDown` returns `false` for list items to let this extension's `addKeyboardShortcuts` handle them.

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

### Image resize + alignment + wrapping toolbar (2026-04-28)
- **`ResizableImage`** = `Image.extend({...})` with two attributes that round-trip via inline style: `width` (e.g. `"50%"`) and `align` (`"left" | "center" | "right"`, rendered as `display: block; margin-left/right: …`). Percentage widths instead of drag-resize because html2pdf renders A4 PDFs from the editor HTML — pixel widths from drag handles render inconsistently across screen sizes vs paper, while presets keep the PDF predictable.
- **Contextual second toolbar row** (`.toolbarSecondary`, background `--color-surface-2`) renders only when an image or table is selected. Houses the image width presets (25/50/75/100% + ⤢ reset), image alignment (⬅ ↔ ➡), and the existing table row/col/border controls. Previously these all lived in the main toolbar, which pushed trailing buttons off-screen on narrow monitors.
- **Wrapping toolbars**: both `.toolbar` and `.toolbarSecondary` use `flex-wrap: wrap` + `justify-content: center` so buttons reflow onto a new centered line on narrow screens instead of overflowing.

### Conditional blocks in templates (2026-04-28)
`fillTemplate()` resolves Handlebars-style block markers before the standard `{{key}}` substitution: `{{#if X}}…{{/if}}` keeps its inner content iff `vars[X]` is a truthy non-empty string, `{{#unless X}}…{{/unless}}` is the inverse. After stripping a block, any leftover empty `<p></p>` wrappers are removed so a hidden line doesn't leave a blank paragraph in the PDF. Nesting is intentionally not supported (non-greedy match closes on the inner `{{/if}}`). `getMissingVariables()` runs the conditional pass first so a `{{var}}` that lives inside a stripped block isn't flagged as missing data.

Three derived variables drive the typical "Czech vs foreigner" branch:
- `nationality` — raw string from `employee.nationality`.
- `isCzech` — `"ano"` iff `nationality.trim() === "CZE"` (the planned ISO-3 dropdown value); empty otherwise.
- `isForeigner` — inverse of `isCzech`.

Empty / unknown nationality is treated as foreign because the foreign branch typically adds legally required fields (passport / visa).

### Row-sourced template variables + probation/end-date conditionals (2026-04-29)
Three plain variables sourced from the employment row are exposed in the template variable picker (under "Pracovní podmínky"):
- `{{workLocation}}` / `{{probationPeriod}}` — free-form strings stored on the row.
- `{{signingDate}}` — raw ISO; `resolveVariables` formats it with the shared `formatDateCZ` helper, so it lands in the rendered contract as "DD. MM. YYYY".

Four derived conditional flags drive `{{#if}}` blocks for the common branches:
- `hasProbation` / `noProbation` — `noProbation` is true when the probation string is empty, `"0"`, `"0 měsíců"`, or otherwise contains no non-zero digit (heuristic: `/[1-9]/.test(probationPeriod)`). Anything with a real number is `hasProbation`.
- `hasEndDate` / `noEndDate` — `noEndDate` is true when `endDate` is null/empty (open-ended employment); useful for hiding the fixed-term clause on indefinite contracts.

Both polarities of each flag are emitted so templates can pick the more readable phrasing per block.

### Template variable pruning + hasPermanentResidence conditional (2026-04-29)
Trimmed the contract-template variable surface to just the keys real templates use. The picker (`VARIABLE_GROUPS` in `frontend/src/lib/contractVariables.ts`) and `resolveVariables` no longer emit:
- `birthNumber`, `idCardNumber`, `currentDepartment` (employee)
- `nationality` (kept on `EmployeeData` as the input for `isCzech` / `isForeigner`, but not emitted as a template var)
- `city`, `zip` (address is now a single line; templates use `{{address}}`)
- `dic` (company)
- `signatoryName`, `signatoryTitle` — entire `SignatoryData` interface and the `signatory` argument to `resolveVariables` are gone
- `contractNumber`

These removals only affect the contract-template surface — the underlying Firestore fields, encryption, Employee form, Employee detail page, CSV export, and audit logging are untouched. References to any of the above in old templates will render as literal `{{key}}` text now (templates are being redone, so back-compat shims aren't worth keeping).

Added under "Zaměstnanec":
- `hasPermanentResidence` / `noPermanentResidence` — conditionals driven by `documents.visaType === "trvalý pobyt"` (case-insensitive, trimmed). `visaType` is plumbed through both `GenerateContractModal` call sites (Historie row + Smlouvy standalone) so the flag resolves correctly in either flow.

### Human-readable contract download filenames (2026-04-29)
Contract storage paths stay short and stable (`contracts/{employeeId}/{contractId}.pdf`) — only the *download* filename is human-readable. The frontend computes a Czech display name at generation time via `frontend/src/lib/contractNaming.ts`'s `buildContractName(type, row, fullName)`:

- `nastup_hpp` / `nastup_ppp` / `nastup_dpp` → `"HPP 2026 Klíma Richard"` (year from `row.startDate`).
- `ukonceni_hpp_ppp` / `ukonceni_zkusebni` → `"Ukončení HPP Klíma Richard"` (subtype from `row.contractType`).
- `ukonceni_dpp` → `"Ukončení DPP Klíma Richard"`.
- `zmena_smlouvy` → `"Dodatek navýšení 2026 Klíma Richard"` — label derived from `row.changes[0].changeKind` (`mzda` → `"navýšení"`, `pracovní pozice` → `"změna pozice"`, `úvazek` → `"změna úvazku"`, `délka smlouvy` → uses the value `"doba určitá"` / `"doba neurčitá"`). Multi-change rows use the first change to keep filenames short.
- `hmotna_odpovednost` / `multisport` → `"Hmotná odpovědnost Klíma Richard"` / `"Multisport Klíma Richard"`.

The name is persisted on the contract doc as `displayName` (passed via `POST /contracts` body alongside `rowSnapshot`). `GET /contracts/:id/download` reads it and emits both an ASCII-folded fallback (`filename="HPP 2026 Klima Richard.pdf"`) and a UTF-8 form (`filename*=UTF-8''HPP%202026%20Kl%C3%ADma%20Richard.pdf`) on the `Content-Disposition` header. Signed copies append `" - podepsaná"` so the unsigned and signed PDFs don't collide in the user's Downloads folder. Older contracts (no `displayName` field) fall back to the previous `{contractId}_{kind}.pdf` form.

`ContractsTab.handleDownload` now performs a real download via a hidden `<a download="…">` link instead of opening a blob URL in a new tab. Blob URLs have no filename, so saving from a preview tab landed a generic name; the new flow parses the `Content-Disposition` header on the client (preferring the UTF-8 form), sets it on the temporary anchor, and clicks it. Matches the Czech button label "Stáhnout" (= download).

### Uniform "DD. MM. YYYY" date format across the app (2026-04-29)
Every user-facing date in the app now renders as "DD. MM. YYYY" — Czech-style with spaces between segments. The three formatter helpers in `frontend/src/lib/dateFormat.ts` (`formatDateCZ`, `formatTimestampCZ`, `formatDatetimeCZ`) all emit the spaced form, and `formatDateCZ` now also accepts JS Date objects so contract output uses the same helper as the rest of the UI. The previous duplicate `formatContractDate` in `contractVariables.ts` was removed; contract dates and UI dates can no longer drift apart. The convention lives in one place — change it in `dateFormat.ts` and every screen plus every contract follows.

### Contract PDF upload routes through backend (2026-04-28)
`storage.rules` deny all direct client access, so the PDF upload now happens server-side. `POST /api/employees/:employeeId/contracts` accepts an optional `pdfBase64` field; when present, the handler reserves a Firestore doc id, decodes the base64 buffer, writes `contracts/{employeeId}/{docId}.pdf` via the Admin SDK (`admin.storage().bucket().file().save()`), then creates the metadata record with `unsignedStoragePath` set — single atomic operation. `express.json` limit was bumped to 10 MB to fit PDFs with embedded base64 logos.

`useContractGeneration.uploadContract()` no longer calls `uploadBytes`; it base64-encodes the Blob (chunked `Uint8Array` → `btoa` loop to avoid stack overflow on large PDFs) and POSTs it. The rollback-delete is gone because the backend either succeeds atomically or fails before writing.

The remaining three Smlouvy-tab paths (download, signed-PDF upload, delete) were also routing through the locked client SDK and are now backend-routed too — see "Contract download / signed upload / delete via backend" below.

### Contract download / signed upload / delete via backend (2026-04-28)
Three new endpoints close the last `storage.rules` violations on the Smlouvy tab:

- `GET  /api/employees/:employeeId/contracts/:contractId/download?kind=unsigned|signed` — looks up the contract doc, resolves the requested storage path, and streams the PDF via `file.createReadStream().pipe(res)` with `Content-Type: application/pdf` so the browser opens it inline.
- `POST /api/employees/:employeeId/contracts/:contractId/signed-pdf` — accepts `{ pdfBase64 }`, writes `contracts/{employeeId}/{contractId}_signed.pdf` via the Admin SDK, then atomically updates the doc with `status: "signed"`, `signedStoragePath`, `signedAt`, `signedUploadedBy`.
- `DELETE /api/employees/:employeeId/contracts/:contractId` — now also deletes both `unsignedStoragePath` and `signedStoragePath` from Storage (best-effort `Promise.all` with per-file `.catch(() => undefined)` so a stray missing file doesn't 500 the whole request).
- `DELETE /api/employees/:employeeId/contracts/:contractId/signed-pdf` (2026-04-29) — deletes only the signed PDF from Storage and reverts the record to `status: "unsigned"`, clearing `signedStoragePath`/`signedAt`/`signedUploadedBy` via `FieldValue.delete()`. Used by the "Smazat podepsanou" action on signed rows.

Frontend: `ContractsTab.handleDownload(contractId, kind)` fetches the streamed body, converts to a blob URL, and `window.open`s it (URL revoked after 60s so the new tab has time to claim it). `handleUploadSigned` shares the `blobToBase64` helper extracted to `frontend/src/lib/blobToBase64.ts`. `confirmDeleteUnsigned` is now a single `DELETE` — backend handles Storage cleanup. The dead `useContractGeneration.deleteStorageFile` was removed.

### Smlouvy tab — Obnovit + Smazat podepsanou actions (2026-04-29)
`ContractsTab` row actions now cover the full state graph:
- **Archived rows** show **Obnovit**, which PATCHes status back to `signed` (if `signedStoragePath` exists) or `unsigned` (otherwise). Previously archived rows had no actions, so the existing `DELETE` path was unreachable — un-archiving via Obnovit re-exposes the appropriate Smazat / Smazat podepsanou button.
- **Signed rows** show **Smazat podepsanou** (with confirm modal) which calls the new `DELETE /signed-pdf` endpoint to drop just the signed copy and revert to unsigned, leaving the original generated PDF and metadata intact. Useful when the wrong scan was uploaded.

### Server-side Puppeteer PDF rendering (2026-04-29)
Contract PDFs are now generated server-side by a real headless Chromium via Puppeteer rather than client-side html2pdf.js + html2canvas. The same engine that paints the editor preview paints the PDF, so the two match byte-for-byte — native `::marker` list bullets, font metrics, line-spacing, and CSS page-breaks all behave exactly as the browser shows them. html2pdf.js stays in place for the payroll and shift-plan PDF exports (different layout requirements; not affected).

- `functions/src/services/pdfRenderer.ts` — module-level browser singleton (one Chromium per Cloud Function instance, reused across requests so cold-start cost is paid only on the first render) + `renderPdf(html, margins)` Buffer. The disconnected event nulls the singleton so the next call relaunches.
- `POST /api/contracts/render-pdf` — admin/director only, accepts `{ html, margins? }`, returns `application/pdf` binary. The route inlines the same CSS rules `.editorContent` uses (font, paragraph margins, table styles, etc.) so the rendered document is styled identically to the editor.
- `functions/src/index.ts` — bumped the `api` v1 function to `runWith({ memory: "1GB", timeoutSeconds: 60 })` so Puppeteer's Chromium (≈500 MB resident, ~3–5s cold start) fits.
- `frontend/src/hooks/useContractGeneration.ts` — `generatePdf` moved into the hook (needs an auth token to call the endpoint). It POSTs `{ html, margins }` and returns the response Blob; the existing `uploadContract` then base64-encodes the blob and POSTs to `/contracts` as before.
- `frontend/src/components/GenerateContractModal.tsx` — destructures `generatePdf` from the hook instead of importing the standalone function.
- `frontend/src/lib/contractVariables.ts`:
  - Conditional-block stripping uses an `HPM_STRIPPED` sentinel: `{{#if X}}…{{/if}}` blocks whose condition is false collapse to the marker; a follow-up regex drops only the wrapping `<p>` if the marker was the entire paragraph contents (or strips the bare marker if it sat between paragraphs). Intentional empty `<p></p>` elsewhere in the document is no longer collateral damage.
  - Empty `<p></p>` paragraphs are normalised to `<p><br></p>` so they render as visible blank lines — Chromium collapses bare empty `<p>` to zero height when re-rendered outside the editor's `contenteditable` surface, but `<br>` forces one line of height. Trailing empty paragraphs at the very end of the document are stripped first so they don't push content onto a blank second page.
  - Empty `<p></p>` runs immediately preceding a `<table>` are stripped before the `<br>` normalisation. Single-row tables can never break (Chromium implicit `break-inside: avoid` on `<tr>`), so the row's full natural height has to fit on whatever's left of the page; the author's blank paragraphs above the table — added for visual breathing room in the editor — would otherwise stack with the table's own `margin: 0.5cm 0` and push the row past the page boundary even when the rest of the page looks empty. Caught by the Nástup HPP signature table moving to page 2 for a Czech employee whose conditional blocks shrunk the doc but still left a blank `<p>` between the date line and the table.

### Denser list spacing (2026-04-29)
Numbered and bullet lists in templates were inheriting body `line-height: 1.6`, and TipTap wraps each `<li>` in a `<p>` that picked up the global `p { margin: 0 0 0.5em }` between items, making lists look loose. Two CSS rules fix it: `li { line-height: 1.3 }` and `li > p { margin: 0 }`. Applied in both `frontend/src/pages/ContractTemplatesPage.module.css` (editor preview) and `functions/src/services/pdfRenderer.ts` `RENDER_CSS` (Puppeteer renderer) so the PDF still matches the editor byte-for-byte.

### Nested lists + custom bullet glyphs (2026-04-29)
TipTap's schema permits `<ul>` inside `<ol>` (and arbitrary further nesting), but the `ListItemIndent` extension takes Tab/Shift-Tab inside a list to apply CSS `margin-left` on the whole `<ul>/<ol>`, which shadows TipTap's default `sinkListItem` keybinding. Two new toolbar buttons next to ≡ / `1.` expose nesting explicitly:
- **→]** Vnořit položku seznamu — `sinkListItem("listItem")`, disabled when `editor.can().sinkListItem` returns false (cursor not in a list, or already at the deepest possible level for that position).
- **[←** Vynořit položku seznamu — `liftListItem("listItem")`, disabled when there's nothing to lift out of.

After sinking, click the bullet/ordered toolbar button to convert the freshly-nested list to the desired type (e.g. `<ul>` inside `<ol>`).

Bullet glyphs: top-level `<ul>` uses `list-style-type: "– "` (en-dash + space) regardless of whether it sits at document root or inside an `<ol>`; `<ul>` nested inside another `<ul>` switches to `circle`. Both rules live in the editor CSS and the Puppeteer `RENDER_CSS`. `<ol>` markers stay default (decimal).

### Generovat button hidden when matching contract exists (2026-04-29)
Contract docs now carry an optional `rowSnapshot` field — a freeze-frame of the row's identifying parameters at generation time. Snapshot fields: `companyId, contractType, jobTitle, department, startDate, endDate, salary, hourlyRate, agreedReward, workLocation, probationPeriod, agreedWorkScope, signingDate`. `POST /api/employees/:id/contracts` accepts and persists `rowSnapshot`; `useContractGeneration.uploadContract` forwards it; `GenerateContractModal` takes a `rowSnapshot` prop; `EmployeeDetailPage` builds the snapshot from the row at modal open.

`EmployeeDetailPage` fetches the contracts list alongside the employee + employment data and exposes `hasMatchingContract(row, type)` — true when any contract exists with `employmentRowId === row.id`, `type === t`, and a snapshot field-by-field equal to the row's current snapshot. The Historie tab filters `getContractTypesForRow(row)` through this check before deciding whether to render the Generovat button (single applicable type), the Generovat ▾ dropdown (multiple), or nothing (all types already covered).

`ContractsTab` notifies the parent via the new `onContractsChanged` prop after every mutation (create/delete/upload-signed/delete-signed/archive/unarchive). The parent's `refetchContracts` reloads the list so the button reappears as soon as a contract is deleted, and the post-generation `onGenerated` flow also calls `refetchContracts` before navigating to Smlouvy. Backwards-compat: existing contracts without `rowSnapshot` always fail the equality check, so the button stays visible until a fresh contract is generated.

Also: the `useEffect` in `ContractsTab` that fires `fetchContracts` now lists `user` in its deps. The previous `[employeeId]` only caused a stuck "Načítám smlouvy…" state when auth hadn't hydrated by mount — `fetchContracts` returns early when `user` is null and never set `loading=false` because the effect didn't re-run when `user` changed.

### DPP row defaults + auto-computed Sjednaná odměna (2026-04-30)
Two changes to how DPP rows behave on the employment-history modal:

1. **End date defaults to empty.** The previous form pre-filled "Konec smlouvy" with 31. 12. of the current year whenever DPP was selected. Open-ended DPP is the common case in this hotel's hiring pattern, so the auto-fill was misleading more often than helpful. The contract-type switch now clears `endDate` for every type — DPP behaves like the others, and a fixed-term DPP requires an explicit date.

2. **"Sjednaná odměna" auto-computes from a settings cap.** A new payroll setting `dppMaxMonthlyReward` (Mzdy → Nastavení tab, default **11 999 Kč/měsíc**) drives a `useEffect` that fills the field whenever `contractType === "DPP"`:
   - **No end date** → `max × 12`, ceil to the nearest 10 000 (= 150 000 Kč with default).
   - **With end date** → `max × ((endY−startY)·12 + (endM−startM) + 1)` months, ceil to the nearest 10 000.

   Typing in the input flips an `agreedRewardManual` flag and freezes the value; a small "↻ auto" link beside the label re-engages auto-compute. Editing an existing row that already has a saved reward starts in manual mode so historical values are never overwritten silently. Switching contract type clears the reward and resets the manual flag.

`GET/PATCH /payroll/settings` now reads/writes `dppMaxMonthlyReward` alongside `foodVoucherRate`; PATCH validates and accepts each field independently so editing one sub-section doesn't require sending the other. The Mzdy settings page (`SettingsPage.tsx`) renders the new value in its own sub-block under the existing meal-voucher controls — same "Upravit" → ConfirmModal pattern.

### DPP template variables — Rozsah práce + Odměna (2026-04-30)
Two new keys exposed under "Pracovní podmínky" in the contract-template variable picker:
- `{{agreedWorkScope}}` — "Rozsah práce DPP" (free-form string from the row, e.g. *"max. 300 hodin ročně"*).
- `{{agreedReward}}` — "Odměna DPP" (numeric Kč, stringified the same way as `{{salary}}`).

Both fields are populated from the employment row when `GenerateContractModal` is opened, so DPP templates can reference them directly instead of reusing the generic `{{salary}}` slot. The fields existed on the row schema before this commit; only the variable plumbing is new.

### Custom standalone contract templates (2026-04-30)
Admin / director users can now create their own contract templates via a **+ Nová šablona** button on the **Šablony smluv** page. The button opens a small modal with two fields — a snake_case ID slug and a Czech display name — and `POST /api/contractTemplates` creates the doc with `kind: "standalone"`, empty `htmlContent`, and default 15 mm margins. Custom templates are always standalone (history-tied templates stay locked to the 9 built-in IDs because their generation is keyed to specific changeType→contractType mappings).

The frontend `ContractType` was a closed union over the 9 built-in IDs; it's now a `string` alias so custom slugs flow through every type-tagged surface (state shapes, props, the `Record<>` indexes). `BUILTIN_CONTRACT_TYPES` retains the closed set for places that still need it. `CONTRACT_TYPE_LABELS` is now `Record<string, string>` and only carries the 9 built-in entries — custom-template labels resolve at runtime from the fetched list (`GET /api/contractTemplates`).

Surfaces that needed the runtime label resolution:
- `ContractTemplatesPage` sidebar concatenates `ALL_TYPES` (built-ins) with `customTypes` (filter `kind === "standalone"` from the fetched list); each entry renders with its proper label.
- `ContractsTab` Generovat ▾ dropdown does the same — built-in standalone types plus custom — and the standalone signing-date prompt resolves its title via `CONTRACT_TYPE_LABELS[id] ?? customStandalone.find(...).name ?? id`.
- The contracts table's type column uses the same fallback chain.
- `buildContractName` got a `default` branch + optional `fallbackLabel` parameter so custom templates emit `"<TemplateName> Klíma Richard"` filenames.

Backend: `POST /api/contractTemplates` validates the slug (`^[a-z][a-z0-9_]{1,39}$`), rejects collisions with the 9 built-in IDs, rejects existing IDs (409). The existing `PUT /:id` body type was widened from `ContractType` to plain `string` so saves to custom-id slugs go through. The listing endpoint now returns the new `kind` field (`"standalone"` for custom, `null` for built-ins).

### Multisport template variables + 3-field signing-date prompt (2026-04-30)
The standalone-contract signing-date prompt now collects **three** dates when the type is `multisport` (single date for `hmotna_odpovednost`): "Datum podpisu", "Datum žádosti", "Platnost od". All three are seeded to today on open and validated together — the Pokračovat button stays disabled until every required field has a value. Modal title dropped the "— datum podpisu" suffix since the prompt isn't single-purpose anymore.

The chosen values flow through `<GenerateContractModal>`'s `employeeData` and surface as three new picker entries under a new **Multisport** group in `VARIABLE_GROUPS`:
- `{{requestedAt}}` — "Datum žádosti", formatted via `formatDateCZ`.
- `{{validFrom}}` — "Platnost od", formatted via `formatDateCZ`.
- `{{validFromMonth}}` — "Měsíc začátku platnosti (např. leden 2026)". Computed from the raw ISO `validFrom` by `czechMonthYear()` (new helper) which indexes into a `CZECH_MONTHS` array and appends the year — e.g. `2026-01-15` → `"leden 2026"`. Empty string when the input isn't a valid `YYYY-MM-DD` prefix.

### PDF page 2+ top margin offset by page-1 logo (2026-04-30)
Contracts with a logo image at the top of page 1 used to look unbalanced on page 2: body text started flush at the template's `margins.top` distance from the page edge, far higher than the post-logo content on page 1. `pdfRenderer.ts` now measures where the first `<img>` ends in the rendered DOM (via `page.evaluate(() => img.getBoundingClientRect().bottom)` after `page.setContent`), converts to mm at 96 DPI, and injects `@page` CSS:

```css
@page { margin: <top + logoMm>mm <right>mm <bottom>mm <left>mm; }
@page :first { margin-top: <top>mm; }
```

`@page :first` reverts page 1 to the template's original top margin so the logo stays pinned where the template author placed it; the default `@page` rule pushes pages 2+ down so their body text starts at the same y-offset as page 1's post-logo content. When no `<img>` is present in the body, `logoMm` is 0 and no `@page` rules are injected — fully back-compatible. Existing `page.pdf({ margin })` call left intact as a fallback for the no-image path.

### Page-break divider hidden in PDF export (2026-04-30)
`PageBreak` previously baked `border-top: 2px dashed #999; margin: 1cm 0` into its `renderHTML` inline style so the editor could show the divider — but that style also reached the Puppeteer renderer and painted the dashed line on the actual PDF page. Split the visual concerns:
- `PageBreak.renderHTML` now emits only `page-break-before: always; height: 0;` — the structural part needed for paginated print, nothing visual.
- A new editor-only rule `.a4Page [data-page-break]` in `ContractTemplatesPage.module.css` paints the dashed divider, scoped so it never reaches the Puppeteer `RENDER_CSS`.
- Defensive override in `pdfRenderer.ts` `RENDER_CSS` strips `border` / `margin` / `padding` / `height` from `[data-page-break]` with `!important`, so older templates whose saved HTML still carries the inline border render cleanly without needing to be re-saved.

### Standalone contract — signing date prompt (2026-04-30)
Standalone contracts (`hmotna_odpovednost`, `multisport`) are not tied to a history row, so they had no `signingDate` — `{{signingDate}}` resolved to an empty string in their templates. Picking either type from the **Generovat ▾** dropdown on the Smlouvy tab now opens a small "Datum podpisu" prompt (one `<input type="date">`, defaults to today, dismissed only via Zrušit / Pokračovat per the no-backdrop-dismiss convention). Confirming carries the chosen date through `<GenerateContractModal>` as `employeeData.signingDate`, which `resolveVariables` formats via `formatDateCZ` like every other date variable. The prompt reuses `ConfirmModal.module.css` (overlay/modal/header/title/body/footer) so it matches the rest of the app's modal styling without duplicating CSS.

### Dodatek template variables (2026-04-30)
New "Dodatky" group in the contract-template variable picker covers the four change kinds a `změna smlouvy` row can carry plus a salary-direction verb:

- `{{dodatekEffectiveDate}}` — "Platnost dodatku", date the dodatek takes effect (= `row.startDate`, formatted via `formatDateCZ`).
- `{{newSalary}}` / `{{isDodatekMzda}}` — value + conditional flag for `changeKind === "mzda"`.
- `{{newJobTitle}}` / `{{isDodatekPozice}}` — for `"pracovní pozice"`.
- `{{newWorkScope}}` / `{{isDodatekUvazek}}` — for `"úvazek"`.
- `{{newEndDate}}` / `{{isDodatekZmenaKonce}}` — for `"délka smlouvy"` (formatted as date).
- `{{salaryChangeVerb}}` — emits `"zvyšuje"` if the new salary is greater than the salary in force immediately before the dodatek, `"mění"` otherwise. Empty string if either side is missing or non-numeric. The "old salary" is computed by `findOldSalary(row, employment)` in `EmployeeDetailPage.tsx`: walks history in chronological order, each `nástup`'s `salary` sets the baseline and each `změna smlouvy` with a `"mzda"` change overrides it; returns the latest value applied before this row.

`EmployeeData` carries two raw fields — `dodatekEffectiveDate` (ISO) and `dodatekChanges: { changeKind, value }[]` — plus `oldSalary`. `resolveVariables` derives every dodatek-related output from these inputs, so the template surface is single-source-of-truth from the row's `changes` array. Conditional flags use `changes.some(c => c.changeKind === kind)` rather than checking value emptiness, so a present-but-blank entry still triggers the section.

### Ctrl+Shift+Space inserts non-breaking space (2026-04-30)
Small `NbspKeybind` extension binds `Mod-Shift-Space` (Ctrl on Win/Linux, Cmd on macOS — matches MS Word) to `view.dispatch(state.tr.insertText(' '))`. The character is indistinguishable from a regular space in the editor (matching Word's behaviour — no visual marker) but round-trips through saved HTML and the Puppeteer-rendered PDF as a real U+00A0, so wrapping never splits Czech one-letter prepositions ("v Praze") or `number + unit` pairs ("150 000 Kč").

### `{{originalSigningDate}}` template variable (2026-04-30)
New variable exposed under "Pracovní podmínky" labelled "Datum podpisu původní smlouvy". Distinct from `{{signingDate}}` (signing date of the document being generated) — `{{originalSigningDate}}` is the signing date of the most recent prior `nástup` row that the current row sits on top of. Used in dodatek and ukončení templates that reference "smlouva ze dne …".

`findOriginalSigningDate(row, employment)` in `EmployeeDetailPage.tsx` filters history to `nástup` rows with `startDate <= row.startDate` (excluding the row itself), sorts descending by `startDate`, and returns the first match's `signingDate`. Re-hire timelines resolve to the latest nástup (the contract currently in force). The value is plumbed via `EmployeeData.originalSigningDate` and formatted by `resolveVariables` through the shared `formatDateCZ` helper.

### Conditional variable picker inserts full {{#if}} block (2026-04-30)
The variable picker entries flagged as conditionals (the eight keys whose label ends with "(pro {{#if}})") now insert the entire `{{#if KEY}}{{/if}}` block in one click and place the cursor between the opening and closing markers. `VARIABLE_GROUPS` entries carry an optional `kind?: "if"` (new `VariableDef` type), and `insertVariable(key, kind)` in `ContractTemplatesPage.tsx` branches on it — for `if` it composes left/right, runs `insertContent(left + right)`, then `setTextSelection(from + left.length)` to land the caret at the insertion point. Plain variables still insert the bare `{{key}}` as before. Tooltip on the button shows whichever snippet would be inserted.

### List-item Tab is position-sensitive (2026-04-30)
`ListItemIndent.addKeyboardShortcuts.Tab` now branches on caret position. With an empty selection at the start of a row (`parentOffset === 0` and the paragraph is the first child of the `listItem`), Tab keeps the existing behavior — bumping `margin-left` on the parent `<ul>/<ol>` so bullet/number and text shift together. Anywhere else inside a list item, Tab dispatches `state.tr.insertText('\t')`; `TabParagraph`'s inline `tab-size: 1.27cm` (which applies to every `<p>`, including those inside `<li>`) paints the gap, so the bullet and any text to the left of the caret stay put. Shift-Tab is unchanged — always outdents the whole row. Wrap behavior is intentionally not handled: a caret tab on a wrapped second line still indents from the wrap origin, which would be visible only in extreme cases.

### Contract company resolved from row, not parent state (2026-04-28)
`GenerateContractModal` now takes a `companyId` prop and fetches `/api/companies/:id` itself, replacing the previous `companyData={company ?? {}}` parent-state pattern. The row-tied modal (history-row trigger) passes `companyId={row.companyId}` — the legally correct company for that specific contract, not whichever company the employee currently has assigned. The standalone modal (multisport / hmotná odpovědnost) passes `companyId={employeeData.currentCompanyId}`. Eliminates two failure modes: `currentCompanyId` being null (company never fetched, all `{{companyName}}/{{ic}}/...` were empty) and an old row pointing at a different company than current.

### Per-template page margins (2026-04-28)
Each `contractTemplates/{id}` doc now carries an optional `margins: { top, bottom, left, right }` field (mm, 0–100). Three places consume the same value so editor preview and generated PDF stay in sync:
1. `.a4Page` padding is applied via inline `style` (the static `1.5cm 1cm` was removed from CSS).
2. `generatePdf(filledHtml, margins)` passes them to html2pdf as `[top, left, bottom, right]` (html2pdf's expected order).
3. The page-break offset effect uses `margins.top` for `TOP_MARGIN_MM`, so the next-page-top after a ↧ break tracks the template's top margin. The effect now depends on `margins`, so changing them re-runs the measurement.

UI: a new ⊟ toggle in the main toolbar opens a `.marginsBar` slide-down (same pattern as the find bar) with four Word-style presets (Standardní 25 mm / Úzké 13 mm / Střední 25/19 mm / Široké 25/51 mm) plus four numeric inputs (Nahoře / Dole / Vlevo / Vpravo). The active preset is highlighted; numeric edits switch to "Vlastní" implicitly because no preset matches.

Defaults: `{15, 15, 15, 15}` (matches the previous hard-coded PDF margins) is applied when a doc has no `margins` field, so legacy templates render unchanged.

Backend: `PUT /api/contractTemplates/:id` validates each margin side as a finite number 0–100 mm and merges into the doc. `GET` returns the doc as-is so no read-side change was needed.

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

---

## Audit log

**Goal:** every business-data write is recorded so an admin can answer "who changed what, when" — most often "show me every change ever made to employee X."

**Storage** — the existing `auditLog/` collection. Pre-existing actions (`reveal`, `export`) keep their original shapes and are preserved. New per-mutation entries are written by `functions/src/services/auditLog.ts`:

```
{
  userId, userEmail, userRole,
  action: "create" | "update" | "delete" | "reveal" | "export",
  collection,                 // e.g. "employees", "shiftPlans/shifts", "settings"
  resourceId, subResourceId?,
  fieldPath?, oldValue?, newValue?, redacted?,   // for update entries (one entry per changed field)
  summary?,                                      // for create / delete entries
  employeeId?,                                   // denormalized for "all changes for X" filtering
  timestamp                                      // serverTimestamp
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
