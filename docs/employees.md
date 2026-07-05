# Employees

Developer documentation for the employee module: the core employee record and form, the session-based employment-history detail page, and the Můj profil self-service / edit-by-approval workflow.

## Phase 3 — Employee Module
- `idCardExpiry` removed from UI — deprecated, stays `null` in Firestore.
- Pracovní zařazení (job title/department/contract/company) set exclusively via employment history modal — not on the add/edit form.
- `jobPositions` and `departments` Firestore collections managed from Settings.
- Employment history modal: linked dropdowns (Oddělení → Pracovní pozice), auto-fills `salary` and `hourlyRate` from position defaults.
- `jobPositions` docs carry optional `clothingAllowance` and `homeOfficeAllowance` (Kč/h, nullable). Seeded from `pozice.csv` columns "Náhrady - oblečení" and "Náhrady - HO"; editable in Settings → Pracovní pozice. Displayed as `N Kč/h` behind the same eye-toggle as salary + hourly rate.
- Settings → Pracovní pozice: editing `hourlyRate` cascades the new value to every active employment record where `currentJobTitle === position.name` AND `currentDepartment === position.department.name` (denormalized fields on `employees/{id}`). PATCH `/jobPositions/:id` returns `409 { requiresConfirmation, fieldChange, affectedEmployees, affectedUnlockedPayrolls }` when the change would touch employees; the UI shows a confirmation dialog flagging employees whose current rate already differs from the position default (`isManualOverride`), plus any unlocked `payrollPeriods` that contain those employees and would need a manual Recount. On confirm, re-PATCH with `confirmCascade: true`. Cascade only covers `hourlyRate` — `defaultSalary` is intentionally excluded (driven by signed contracts), and `clothingAllowance`/`homeOfficeAllowance` are not yet snapshotted onto employment records.
- Employee list default order: `lastName` then `firstName` (Czech locale). Column headers are now clickable to sort — see [Employees list — Datum nástupu / Datum ukončení columns + sortable columns (2026-06-20)](#employees-list--datum-nástupu--datum-ukončení-columns--sortable-columns-2026-06-20).
- Settings → Oddělení: clickable "Název" header sorts asc/desc. Settings → Pracovní pozice: clickable "Název" and "Oddělení" headers with asc/desc toggle. Active column shows ▲/▼, inactive ⇅.
- **Education levels (`educationLevels`)**: admin-managed catalogue used by the EmployeeFormPage Vzdělání dropdown. Each doc carries `code` (e.g. `K`) + `name` (e.g. `úplné střední všeobecné vzdělání`) + `displayOrder`. Backend route `/api/educationLevels`: GET open to any authenticated user (form needs the list); POST/PATCH/DELETE admin-only. Settings → Vzdělání tab shows two sortable columns (Název, Kód) with inline edit + create modal + delete confirm. Seeded from `scripts/seeds/vzdelani.csv` (one `"<code> - <name>"` line per level) by `scripts/seed-education-levels.js`. EmployeeFormPage composes the option label as `${code} - ${name}` to match the legacy hardcoded format, so already-saved `employee.education` values keep selecting the right option; a saved value not in the catalogue is still rendered as an extra option to avoid silent loss on save.
- **CSV export** (admin + director): "Exportovat CSV" button on `EmployeesPage` opens `ExportEmployeesModal`. Users pick which of 36 seed-compatible columns to include, filter by status / company / contract type / nationality / job title, and name the output file (defaults to `zamestnanci_YYYY-MM-DD.csv`; `sanitizeFilename()` strips Windows-illegal characters and appends `.csv` on blur and at submit). Backend endpoint `GET /api/employees/export` merges each employee with their `contact`, `documents`, `benefits`, and latest `employment` sub-docs in parallel, redacting the five encrypted fields (`birthNumber`, `idCardNumber`, `insuranceNumber`, `bankAccount`, `idCardExpiry`) by default. Opting in via `?includeSensitive=true` decrypts them and writes ONE `auditLog/` entry per export (action `"export"`), not one per field per employee. **The sensitive opt-in is permission-gated server-side:** `?includeSensitive=true` requires `employees.export.sensitive` (separate from the `employees.export` gate on the route); the handler returns 403 without it. The frontend already hides the toggle for callers lacking the permission, but the backend is the real gate — a direct API call (or a custom type granted plain `employees.export` only) can't dump plaintext PII. CSV assembly lives client-side in `frontend/src/lib/csvExport.ts` — semicolon-delimited, CRLF, UTF-8 BOM, dates `"DD. MM. YYYY"`, booleans `"ANO"`/empty, salary with space thousands separator. Column order mirrors `scripts/seeds/employees.csv` so a full-column export is round-trip compatible with the seed loader. **Excel text-literal escape:** columns flagged `forceText` (`idCardNumber`, `passportNumber`, `visaNumber`, `birthNumber`, `insuranceNumber`, `bankAccount`, `phone`) emit as `="value"` so Excel preserves leading zeros on visa numbers, keeps `+420` phone prefixes, and doesn't interpret `/` in bank accounts as division. Future: the `accountant` role is in the plan for this allow list but not yet in `UserRole`; a TODO at `functions/src/routes/employees.ts` tags the handler.
- Shift plan export: "Exportovat ▾" button opens a PDF/CSV dropdown. CSV is semicolon-delimited UTF-8 BOM, one row per employee (name, rawInput per day, monthly shift count), section separator rows, MOD row after vedoucí. All employees included regardless of active flag. Filename: `smeny_{year}_{month}.csv`.
- Shift plan page: month nav and plan bar are individually sticky (`position: sticky`) within `.main`; ShiftGrid thead sticks within the wrapper (`overflow-y: auto`, bounded `max-height`). Layout `.shell` uses `height: 100vh` so `.main` is the real scroll container.
- Czech date formatting: `frontend/src/lib/dateFormat.ts` — `formatDateCZ(iso)`, `formatTimestampCZ(ts)`, `formatDatetimeCZ(ts)`.
- Gendered marital status: `frontend/src/lib/genderDisplay.ts` — `displayGendered(value, gender)`. Values are stored combined ("ženatý/vdaná") and resolved on read; passing a `null`/unknown gender returns the combined form unchanged. The per-employee root flag **`genderNeutralDisplay`** (boolean) opts an employee out of resolution everywhere they're displayed — see "Per-employee neutral gender display" below.

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
- `frontend/src/components/EmploymentRowItem.tsx` — single row's metadata + action cluster. Owns the per-row delete confirm modal with copy that varies by row type (Nástup → cascade warning with row count; Dodatek/Ukončení → tied-contract warning). **On phones (v3.8.1)** the row's action cluster is collapsed by default and revealed by tapping the summary (see "Collapsible employment-history entries on phones" in `docs/other-features-and-ui.md`); desktop is unchanged.
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

- **`DELETE /api/employees/:id`** blocks the delete if the employee has **any** payroll or shift history — an entry in any `payrollPeriods/*/entries/{employeeId}`, membership in any `shiftPlans/*/planEmployees`, **or a shift cell in any `shiftPlans/*/shifts`** (added v2.2.2: a cell can outlive its membership row, so checking membership alone let an employee with orphan-prone cells slip through and get hard-deleted). Such employees must be **terminated** (`Ukončit smlouvu`), not deleted. Index-free by design: it iterates the (monthly) `payrollPeriods` / `shiftPlans` parents and uses a doc-id lookup / collection-scope query rather than a `collectionGroup` query (which would need a `COLLECTION_GROUP` index the emulator does **not** enforce → silent prod 500s). For the allowed (no-history) path the endpoint removes the employee's sub-collections + the Storage blobs for `contracts` and `otherDocuments`, the top-level `alerts` / `vacationRequests` / `employeeChangeRequests` / `probationAlerts`, the linked `users.employeeId` (unlink, or delete the account with `?deleteUser=true`), **and any stray shift-plan request docs** (`unavailabilityRequests` / `shiftOverrideRequests` / `shiftChangeRequests`, added v2.2.2). `auditLog` is intentionally preserved as immutable history.
- **`DELETE /api/companies/:id`** blocks if an in-use employee's denormalized `currentCompanyId` references it (*"Nelze smazat společnost, ve které jsou aktivní zaměstnanci."*).
- **`DELETE /api/jobPositions/:id`** blocks if an in-use employee's `currentJobTitle` matches the position name (*"Nelze smazat pracovní pozici, kterou mají aktivní zaměstnanci ve smlouvě."*). Positions are referenced by **name**, and the DPP hourly rate resolves by current position name at every payroll recompute — so deleting an in-use position would otherwise silently zero DPP pay on the next nightly run.
- **`DELETE /api/educationLevels/:id`** blocks if an in-use employee's `education` root field matches the level's composite display label (`"<code> - <name>"`, or `"<name>"` without a code — the string the admin form stores). Message *"Nelze smazat vzdělání, které mají přiřazené zaměstnanci."*

All mirror the long-standing `departments` / `roleTypes` "still in use" block pattern (`departments` still blocks on its contained `jobPositions`, not on employees). This prevents **new** orphans only; sweeping any pre-existing orphaned references is a separate operational task.

**"In-use" = ACTIVE or BEFORE-START only (v3.8.4).** The companies / jobPositions / educationLevels guards ignore **terminated** employees — a catalogue value only ex-employees ever used can be cleaned up. Implemented by the shared `functions/src/services/lookupGuard.ts` → `isReferencedByLiveEmployee(refField, value)`: a single-field equality query with a `.select("status")` projection whose result is filtered in code to `status ∈ {active, before-start}`, so **no composite index** is needed (the denormalized root `status` drives it). Because the guards now block deleting anything an active/before-start employee uses, the only way a non-terminated employee can reference a missing value is if they were **reactivated** after it was deleted while terminated. `EmployeeDetailPage` detects that (current company/department/position not in the loaded catalogue, or `education` label missing) and shows a **non-blocking warning banner** (*"Neplatné údaje po reaktivaci: … — už nejsou v číselníku. Upravte je…"*) so the admin fixes the values via the normal edit surfaces.

### PDF form exports — Dotazník + Prohlášení (2026-06-11)
Two official forms are filled from the employee's data and opened in a new tab (view, not download): the **"Osobní dotazník zaměstnance"** and the **"Prohlášení poplatníka daně"** (MFin 5457). Both are pre-supplied **fillable AcroForm PDFs** in `functions/assets/` (copied to `lib/assets/` by the functions `build` step), filled with `pdf-lib`. `functions/src/services/formPdf.ts`:
- `fillQuestionnairePdf(data, title)` sets the 27 named text fields via the AcroForm appearance pipeline (`getTextField().setText()` → `updateFieldAppearances(DejaVu)` → `flatten`). DejaVu Sans is embedded because the fields' default WinAnsi font can't encode Czech diacritics.
- `fillProhlaseniPdf(data, title)` instead **draws** the 7 values at each field's widget rectangle at a fixed 11 pt (`fillFormByDrawing`). Its AcroForm fields have no font in their DA, so `setFontSize` throws and the appearance pipeline auto-fits the text far too small — drawing gives full size control. The foreigner (daňový-nerezident) block has no fields and is left for hand-fill.
- `doc.setTitle()` carries the human filename (`Dotazník <jméno> <příjmení>`, `Prohlášení <období> <jméno> <příjmení>`) — that drives the browser tab + save-as name (a blob-URL open ignores `Content-Disposition`, which is set to `inline`).

Endpoints in `employees.ts` decrypt the sensitive fields they embed (rodné číslo / OP / účet / pojištěnec) and **audit-log the export** (`writeAudit` `action: "export"`, `extra.document`):
- `GET /:id/questionnaire-pdf` — gated `employees.view.all` OR `employees.view.nonManagement`. `rodinný stav` is resolved to the M/F variant by `gender` (`displayGendered`, mirrors `frontend/src/lib/genderDisplay.ts`) — unless the employee's `genderNeutralDisplay` flag is set, in which case `""` is passed as the gender so the combined form is printed; `telefon` formatted `+420 XXX XXX XXX`; `nationality` shown as `CODE - Name` (`functions/src/services/nationalities.ts`, a backend copy of the frontend pure-data module).
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

## Czech address connector normalization (#6, v3.4.3)

`permanentAddress` / `contactAddress` (free-text, in the `employees/{id}/contact` sub-doc) are normalized on save so compound place names follow ÚJČ (prirucka.ujc.cas.cz id=164 spojovník / id=165 pomlčka): both joined parts single-word → **spojovník `-`** tight (`Frýdek-Místek`, `Praha-Kunratice`); a multi-word part incl. `Praha 4` → **pomlčka en-dash `–`** with spaces (`Praha 4 – Modřany`); em-dash and other dash variants are normalized away. Helper `normalizeCzechAddressConnector()` / `normalizeContactAddresses()` in `functions/src/services/addressFormat.ts` (unit-tested via `node:test` — `npm test` in `functions/`). Conservative: only a connector with a letter on at least one side is rewritten (house ranges like `12-14` and dash-free text untouched), processed per comma-segment. Applied at both write paths: `PUT /employees/:id/contact` (admin create+edit) and the change-request approval (`employeeChangeRequests.ts`). Existing prod data was a one-time read-only-inventoried + backed-up cleanup, not a migration in the deploy.

---

## Employee self-service — Můj profil (2026-05-22)

Every linked user gets `/muj-profil` ("Můj profil", menu item for all six roles, appended last so no role's landing page changes). It shows the caller's **own** employee record (personal / contact / documents / insurance + employment history) and lets them propose edits that an **admin or director must approve** before they touch the live record.

- **Self-scoped read API** (mounted at `/me`, any authenticated user): `GET /me/employee[/contact|/documents|/benefits|/employment|/contracts]`, `GET /me/employee/contracts/:id/download`, `GET /me/employee/alerts`, and `POST /me/employee/reveal`. The employee id is resolved server-side from `users/{uid}.employeeId` — never from the URL — so a caller can only ever read their own record. Backend in `functions/src/routes/selfService.ts`. See [Signed-contract employment history + self download (v3.5.1)](#signed-contract-employment-history--self-download-v351) for the two new contract endpoints and the signed-only history filter.
- **Edit-by-approval workflow** — new top-level collection `employeeChangeRequests/{id}` (Admin-SDK only; no `firestore.rules`/index changes, queries are single-field). Employee submits a diff via `POST /me/change-requests` (sensitive proposed values are **encrypted on submit** so plaintext never rests on the request doc); they can list/cancel their own pending requests. Admin/director review in a new Upozornění tab **"Žádosti o úpravu údajů"** (`GET /employee-change-requests/pending` + `/pending-count`, `POST /:id/reveal` (gated `changeRequests.review` **+ `sensitive.reveal`** — revealing a proposed sensitive value needs sensitive-reveal rights, not just review), `PATCH /:id`). **Approve** applies the diff to the live record (encrypting sensitive fields, refreshing document-expiry alerts, audit-logging every applied field) via `functions/src/services/employeeChangeRequests.ts`; **reject** takes an optional reason.
- **Editable-field whitelist** lives in two mirrored places — backend `EDITABLE_FIELDS` (`functions/src/services/employeeChangeRequests.ts`) and frontend `frontend/src/lib/selfEditFields.ts` — covering root/contact/documents/benefits incl. sensitive fields (rodné číslo, OP, pojištěnec, účet). Employment/contract terms are excluded (those stay in the Nástup/Dodatek flow). Read display reuses `displayGendered` for Rodinný stav (respecting `genderNeutralDisplay`); edit mode uses the same dropdowns as the employee form for Rodinný stav + Vzdělání. **Pohlaví itself is not shown on Můj profil** (view or edit) — employees don't see their own gender; it remains on the manager-facing employee detail page. `emp.gender` is still fetched (it drives the Rodinný stav resolution) — only the row is hidden.
- Page: `frontend/src/pages/EmployeeSelfPage.tsx`; admin tab: `frontend/src/pages/upozorneni/EmployeeDataChangeRequestsTab.tsx`; badge context: `frontend/src/context/EmployeeChangeRequestsContext.tsx`.

### Signed-contract employment history + self download (v3.5.1)

**Signed-only history filter.** The employment-history overview on Můj profil shows a row **only when it has a matching signed contract**. Both unsigned-but-generated entries and entries with no contract at all are hidden — from the employee's perspective, both mean "not finalised". The filter is applied in `frontend/src/pages/EmployeeSelfPage.tsx` before `groupBySession`:

```ts
const contractByRow = mapContractsToRows(employment, contracts);
const visibleEmployment = employment.filter((row) => {
  const c = contractByRow.get(row.id);
  return !!c && c.status === "signed";
});
```

`mapContractsToRows` (from `frontend/src/lib/employmentSessions.ts`) picks the most-recent contract generation per row. Consequence: because `groupBySession` drops orphan rows (rows with no preceding Nástup in the visible set), hiding a Nástup hides its entire session — the session's effective end date is computed only from the visible rows. A Ukončení row therefore appears only after its own signed contract is uploaded. This is deliberate: employees see only legally finalised history. On older records that predate contract generation, those rows are invisible on Můj profil; the admin-side detail page is unaffected.

**New self-scoped endpoints** (`functions/src/routes/selfService.ts`):

- **`GET /me/employee/contracts`** — returns contract metadata for the caller's own record: `{ id, type, status, employmentRowId, generatedAt, displayName }`. Auth-only (no `contracts.view` required); returns no PDF bytes or storage paths. The frontend uses this list to build the `contractByRow` map.
- **`GET /me/employee/contracts/:contractId/download`** — streams the caller's own signed contract PDF via Admin SDK (`storage.rules` deny direct client access). Self-scoped and signed-only: 404s when the contract is not under the caller's employee record, is not in `status: "signed"`, or the Storage file is missing. Auth-only — no `contracts.view` (unlike the admin download route in `functions/src/routes/contracts.ts`). Sends `Content-Disposition: attachment` with a UTF-8 filename (`<displayName> - podepsaná.pdf`) and an ASCII fallback for legacy clients; mirrors the filename pattern of the admin route.

**Frontend download button.** Each visible (signed) history entry on Můj profil shows a "Stáhnout smlouvu" button. `frontend/src/components/EmploymentRowItem.tsx` and `frontend/src/components/EmploymentSession.tsx` gained an optional `onSelfDownload?: (contractId: string, displayName?: string) => void` prop. When set (on the self page only), the admin `<ContractActionButtons>` cluster is replaced by the single download button — no generate/sign/delete/preview actions leak onto Můj profil, including for admins viewing their own profile.

### Promotion-batch fixes (2026-05-22)
- **create-user** (`functions/src/routes/auth.ts`): the handler had no try/catch and the Express app had no error middleware, so a rejected `admin.auth().createUser` (e.g. duplicate email, or the project's password policy) left the request hanging. Now wrapped in try/catch with mapped Firebase error codes → clean Czech messages, incl. translating `PASSWORD_DOES_NOT_MEET_REQUIREMENTS`; a global error-handler middleware was added in `index.ts` as a safety net. The create-user form also shows a password-policy hint (≥8 chars, upper+lower+digit).
- **MOD row** (`frontend/src/components/ModCell.tsx` + `ShiftGrid.tsx`): the MOD row validated typed letters against a hardcoded `MOD_PERSONS` list; it now accepts the letters actually assigned to managers in the current plan.
- **Vacation pending-count** (`functions/src/routes/vacation.ts`): `GET /vacation/pending-count` combined `status == "approved"` with `pendingEdit != null`, which needs a composite index that isn't in `firestore.indexes.json` — on real Firestore the query 500'd and the frontend swallowed it, so the "Dovolená" badge stayed 0 everywhere. Rewritten to two single-field equality queries + a JS filter (no composite index).

---

## Per-employee neutral gender display (2026-06-18)

The only gender-resolved employee field is `maritalStatus` (rodinný stav), stored combined ("ženatý/vdaná") and resolved on read by `displayGendered()`. A per-employee root boolean **`genderNeutralDisplay`** opts an individual out of that resolution: when set, the combined form is shown wherever the employee appears.

- **Toggle**: a checkbox ("Nerozlišovat tvary podle pohlaví") sits under the Pohlaví selector on `EmployeeFormPage.tsx`. Default off/absent.
- **Mechanism — no new branching in the resolver.** `displayGendered()` already returns the combined form for a `null`/unknown gender (the path used by employees with no gender set), so the three resolution sites simply pass `null`/`""` instead of the real gender when the flag is set:
  - `EmployeeDetailPage.tsx` (Rodinný stav row)
  - `EmployeeSelfPage.tsx` (`renderReadValue`, view mode)
  - backend Dotazník PDF — `functions/src/routes/employees.ts` `GET /:id/questionnaire-pdf`
  Edit controls always edit the raw combined value, so edit mode needs no change. Contract generation does not resolve gender, so contracts are unaffected.
- **Persistence is additive.** The create handler (`POST /employees`) seeds `genderNeutralDisplay: false`; `PATCH /employees/:id` spreads the request body (no whitelist) so updates persist automatically. Both read endpoints (`GET /employees/:id` and the self-scoped `GET /me/employee`) return all non-sensitive root fields, so the flag surfaces with no endpoint change. Legacy records without the field read as `false` (normal resolution) — **no migration needed**. Audit label added in `frontend/src/lib/audit/fields.employee.ts`; the boolean renders as Ano/Ne via the existing formatter.

Also shipped alongside: **Pohlaví is no longer displayed on Můj profil** (view + edit) — see the self-service section above.

---

## Date-based active/terminated status + auto-move / reinstate (2026-05-28)

The employee root `status` is now **derived from the employment sessions** rather than a static field set only at creation. The valid values are now a **three-way enum: `"active" | "before-start" | "terminated"`**, driving three tabs on the Employees page: Aktivní, Před nástupem, and Ukončení.

- **`computeEffectiveStatus(rows, today)`** — exported, pure, in `functions/src/routes/employees.ts`. Returns:
  - `"active"` — at least one session is currently active (Nástup `startDate <= today` AND effective end date is not before today).
  - `"before-start"` — either (a) no session is currently active AND the most recent session's Nástup `startDate` is in the future (upcoming new hires and returning past employees whose new Nástup hasn't arrived yet; any future start qualifies — no time window), or (b) **there are no employment rows at all yet** (a freshly-created / name-only employee added before any contract exists). In both cases the employee has not started, so they belong in the Před nástupem tab — never "active" before onboarding.
  - `"terminated"` — no session is active and the most recent Nástup is not in the future.

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
- **`zaucovani` (boolean) + `zaucovaniDo` (YYYY-MM-DD) — "Zaučování" (training).** Checkbox in the employee edit form (Doplňující údaje → Benefity); ticking it reveals a "Zaučování do" date field. Stored on the `benefits` sub-doc. While active, the employee **detail** page shows a "Zaučování (do …)" banner under the header. **Auto-untick:** the flag is treated as off once `zaucovaniDo` is in the past — computed on read via `clock.today()` (no nightly job): the detail banner hides, and the edit form loads the checkbox unticked (so the next save persists the cleared flag). A ticked flag with no end date stays active until cleared manually. The same flag also renders a green **"V zácviku"** badge next to the employee's name on the **Employees list** (beside the HPP/PPP/DPP contract badge) — `PUT /employees/:id/benefits` denormalizes `zaucovani` + `zaucovaniDo` onto the root employee doc so the list needs no benefits join, and `isInTraining()` in `EmployeesPage.tsx` recomputes the live state (using `clock.today()`) so the badge auto-clears the same way the banner does.
- **"Platnost OP" (`idCardExpiry`) removed from Můj profil self-service** — both the displayed value and the "Navrhnout úpravu" change-request form (it was unused there). Stored data is untouched; the admin-side `documents` sub-collection still keeps `idCardExpiry` for expiry alerts. **Decoupling:** `refreshDocumentExpiryAlerts` no longer derives a field's encryption flag from the self-edit `EDITABLE_FIELDS` whitelist — encryption is now declared on `EXPIRY_FIELDS` itself (`sensitive: boolean`), so dropping a field from the self-edit whitelist can't break decryption of stored values.
- **Phone +420 grouping.** Numbers starting with `+420` display as `+420 XXX XXX XXX` on the employee detail page and Můj profil (display only; storage unchanged). Shared helper `frontend/src/lib/phoneFormat.ts` → `formatPhoneDisplay`. Other country codes are shown unchanged for now.
- **Non-+420 phone display format (v3.1.0).** When a save involves a changed phone number that does NOT start with `+420`, a `PhoneFormatModal` prompts the user to choose how it should be displayed. The confirmed string is stored verbatim in `contact.phone` and shown as-is everywhere (`formatPhoneDisplay` only reformats the `+420` case). This is a frontend-only change — no schema change, no backend endpoint. See [Non-+420 phone display format](#non420-phone-display-format-v310) below.

---

## Employees list — Datum nástupu / Datum ukončení columns + sortable columns (2026-06-20)

Two changes to `frontend/src/pages/EmployeesPage.tsx` shipped together in v2.2.8.

### New columns: Datum nástupu and Datum ukončení

The Employees table now shows a **fixed column set for ALL users** — the set was deliberately chosen and is not a per-user picker:

| Column | Notes |
|---|---|
| Jméno (+ HPP/PPP/DPP badge) | |
| Pozice | |
| Oddělení | |
| Národnost | |
| **Datum nástupu** | new |
| **Datum ukončení** | new |
| Stav | |

Společnost was deliberately omitted to keep the table width manageable.

Both new columns are backed by **root-denormalized fields** on `employees/{id}` maintained by `applyDerivedStatus`:

- **`employmentStartDate`** (`string` ISO `YYYY-MM-DD` | `null`) — the start of the employee's **current continuous run** at the company. This is NOT necessarily their latest Nástup date: a returning employee whose new Nástup begins within one calendar month of their previous session's end is treated as continuous, and `employmentStartDate` reflects the original run's start. Example: if Richard Klíma's latest Nástup is 1. 1. 2026 but he has worked unbroken since Nov 2022, the stored value is `"2022-11-01"`. `null` for name-only employees with no employment rows.
- **`employmentEndDate`** (`string` ISO `YYYY-MM-DD` | `null`) — the effective end date of the latest session. `null` means open-ended (renders as "—" in the UI). Populated for terminated employees (their exit date) and still-active employees with a known future end (fixed-term contract or an in-advance departure). Mirrors the same end-date resolution as `computeEffectiveStatus`: Nástup `endDate`, overridden by any in-effect `délka smlouvy` Dodatek (empty value = doba neurčitá clears it to `null`), then by the Ukončení row's `startDate`.

#### Backend — `computeEmploymentDates(rows, today)` in `functions/src/routes/employees.ts`

A new exported pure function placed immediately after `computeEffectiveStatus` in the same file. It folds employment sessions oldest-to-newest using the same session-building loop (`nástup` opens, `změna smlouvy` appends, `ukončení` closes), and returns `{ employmentStartDate, employmentEndDate }`.

**Continuous-run rule:** a new Nástup continues the SAME run when it starts in the **same calendar month** as, or the calendar month **immediately after**, the previous session's effective end (gap ≤ 1 whole calendar month). Dec-31 end → Jan-1 start is therefore continuous. A gap of 2+ months (terminated, rehired later) starts a fresh run and `employmentStartDate` resets to that new Nástup's `startDate`.

**Gap measurement — `isoMonthIndex(dateStr)`:** a module-level helper that parses a date string by substring (never `new Date()` — avoids the UTC-shift-to-previous-day bug) and returns an absolute month index (`year * 12 + (month - 1)`). Comparing two `isoMonthIndex` values is year-boundary-safe (Dec 2025 → Jan 2026 differ by exactly 1). An unmeasurable boundary (missing/garbled date, or an open-ended prior session) is treated as **continuous** (forgiving default — keeps the run going).

#### Backend — `applyDerivedStatus` persistence

Both `employmentStartDate` and `employmentEndDate` are computed and written inside **`applyDerivedStatus(empRef, now, req?)`**. Previously this function early-returned when the derived status was unchanged; it now writes whenever **either** status **or** a date changed, which allows the nightly `refreshEmployeeEffective` sweep (and the admin-triggered `trigger-effective-refresh` manual run) to backfill both fields onto existing employees without churning `updatedAt` when nothing moved.

Key design decisions:
- The two date fields are **pure derived denormalizations** — no audit log entry is written when they change (only the status transition is audited), to avoid log noise.
- They apply to **both active and terminated employees**. This is why they live in `applyDerivedStatus` rather than `computeEffectiveRootFields` (the latter returns `null` for terminated employees and would skip the write for exited staff).
- `POST /employees` seeds both fields as `null` for name-only employees.
- **No schema migration needed.** Existing employees backfill automatically on the next nightly sweep or manual trigger-effective-refresh call. The change is purely additive.
- `GET /employees` already returns the entire root doc, so no endpoint change was required — the fields flow through to the list automatically.

#### Frontend

Two new `<th>` / `<td>` pairs inserted between Národnost and Stav in `EmployeesPage.tsx`. Values are formatted with `formatDateCZ(value) || "—"`, so `null` / missing renders as a dash.

---

### Sortable columns

Every column header **except Stav** is now clickable to toggle sort order. Clicking an inactive header sorts ascending; clicking the active header toggles asc ↔ desc. The active column shows ▲ (asc) or ▼ (desc).

| Column | Sort key | Sort comparator |
|---|---|---|
| Jméno | surname then first name | Czech `Intl.Collator("cs", {sensitivity:"base", numeric:true})` |
| Pozice | `currentJobTitle` | same Czech collator |
| Oddělení | `currentDepartment` | same Czech collator |
| Národnost | **resolved display name** (e.g. "Ukrajina") | same Czech collator |
| Datum nástupu | `employmentStartDate` | ISO string lexicographic (chronological) |
| Datum ukončení | `employmentEndDate` | ISO string lexicographic (chronological) |
| Stav | — | **not sortable** |

Nationality sorts on the human-readable resolved name, not the stored 3-letter code, so the sort order matches what the user sees.

**Missing values always sink to the bottom** regardless of sort direction (e.g. open-ended employees with no `employmentEndDate` always appear last when sorting by that column).

**Default** remains `lastName` → `firstName` ascending — identical to the previous hard-coded order, so the initial render is unchanged.

#### Implementation

All sorting is **client-side in `EmployeesPage.tsx`**:

- State: `sortKey: string | null` and `sortDir: "asc" | "desc"`.
- `toggleSort(key)` — sets `sortDir = "asc"` when the key changes, flips it when the same key is clicked.
- `sortValue(employee, key)` — module-level pure helper that maps a sort key to the comparable string/null for a given employee record.
- `.sortable` / `.sortArrow` — CSS classes in `EmployeesPage.module.css` for header hover styling and the ▲/▼ indicator.

No backend changes were required.

---

## Non-+420 phone display format (v3.1.0)

Czech numbers (`+420`) are auto-formatted by `formatPhoneDisplay` on read. Non-Czech numbers (any phone that does not begin with `+420`) present a different problem: there is no universal grouping rule, so the app asks the user to choose.

### Trigger condition — `needsPhoneFormatPrompt`

`frontend/src/lib/phoneFormat.ts` exports:

```ts
needsPhoneFormatPrompt(phone: string, previous: string): boolean
```

Returns `true` when ALL of these hold:
1. `phone` is non-empty after trimming.
2. `phone` (whitespace-collapsed) does NOT start with `+420`.
3. `phone` differs from `previous` (the already-stored value) — a round-trip save of an unchanged foreign number must not re-prompt.

### Save gate in `EmployeeFormPage`

`frontend/src/pages/EmployeeFormPage.tsx` stores the previously-loaded phone in `initialPhone` (a `useRef`, populated when the employee data loads). The main save path calls `doSave()` with no argument; `doSave` checks `needsPhoneFormatPrompt(contact.phone, initialPhone.current)` and, if true, sets `phonePrompt = true` and returns — suspending the save.

`PhoneFormatModal` renders when `phonePrompt` is set. On confirm it calls `doSave(display)` with the user's chosen string as `phoneOverride`; the contact payload substitutes `phoneOverride` for the raw input value before posting. On cancel the save is simply abandoned.

### Self-service gate in `EmployeeSelfPage`

`frontend/src/pages/EmployeeSelfPage.tsx` builds a `changes` array from `buildChanges()` and, before submitting, checks whether the phone change entry satisfies `needsPhoneFormatPrompt`. If so it holds the entire pending change-set in `phonePromptChanges` state. `PhoneFormatModal` renders; on confirm it mutates the phone change's `newValue` in the held array and then calls `submitChanges` — so the correct display string goes out in the change-request payload, not the raw input.

### `PhoneFormatModal` (`frontend/src/components/PhoneFormatModal.tsx`)

A small modal (overlay/modal/header/body/footer; standard project modal pattern, no backdrop dismissal) with:
- A read-only "Zadané číslo" display of the raw input.
- An editable "Zobrazit jako" text input pre-seeded with the raw value (the user can add spaces/dashes for readability).
- **Uložit** confirms with `display.trim() || phone.trim()` — falls back to the original if the user clears the field.
- **Zrušit** / ✕ cancel without saving.

### Storage and display

The confirmed string is stored verbatim in `contact.phone`. `formatPhoneDisplay` returns it unchanged (it only reformats `+420` numbers). No database schema change; no backend endpoint.

---

## Parental leave — RODIČOVSKÁ employment row (v3.1.0)

A new informational employment-row `changeType: "rodičovská"` records a parental-leave period on an employee's history. It carries `startDate` and `endDate` only — no salary, position, or contract data.

### Data model

Stored as a regular doc in `employees/{id}/employment` with the shape:

```json
{ "changeType": "rodičovská", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD" }
```

Backend (`functions/src/routes/employees.ts`) enforces this in two ways:

- `POST /api/employees/:id/employment` whitelists `changeType: "rodičovská"` in `VALID_CHANGE_TYPES` and validates that `startDate` is present. **`endDate` is optional** — a blank or absent end date is normalized to `null` (open-ended leave whose end is not yet known). Any request missing `startDate` is rejected 400.
- `PATCH /api/employees/:id/employment/:rowId` on a row whose stored `changeType` is `"rodičovská"` strips every employment-contract field (`changeType`, `salary`, `hourlyRate`, `contractType`, `jobTitle`, `department`, `companyId`, `changes`, `agreedReward`, `agreedWorkScope`, `workLocation`, `probationPeriod`, `status`) from the PATCH body before writing — a `rodičovská` row can never be mutated into employment-contract data.

### Session grouping

`frontend/src/lib/employmentSessions.ts` — `groupBySession()` now collects `rodičovská` rows into `session.rodicovska: EmploymentRow[]` instead of silently dropping them (the previous "orphan drop" path for unrecognised `changeType` values). They are never folded into `effective` state or into `session.terminated`.

### UI — EmploymentSession card

`frontend/src/components/EmploymentSession.tsx`:

- Session header shows a **"+ Rodičovská"** button (beside "+ Dodatek") when the session is not terminated and the user holds `employment.manage`. Clicking it fires `onAddRodicovska` → `EmployeeDetailPage` opens `AddEntryModal` with `lockedChangeType: "rodičovská"`.
- `AddEntryModal` in `rodičovská` mode shows only **Začátek** and optional **Konec** date fields (no contract type, no salary, no changes). Title: "Rodičovská dovolená". Only `startDate` is required; `endDate` may be left blank for open-ended leave (the end date is often not known when parental leave begins).
- Active periods render in a **"rodicovskaBand"** — a header sub-row showing "Rodičovská | start – end" (or "dosud" in a `.ongoing` span when `endDate` is null) with per-period action buttons (gated `employment.manage`): a **✎ edit button** (`onEditRow(rd)`) so the end date can be filled in later, and a ✕ delete button. The band is outside the collapsible body so it is always visible on collapsed sessions; the ✎ edit button is the only affordance for rodičovská rows since they do not appear in the expandable body list.
- `rodičovská` rows are **not** included in the session's `rows[]` list and therefore do not appear as EmploymentRowItem entries in the expanded body.

### Denormalized badge — `parentalLeaveFrom` / `parentalLeaveTo`

Two new root-level fields on `employees/{id}` hold the next-or-current parental-leave window:

| Field | Type | Value |
|---|---|---|
| `parentalLeaveFrom` | `string` YYYY-MM-DD \| `null` | Start of the earliest not-yet-ended `rodičovská` period |
| `parentalLeaveTo` | `string` YYYY-MM-DD \| `null` | End of the same period |

`computeParentalLeave(rows, today)` in `functions/src/routes/employees.ts` finds the earliest `rodičovská` row that has not yet ended: a row with no `endDate` (open-ended) is treated as ongoing; a dated row drops off once its `endDate` is past. Sorts qualifying rows by `startDate` and takes the first. Written by `applyDerivedStatus` on every employment write that involves a `rodičovská` row (no root-field fold, just the parental-leave window update), and on every nightly sweep.

`isOnParentalLeave(emp)` in `frontend/src/pages/EmployeesPage.tsx` does a live containment check: `parentalLeaveFrom <= today` AND (`parentalLeaveTo` is null/empty OR `today <= parentalLeaveTo`). An open-ended period (null `parentalLeaveTo`) keeps the badge until an end date is filled in and passes. A **"Rodičovská"** badge renders next to the employee's name in the Employees list and appears/clears automatically with no server round-trip.

No migration required — `parentalLeaveFrom` / `parentalLeaveTo` backfill automatically on the next nightly `refreshEmployeeEffective` sweep or a manual `POST /api/employees/trigger-effective-refresh`.

### Data-safety design

Every existing consumer of employment rows (salary fold in `computeEffectiveState`, probation alerts, payroll calculator, CSV export, Dotazník PDF, Prohlášení PDF) either ignores unknown `changeType` values (silent drop via the orphan path) or explicitly skips `changeType !== "rodičovská"` when picking the "latest employment row". This means:

- A `rodičovská` row can never affect salary, position, contract type, status, start/end dates, or payroll.
- The server-side PATCH strip ensures a `rodičovská` row can never carry contract data even through direct API calls.
- Adding the feature is purely additive — no existing employee record is modified, and no existing query result changes.

---

## Self document-expiry alerts + Můj profil badge (v3.2.0)

Employees now see their own expiring/expired document alerts on the dashboard and on Můj profil, mirroring the same `alerts` collection data that admin users see on the Upozornění page. A red badge also appears next to the "Můj profil" sidebar item when the signed-in user has at least one active alert.

### Backend — `GET /me/employee/alerts`

New endpoint in `functions/src/routes/selfService.ts`, mounted alongside the existing `/me` self-service routes and therefore covered by `selfServiceRouter.use(requireAuth)`. No extra permission is required: a user linked to an employee sees only their own alerts.

```
GET /me/employee/alerts
→ DocumentExpiryAlert[]
```

Queries `alerts` where `employeeId == <caller's employeeId>` (resolved server-side from `users/{uid}.employeeId` via `getCallerEmployeeId`) and **excludes** the `idCardExpiry` (`platnost OP`) field from the result. Employees see only `passportExpiry` and `visaExpiry` alerts; admins still see all three (including OP) on the Employee detail page. If the caller has no linked `employeeId`, returns `[]`.

The 30-day expiring/expired classification and alert lifecycle are identical to those on the admin side (`updateDocumentAlerts` in `functions/src/routes/employees.ts`, `EXPIRY_FIELDS`, `EXPIRY_ALERT_DAYS = 30`). This endpoint is a self-scoped read; it does not trigger regeneration.

### Security hardening — `POST /me/employee/reveal`

`POST /me/employee/reveal` now requires `requirePermission("sensitive.reveal.self")` (was auth-only in prior releases). The audit entry written on a successful reveal carries `extra.self: true` so it is distinguishable from an admin-side reveal in the audit log. Permission key `sensitive.reveal.self` is seeded into the default employee role and is separate from the admin/director `sensitive.reveal` key.

### Frontend — `DocumentExpiryBar` shared component

`frontend/src/components/DocumentExpiryBar.tsx` (+ `DocumentExpiryBar.module.css`) is a **pure display component** extracted from the previously-inline banner in `EmployeeDetailPage.tsx`. It accepts a list of `DocumentExpiryAlert` objects and renders nothing when the list is empty.

```ts
export interface DocumentExpiryAlert {
  id: string;
  fieldLabel: string;
  expiryDate: string;          // ISO YYYY-MM-DD
  daysUntilExpiry: number;     // negative when already expired
  status: "expiring" | "expired";
}
```

Alert items are styled as `.alertItemExpiring` or `.alertItemExpired` and display a Czech phrase (`"Prošlé o N dní"` / `"Vyprší dnes"` / `"Vyprší za N dní"`). The component is now used in three places:

| Page | Data source |
|---|---|
| `EmployeeDetailPage` (admin view) | Employee-specific alerts already fetched for the page |
| `EmployeeSelfPage` (Můj profil) | `useSelfDocAlertsContext()` — excludes OP |
| `OverviewPage` (dashboard) | `useSelfDocAlertsContext()` — excludes OP |

### Frontend — `SelfDocAlertsContext`

`frontend/src/context/SelfDocAlertsContext.tsx` — a React context that fetches `GET /me/employee/alerts` whenever the signed-in user has a linked `employeeId`. Provides `{ alerts, count, refresh }`.

```ts
// Expose via:
export function useSelfDocAlertsContext(): { alerts: DocumentExpiryAlert[]; count: number; refresh: () => void }
```

The context is mounted at the app root (inside `SelfDocAlertsProvider`) and therefore available to any component. `Layout.tsx` calls `refresh` on every navigation and on its existing 60-second interval tick (the same loop that refreshes all other sidebar badge contexts), so the badge stays current without a dedicated timer.

### Můj profil sidebar badge

`Layout.tsx` `badgeFor("mujProfil")` now returns `selfDocAlertCount` from `useSelfDocAlertsContext()`. A non-zero count renders as a red badge on the "Můj profil" menu item in both the desktop sidebar and the mobile `BottomNav` (which receives `badgeFor` as a prop). Users without a linked employee get a count of 0 and see no badge.

---

## Employee write security hardening (v3.2.1)

Two complementary guards protect the employee root document from crafted write requests.

### Mass-assignment guard — `PATCH /employees/:id`

A constant `PROTECTED_ROOT_FIELDS` lists every server-derived / denormalized field on the root `employees/{id}` document:

```
status, currentJobTitle, currentDepartment, currentContractType, currentCompanyId,
currentContractDuringLeave, leaveContractType,
employmentStartDate, employmentEndDate, parentalLeaveFrom, parentalLeaveTo,
zaucovani, zaucovaniDo, createdAt, createdBy
```

`PATCH /:id` strips every key in this list from the request body before writing. A crafted payload cannot corrupt the status, position, company, employment dates, or training flag — all of which are derived by server-side computation (`applyDerivedStatus`, `computeEffectiveRootFields`, `applyDerivedStatus`, etc.) and must never be written by a client directly.

### Redaction-mask round-trip guard

`functions/src/services/encryption.ts` exports `REDACTION_MASK = "••••••••"` — the placeholder shown to clients in place of a sensitive field value. Three write handlers check for it before encrypting:

- `PATCH /:id` — drops any field in `SENSITIVE_FIELDS` whose submitted value equals `REDACTION_MASK`.
- `PUT /:id/documents` — drops fields in `DOCUMENT_SENSITIVE_FIELDS` that are empty or equal the mask.
- `PUT /:id/benefits` — drops fields in `BENEFITS_SENSITIVE_FIELDS` that are empty or equal the mask.

Without this guard, a frontend that re-submits the redacted display value (the placeholder string) would encrypt it and overwrite the real ciphertext. The dropped field is simply skipped on the `update()` call, preserving the stored encrypted value unchanged.

---

## Concurrent contracts — simplified model (v3.5.0, #22)

An employee may hold two active contracts simultaneously — the typical case is a main employment (e.g. HPP) that the employee is on rodičovská from, plus a concurrent secondary contract (e.g. DPP) that they actively work. **Design decision: payroll and shifts belong to the most recent active contract.** There is no separate payroll row per contract and no per-contract shift attribution.

### Backend — `computeEffectiveRootFields` selection rule

The function selects the **latest active session** (the most recently started Nástup that is both started and not terminated by today) and exposes its folded fields as `current*`. For single-contract employees this is byte-identical to the previous behaviour. When a concurrent contract (e.g. a DPP) is the latest active session it becomes current automatically; when it ends, the still-active earlier contract resurfaces as current.

Two new server-owned root fields are written alongside `current*` (both in `PROTECTED_ROOT_FIELDS`):

| Field | Type | Description |
|---|---|---|
| `currentContractDuringLeave` | `boolean` | An active `rodičovská` row exists on a **different** session than the current (latest active) one — the current contract is a concurrent job worked during leave. Default `false`. |
| `leaveContractType` | `string \| null` | The on-leave (main) contract's folded `contractType` (e.g. `"HPP"`), so the Employees list can badge it alongside the current concurrent contract. `null` when not in concurrent-leave mode. |

These are computed in `computeEffectiveRootFields` by finding `leaveSession` — any session other than `chosen` that has at least one `rodičovská` row currently active (started and not yet ended or open-ended). Written by the same employment-write + nightly-sweep + manual-trigger paths as `current*`. `EMPTY_ROOT_FIELDS` defaults both to `false` / `null`.

### Frontend — Employees list

`EmployeesPage.tsx` was updated to handle the concurrent-leave scenario:

- **`isOnParentalLeave(emp)`** — unchanged predicate (see the RODIČOVSKÁ section above).
- **`positionDisplay(emp)` / `departmentDisplay(emp)`** — if on parental leave and `currentContractDuringLeave`, returns `"RODIČOVSKÁ/<currentJobTitle>"` / `"RODIČOVSKÁ/<currentDepartment>"`; if on parental leave without concurrent, returns `"RODIČOVSKÁ"`; otherwise the normal current value.
- **`parentalCell(emp, base)`** — renders the Pozice/Oddělení cell JSX: leads with a `<span className={styles.parentalBadge}>Rodičovská</span>`; when `currentContractDuringLeave && base` appends `"/ <base>"` text (no leading margin on the badge, since it leads the cell).
- **Contract-type badges in the name cell** — a concurrent-leave employee shows two badges: `leaveContractType` first, then `currentContractType`, each coloured independently via `contractBadgeClass()` (default/grey = HPP, `.contractBadgePpp` blue = PPP, `.contractBadgeDpp` amber = DPP).
- **Sorting** — Pozice/Oddělení columns sort on `positionDisplay` / `departmentDisplay`, so "RODIČOVSKÁ/..." sorts under R.

> **Note:** An earlier "Phase 1" interim design (a user-settable `parallel` flag on Nástup rows, an `additionalContracts[]` array, and a "Souběžná smlouva" checkbox) was built and then replaced before this feature reached production. No production data carries that flag. The `currentEffectiveForMinWage` helper in `routes/payroll.ts` reads `r.parallel === true` defensively, but this will always be `false` for current data.

---

## PPP part-time support — `hoursPerWeek` (v3.5.0, #15)

A new optional field `hoursPerWeek` (number) on employment rows enables an explicit hours-per-week fraction for PPP employees. The legacy assumption of 20 h/week (half-time) remains in force whenever the field is absent.

### Data model

`employees/{id}/employment/{rowId}` — a Nástup row with `contractType: "PPP"` may carry `hoursPerWeek: <number>`. Set via a **"Počet hodin týdně"** numeric input on the Nástup form (visible only when `contractType === "PPP"`; hidden for HPP/DPP). DPP rows never carry this field (DPP pay is based on agreed reward, not weekly hours).

A new **"počet hodin"** Dodatek change kind — a `změna smlouvy` row may carry `changes: [{ changeKind: "počet hodin", value: "<number>" }]` to update the fraction mid-contract. This appears in the Dodatek form's change-kind dropdown and is displayed as "Počet hodin týdně" in the row summary (label registered in `frontend/src/components/EmploymentRowItem.tsx`). The audit field label is also registered in `frontend/src/lib/audit/fields.employee.ts`.

### Frontend fold — `computeEffectiveState`

`frontend/src/lib/employmentSessions.ts` carries `hoursPerWeek` through the fold: starts from `nastup.hoursPerWeek ?? null`; a "počet hodin" Dodatek overrides it. `EffectiveState` and the `EmploymentRow` type both include `hoursPerWeek: number | null`. The same fold is mirrored server-side in `effectiveCompFromRows()` in `functions/src/services/payrollCalculator.ts`.

### Contract template variables

Three new variables in `frontend/src/lib/contractVariables.ts` (v3.5.0):

| Variable | Group | Description |
|---|---|---|
| `{{hoursPerWeek}}` | Pracovní podmínky | Hours/week from the Nástup row (PPP) |
| `{{newHoursPerWeek}}` | Dodatky | New hours/week from a "počet hodin" Dodatek |
| `{{isDodatekHodiny}}` | Dodatky | `"ano"` when the Dodatek contains a "počet hodin" change; empty otherwise |

See also the `{{isDodatekHodiny}}` entry in [Dodatek template variables](contracts.md#dodatek-template-variables-2026-04-30) in `contracts.md`.

### Payroll

PPP vacation proration (`vacationFactor`) and all other payroll-computation implications of `hoursPerWeek` are documented in `payroll.md` (local, gitignored).

---

## Minimum-wage check — non-blocking warning (v3.5.0, #2)

A non-blocking warning surface for HPP/PPP contracts whose monthly gross salary is below the statutory `minimumWage` setting (`settings/payroll`). DPP is never checked.

### Threshold formula

Frontend helper `frontend/src/lib/minWage.ts`:

```
HPP → round(minWage)
PPP → round((minWage / 40) × hoursPerWeek)   — default 20 h when hoursPerWeek is absent
DPP → null (not checked)
```

Exports:
- `minWageThreshold(contractType, minWage, hoursPerWeek?)` → `number | null` — the monthly threshold, or `null` for unchecked types
- `isBelowMinWage(contractType, salary, minWage, hoursPerWeek?)` → `boolean`
- `formatCzk(value)` → `"39 000"` (Czech thousands grouping with non-breaking space)

The backend in `functions/src/routes/payroll.ts` mirrors the formula in `minWageThresholdServer()` and `currentEffectiveForMinWage()`.

### Warning surface 1 — contract entry

In `EmployeeDetailPage.tsx`, both the Nástup salary field and the mzda Dodatek salary field call `minWageThreshold` on change. When the entered value is below threshold, a `ConfirmModal` (state variable `minWageWarn`) informs the user. The warning is **non-blocking** — the admin acknowledges it and proceeds; no save is blocked.

### Warning surface 2 — Settings → Mzdy

When the admin edits `minimumWage` in `SettingsPage.tsx`, clicking "Zkontrolovat a uložit" calls `GET /api/payroll/min-wage-check?minimumWage=<newValue>` first. If violations are returned, the UI lists them (employee name, contract type, current salary, threshold, hours/week for PPP) before offering a separate "Uložit i přesto" button. If the endpoint call fails, the setting saves directly without blocking (network failure must not prevent a legal setting change).

### Endpoint

```
GET /api/payroll/min-wage-check?minimumWage=<number>
```

- **Gate:** `requireAuth` + `requirePermission("settings.payroll.manage")`
- **Query parameter:** `minimumWage` — a positive number; returns 400 otherwise
- **Response:** `{ minimumWage: number, violations: ViolationEntry[] }`
- `ViolationEntry`: `{ employeeId, name, contractType, hoursPerWeek: number | null, salary: number, threshold: number }`
- Only ACTIVE employees and active (started, not yet ended) contracts are checked.
- Results sorted by `salary` ascending (most under-threshold first).
- Defined in `functions/src/routes/payroll.ts`.
