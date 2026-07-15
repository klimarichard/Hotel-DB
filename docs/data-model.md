# Data Model & Build Phases

This document describes the Firestore data model (top-level collections, sub-collections, and denormalized fields) and the build-phase status of the HPM Intranet HR application.

## Firestore Data Model

**Top-level collections:** `employees`, `users`, `roleTypes`, `companies`, `jobPositions`, `departments`, `educationLevels`, `alerts`, `notifications`, `shiftPlans`, `vacationRequests`, `payrollPeriods`, `auditLog`, `hotels`, `handoverWarnings`, `settings`

**Sub-collections under `employees/{id}`:** `documents`, `contact`, `employment`, `benefits`, `contracts`, `otherDocuments`, `vacationLedger`

`vacationLedger/{year}` is the per-employee, per-calendar-year vacation-hour balance (nárok/čerpáno/zůstatek in hours, month-indexed, sourced from an AVENSIO seed / payroll locks / manual edits) — see [Employees — Vacation-hour ledger](employees.md#vacation-hour-ledger-v490). Not to be confused with the top-level `vacationRequests` collection (day-off applications, see [Vacation](vacation.md)).

**Sub-collections under `hotels/{hotelSlug}`** (Recepce; `hotelSlug` ∈ `ambiance`, `superior`, `amigo-alqush`, `ankora` — see [Recepce](recepce.md)):

| Path | Purpose |
|---|---|
| `hotels/{slug}/shiftHandovers/{shiftDate}_{shiftType}` | Předávací protokol per shift (`den`\|`noc`); each doc has its own `history` subcollection for element-level change history + undo/redo. |
| `hotels/{slug}/walkins/{autoId}` | Walk-in sale entries. |
| `hotels/{slug}/taxiRides/{autoId}` | Taxi ride entries. |
| `hotels/{slug}/config/walkins`, `hotels/{slug}/config/taxi` | Per-hotel visible date range (`{ from, to }`) that `walkiny.manage`/`taxi.manage` set to bound non-manager visibility. |
| `hotels/ambiance/lobbyBarSales/{autoId}` | Lobby bar item sales (Ambiance only) — `itemName`/`unitPrice`/`price`/`provision`/`doSpolecne` are computed server-side and SNAPSHOTTED at sale time, never re-derived from the live catalogue on read. |
| `hotels/ambiance/config/lobbyBar` | Lobby bar's visible date range (`{ from, to }`), set by `lobbyBar.manage`. |
| `hotels/ambiance/config/lobbyBarItems` | Lobby bar item catalogue + per-currency provision rates: `{ items: [{ id, name, priceCZK, priceEUR }], provisionCZK, provisionEUR }` (defaults 20 / 1), `lobbyBar.manage`-only. |
| `hotels/amigo-alqush/terminalPayments/{autoId}` | Card-terminal payments (Amigo & Alqush only) — `amount` is CZK-only, `type` a fixed 7-value enum, `note` optional on every type, `settled`/`settledBy`/`settledAt` settable only via the dedicated `terminal.manage`-gated endpoint. |
| `hotels/amigo-alqush/config/terminal` | Terminál's visible date range (`{ from, to }`), set by `terminal.manage`. |

`handoverWarnings/{hotel}_{id}[_late]` — Předávací protokol warnings, `type`
`"chain"` (Nenavazující předání — a handover chain break) or `"late"` (Pozdní
příchod — Převzal after the next shift's start), surfaced on the Upozornění hub.
`settings/sm` and
`settings/taxiRoutes` hold the two GLOBAL (all-hotels) Recepce config docs — the
shared sm rates and the shared taxi routes ceník, respectively.

The `benefits` sub-doc carries the insurance/bank/Multisport fields plus `nepodepiseProhlaseni: boolean` ("Nepodepíše prohlášení poplatníka" — drives the "Nepodepsané prohlášení" banner on the employee detail page) and `zaucovani: boolean` + `zaucovaniDo: string` (YYYY-MM-DD) — the "Zaučování" (training) flag and its end date, which drive a "Zaučování" banner that auto-hides once `zaucovaniDo` passes. **`zaucovani` + `zaucovaniDo` are also denormalized onto the root `employees/{id}` doc** (written by the `PUT /employees/:id/benefits` handler) so the Employees list — which reads only root docs — can render the "V zácviku" badge without joining the benefits sub-doc; the badge's auto-expiry is computed live from `zaucovaniDo` on read.

**Sub-collections under `shiftPlans/{id}`:** `planEmployees`, `shifts`, `rules`, `unavailabilityRequests`, `shiftOverrideRequests`, `shiftChangeRequests`, `shiftsSnapshot`. Request docs carry `requestedBy` (author uid) and, when filed at a shared terminal, `requestedByEmployeeId` (the picked real person — see [shifts.md](shifts.md#shared-terminal-attribution--who-is-really-requesting-v4215)).

**Sub-collections under `payrollPeriods/{id}`:** `entries`

**Denormalized fields on `employees` root doc** (for querying and list display):

| Field | Type | Maintained by | Description |
|---|---|---|---|
| `currentCompanyId` | string | `resyncRootFields` (per employment write) + nightly sweep | ID of the company in the employee's current active session |
| `currentDepartment` | string | same | Department name from the latest in-effect session |
| `currentContractType` | string | same | Contract type (`HPP`/`PPP`/`DPP`) from the latest in-effect session |
| `currentJobTitle` | string | same | Job title from the latest in-effect session |
| `currentContractDuringLeave` | boolean | same | `true` when an active `rodičovská` row sits on a **different** session than `current*` — the current contract is a concurrent job worked during parental leave. Default `false`. |
| `leaveContractType` | string \| null | same | The on-leave (main) contract's folded `contractType` (e.g. `"HPP"`), so the Employees list can badge it alongside the current concurrent contract. `null` when not in concurrent-leave mode. |
| `status` | `"active"\|"before-start"\|"terminated"` | `applyDerivedStatus` (per employment write) + nightly sweep | Derived from employment rows; see [employees.md](employees.md) |
| `employmentStartDate` | string (ISO `YYYY-MM-DD`) \| null | `applyDerivedStatus` (per employment write) + nightly sweep | Start of the employee's **current continuous run** — NOT necessarily the latest Nástup date; a rehire within one calendar month of the prior session's end extends the previous run (see continuous-run rule in [employees.md](employees.md)) |
| `employmentEndDate` | string (ISO `YYYY-MM-DD`) \| null | `applyDerivedStatus` (per employment write) + nightly sweep | Effective end date of the latest session (`null` = open-ended); mirrors the same end-date fold as `computeEffectiveStatus` |

`currentContractDuringLeave` and `leaveContractType` were added in v3.5.0 (concurrent contracts, #22). Both are in `PROTECTED_ROOT_FIELDS` and are written by the same employment-write + nightly-sweep paths as `current*`. `EMPTY_ROOT_FIELDS` defaults them to `false` / `null`. See [employees.md — Concurrent contracts](employees.md#concurrent-contracts--simplified-model-v350-22) for the full selection logic.

`employmentStartDate` and `employmentEndDate` were added in v2.2.8. Both are pure derived denormalizations (no audit log on change). They are computed in `computeEmploymentDates(rows, today)` (`functions/src/routes/employees.ts`) and persisted in `applyDerivedStatus`. Existing employees backfill on the next nightly `refreshEmployeeEffective` sweep or `trigger-effective-refresh` manual call; `POST /employees` seeds both as `null` for name-only employees. No migration script needed — additive, data-safe.

### Live employee-name resolution — read-time, never a backfill (v4.6.0)

Several collections **snapshot** an employee's name at write time and never rewrite it: `shiftPlans/{id}/planEmployees` (frozen when the person is added to the roster — `copy-employees` propagates the stale copy forward to the next month, and a plan predating the display-name feature carries no `displayName` key at all), `payrollPeriods/*/entries` (built from that already-stale roster, so a **recalc did not fix it**), `vacationRequests`, the `alerts`/`probationAlerts` collections, `employeeChangeRequests`, and the Předávací protokol signature stamps (`predal`/`prevzal`) + the `handoverWarnings` derived from them.

**The fix is read-time re-resolution, not a backfill.** Every endpoint that returns one of these snapshots now re-resolves the name against the **live** `employees/{id}` doc before responding; the stored snapshot survives only as the fallback for an employee that has since been deleted. This is deliberate over a one-time backfill migration: a backfill would rewrite production data, fix only the rows that exist today, and re-break on the very next rename. Read-time resolution is self-healing and **writes nothing** — notably, a **locked** `payrollPeriods` period now displays the current name without the lock being touched.

**Shared helper — `functions/src/services/employeeNames.ts`:**

```ts
interface EmployeeNameParts { firstName: string; lastName: string; displayName: string; }

function nameParts(rec: unknown): EmployeeNameParts;                       // read the three fields off any name-bearing record
function resolveEmployeeNameParts(ids): Promise<Map<string, EmployeeNameParts>>; // ONE batched getAll for a whole request
function preferLive(live, employeeId, snapshot): EmployeeNameParts;         // live if present, else the snapshot's parts
```

It returns raw name **parts**, not a composed string, because callers disagree about the form they need: most surfaces show `employeeDisplayName()` ("Zobrazované jméno" if set, else "Jméno Příjmení"), while the Zaměstnanci list, employee-picker dropdowns, and the payroll PDF deliberately stay surname-first on the **legal** name (`employeeSurnameFirst()`). Composition stays with the caller — `frontend/src/lib/employeeName.ts` on the frontend.

**Endpoints re-resolving via this helper:** `shifts.ts` (`GET /plans/:planId`, `GET /plans/:planId/employees`, `GET /changeRequests/pending`, `GET /plans/:planId/shiftChangeRequests` — the last two via a `withLiveSwapNames` wrapper that re-derives a swap partner's denormalized `requestedChange.swapWithName`), `payroll.ts` (the period GETs, via a `hydrateNames` helper, and the min-wage check), `payrollCalculator.ts` (an entry's `firstName`/`lastName`/`displayName` are now built from the live employee doc, never from the roster snapshot), `vacation.ts` (`GET /vacation`, `GET /vacation/approved-upcoming`), `alerts.ts` (both `GET /alerts` and the probation alerts GET, via `withLiveEmployeeNames`), and `employeeChangeRequests.ts` (`GET /employee-change-requests/pending`).

**Recepce mirror — `functions/src/services/recepceEmployees.ts`.** Recepce already had this pattern (`recepceDisplayName`, `resolveEmployeeDisplays` — see [Recepce — Předávací protokol](recepce.md#předávací-protokol-shift-handover), "Name display" subsection) for surfaces keyed directly by `employeeId`. v4.6.0 adds `resolveEmployeeIdsByUid` (batch `users/{uid}.employeeId` lookup) and `resolveDisplayNamesByUid` (uid → live display name, composing the two) for surfaces that instead stamp an auth **uid** — the Předávací protokol's `predal`/`prevzal` signature stamps and the `handoverWarnings` derived from them. Only the display **label** is re-resolved; the signature's legal substance (`uid`, the proven `email`, and `at`) is the historical record and is never rewritten. See [Recepce — Předávací protokol](recepce.md#předávací-protokol-shift-handover) for the two call sites (`handovers.ts`'s `withLiveSignerNames`, `handoverWarnings.ts`).

**Guidance for new surfaces:** enrich the endpoint response, don't add another name helper. Because the frontend already called `employeeDisplayName()` in most of these places before this fix, enriching the API response fixed the display with **zero frontend change** in every case above — the pattern to reach for next time a denormalized name surfaces stale is "hydrate on read", not a new client-side helper or a migration.

---

### `roleTypes/{id}` — configurable user types

Editable **user types** (the configurable-RBAC replacement for hard-coded roles). See [Authentication, Roles & Permissions](auth-and-permissions.md) for the full model.

```
roleTypes/{id} = {
  name: string,            // display label, e.g. "Ředitel"
  permissions: string[],   // permission keys from the catalogue this type grants
  management: boolean,      // holders count as "management" for employee-record scoping
  system: boolean           // protected built-in — only `admin` is true (not editable/deletable)
}
```

Six built-ins are seeded (`admin`, `director`, `manager`, `employee`, `accountant`, `hr`) by `scripts/seed-role-types.js`. Seeding is additive; the backend resolver falls back to the built-in mapping when a doc is missing, so an unseeded collection never locks anyone out.

### New permission fields on `users/{uid}`

Each user document gains three optional RBAC fields (mirrored as Firebase Auth custom claims):

- **`roleType`** — the `roleTypes` id assigned to the user (defaults to the legacy `role` when unset).
- **`extraPermissions: string[]`** — per-user permission grants on top of the type.
- **`revokedPermissions: string[]`** — per-user permission revokes subtracted from the type.

Effective permissions = `roleType.permissions ∪ extraPermissions − revokedPermissions`. The legacy **`role`** field is retained (still drives menu-order config, the sidebar label, and a few inline checks).

`users/{uid}` also carries a handful of self-service/admin preference fields outside the RBAC set above, e.g. `theme: "light" | "dark" | null` and `recepceDefaultHotel: HotelSlug | null` — the hotel the [Recepce](recepce.md#per-user-default-hotel--usersuidrecepcedefaulthotel) hub opens on for this user. Both follow the same shape: a self-service `GET`/`PUT /api/auth/me/*` endpoint gated on `requireAuth` only (no permission key — a user may only ever set their own preference), plus, for `recepceDefaultHotel` only, an admin-side write through `PATCH /api/auth/users/:uid` under the existing `users.manage` gate. See [Auth, Roles & Permissions — Endpoints](auth-and-permissions.md#endpoints).

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
| 8 | 🚧 | Polish — dashboard (`Přehled` — today's staffing, MOD, absent managers) ✅, stats, audit log UI ✅, Upozornění hub ✅ |

---
