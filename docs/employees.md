# Employees

Developer documentation for the employee module: the core employee record and form, the session-based employment-history detail page, and the Můj profil self-service / edit-by-approval workflow.

## Phase 3 — Employee Module
- `idCardExpiry` removed from UI — deprecated, stays `null` in Firestore.
- Pracovní zařazení (job title/department/contract/company) set exclusively via employment history modal — not on the add/edit form.
- `jobPositions` and `departments` Firestore collections managed from Settings.
- Employment history modal: linked dropdowns (Oddělení → Pracovní pozice), auto-fills `salary` and `hourlyRate` from position defaults.
- `jobPositions` docs carry optional `clothingAllowance` and `homeOfficeAllowance` (Kč/h, nullable). Seeded from `pozice.csv` columns "Náhrady - oblečení" and "Náhrady - HO"; editable in Settings → Pracovní pozice. Displayed as `N Kč/h` behind the same eye-toggle as salary + hourly rate.
- Settings → Pracovní pozice: editing `hourlyRate` cascades the new value to every active employment record where `currentJobTitle === position.name` AND `currentDepartment === position.department.name` (denormalized fields on `employees/{id}`). PATCH `/jobPositions/:id` returns `409 { requiresConfirmation, fieldChange, affectedEmployees, affectedUnlockedPayrolls }` when the change would touch employees; the UI shows a confirmation dialog flagging employees whose current rate already differs from the position default (`isManualOverride`), plus any unlocked `payrollPeriods` that contain those employees and would need a manual Recount. On confirm, re-PATCH with `confirmCascade: true`. Cascade only covers `hourlyRate` — `defaultSalary` is intentionally excluded (driven by signed contracts), and `clothingAllowance`/`homeOfficeAllowance` are not yet snapshotted onto employment records.
- Employee list always sorted by `lastName` then `firstName` (Czech locale) — new employees appear in correct position immediately.
- Settings → Oddělení: clickable "Název" header sorts asc/desc. Settings → Pracovní pozice: clickable "Název" and "Oddělení" headers with asc/desc toggle. Active column shows ▲/▼, inactive ⇅.
- **Education levels (`educationLevels`)**: admin-managed catalogue used by the EmployeeFormPage Vzdělání dropdown. Each doc carries `code` (e.g. `K`) + `name` (e.g. `úplné střední všeobecné vzdělání`) + `displayOrder`. Backend route `/api/educationLevels`: GET open to any authenticated user (form needs the list); POST/PATCH/DELETE admin-only. Settings → Vzdělání tab shows two sortable columns (Název, Kód) with inline edit + create modal + delete confirm. Seeded from `scripts/seeds/vzdelani.csv` (one `"<code> - <name>"` line per level) by `scripts/seed-education-levels.js`. EmployeeFormPage composes the option label as `${code} - ${name}` to match the legacy hardcoded format, so already-saved `employee.education` values keep selecting the right option; a saved value not in the catalogue is still rendered as an extra option to avoid silent loss on save.
- **CSV export** (admin + director): "Exportovat CSV" button on `EmployeesPage` opens `ExportEmployeesModal`. Users pick which of 36 seed-compatible columns to include, filter by status / company / contract type / nationality / job title, and name the output file (defaults to `zamestnanci_YYYY-MM-DD.csv`; `sanitizeFilename()` strips Windows-illegal characters and appends `.csv` on blur and at submit). Backend endpoint `GET /api/employees/export` merges each employee with their `contact`, `documents`, `benefits`, and latest `employment` sub-docs in parallel, redacting the five encrypted fields (`birthNumber`, `idCardNumber`, `insuranceNumber`, `bankAccount`, `idCardExpiry`) by default. Opting in via `?includeSensitive=true` decrypts them and writes ONE `auditLog/` entry per export (action `"export"`), not one per field per employee. **The sensitive opt-in is permission-gated server-side:** `?includeSensitive=true` requires `employees.export.sensitive` (separate from the `employees.export` gate on the route); the handler returns 403 without it. The frontend already hides the toggle for callers lacking the permission, but the backend is the real gate — a direct API call (or a custom type granted plain `employees.export` only) can't dump plaintext PII. CSV assembly lives client-side in `frontend/src/lib/csvExport.ts` — semicolon-delimited, CRLF, UTF-8 BOM, dates `"DD. MM. YYYY"`, booleans `"ANO"`/empty, salary with space thousands separator. Column order mirrors `scripts/seeds/employees.csv` so a full-column export is round-trip compatible with the seed loader. **Excel text-literal escape:** columns flagged `forceText` (`idCardNumber`, `passportNumber`, `visaNumber`, `birthNumber`, `insuranceNumber`, `bankAccount`, `phone`) emit as `="value"` so Excel preserves leading zeros on visa numbers, keeps `+420` phone prefixes, and doesn't interpret `/` in bank accounts as division. Future: the `accountant` role is in the plan for this allow list but not yet in `UserRole`; a TODO at `functions/src/routes/employees.ts` tags the handler.
- Shift plan export: "Exportovat ▾" button opens a PDF/CSV dropdown. CSV is semicolon-delimited UTF-8 BOM, one row per employee (name, rawInput per day, monthly shift count), section separator rows, MOD row after vedoucí. All employees included regardless of active flag. Filename: `smeny_{year}_{month}.csv`.
- Shift plan page: month nav and plan bar are individually sticky (`position: sticky`) within `.main`; ShiftGrid thead sticks within the wrapper (`overflow-y: auto`, bounded `max-height`). Layout `.shell` uses `height: 100vh` so `.main` is the real scroll container.
- Czech date formatting: `frontend/src/lib/dateFormat.ts` — `formatDateCZ(iso)`, `formatTimestampCZ(ts)`, `formatDatetimeCZ(ts)`.
- Gendered marital status: `frontend/src/lib/genderDisplay.ts` — `displayGendered(value, gender)`.

---

## Employee detail — session-based history (2026-05-06)

The Employee detail page collapses what used to be two tabs ("Historie pracovního poměru" + "Smlouvy") into a single **Historie pracovního poměru** tab where every employment relationship is a self-contained collapsible card. The Smlouvy tab is gone; `frontend/src/components/ContractsTab.tsx` was deleted.

### Layout
Each card represents one **session** — a Nástup row, the Dodatky that followed, and the Ukončení that closed it (if any). Sessions render newest-first; rows inside read oldest → newest so chronology is top-down. Only the latest session is expanded by default (`idx === 0`); the rest stay collapsed.

The card header shows the session's **effective state** computed by folding every Dodatek's `changes[]` onto the Nástup: `jobTitle`, `contractType`, `salary` (with eye-toggle reveal), `companyId`, `startDate`, `endDate`. Header buttons: `+ Dodatek`, `Ukončit smlouvu`. `+ Dodatek` hides once the session is `terminated` — defined as either an explicit Ukončení row OR an effective `endDate` in the past (a fixed-term contract that ran out without anyone filing the termination paperwork). `Ukončit smlouvu` hides **only** when a formal Ukončení row already exists (`!session.ukonceni`), so a fixed-term contract (e.g. DPP, which always carries an end date) can always be ended — early, or retroactively after its end date has passed. (Previously both buttons hid on `terminated`, which locked DPP/fixed-term cards out of the terminate action.) The related "no active employment" warning in `AddEntryModal` now treats a non-terminated session as active (`groupBySession(...).some(s => !s.terminated)`) instead of requiring `endDate === null`, so terminating a fixed-term contract no longer shows a spurious warning.

Each row inside the card carries: `Upravit` (hidden once a signed PDF is on file — editing then would silently desync from the legal document), the three-button contract action set, and `Smazat`. Page-level header buttons: `+ Nástup` (locked-changeType AddEntryModal) and `+ Adhoc dokument ▾` (dropdown with built-in standalone types + custom standalone templates).

A bottom collapsible **Adhoc smlouvy** lists every contract record where `employmentRowId == null` (Multisport, Hmotná odpovědnost, custom standalone). Default-open when at least one record exists.

### Components
- `frontend/src/components/EmploymentSession.tsx` — collapsible card; computes `idx === 0`-style default-expanded behaviour from a prop, uses `<SalaryReveal>` for the redacted salary display.
- `frontend/src/components/EmploymentRowItem.tsx` — single row's metadata + action cluster. Owns the per-row delete confirm modal with copy that varies by row type (Nástup → cascade warning with row count; Dodatek/Ukončení → tied-contract warning).
- `frontend/src/components/ContractActionButtons.tsx` — leaf renderer of the three states: no contract → `Generovat smlouvu` + `Nahrát podepsanou smlouvu`; contract with unsigned PDF → download + `Smazat smlouvu` + upload; contract with signed PDF → "Stáhnout podepsanou" + `Smazat smlouvu` + upload. The upload-without-generate path POSTs `/contracts` with no `pdfBase64` to materialise a record on the fly, then POSTs `/signed-pdf` against it — needed for legacy paper contracts that have no generated unsigned counterpart.
- `frontend/src/components/AdhocContractsSection.tsx` — bottom collapsible.
- `frontend/src/components/SalaryReveal.tsx` — shared `••••• [eye]` widget. Click stops propagation so it doesn't toggle the surrounding collapsible.

The existing `GenerateContractModal` is unchanged — only the call sites moved.

### Session derivation
`frontend/src/lib/employmentSessions.ts`:
- `groupBySession(rows)` — walks rows in `startDate` ascending order, opens a new session on each `nástup`, appends `změna smlouvy` and the (single) `ukončení`. Orphan rows (no preceding Nástup) are silently dropped — rare in practice, indicates dirty data.
- `computeEffectiveState(nastup, dodatky, ukonceni)` — folds Dodatek changes:
  - `mzda` → `salary` (or `agreedReward` for DPP)
  - `pracovní pozice` → `jobTitle`
  - `úvazek` → `contractType` via `uvazekToContractType()` ("poloviční"/"zkrácený"/"částečný" → PPP, "plný" → HPP, otherwise unchanged)
  - `délka smlouvy` → `endDate` — an **empty** value means "změna na dobu neurčitou" and clears a fixed end date (`endDate = null`); a non-empty value sets it. (The fold is mirrored server-side in `routes/employees.ts`, `services/payrollCalculator.ts` and `services/probationAlerts.ts` — all four honour the empty-clears-to-indefinite case.)
  - Ukončení's `startDate` overrides `endDate` (the actual end of the session)
- `mapContractsToRows(rows, contracts)` — `rowId → ContractRecord`, picking the most recent generation per row.
- `expectedContractTypesForRow(row)` — the template id(s) appropriate for a given row's `changeType` + `contractType`. Used both for matching existing contracts and as the default type for upload-without-generate.

### Backend changes
`functions/src/routes/employees.ts`:
- `recomputeRootFromLatestSession(empRef, now)` — walks an employee's rows the same way the frontend does, applies Dodatek `changes[]` (`pracovní pozice` → `currentJobTitle`, `úvazek` → `currentContractType`), and patches the root denormalized fields. A `pracovní pozice` change also moves `currentDepartment`: `buildPositionDeptMap()` resolves the new position name → its department name (position `departmentId` → `departments.name`), so a Dodatek that promotes someone into a position in another department updates the Oddělení column too. Unresolvable (free-text/legacy) positions keep the last known department; a session with no position-change Dodatek keeps the Nástup department (never retroactively rewritten). A future-dated Dodatek only folds once its `startDate` arrives: the employee **detail header** recomputes live on every render so it flips at the instant of the validity date, while the cached root fields (Zaměstnanci list) are re-folded by the `refreshEmployeeEffective` scheduled job, which runs **daily at 00:00 Europe/Prague** so the list flips from midnight too (plus immediately on any employment write, and via the `trigger-effective-refresh` backfill).
- `resyncRootFields(empRef, req, now)` — the single chokepoint for keeping the denormalized `current*` fields correct after **any** employment-row write. Folds the latest session via `recomputeRootFromLatestSession` (clearing the fields when no active session remains) and audit-logs the change. Called from `POST /employment` (both `nástup` and `změna smlouvy`), `PATCH /employment/:rowId`, and the DELETE endpoint. **Never copy a single row's own fields onto the root**: a Dodatek row holds its change in `changes[]` and has no `jobTitle`/`department`/`contractType`/`companyId`, so a raw copy blanks the list's Pozice/Oddělení/Typ columns. (This was a real bug — editing any Dodatek wiped `current*` — fixed by routing every write path through this helper.)
- `DELETE /api/employees/:id/employment/:rowId` — deletes one row, but cascades to the entire session when the row is a Nástup (walks forward to the next Nástup, exclusive). Tied contracts (matched by `employmentRowId`) are deleted alongside, including their unsigned + signed PDFs from Storage. After deletion, root denormalized fields are recomputed; if the last session is gone they're cleared. Each deletion (rows + contracts + root patch) is audit-logged; the contract delete entries carry `deletedDueToEmploymentRowDelete` for traceability.

### Delete protection (referential integrity) — 2026-06-11
Guards that prevent the orphaned-reference class (the "Kyrylo Tarasenko" bug, where deleting an employee left dangling `planEmployees` / shift cells / `payrollPeriods` entries that regenerated as phantom 0-hour rows). Each guard returns HTTP 400 with a Czech message, surfaced in the UI via `ConfirmModal`.

- **`DELETE /api/employees/:id`** blocks the delete if the employee has **any** payroll or shift history — an entry in any `payrollPeriods/*/entries/{employeeId}` or membership in any `shiftPlans/*/planEmployees`. Such employees must be **terminated** (`Ukončit smlouvu`), not deleted. Index-free by design: it iterates the (monthly) `payrollPeriods` / `shiftPlans` parents and uses a doc-id lookup / collection-scope query rather than a `collectionGroup` query (which would need a `COLLECTION_GROUP` index the emulator does **not** enforce → silent prod 500s). For the allowed (no-history) path the endpoint now also removes the previously-orphaned `otherDocuments` sub-collection, the employee's `employeeChangeRequests`, and the Storage blobs for both `contracts` and `otherDocuments`.
- **`DELETE /api/companies/:id`** blocks if any employee's denormalized `currentCompanyId` references it (*"Nelze smazat společnost, ve které jsou aktivní zaměstnanci."*).
- **`DELETE /api/jobPositions/:id`** blocks if any employee's `currentJobTitle` matches the position name (*"Nelze smazat pracovní pozici, kterou mají aktivní zaměstnanci ve smlouvě."*). Positions are referenced by **name**, and the DPP hourly rate resolves by current position name at every payroll recompute — so deleting an in-use position would otherwise silently zero DPP pay on the next nightly run.

All three mirror the long-standing `departments` / `roleTypes` "still in use" block pattern. This prevents **new** orphans only; sweeping any pre-existing orphaned references is a separate operational task.

### PDF form exports — Dotazník + Prohlášení (2026-06-11)
Two official forms are filled from the employee's data and opened in a new tab (view, not download): the **"Osobní dotazník zaměstnance"** and the **"Prohlášení poplatníka daně"** (MFin 5457). Both are pre-supplied **fillable AcroForm PDFs** in `functions/assets/` (copied to `lib/assets/` by the functions `build` step), filled with `pdf-lib`. `functions/src/services/formPdf.ts`:
- `fillQuestionnairePdf(data, title)` sets the 27 named text fields via the AcroForm appearance pipeline (`getTextField().setText()` → `updateFieldAppearances(DejaVu)` → `flatten`). DejaVu Sans is embedded because the fields' default WinAnsi font can't encode Czech diacritics.
- `fillProhlaseniPdf(data, title)` instead **draws** the 7 values at each field's widget rectangle at a fixed 11 pt (`fillFormByDrawing`). Its AcroForm fields have no font in their DA, so `setFontSize` throws and the appearance pipeline auto-fits the text far too small — drawing gives full size control. The foreigner (daňový-nerezident) block has no fields and is left for hand-fill.
- `doc.setTitle()` carries the human filename (`Dotazník <jméno> <příjmení>`, `Prohlášení <období> <jméno> <příjmení>`) — that drives the browser tab + save-as name (a blob-URL open ignores `Content-Disposition`, which is set to `inline`).

Endpoints in `employees.ts` decrypt the sensitive fields they embed (rodné číslo / OP / účet / pojištěnec) and **audit-log the export** (`writeAudit` `action: "export"`, `extra.document`):
- `GET /:id/questionnaire-pdf` — gated `employees.view.all` OR `employees.view.nonManagement`. `rodinný stav` is resolved to the M/F variant by `gender` (`displayGendered`, mirrors `frontend/src/lib/genderDisplay.ts`); `telefon` formatted `+420 XXX XXX XXX`; `nationality` shown as `CODE - Name` (`functions/src/services/nationalities.ts`, a backend copy of the frontend pure-data module).
- `GET /:id/tax-declaration-pdf?period=…` — gated `employment.manage` OR `documents.view`. The free-text **zdaňovací období** (e.g. `2026` or `od září 2026`) is entered in a dialog; `adresa bydliště` is Czech employees' trvalá address, foreigners' resolved kontaktní address.

UI: a **"Dotazník"** button in the employee hero (`EmployeeDetailPage`) and a **"Prohlášení poplatníka"** button in the Další-dokumenty toolbar (`OtherDocumentsTab`), each streaming the audited blob with the auth token and opening it in a new tab.

### Salary formatting in templates
`{{salary}}` and `{{newSalary}}` template variables now resolve with Czech thousands-dots: `39000` → `"39.000"`. The literal `,- Kč` tail stays in the template HTML (`nastup_hpp`/`nastup_ppp`/`zmena_smlouvy`), so the helper emits only the formatted integer. Implemented via `formatSalaryCZ()` in `frontend/src/lib/contractVariables.ts`.

### Dodatek/Ukončení generation context
A Dodatek row stores only `changes[]` and `startDate` — `companyId`, `contractType`, `jobTitle`, `salary`, `workLocation` are all empty on the row itself. `EmployeeDetailPage` carries the session's parent Nástup alongside the row in `generateModal` state and falls back to it for every context field the row doesn't supply. Nástup rows are unaffected (parent === row, fallbacks no-op).

For an **Ukončení** row the termination date lives in the row's own `startDate` (the terminate flow never sets `endDate`). The generation context therefore maps the `{{endDate}}` variable ("Datum ukončení") from `r.startDate` when `changeType === "ukončení"`, instead of `r.endDate ?? p.endDate`. Without this, termination templates reported no end date for open-ended contracts (and the original fixed end — not the actual termination date — when ending a fixed-term contract early).

### AddEntryModal lock
`AddEntryModal` accepts `lockedChangeType?: ChangeType`. When set, the changeType selector is hidden and the form is pre-filled with the locked value. Title reflects the action ("Nový nástup" / "Nový dodatek" / "Ukončit smlouvu"). The `+ Nástup` page button, session-header `+ Dodatek`, and session-header `Ukončit smlouvu` all use this lock so each entry point produces exactly one kind of row.

### Per-row action button states
| State                        | Buttons shown                                               |
|------------------------------|-------------------------------------------------------------|
| No contract record           | `Generovat smlouvu`, `Nahrát podepsanou smlouvu`            |
| Contract record, unsigned    | "Stáhnout", `Smazat smlouvu`, `Nahrát podepsanou smlouvu`   |
| Contract record, signed      | "Stáhnout podepsanou", `Smazat smlouvu`                     |

The existing `archived` lifecycle (PATCH `status: "archived"` / `status: "unsigned"`) is no longer surfaced in the UI; the backend endpoint stays in place for backward safety. Legacy archived contracts render as ordinary signed contracts in the new layout.

### Snapshot/seed pair (local)
`scripts/snapshot-employment-history.js` reads the live emulator's employment + contract metadata for a pinned set of employee IDs and writes `scripts/_employment_history_snapshot.json`. `scripts/seed-employment-history.js` replays it (wired into `seed-all.js` as the last step, fail-soft when the snapshot file is absent). PDFs aren't snapshotted — only metadata. `scripts/` is gitignored, so neither file ships in commits.

### Dodatek modal refinements (2026-05-06)
Three follow-ups on the Dodatek (`změna smlouvy`) form:

- **"Text pro smlouvu" dropped.** Each change row had a free-text override that pre-dated the `zmena_smlouvy` template's `{{#if isDodatekMzda}}` / `{{#if isDodatekPozice}}` / `{{#if isDodatekUvazek}}` / `{{#if isDodatekZmenaKonce}}` conditional blocks. Those blocks now generate the contract sentence from the `changeKind` + `value`, so the manual override was dead weight. `contractText` is gone from `ChangeRow` in both `frontend/src/pages/EmployeeDetailPage.tsx` and `frontend/src/lib/employmentSessions.ts`; existing Firestore docs that still carry the field load fine (TypeScript ignores extra properties).
- **`pracovní pozice` change picks from `jobPositions`.** Replaced the free-text "Nová pozice" input with a `<select>` listing every entry from the `/jobPositions` catalogue, sorted alphabetically (`cs` collation) with `<optgroup>` per department. Not filtered to the employee's current department — the workflow is now: register the pozice in Settings → Pracovní pozice first, then add the Dodatek (or Nástup) referencing it. Legacy free-text values that don't match the catalogue surface as a `(mimo katalog)` fallback option so old rows still round-trip through edit. Positions whose `departmentId` no longer resolves to a department doc fall into a trailing **ostatní** optgroup.
- **Transition chain in the session header.** When a Dodatek shifts the `jobTitle` or `contractType` during a session, the header surfaces the full chronological chain — `recepční → senior recepční → Front Office Manager` for the title, `HPP → PPP → HPP` inside the contract-type tag chip. All entries before the last render with the existing `.titleFrom` strikethrough so they read as history; the trailing entry is the current value. `frontend/src/lib/employmentSessions.ts` exports `collectFieldChain(session, field)` which walks each Dodatek's `changes[]`, maps `úvazek` → HPP/PPP via the existing `uvazekToContractType()`, and collapses consecutive duplicates. Sessions with length-1 chains (no transitions) collapse to the plain current value.

---

## Employee self-service — Můj profil (2026-05-22)

Every linked user gets `/muj-profil` ("Můj profil", menu item for all six roles, appended last so no role's landing page changes). It shows the caller's **own** employee record (personal / contact / documents / insurance + employment history) and lets them propose edits that an **admin or director must approve** before they touch the live record.

- **Self-scoped read API** (mounted at `/me`, any authenticated user): `GET /me/employee[/contact|/documents|/benefits|/employment]` and `POST /me/employee/reveal`. The employee id is resolved server-side from `users/{uid}.employeeId` — never from the URL — so a caller can only ever read their own record. Backend in `functions/src/routes/selfService.ts`.
- **Edit-by-approval workflow** — new top-level collection `employeeChangeRequests/{id}` (Admin-SDK only; no `firestore.rules`/index changes, queries are single-field). Employee submits a diff via `POST /me/change-requests` (sensitive proposed values are **encrypted on submit** so plaintext never rests on the request doc); they can list/cancel their own pending requests. Admin/director review in a new Upozornění tab **"Žádosti o úpravu údajů"** (`GET /employee-change-requests/pending` + `/pending-count`, `POST /:id/reveal` (gated `changeRequests.review` **+ `sensitive.reveal`** — revealing a proposed sensitive value needs sensitive-reveal rights, not just review), `PATCH /:id`). **Approve** applies the diff to the live record (encrypting sensitive fields, refreshing document-expiry alerts, audit-logging every applied field) via `functions/src/services/employeeChangeRequests.ts`; **reject** takes an optional reason.
- **Editable-field whitelist** lives in two mirrored places — backend `EDITABLE_FIELDS` (`functions/src/services/employeeChangeRequests.ts`) and frontend `frontend/src/lib/selfEditFields.ts` — covering root/contact/documents/benefits incl. sensitive fields (rodné číslo, OP, pojištěnec, účet). Employment/contract terms are excluded (those stay in the Nástup/Dodatek flow). Read display reuses `displayGendered` (Pohlaví/Rodinný stav); edit mode uses the same dropdowns as the employee form for Rodinný stav + Vzdělání.
- Page: `frontend/src/pages/EmployeeSelfPage.tsx`; admin tab: `frontend/src/pages/upozorneni/EmployeeDataChangeRequestsTab.tsx`; badge context: `frontend/src/context/EmployeeChangeRequestsContext.tsx`.

### Promotion-batch fixes (2026-05-22)
- **create-user** (`functions/src/routes/auth.ts`): the handler had no try/catch and the Express app had no error middleware, so a rejected `admin.auth().createUser` (e.g. duplicate email, or the project's password policy) left the request hanging. Now wrapped in try/catch with mapped Firebase error codes → clean Czech messages, incl. translating `PASSWORD_DOES_NOT_MEET_REQUIREMENTS`; a global error-handler middleware was added in `index.ts` as a safety net. The create-user form also shows a password-policy hint (≥8 chars, upper+lower+digit).
- **MOD row** (`frontend/src/components/ModCell.tsx` + `ShiftGrid.tsx`): the MOD row validated typed letters against a hardcoded `MOD_PERSONS` list; it now accepts the letters actually assigned to managers in the current plan.
- **Vacation pending-count** (`functions/src/routes/vacation.ts`): `GET /vacation/pending-count` combined `status == "approved"` with `pendingEdit != null`, which needs a composite index that isn't in `firestore.indexes.json` — on real Firestore the query 500'd and the frontend swallowed it, so the "Dovolená" badge stayed 0 everywhere. Rewritten to two single-field equality queries + a JS filter (no composite index).

---

## Date-based active/terminated status + auto-move / reinstate (2026-05-28)

The employee root `status` is now **derived from the employment sessions** rather than a static field set only at creation. The valid values are now a **three-way enum: `"active" | "before-start" | "terminated"`**, driving three tabs on the Employees page: Aktivní, Před nástupem, and Ukončení.

- **`computeEffectiveStatus(rows, today)`** — exported, pure, in `functions/src/routes/employees.ts`. Returns:
  - `"active"` — at least one session is currently active (Nástup `startDate <= today` AND effective end date is not before today).
  - `"before-start"` — no session is currently active AND the most recent session's Nástup `startDate` is in the future. Covers upcoming new hires and returning past employees whose new Nástup hasn't arrived yet. Any future start qualifies — there is no time window.
  - `"terminated"` — no session is active and the most recent Nástup is not in the future.
  - `null` — no employment rows yet (freshly-created employee; status is left as-is so a new hire isn't shown terminated before onboarding).

  **Asymmetric, date-based boundaries:** a session is active when its Nástup `startDate <= today` AND its effective end date (the Ukončení row's `startDate`, or a fixed-term `endDate`, folded through any in-effect `délka smlouvy` Dodatek) is NOT before today. So a termination dated today or in the future leaves the employee active (the end date is the last active day), while a future-dated Nástup activates **on** its day, not before.
- **`applyDerivedStatus(empRef, now, req?)`** recomputes + persists `status` (audited when `req` is supplied). Wired into all three employment write paths — `resyncRootFields` (POST/PATCH employment) and the DELETE employment handler — plus the nightly `refreshEffectiveRootForAllActive` sweep, which now scans **every** employee and re-derives status in **all three directions** so date transitions flip on their day with no employment write (including `before-start → active` on the start day). It is orthogonal to the denormalized current* fields (the list-blanking resync logic is untouched); `computeEffectiveRootFields` also date-gates the Ukončení row so a future-dated termination keeps the still-active employee's current* columns populated.
- **Reinstate-on-duplicate:** the new-employee form (`EmployeeFormPage`) matches the entered first+last name and `dateOfBirth` against terminated employees; on a match it offers — via `ConfirmModal`'s three-way layout — *Reaktivovat a upravit údaje* (navigate to the existing record's edit form; adding a fresh Nástup there reactivates them through the same derived status), *Přesto vytvořit nového*, or *Zrušit*. No separate status endpoint is needed.

### Frontend — three-tab Employees page

`EmployeesPage` fetches all three statuses in parallel on load (`/employees?status=active`, `/employees?status=before-start`, `/employees?status=terminated`) — three separate single-field queries, no composite index needed. The tab switcher shows three buttons: **Aktivní** / **Před nástupem** / **Ukončení**. The "Před nástupem" tab sits between Aktivní and Ukončení.

Status badges in the employee list:
- `"active"` → green **Aktivní** badge.
- `"before-start"` → violet **Před nástupem** badge.
- `"terminated"` → red **Ukončen** badge.

Cross-tab search (entered when searching): matches from all three statuses are shown regardless of the selected tab.
- **One-time backfill:** `scripts/_backfill-employee-status-staging.js` (local, ADC, `BACKFILL_PROJECT=<id>`, dry-run by default + `--apply`) brings existing `status` in line with the derived logic. Run dry-run first and review any `terminated → active` flips before applying.

## Employees list — search by birth name (2026-05-28)

The Zaměstnanci search predicate (`EmployeesPage`) also matches `birthSurname` (rodné příjmení), so someone who changed their surname after marriage is findable by their original name. The list API already returns `birthSurname` (only `birthNumber` is redacted), so this is a client-side-only change.

## Další dokumenty tab (2026-05-29)

A third tab on the Employee detail page — **Další dokumenty** (alongside *Detail* and *Historie pracovního poměru*) — holds arbitrary uploaded PDF files (scans, attachments) that aren't generated contracts. Each document is just a display name + a PDF.

- **Storage is deliberately separate** from both the identity `documents` sub-collection (a single doc holding OP/passport data incl. encrypted `idCardNumber`) and from `contracts`: new sub-collection `employees/{id}/otherDocuments/{docId}` + new Storage prefix `other-documents/{employeeId}/{docId}.pdf`. Firestore fields: `{ name, storagePath, contentType: "application/pdf", uploadedAt, uploadedBy }`. No encrypted fields.
- **Endpoints** (`functions/src/routes/employees.ts`, router mounted at `/api/employees`), mirroring the contracts storage/audit pattern (base64-in/Admin-SDK-save, `Content-Disposition` UTF-8 + ASCII-fallback download, best-effort Storage delete on remove):
  - `GET /:id/other-documents` — list (newest first).
  - `POST /:id/other-documents` — body `{ name, pdfBase64 }` (validates non-empty name + present base64), `logCreate`, returns `{ id }`.
  - `GET /:id/other-documents/:docId/download` — streams the PDF inline.
  - `DELETE /:id/other-documents/:docId` — deletes the doc + Storage file, `logDelete`.
- **Permissions** match contracts: write (POST/DELETE) and read (GET) are guarded by `requireRole("admin","director","accountant","hr")`, but the router-level `enforceEmpAccess` middleware blocks `accountant` on any non-GET write and blocks `hr` from management-employee records — so effectively admin/director/hr upload+delete, manager/accountant view only. Not surfaced on `Můj profil`.
- **UI**: `frontend/src/components/OtherDocumentsTab.tsx` — list rows (name + `formatTimestampCZ(uploadedAt)` + Zobrazit / Stáhnout / Smazat), a *Nahrát dokument* upload modal (name input + `accept="application/pdf"`, ≤ 15 MB guard, base64 upload). Delete + errors go through `ConfirmModal` (no native dialogs); the modal doesn't close on backdrop click.

## Multisport — periods + companions (2026-05-29)

The Multisport benefit moved from a single window to multiple periods + companion cards on the benefits doc:
- `multisportPeriods: { from, to|null }[]` — basic enrollment windows (whole-month by convention; `to: null` = ongoing).
- `multisportCompanions: { id, name, from, to|null, price }[]` — "Doprovodná" cards (several allowed).
- `multisport` (bool) is now a **derived "active today" flag**, maintained on write and re-derived nightly by `sweepMultisport`. The legacy `multisportFrom`/`multisportTo` are dropped on write/migration; `readMultisport` (`functions/src/services/multisport.ts`) falls back to synthesising one period from them so unmigrated docs keep working. Pure helpers (`multisportPriceForMonth`, `multisportStartNotes`, `overlapsMonth`, `endOfMonth`, `anyPeriodActiveOn`, `readMultisport`) live in that module and are unit-tested by `scripts/_smoke-multisport-calc.js`.

**Endpoint:** `PUT /api/employees/:id/multisport` (admin/director/hr; accountant blocked by `enforceEmpAccess`) — body `{ periods, companions }`; validates dates + companion name/price, recomputes the derived flag, audit-logs to `employees/benefits`. The standard `GET /:id/benefits` returns the arrays (Multisport fields are not encrypted).

**UI:** dedicated `frontend/src/components/MultisportEditor.tsx` on the Employee detail **Benefity** section — add/remove basic periods + companion cards in a modal (no native dialogs, no backdrop close). The Multisport checkbox+dates were removed from `EmployeeFormPage`, and that form's benefits save now strips any `multisport*` keys so it can never overwrite the editor-owned fields.

**Termination:** `endMultisportOnTermination` (`functions/src/routes/employees.ts`) caps every basic period + companion `to` at the end of the termination month when an Ukončení row is added; the frontend shows a `ConfirmModal` reminding the admin to cancel it in the Multisport extranet.

**Sweep:** `sweepMultisport` now scans **all** benefits docs and re-derives `multisport` from `multisportPeriods` **bidirectionally** (a started period flips it on, an ended one off). Manual trigger `POST /benefits/trigger-multisport-sweep`.

Payroll shows the monthly Multisport **price** (basic + active companions) instead of "ANO" — full computation is in the local `payroll.md`. Basic price = Settings → Mzdy → `multisportBasePrice` (init 470). One-time migration: `scripts/_migrate-multisport.js` (currently-enrolled only, local).

## Wave A quick-wins (2026-06-04)

- **Contract-type badge on the Zaměstnanci list.** Each employee name carries an HPP/PPP/DPP badge (same component/derivation as the Payroll list). The standalone **"Typ smlouvy"** column was removed — the badge replaces it; the row-background contract-type tint is unchanged.
- **Cross-tab search.** `EmployeesPage` fetches both the active and terminated lists once on load; when a search term is entered, matches from **either** tab are shown regardless of the selected tab. An empty search shows only the current tab's list.
- **Salary on the Nástup row.** Employment-history Nástup rows now render the starting `salary` for HPP and PPP contracts via the same `<SalaryReveal>` redact/eye-toggle widget used for salary Dodatek rows. DPP and rows without a salary are unchanged.
- **`nepodepiseProhlaseni` (boolean).** New "Nepodepíše prohlášení poplatníka" checkbox in the employee edit form (Doplňující údaje → Benefity), stored on the `benefits` sub-doc. When `true`, the employee **detail** page shows a "Nepodepsané prohlášení" banner under the header.
- **"Platnost OP" (`idCardExpiry`) removed from Můj profil self-service** — both the displayed value and the "Navrhnout úpravu" change-request form (it was unused there). Stored data is untouched; the admin-side `documents` sub-collection still keeps `idCardExpiry` for expiry alerts. **Decoupling:** `refreshDocumentExpiryAlerts` no longer derives a field's encryption flag from the self-edit `EDITABLE_FIELDS` whitelist — encryption is now declared on `EXPIRY_FIELDS` itself (`sensitive: boolean`), so dropping a field from the self-edit whitelist can't break decryption of stored values.
- **Phone +420 grouping.** Numbers starting with `+420` display as `+420 XXX XXX XXX` on the employee detail page and Můj profil (display only; storage unchanged). Shared helper `frontend/src/lib/phoneFormat.ts` → `formatPhoneDisplay`. Other country codes are shown unchanged for now.
