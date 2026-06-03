# Authentication, Roles & Permissions

This document covers how users authenticate (login + password reset), the **configurable permission model** that gates routes, menus, and API endpoints across the frontend/backend layers, and how the per-role sidebar menu order is configured and stored.

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

- **`roleType`** — the type id. Defaults to the legacy `role` when unset.
- **`extraPermissions[]`** — per-user grants (added on top of the type).
- **`revokedPermissions[]`** — per-user revokes (subtracted from the type).

**Effective set** = `roleType.permissions ∪ extraPermissions − revokedPermissions`. `system.admin` expands to everything and can never be revoked.

`roleType`/`extraPermissions`/`revokedPermissions` are **optional custom claims** set via `setCustomUserClaims` (merged, not replaced) alongside the still-present legacy `role` claim. They take effect on the **next token refresh** (≤ 1 h, or on re-login).

### Resolution & fallback (backend)

`resolveEffectivePermissions` reads the `roleTypes` collection through a **per-instance 60 s TTL cache** and applies the per-user overrides.

It **always falls back to the built-in role→permission mapping** when a `roleType` doc is missing or Firestore is unreachable. So a seeding gap or an outage never locks anyone out, and behaviour is identical to the built-ins until an admin edits a type.

## Enforcement (backend is the real gate)

`requireAuth` resolves the effective permission set **once per request** and attaches it as `req.permissions`. `requirePermission(...perms)` passes if the caller holds **ANY** of the listed permissions (or `system.admin`). **Every backend route now uses `requirePermission`** in place of the old `requireRole`.

The endpoint→permission mapping is **aligned to the UI**. Where the API was historically broader than the UI, it was tightened:
- **accountant** is read-only on employees/contracts;
- **hr** is read-only on the shift plan;
- **manager** has no contract access and can't edit MOD or approve shift requests;
- **director** doesn't self-submit shift requests.

### Row-level scope

A second layer is still applied at the router level on `employees.ts` and `contracts.ts` (`enforceEmpAccess` / `enforceContractAccess`):

- **accountant write-block** — a safety net against any mutation.
- A **non-management-scoped caller** — one who holds `employees.view.nonManagement` but NOT `employees.view.all` (e.g. built-in `hr`) — is blocked from any record whose linked login's **type is management**. The list + export handlers filter management records out for such callers.
- `getManagementEmployeeIds` resolves each user's type (`roleType ?? role`) against the per-type `management` flag.

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

> **Transitional note.** The backend is now **fully permission-based** — all handler-internal checks read the effective permission set (`req.permissions`) and `requireRole` is gone. The legacy `role` field is still **retained** on the frontend/data side: it drives the per-role menu-order configurator (Settings → Menu), the sidebar user label, and serves as the `roleType` default + the `getManagementEmployeeIds` fallback. So the user-row **role dropdown remains alongside the new "Oprávnění" button** for now; full retirement of `role` (per-type menu config + a `roleType=role` user migration) is future cleanup. The permissions a user actually has come from the type + individual overrides, not the legacy dropdown.

## Endpoints

| Endpoint | Purpose | Gate |
|---|---|---|
| `GET/POST/PATCH/DELETE /api/role-types` | Manage user types | `userTypes.manage` (list also allowed for `users.setType`); `DELETE` blocks the system type and any in-use type |
| `PATCH /api/auth/users/:uid/permissions` | Assign a user's type + grants/revokes | `users.permissions.manage` / `users.setType`; writes merged claims + mirrors to `users/{uid}`; enforces own-admin / last-admin lockout guards |
| `GET /api/auth/me` | Returns the resolved `permissions` array (plus the user profile) | authenticated |

**Seeding** — `scripts/seed-role-types.js` seeds the six built-ins (additive; the resolver falls back to the built-ins if unseeded).

## Per-role menu order

Settings → **Menu** (admin-only) lets admin configure the sidebar order independently for each **role** — the menu-order configurator is still keyed by the **legacy `role`** (see the transitional note above), not by user type. The roles render side-by-side as cards; each card shows the role's items with ▲▼ buttons to reorder, plus a "Kopírovat z…" dropdown that overwrites the draft with another role's order (filtered to ids the target role can access — e.g., copying admin → employee drops `nastaveni` because employee can't see it). Single Uložit at the bottom of the tab commits all lists.

**Storage** — `settings/menuOrder` Firestore doc with shape `{ admin: [...ids], director: [...], manager: [...], employee: [...] }`. Saved on every PUT through the audit log.

**Registry** — `frontend/src/lib/menuItems.ts` is the single source of truth for sidebar items (id, label, path, and the `permission` that gates them). When adding a new menu item, register it here and add the matching `<Route>` in `App.tsx` — the sidebar appends new items at the end of any saved order automatically, so existing orderings don't need backfilling. The backend mirrors this list (validates ids + role permissions on PUT) at `functions/src/routes/menuOrder.ts`.

**Layout consumption** — `frontend/src/components/Layout.tsx` calls `GET /api/settings/menu-order/me` once on mount and resolves the order via `resolveOrderByPermission(can, savedOrder)`, which drops items the user lacks the permission for and appends any allowed items missing from the saved list. Falls back to the registry's default declaration order when no order is saved. Badges (Směny, Dovolená, Upozornění) are still resolved per-id.

**Endpoints**:
- `GET /api/settings/menu-order` — admin only; returns the full map.
- `GET /api/settings/menu-order/me` — any authenticated user; returns just their role's order (or `null` for default).
- `PUT /api/settings/menu-order` — admin only; validated against the registry (ids must exist, must be allowed for the target role); audit-logged.
