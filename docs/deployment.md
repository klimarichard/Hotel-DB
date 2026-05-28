# Deployment & Environments

This document covers how the HPM Intranet is built and deployed across its three environments, the deploy tooling and project aliases, environment-specific concerns (encryption-key sourcing, region pinning, indexes, server-side PDF rendering), and the operational endpoints and rounds layered on top.

## Deployment & environments

Three environments with a strict cutover path:

| Env | Firebase project | Where it runs |
|---|---|---|
| Emulator | `hotel-hr-app-75581` (default alias; project ID is cosmetic in the emulator) | `firebase emulators:start` — Auth :9099, Functions :5002, Firestore :8080, Hosting :5000, UI :4000 |
| Staging | `hote-hr-app-staging` | Real Firebase, separate auth pool, used to dry-run every change before prod |
| Production | `hotel-hr-app-75581` | Real Firebase |

### Project aliases
`.firebaserc` declares `default` / `staging` / `production`. Tooling always names the alias explicitly (`--project staging`) so a stray deploy can never land on prod.

### Deploy scripts
Root `package.json` orchestrates each environment with a build + deploy pair:

```
npm run deploy:staging   # builds functions, builds frontend with --mode staging, deploys to the staging project
npm run deploy:prod      # same, against the production project
```

The frontend picks up its Firebase config from `frontend/.env.staging` / `frontend/.env.production`. The local emulator reads `functions/.env`; deployed staging **and** prod read `ENCRYPTION_KEY` from Secret Manager (see "Encryption key via Secret Manager" below).

For focused redeploys (e.g. functions-only after a small fix) skip the npm script and run the firebase CLI directly: `firebase deploy --only functions:api --project staging` or `--only firestore:indexes --project staging`.

### Encryption key via Secret Manager
Deployed functions source `ENCRYPTION_KEY` from Google Secret Manager, not from a `.env` file. `functions/src/index.ts` declares `secrets: ["ENCRYPTION_KEY"]` on the `api` export — the only function that decrypts (`services/encryption.ts`, used solely by `routes/employees.ts`; the scheduled functions never touch encrypted fields, so the secret is scoped to `api` alone). The declaration makes the secret a **hard deploy requirement for both staging and prod**, so each project must have:

- an `ENCRYPTION_KEY` secret (with an enabled version) in Secret Manager, and
- a `roles/secretmanager.secretAccessor` binding for the function's runtime service account — the App Engine default SA `<projectId>@appspot.gserviceaccount.com`, which 1st-gen functions run as. `firebase deploy` grants this automatically; it can also be set with `gcloud secrets add-iam-policy-binding`.

A `functions/.env.<prodId>` file could **not** isolate the prod key: the emulator also runs as project `hotel-hr-app-75581` and would load it. Secret Manager is the only safe production source. The local emulator is unaffected — it still reads `functions/.env`.

**The prod `ENCRYPTION_KEY` is irrecoverable.** Once employee data is encrypted with it, losing the Secret Manager value bricks every encrypted field (`birthNumber`, `idCardNumber`, `insuranceNumber`, `bankAccount`). Keep the value in a password manager / offline safe and never rotate it.

### First deploy to a fresh project
A project that has never run a Cloud Function needs two one-time steps before/after its first deploy:

1. **Provision the App Engine default SA** — `gcloud app create --region=europe-west3 --project=<projectId>`. 1st-gen functions run as `<projectId>@appspot.gserviceaccount.com`, which doesn't exist until the App Engine app is created. Without it, the secret IAM binding fails with "service account ... does not exist". The region is **permanent**; use `europe-west3` to match Firestore/Storage.
2. **Grant the `api` function public invoker access** — after the first deploy, `gcloud functions add-iam-policy-binding api --region=europe-west3 --member=allUsers --role=roles/cloudfunctions.invoker --project=<projectId>`. firebase-tools does not always set this on a fresh function, leaving `api` returning 403 to everyone. The binding survives later redeploys.

### Region pinning
All Cloud Functions run in `europe-west3` to co-locate with Firestore (`eur3` multi-region). `functions/src/index.ts` sets the region two ways because v1 + v2 functions don't share defaults: `setGlobalOptions({ region })` for the v2 `onSchedule` triggers, and `.region(REGION)` on the v1 `https.onRequest` export. Hosting rewrites pin the region explicitly too:

```
{ "source": "/api/**", "function": "api", "region": "europe-west3" }
```

### API dual mount
Express is mounted at both `/api` and `/` in `functions/src/index.ts`. Firebase Hosting forwards `/api/**` verbatim through the rewrite (so the function sees `/api/employees/...`), but the direct function URL and the Vite dev proxy deliver paths without the prefix (`/employees/...`). Mounting at both keeps every entry path resolving to the same routes.

### Server-side PDF rendering
Contract PDFs are rendered server-side via Puppeteer with `@sparticuz/chromium` — the bundled Chromium binary is too heavy for the default function runtime (~500 MB resident, ~3–5 s cold start). The `api` export bumps memory to 1 GB and timeout to 60 s; the rest of the API rides the same instance and amortizes the cost.

### Firestore indexes
The emulator ignores Firestore's index requirements — a query that needs an index returns just fine locally and then 500s with `FAILED_PRECONDITION` on real Firestore. The staging cutover surfaced this in two flavours:

- **Composite indexes** — any `where(...).orderBy(...)` across different fields, **an equality filter combined with a range filter on another field** (e.g. `where("employeeId","==",x).where("date",">=",a).where("date","<=",b)`), or chained `orderBy`s, needs a composite index. `firestore.indexes.json` declares them for `shiftPlans`, `payrollPeriods`, `employment`, `jobPositions`, `vacationRequests` (incl. `(employeeId, status, endDate)` for the approval-time `applyVacationXs` query), `shiftOverrideRequests`, `shiftChangeRequests`, the single-collection `shifts (employeeId, date)` index used by `findShiftCollisions`, plus the `auditLog` filter set.
- **Collection-group single-field exemptions** — collection-group queries on a single field need an explicit `COLLECTION_GROUP` index. `firestore.indexes.json` declares one for `benefits.multisport` so the daily `sweepMultisport` cron (and its manual trigger) can find every employee whose Multisport flag is still on.
- **Index scope matters** — a `COLLECTION_GROUP` index does **not** serve a single-collection `parentDoc.collection("shifts").where(...)` query (or vice versa). The `shifts` subcollection therefore needs both a `COLLECTION_GROUP` `(shiftPlanId, employeeId, date)` index *and* a `COLLECTION` `(employeeId, date)` index. Adding a vacation request hung silently on staging until the latter existed: `findShiftCollisions` threw `FAILED_PRECONDITION`, and because the Express app has no global error handler and the route had no `try/catch`, the unhandled async rejection never produced a response (the form spun forever). `POST /vacation` now wraps the collision check in `try/catch` so such failures return a visible 500.

When adding any new query that combines filter + orderBy on different fields, or any `collectionGroup(...).where(...)`, extend `firestore.indexes.json` and run `firebase deploy --only firestore:indexes --project staging` to verify on real Firestore *before* the same code reaches prod.

### Manual trigger endpoints
Five `POST /api/.../trigger-*` endpoints mirror the scheduled jobs that publish shift plans, sweep Multisport, refresh probation / document alerts, and re-fold employees' effective root fields. They exist so an admin can re-run a job after a missed scheduled execution (and to backfill data after a fix):

| Endpoint | Underlying job |
|---|---|
| `POST /api/shifts/trigger-deadlines` | `transitionPlanDeadlines()` |
| `POST /api/benefits/trigger-multisport-sweep` | `sweepExpiredMultisport()` |
| `POST /api/employees/trigger-probation-refresh` | `refreshAllProbationAlerts()` |
| `POST /api/employees/trigger-alert-refresh` | document expiry alert refresh |
| `POST /api/employees/trigger-effective-refresh` | `refreshEffectiveRootForAllActive()` (re-folds `current*` for every active employee; repairs any drifted cache) |

All five are admin-only (`requireAuth` + `requireRole("admin")`) and write a `manual-trigger` audit entry per successful call (`extra.trigger` names the underlying job, `extra.result` carries the job's return value). The audit-log write happens *after* the job, so a failed re-run leaves no entry — the failure surfaces in `firebase functions:log`.

### Staging credential rotation
`scripts/rotate-staging-passwords.js` paginates through every staging Auth user, replaces each password with a fresh 16-char random string, and writes `scripts/staging-credentials.txt` (gitignored). Requires Application Default Credentials (`gcloud auth application-default login`); refuses to run without `--allow-staging`; the shared `scripts/_seed-target.js` guard hard-blocks targeting prod.

### Test clock (non-prod time override)
A settable "current time" for exercising time-dependent behaviour — probation / document-expiry / Multisport sweeps, shift-plan deadline transitions, and any "today"-based UI — without waiting for real calendar time. **Offset mode:** the clock jumps to a chosen instant and keeps ticking from there (`fakeNow = realNow + offsetMs`).

- **State:** a single Firestore doc `settings/timeOverride` holding `{ enabled, offsetMs, targetISO, setAtISO, setBy }`.
- **Backend** (`functions/src/services/clock.ts`): `now()` / `nowMs()` apply the offset, but are gated by `isOverrideAllowed()`. The four time-decision sites — `planTransitions`, `multisportSweep`, `probationAlerts`, and `updateDocumentAlerts` — read the clock; **record-keeping timestamps (audit, `createdAt`, `serverTimestamp`) stay real.** An Express middleware refreshes the cached offset per request (TTL-cached); each scheduled job refreshes at start.
- **Endpoints** (`/api/settings/time-override`): `GET` (any authed user — drives the offset + banner), `PUT` / `DELETE` (admin-only **and** non-prod-only).
- **Frontend:** `lib/clock.ts` mirrors the offset (localStorage-cached for flash-free paint); `TimeOverrideContext` fetches it; the **sidebar-footer `TimeOverrideControl`** (next to Odhlásit / theme toggle) sets/clears it via a modal — the button itself turns amber and shows the fake date while active; an amber banner also rides every page. The control renders only when the backend reports `allowed` (emulator / staging). Every "what is today/now" UI site reads `clock.now()` / `clock.today()`.
- **Production safety (hard rule):** `overrideAllowed()` returns `true` **only** when `FUNCTIONS_EMULATOR === "true"` (local) or the runtime project id is exactly `hote-hr-app-staging`. In prod — or any environment that can't be positively identified as emulator/staging — it is `false`: `now()` returns real time unconditionally, `PUT`/`DELETE` 403, `GET` reports `allowed:false` so the footer control is hidden and the banner never shows. Production business logic can never run on a faked clock. Verified across simulated environments by `scripts/_verify-clock-gate.js`; the emulator end-to-end path (set → trigger reacts → clear) by `scripts/_smoke-clock.js`.

To test a trigger: set the clock, then call the matching `trigger-*` endpoint (or use the Upozornění manual refresh) — the job evaluates against the fake date on demand, no cron wait.

### Batch 5 — user management, contracts, fixes (2026-05-27)
Post-launch round covering user management, contract UX, and several bug fixes.

**User management (Settings → Uživatelé):**
- **Edit user** — a row "Upravit" action edits name + e-mail via `PATCH /api/auth/users/:uid`, updating both the Firestore profile and the Firebase Auth account. Changing the e-mail changes the user's login, so the UI warns first (ConfirmModal). Role / employee link / active state keep their existing per-row controls.
- **Create without password** — the password field is optional; left blank, the Auth account is created with no password and the backend returns a `generatePasswordResetLink`. The app also sends the reset e-mail (client `sendPasswordResetEmail`) and shows a copyable reset-link modal.
- **Inactive users** — listed active-first (inactive sink to the bottom). Creating a user with an e-mail that belongs to an existing inactive account offers to reactivate it (applying the entered name/role/employee) instead of failing on the duplicate-e-mail conflict.

**Contracts:**
- Generated PDFs **open in a browser tab** ("Zobrazit") for preview; a separate **"Stáhnout"** button downloads with the correct convention filename (read from the backend `Content-Disposition`, incl. the `- podepsaná` suffix for signed copies).
- **Stale detection** — a generated (unsigned) contract whose employment row has since changed shows **"Znovu generovat smlouvu"** instead of "Zobrazit"; regenerating discards the stale PDF (DELETE) and reopens the generator (compares the stored `rowSnapshot` against the current one, key-sorted).
- **Dodatek filename** — `DODATEK<YEAR> <all change labels> Příjmení Jméno` (e.g. `DODATEK2026 navýšení, změna pozice Klíma Richard`).
- **Signing date** defaults to the row's start-of-validity, with an inline warning when it is later than the validity start.
- **Template save** surfaces the real backend error and guards the Firestore ~1 MB document limit (inlined base64 images); saving a custom (standalone) template now sends its real name.

**Fixes:**
- **Vacation "Moje žádosti"** no longer drops approved/legacy requests — `GET /vacation` sorts by `requestedAt` in memory instead of a Firestore `orderBy` (which silently excludes documents missing that field). It also identifies a user's own requests (list filter, edit/cancel ownership, `approved-upcoming`) by the stable **`employeeId`** rather than the auth `uid`: prod data was migrated from staging while accounts were recreated, so migrated requests carry stale staging uids — matching by `employeeId` (the shift plan's key) keeps them visible and editable (`requesterEmployeeId()` in `functions/src/routes/vacation.ts`).
- Sidebar footer shows the user's **name** instead of their e-mail.
- The **Upozornění** badge updates immediately when an alert is dismissed (optimistic read-state in `AlertsContext`, reconciled with the server).
