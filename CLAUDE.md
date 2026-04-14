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
7. Payroll — calculation engine (replicates MZDY.xlsx), summary UI, export
8. Polish — stats dashboard, audit log UI, daily expiry alert scheduled function

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
- To seed employees from DTB.csv: `"C:\Program Files\nodejs\node.exe" scripts\seed-employees.js` (from project root, emulators must be running, DTB.csv must be at project root — UTF-8 with BOM, semicolon-delimited)

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
- Seed scripts switched from CP1250/iconv + DTB.xlsx to UTF-8 BOM-stripped DTB.csv; column mapping corrected; `mapMaritalStatus()` added; employment history no longer seeded from CSV (must be added via UI); `seed-admin.js` added to `seed-all.js` run order

### Phase 3 — deferred items (still pending)
- `jobPositions` lookup table — dropdown for "pracovní pozice" in history modal and salary defaults bound to position
- `departments` binding — "oddělení" auto-filled from selected position
- "změna smlouvy" — default contract text per change kind
- Expiry alert dates displayed as Czech-formatted dates (currently raw ISO strings)

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
- New button "Žádosti o změny" in plan bar (admin/director only), with red badge from `changeRequestCount`.
- `ShiftChangeRequestsProvider` added to `App.tsx` provider stack.

### Open items from spec (§14)
- Payroll: confirm whether D/N shifts use 11.5h net or 12h gross after break deduction
- Payroll: confirm night premium rate formula (% or fixed per hour)
- Payroll: confirm holiday premium rate formula
- Auth: confirm password reset flow (email-based or admin-reset only?)
- Shift planner: confirm whether portýři follow same availability rules as receptionists
- Contract templates: managed via TipTap editor in app (admin/director); no external .docx files needed
