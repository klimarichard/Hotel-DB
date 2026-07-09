# Data Model & Build Phases

This document describes the Firestore data model (top-level collections, sub-collections, and denormalized fields) and the build-phase status of the HPM Intranet HR application.

## Firestore Data Model

**Top-level collections:** `employees`, `users`, `roleTypes`, `companies`, `jobPositions`, `departments`, `educationLevels`, `alerts`, `notifications`, `shiftPlans`, `vacationRequests`, `payrollPeriods`, `auditLog`, `hotels`, `handoverWarnings`, `settings`

**Sub-collections under `employees/{id}`:** `documents`, `contact`, `employment`, `benefits`, `contracts`

**Sub-collections under `hotels/{hotelSlug}`** (Recepce; `hotelSlug` ∈ `ambiance`, `superior`, `amigo-alqush`, `ankora` — see [Recepce](recepce.md)):

| Path | Purpose |
|---|---|
| `hotels/{slug}/shiftHandovers/{shiftDate}_{shiftType}` | Předávací protokol per shift (`den`\|`noc`); each doc has its own `history` subcollection for element-level change history + undo/redo. |
| `hotels/{slug}/walkins/{autoId}` | Walk-in sale entries. |
| `hotels/{slug}/taxiRides/{autoId}` | Taxi ride entries. |
| `hotels/{slug}/config/walkins`, `hotels/{slug}/config/taxi` | Per-hotel visible date range (`{ from, to }`) that `walkiny.manage`/`taxi.manage` set to bound non-manager visibility. |

`handoverWarnings/{hotel}_{shiftDate}_{shiftType}` — "Nenavazující předání" flags
(a handover chain break), surfaced on the Upozornění hub. `settings/sm` and
`settings/taxiRoutes` hold the two GLOBAL (all-hotels) Recepce config docs — the
shared sm rates and the shared taxi routes ceník, respectively.

The `benefits` sub-doc carries the insurance/bank/Multisport fields plus `nepodepiseProhlaseni: boolean` ("Nepodepíše prohlášení poplatníka" — drives the "Nepodepsané prohlášení" banner on the employee detail page) and `zaucovani: boolean` + `zaucovaniDo: string` (YYYY-MM-DD) — the "Zaučování" (training) flag and its end date, which drive a "Zaučování" banner that auto-hides once `zaucovaniDo` passes. **`zaucovani` + `zaucovaniDo` are also denormalized onto the root `employees/{id}` doc** (written by the `PUT /employees/:id/benefits` handler) so the Employees list — which reads only root docs — can render the "V zácviku" badge without joining the benefits sub-doc; the badge's auto-expiry is computed live from `zaucovaniDo` on read.

**Sub-collections under `shiftPlans/{id}`:** `planEmployees`, `shifts`, `rules`, `unavailabilityRequests`, `shiftOverrideRequests`, `shiftChangeRequests`, `shiftsSnapshot`

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
