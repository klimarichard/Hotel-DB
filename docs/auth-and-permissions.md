# Authentication, Roles & Permissions

This document covers how users authenticate (login + password reset), the **configurable permission model** that gates routes, menus, and API endpoints across the frontend/backend layers, and how the per-user-type sidebar menu order is configured and stored.

> **History.** The app originally hard-coded a fixed six-role model (`admin`/`director`/`manager`/`employee` + `accountant`/`hr`) where every gate was a `requireRole(...)`/`RequireRole` check. That has been replaced by a **configurable RBAC** model: a fixed catalogue of ~90 granular permissions, editable **user types** stored as Firestore data, and per-user grants/revokes on top. The six former roles survive as **seeded built-in types** with the same effective access, so behaviour is identical until an admin edits a type.

## Auth — Login & Password Reset

**Login**: username + password. The login form accepts a bare username (e.g. `vondra`) and appends `@hotel.local` automatically. Typing a full email also works as a fallback.

Two password-reset flows using Firebase Auth built-in email:
- **Self-service**: "Zapomenuté heslo?" on login → `sendPasswordResetEmail(auth, email)`.
- **Admin-initiated**: "Resetovat heslo" button in Settings → Uživatelé → calls `sendPasswordResetEmail` from frontend with user's email. Inline feedback clears after 4 s.

## Permission model

### Permission catalogue (fixed vocabulary)

Permissions are a **fixed vocabulary of ~90 granular keys** — a catalogue, not free-form strings. Keys are grouped by area: navigation, employees, sensitive data, employment, contracts, documents, benefits, payroll, shifts, vacation, alerts, change-requests, audit, dashboard, master-data/settings, users, system, and self-profile.

- **Backend source of truth**: `functions/src/auth/permissions.ts` (`PERMISSION_CATALOG`).
- **Frontend mirror**: `frontend/src/lib/permissions/catalog.ts` — the keys must stay in sync with the backend catalogue.

The special `system.admin` permission **expands to ALL permissions** and cannot be revoked.

#### Dashboard permissions

| Key | Label | Granted to (built-in types) |
|---|---|---|
| `dashboard.view` | Zobrazit vlastní přehled | all types (via BASE_SELF for self-service types; explicit for accountant) |
| `dashboard.tasks.view` | Zobrazit úkoly ke schválení | director, admin (via system.admin) |
| `dashboard.stats.view` | Zobrazit statistiky personálu | director, accountant, admin |
| `dashboard.staffing.view` | Zobrazit obsazenost (sekce Dnes/Zítra) | director, manager, employee, hr, admin |

**`dashboard.staffing.view`** gates the DNES / ZÍTRA staffing sections on the Přehled (`/prehled`) page (the blocks that show employees scheduled for day/night shifts and managers on vacation). It is deliberately **not** granted to `accountant` (finance viewer — those sections are operational, not financial). `admin` receives it via `system.admin` expansion.

> **Deploy note:** `dashboard.staffing.view` was added as a new permission key. When deployed to an environment where the built-in `roleTypes` docs already exist in Firestore, those docs' `permissions` arrays won't contain the key, so the Dnes/Zítra sections will be **hidden for existing users** until it is backfilled. Backfill **additively** — either add the permission to each affected type in-app (Nastavení → Uživatelské typy), or run a targeted `arrayUnion` of just this key onto `director`, `manager`, `employee`, and `hr`. Do **not** re-run `seed-role-types.js` to fix this: it overwrites each type's whole `permissions` array from `BUILTIN_TYPE_PERMISSIONS`, discarding any in-app permission customisations. `admin` needs no backfill (`system.admin` expansion), and a type with no Firestore doc at all falls back to `BUILTIN_TYPE_PERMISSIONS`, which already includes the key.

### User types (editable data)

What used to be hard-coded roles are now **editable user types** stored in Firestore at `roleTypes/{id}`:

```
roleTypes/{id} = {
  name: string,            // display label, e.g. "Ředitel"
  permissions: string[],   // permission keys this type grants
  management: boolean,      // holders count as "management" for record scoping
  system: boolean           // protected built-in (only `admin`)
}
```

Six built-ins are seeded: `admin`, `director`, `manager`, `employee`, `accountant`, `hr`.

- **Only `admin` is `system: true`** — protected: it can't be edited or deleted and always has all permissions.
- The other five (`director`, `manager`, `employee`, `accountant`, `hr`) are **fully editable AND deletable**.
- **`management: true`** means holders count as "management" for employee-record scoping (this replaces the old hard-coded admin/director/manager list). Built-ins `admin`/`director`/`manager` are management; `employee`/`accountant`/`hr` are not.

### Per-user assignment & overrides

Each user document (and their custom claims) carries:

- **`roleType`** — the type id. Every user has one (it is the sole identity for authorization).
- **`extraPermissions[]`** — per-user grants (added on top of the type).
- **`revokedPermissions[]`** — per-user revokes (subtracted from the type).

**Effective set** = `roleType.permissions ∪ extraPermissions − revokedPermissions`. `system.admin` expands to everything and can never be revoked.

`roleType`/`extraPermissions`/`revokedPermissions` are **custom claims** set via `setCustomUserClaims` (merged, not replaced). They take effect on the **next token refresh** (≤ 1 h, or on re-login). (A legacy `role` claim may still be present on older accounts but is **no longer read** for authorization.)

### Resolution & fallback (backend)

`resolveEffectivePermissions({ roleType, extra, revoked })` keys off the **`roleType`** claim only and reads the `roleTypes` collection through a **per-instance 60 s TTL cache**, then applies the per-user overrides.

When a `roleType` doc is missing or Firestore is unreachable it **falls back to the built-in type defaults** (`BUILTIN_TYPE_PERMISSIONS`, keyed by the built-in type id). So a seeding gap or an outage never locks anyone out, and behaviour is identical to the built-ins until an admin edits a type.

## Enforcement (backend is the real gate)

`requireAuth` resolves the effective permission set **once per request** and attaches it as `req.permissions`. `requirePermission(...perms)` passes if the caller holds **ANY** of the listed permissions (or `system.admin`). **Every backend route now uses `requirePermission`** in place of the old `requireRole`.

The endpoint→permission mapping is **aligned to the UI**. Where the API was historically broader than the UI, it was tightened:
- **accountant** is read-only on employees/contracts;
- **hr** is read-only on the shift plan;
- **manager** has no contract access and can't edit MOD or approve shift requests;
- **director** doesn't self-submit shift requests.

### Row-level scope

A second layer is still applied at the router level on `employees.ts` and `contracts.ts` (`enforceEmpAccess` / `enforceContractAccess`):

- **read-only viewers** (callers holding no write permission for the resource, e.g. built-in `accountant`) are blocked from any mutation — a **permission-based** safety net (contracts: any non-GET requires one of `contracts.generate/edit/delete/sign`), not a role check.
- A **non-management-scoped caller** — one who holds `employees.view.nonManagement` but NOT `employees.view.all` (e.g. built-in `hr`) — is blocked from any record whose linked login's **type is management**. The list + export handlers filter management records out for such callers.
- `getManagementEmployeeIds` resolves each user's type (`roleType`) against the per-type `management` flag.

## Frontend

`useAuth` exposes **`can(permission)`** plus the effective permission set, loaded from `GET /auth/me` (which now returns a `permissions` array).

- **Routes (`frontend/src/App.tsx`)** — `<RequirePermission allow={[…]}>` wraps each route (replacing `RequireRole`), gated by `nav.*` / capability permissions. Unauthorized users redirect to `/`. A `DefaultRedirect` still lands each user on the first page they can open.
- **Menu** — `frontend/src/lib/menuItems.ts` items each carry a `permission`; the sidebar renders via `resolveOrderByPermission(can, savedOrder)`, which drops items the user lacks the permission for.
- The old role-helper module `frontend/src/lib/permissions.ts` was **removed**; scattered role checks are replaced by `can()`.

The route guard is the source of truth — the menu is just for discoverability. Backend endpoints are the final gate regardless.

## Admin UI — managing types & per-user permissions

### Settings → Uživatelské typy

Visible to users who can manage types (`userTypes.manage`). Lists all user types with badges (**systém** / **vedení** / **počet oprávnění**). Selecting a type shows an **editable matrix of permissions grouped by area**, plus a **"Vedení"** (management) toggle and the type name.

- **Create** a new type by cloning an existing one or starting blank ("Prázdný (bez práv)", behind a confirmation).
- **Delete** a type — except the system **"Administrátor"** type (blocked), and a type still assigned to users can't be deleted until those users are reassigned.
- The **Administrátor** type is **read-only**.

### Settings → Uživatelé → per-user "Oprávnění"

The per-user **"Oprávnění"** button lets an admin choose the user's **type** from a dropdown and fine-tune individual permissions on top of it. Ticking/unticking a box that differs from the type is saved as an individual **grant/revoke** (marked ●).

Guards: you **can't remove your own administrator rights**, and the **last administrator can't be demoted**.

> **Legacy `role` — fully retired (2026-06-04).** There are no roles; authorization is purely the permission set, keyed off the user **type**. The per-user `role` fallback is **gone**: `requireAuth` sets `req.roleType` from the `roleType` claim only (no `?? role`), `req.role` no longer exists, the resolver's `id = roleType`, `getManagementEmployeeIds` reads `roleType` only, and the legacy `POST /auth/set-role` endpoint + the create-user `role` param were removed. **Prerequisite that made this safe:** every user's `roleType` **claim** was backfilled first (`scripts/backfill-roletype-claim.js`, additive `setCustomUserClaims` merge) — the earlier doc-only backfill didn't touch claims, and the runtime gates on the claim. The audit log now records the actor's `roleType` (stored field name kept as `userRole`). What stays of the old role concept is the **built-in type machinery**, renamed so it no longer reads as gating: `BUILTIN_TYPE_PERMISSIONS` (was `BUILTIN_ROLE_PERMISSIONS`) + `BUILTIN_TYPE_MANAGEMENT` + the `BuiltinTypeId` union (was `UserRole`) — these are the seed source for the built-in types and the resolver's anti-lockout fallback, **not** a per-user role.

## Inverse permission gating (`excludeIfPermission` pattern)

Some UI sections are redundant for users who already hold a superseding permission. Rather than creating a separate lower-privilege permission or hard-coding role checks, the codebase uses an **inverse gate**: show content only when the user does NOT hold a given permission.

Examples:
- `VacationPage.tsx` — "Schválené dovolené (všichni zaměstnanci)" is hidden (and its fetch skipped) for `vacation.view.all` holders, because "Všechny žádosti" already shows every approved request.
- The onboarding tour uses `TourStep.excludeIfPermission` with the same semantics — see `docs/onboarding-and-help.md` for details.

When adding a new UI section, check whether it is a subset of something a higher-privilege user already sees before adding a separate permission. If it is, apply this pattern (`&& !can("superseding.permission")`) rather than gating by a narrower permission alone.

## Endpoints

| Endpoint | Purpose | Gate |
|---|---|---|
| `GET/POST/PATCH/DELETE /api/role-types` | Manage user types | `userTypes.manage` (list also allowed for `users.setType`); `DELETE` blocks the system type and any in-use type |
| `PATCH /api/auth/users/:uid/permissions` | Assign a user's type + grants/revokes | `users.permissions.manage` / `users.setType`; writes merged claims + mirrors to `users/{uid}`; enforces own-admin / last-admin lockout guards |
| `GET /api/auth/me` | Returns the resolved `permissions` array (plus the user profile) | authenticated |

**Seeding** — `scripts/seed-role-types.js` seeds the six built-ins (additive; the resolver falls back to the built-ins if unseeded).

## Per-type menu order

Settings → **Menu** (admin-only) lets admin configure the sidebar order independently for each **user type**. Each type renders as a card showing the items that type can see (its permissions), with ▲▼ buttons to reorder, plus a "Kopírovat z…" dropdown that overwrites the draft with another type's order (filtered to ids the target type can access). Single Uložit commits all lists.

**Storage** — `settings/menuOrder` Firestore doc keyed by **user-type id** (`{ <typeId>: [...ids] }`). Built-in type ids equal the old role names, so pre-existing per-role data maps over unchanged. Saved on every PUT through the audit log.

**Registry** — `frontend/src/lib/menuItems.ts` is the single source of truth for sidebar items (id, label, path, and the `permission` that gates them). When adding a new menu item, register it here and add the matching `<Route>` in `App.tsx` — the sidebar appends new items at the end of any saved order automatically. The backend (`functions/src/routes/menuOrder.ts`) validates that saved orders reference only real item ids; per-type *visibility* is enforced by the sidebar itself, so it isn't re-checked there.

**Layout consumption** — `frontend/src/components/Layout.tsx` calls `GET /api/settings/menu-order/me` on mount and resolves the order via `resolveOrderByPermission(can, savedOrder)`, which drops items the user lacks the permission for and appends any allowed items missing from the saved list. Falls back to the registry's default declaration order when none is saved. The configurator (`MenuOrderTab`) reuses the same resolver with a per-type `can`. Badges (Směny, Dovolená, Upozornění) are still resolved per-id.

**Endpoints**:
- `GET /api/settings/menu-order` — admin only; returns the full per-type map.
- `GET /api/settings/menu-order/me` — any authenticated user; returns just their **type's** order (keyed by `req.roleType`), or `null` for default.
- `PUT /api/settings/menu-order` — admin only; per-type-id arrays of valid item ids (unknown ids dropped, de-duplicated); audit-logged.
