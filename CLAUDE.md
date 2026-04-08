# Hotel HR App — Claude Guidelines

## Git Workflow

- **Always create a new branch before making any changes.** Never work directly on `master`.
- Branch naming: `feature/short-description`, `fix/short-description`, `chore/short-description`
- You may commit and push to the feature branch freely.
- **Only the user decides when to merge.** Never merge branches yourself.
- Use clear, descriptive commit messages explaining *why*, not just *what*.

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
| Contract generation | docx-templater + Puppeteer (Phase 4) |
| Encryption | AES-256-GCM in Cloud Functions |

### Firebase project
- Project ID: `hotel-hr-app-75581`
- Web App ID: `1:261269048570:web:9bb9e3b02efac0c31d8d43`

### Roles
`admin` → `hr` → `manager` → `receptionist` (least privileged)
Custom claims set via Firebase Admin SDK on the `users/` Firestore collection.

### Sensitive encrypted fields
These fields are AES-256-GCM encrypted before writing to Firestore. They must **never** be stored in plaintext or returned raw to the frontend:
- `employees.birthNumber` (rodné číslo)
- `documents.idCardNumber`, `documents.idCardExpiry`
- `benefits.insuranceNumber`, `benefits.bankAccount`

Every reveal of a sensitive field is logged to the `auditLog/` Firestore collection.

### Firestore data model
Top-level collections: `employees`, `users`, `companies`, `jobPositions`, `alerts`, `notifications`, `shiftPlans`, `payrollPeriods`, `auditLog`

Sub-collections under `employees/{id}`: `documents`, `contact`, `employment`, `benefits`, `contracts`

Sub-collections under `shiftPlans/{id}`: `planEmployees`, `shifts`, `rules`, `unavailabilityRequests`

Sub-collections under `payrollPeriods/{id}`: `entries`

Denormalized fields on `employees` root doc for querying: `currentCompanyId`, `currentDepartment`, `currentContractType`, `currentJobTitle`

### Build phases (from spec §13)
1. ✅ Foundation — scaffold, Firebase project, dependencies, encryption service, employee CRUD + frontend shell
2. Auth — user management UI, role assignment (Firebase Auth + custom claims already wired)
3. Employee module — documents/contact/benefits tabs, add/edit forms, document expiry alerts
4. Contract module — docx-templater generation, PDF export, Firebase Storage, contract log UI
5. Shift planner — `parseShiftExpression()`, monthly grid UI, availability rules, notifications
6. Payroll — calculation engine (replicates MZDY.xlsx), summary UI, export
7. Polish — stats dashboard, audit log UI, daily expiry alert scheduled function

### Running locally
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
- PowerShell execution policy blocks `firebase.ps1` — use `cmd` or `firebase.cmd` directly
- Node.js v24 is installed (winget installed latest, not v20) — `functions/package.json` uses `"node": ">=20"` to accommodate this

### Open items from spec (§14)
- Payroll: confirm whether D/N shifts use 11.5h net or 12h gross after break deduction
- Payroll: confirm night premium rate formula (% or fixed per hour)
- Payroll: confirm holiday premium rate formula
- Auth: confirm password reset flow (email-based or admin-reset only?)
- Shift planner: confirm whether portýři follow same availability rules as receptionists
- Contract templates: confirm who holds master .docx files and how template updates are managed
