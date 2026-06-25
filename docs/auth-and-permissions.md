# Authentication, Roles & Permissions

This document covers how users authenticate (login + password reset), the **configurable permission model** that gates routes, menus, and API endpoints across the frontend/backend layers, and how the per-user-type sidebar menu order is configured and stored.

> **History.** The app originally hard-coded a fixed six-role model (`admin`/`director`/`manager`/`employee` + `accountant`/`hr`) where every gate was a `requireRole(...)`/`RequireRole` check. That has been replaced by a **configurable RBAC** model: a fixed catalogue of ~90 granular permissions, editable **user types** stored as Firestore data, and per-user grants/revokes on top. The former roles survive as **seeded built-in types** with the same effective access, so behaviour is identical until an admin edits a type. (`hr`/Personalista was later removed in v2.1.2 — see below — leaving five built-ins.)

## Auth — Login & Password Reset

**Login**: username + password. The login form accepts a bare username (e.g. `vondra`) and appends `@hotel.local` automatically. Typing a full email also works as a fallback.

Two password-reset flows using Firebase Auth built-in email:
- **Self-service**: "Zapomenuté heslo?" on login → `sendPasswordResetEmail(auth, email)`.
- **Admin-initiated**: "Resetovat heslo" button in Settings → Uživatelé → calls `sendPasswordResetEmail` from frontend with user's email. Inline feedback clears after 4 s.

## Permission model

### Permission catalogue (fixed vocabulary)

Permissions are a **fixed vocabulary of ~87 granular keys** — a catalogue, not free-form strings.

- **Backend source of truth**: `functions/src/auth/permissions.ts` (`PERMISSION_CATALOG`) — a **flat** list of `{ group, items: [{ key, label }] }`. The backend stores and validates a flat permission array and is unaware of the frontend hierarchy.
- **Frontend mirror**: `frontend/src/lib/permissions/catalog.ts` — keys must stay in sync with the backend (a manual mirror; `scripts/_smoke-permissions-hierarchy.js` asserts the two key sets are equal). Since **v2.2.0** the frontend catalogue is **hierarchical** (`PERMISSION_SECTIONS`, one section per app page) — see "Hierarchical permission matrix" below.

> **v2.2.0 — significant RBAC redesign.** The in-app matrix became a page-based **dependency hierarchy** (see below), and **six redundant keys were removed**, each folded into its `nav.X.view` master: `payroll.view`, `alerts.view`, `contractTemplates.view`, `audit.view` (the matching `nav.*` master now gates both menu/route AND the backend data endpoints + in-page sections); `self.profile.view` (was never enforced anywhere); and `masterData.view` (the číselník GETs — companies/departments/jobPositions — are now `requireAuth`-only, like `educationLevels`, so any authenticated user can read the reference lists that populate form dropdowns). A one-time data migration (`scripts/migrate-permission-keys.js`) remaps the removed keys onto their survivors across `roleTypes`, user docs, and custom claims. The catalogue went 93 → 87 keys.

### Hierarchical permission matrix (frontend, v2.2.0)

The frontend catalogue is a tree: **section → subsection → item**, where each item carries a `level` (0 = the section's `nav.X.view` master; 1–4 = nesting depth), an optional `exclusiveGroup`, and a `spaceBefore` flag. The structure is authored to match `PERMISSIONS_LIST.md` (a local working file).

- **`frontend/src/lib/permissions/hierarchy.ts`** (pure, unit-tested) drives the UI affordance: `computeEnabled` (a child checkbox is clickable only when its parent is checked), `resolveToggle` (unchecking a parent cascades its descendants off; checking a mutually-exclusive item clears its siblings), and `normalize` (**repair-upward** — on save, a child whose parent is missing gains the missing ancestors rather than being dropped, since a parent is an enabling prerequisite; mutual-exclusion conflicts resolve keep-first).
- **`frontend/src/components/permissions/PermissionMatrix.tsx`** is the shared renderer used by both editors; mutually-exclusive items render as **radio-style** controls. The hierarchy is a **frontend-only** affordance — the backend never sees it and remains the real gate (a flat-array membership check). `ALL_PERMISSIONS`, the `Permission` union, and a flat `PERMISSION_CATALOG` (group = section title) are still derived from `PERMISSION_SECTIONS` for back-compat (e.g. the Nápověda HelpPage).
- The **Systém** section's master is `system.access` ("Přístup k systémovým funkcím") — an umbrella key that is **inert server-side** (no `requirePermission` checks it); it only organises the system rights in the matrix (`system.admin`, `system.triggers`, `system.timeOverride`, `system.version.view`).
- **`system.version.view`** ("Zobrazit verzi aplikace") gates a small `vX.Y.Z` line at the bottom of the sidebar footer (`Layout.tsx`, below the test-clock control). Display-only and **inert server-side** (no `requirePermission` checks it). Admin-only by default (conferred via `system.admin`); no other built-in type holds it, but it is freely grantable per-user/type. The version string is baked into the bundle at build time — `vite.config.ts` reads `package.json` and exposes it as the `__APP_VERSION__` define (typed in `src/vite-env.d.ts`); there is no runtime API call.

The special `system.admin` permission **expands to ALL permissions** and cannot be revoked. It is also **non-grantable through the RBAC editors**: `sanitizePermissionList` (in `permissions.ts`, backed by `NON_GRANTABLE_PERMISSIONS`) strips `system.admin` from every grant path — a user type's `permissions` array (create + edit) and a per-user `extraPermissions` grant. The **only** way to confer superadmin is to assign the protected built-in `admin` type itself. This stops a delegated user-manager (a custom type holding `userTypes.manage` or `users.permissions.manage` but not `system.admin`) from editing `system.admin` onto its own type / its own user and self-escalating.

#### Dashboard permissions

| Key | Label | Granted to (built-in types) |
|---|---|---|
| `dashboard.view` | Zobrazit vlastní přehled | all types (via BASE_SELF for self-service types; explicit for accountant) |
| `dashboard.tasks.view` | Zobrazit úkoly ke schválení | director, admin (via system.admin) |
| `dashboard.stats.view` | Zobrazit statistiky personálu | director, accountant, admin |
| `dashboard.staffing.view` | Zobrazit obsazenost (sekce Dnes/Zítra) | director, manager, employee, admin |

**`dashboard.staffing.view`** gates the DNES / ZÍTRA staffing sections on the Přehled (`/prehled`) page (the blocks that show employees scheduled for day/night shifts and managers on vacation). It is deliberately **not** granted to `accountant` (finance viewer — those sections are operational, not financial). `admin` receives it via `system.admin` expansion.

> **Deploy note:** `dashboard.staffing.view` was added as a new permission key. When deployed to an environment where the built-in `roleTypes` docs already exist in Firestore, those docs' `permissions` arrays won't contain the key, so the Dnes/Zítra sections will be **hidden for existing users** until it is backfilled. Backfill **additively** — either add the permission to each affected type in-app (Nastavení → Uživatelské typy), or run a targeted `arrayUnion` of just this key onto `director`, `manager`, `employee`, and `hr`. Do **not** re-run `seed-role-types.js` to fix this: it overwrites each type's whole `permissions` array from `BUILTIN_TYPE_PERMISSIONS`, discarding any in-app permission customisations. `admin` needs no backfill (`system.admin` expansion), and a type with no Firestore doc at all falls back to `BUILTIN_TYPE_PERMISSIONS`, which already includes the key.

#### Users & permissions group

| Key | Label | Granted to (built-in types) |
|---|---|---|
| `users.view` | Zobrazit uživatele | director, admin |
| `users.manage` | Spravovat uživatele (vytvořit/upravit/deaktivovat) | admin |
| `users.linkEmployee` | Propojit zaměstnance s účtem | admin (via `system.admin`) |
| `users.setType` | Přiřadit typ uživatele | admin |
| `users.permissions.manage` | Spravovat individuální oprávnění uživatele | admin |
| `userTypes.manage` | Spravovat typy uživatelů | admin |

**`users.linkEmployee`** gates `PATCH /api/auth/users/:uid/employee` (linking or unlinking an employee record to a user account). It was previously covered by `users.manage`; it is now a separate key so the ability to link employees can be delegated independently. `admin` receives it via `system.admin` expansion.

> **Deploy note:** `users.linkEmployee` was introduced as a new key. Existing `roleTypes` docs in Firestore will not contain it, so the employee-link dropdown in Settings → Uživatelé will be hidden for those types. Backfill **additively** — add it to any type that previously relied on `users.manage` to link employees, using Nastavení → Uživatelské typy. Do **not** re-run `seed-role-types.js`; it overwrites each type's whole `permissions` array. `admin` needs no backfill (`system.admin` expansion).

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

Five built-ins are seeded: `admin`, `director`, `manager`, `employee`, `accountant`. (A sixth, `hr`/Personalista, was seeded historically but **removed in v2.1.2** — it was unused, with no assigned users and no `roleTypes/hr` doc on any environment. The non-management record-scoping capability it exercised stays available to any custom type via `employees.view.nonManagement` + `management: false`.)

- **Only `admin` is `system: true`** — protected: it can't be edited or deleted and always has all permissions.
- The other four (`director`, `manager`, `employee`, `accountant`) are **fully editable AND deletable**.
- **`management: true`** means holders count as "management" for employee-record scoping (this replaces the old hard-coded admin/director/manager list). Built-ins `admin`/`director`/`manager` are management; `employee`/`accountant` are not.

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
  - ⚠️ `contractsRouter` is mounted at the **app root** (`app.use("/", contractsRouter)`) because its routes span two prefixes with no common base (`/contracts/render-pdf` and `/employees/:id/contracts/...`). A router-level guard therefore runs for **every** request in the app, so **both** of the router's guards short-circuit on non-contract paths via `isContractPath()` and only govern the router's own contract endpoints: `enforceContractAccess` (added v2.1.1 — without it, any non-GET from callers lacking a contract-write permission was rejected app-wide: vacation, self-service change requests, shifts, …; latent until the first low-privilege employee logins existed) and `requireAuth` (extended v2.1.2 — without it the root-mounted `requireAuth` 401-gated the public `GET /health` and double-authenticated every request to routers mounted after the contracts router).
- A **non-management-scoped caller** — one who holds `employees.view.nonManagement` but NOT `employees.view.all` (e.g. a custom non-management type) — is blocked from any record whose linked login's **type is management**. The list + export handlers filter management records out for such callers.
- `getManagementEmployeeIds` resolves each user's type (`roleType`) against the per-type `management` flag.

## Frontend

`useAuth` exposes **`can(permission)`** plus the effective permission set, loaded from `GET /auth/me` (which now returns a `permissions` array).

- **Routes (`frontend/src/App.tsx`)** — `<RequirePermission allow={[…]}>` wraps each route (replacing `RequireRole`), gated by `nav.*` / capability permissions. Unauthorized users redirect to `/`. A `DefaultRedirect` still lands each user on the first page they can open.
- **Menu** — `frontend/src/lib/menuItems.ts` items each carry a `permission`; the sidebar renders via `resolveOrderByPermission(can, savedOrder)`, which drops items the user lacks the permission for.
- The old role-helper module `frontend/src/lib/permissions.ts` was **removed**; scattered role checks are replaced by `can()`.

The route guard is the source of truth — the menu is just for discoverability. Backend endpoints are the final gate regardless.

## Admin UI — managing types & per-user permissions

### Settings → Uživatelské typy

Visible to users who can manage types (`userTypes.manage`). Lists all user types with badges (**systém** / **vedení** / **počet oprávnění**). Selecting a type shows the **hierarchical permission matrix** (page-based sections with dependency gating; see "Hierarchical permission matrix" above), plus a **"Vedení"** (management) toggle and the type name.

- **Create** a new type by cloning an existing one or starting blank ("Prázdný (bez práv)", behind a confirmation).
- **Delete** a type — except the system **"Administrátor"** type (blocked), and a type still assigned to users can't be deleted until those users are reassigned.
- The **Administrátor** type is **read-only** (matrix rendered all-on, locked).
- The matrix (`PermissionMatrix`, shared with the per-user modal) renders `system.admin` **disabled** in its Systém section — it can't be granted, only conferred by assigning the `admin` type; the backend strips it regardless. On save, the type's set is `normalize()`d (repair-upward + exclusivity).

### Settings → Uživatelé → per-user "Oprávnění"

The per-user **"Oprávnění"** button lets an admin choose the user's **type** from a dropdown and fine-tune individual permissions on top of it. Ticking/unticking a box that differs from the type is saved as an individual **grant/revoke** (marked ●). It uses the same hierarchical `PermissionMatrix` (single-column, scrollable in the modal): the dependency cascade runs on the **effective** set (`baseline ∪ extra − revoked`), then re-decomposes into `extra = next − baseline` / `revoked = baseline − next` — so cascading off a type-inherited permission becomes a revoke (●), while removing a per-user grant just drops it.

**`users.setType` vs `users.permissions.manage` are enforced separately.** `PATCH /api/auth/users/:uid/permissions` is reachable with *either* permission, but they are not equivalent: changing a user's **`roleType`** is the lower-trust action (`users.setType`), while writing per-user **`extraPermissions`/`revokedPermissions`** is the higher-trust one and requires **`users.permissions.manage`** specifically. A caller holding only `users.setType` may change the type but the backend rejects (403) any attempt to write grants/revokes; the frontend mirrors this — the permission matrix in the modal is **read-only** for such a caller and `save()` sends only `roleType`. (Previously the OR-gate honoured grant/revoke fields from a setType-only caller, which let them self-grant anything — now closed.)

**Token revocation on type/permission change (v3.2.1).** After writing the new claims, `PATCH /auth/users/:uid/permissions` calls `admin.auth().revokeRefreshTokens(uid)`. The user can no longer obtain a fresh ID token after their current one expires (≤ 1 h). `requireAuth` does **not** use `checkRevoked` — the caller's existing ID token still verifies until it expires — so a downgraded user has up to one hour of residual access. This is an intentional tradeoff: per-request revocation checks add a round-trip to Firestore and were considered too expensive. The window is bounded by token TTL.

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
| `PATCH /api/auth/users/:uid/permissions` | Assign a user's type + grants/revokes | `users.setType` (type only) **or** `users.permissions.manage` (type + grants/revokes); writing `extraPermissions`/`revokedPermissions` requires `users.permissions.manage` specifically (403 otherwise); `system.admin` is stripped from grants; writes merged claims + mirrors to `users/{uid}`; enforces own-admin / last-admin lockout guards; **calls `revokeRefreshTokens`** after writing (v3.2.1) |
| `PATCH /api/auth/deactivate-user/:uid` | Disable a user account | `users.manage`; sets `disabled: true` in Firebase Auth + `active: false` in Firestore; **calls `revokeRefreshTokens`** so the disabled account can't silently refresh into a new session (v3.2.1) |
| `POST /api/auth/create-user` | Create a new user account | `users.manage`; if `employeeId` is supplied in the body, also requires `users.linkEmployee` (or `system.admin`) — a `users.manage` holder without `users.linkEmployee` receives 403 when they include `employeeId` (v3.2.1) |
| `PATCH /api/auth/users/:uid/employee` | Link or unlink an employee record to a user | `users.linkEmployee`; body `{ employeeId: string \| null }` |
| `GET /api/auth/users` | List all users | `users.view`; each entry includes `roleTypeName` and `employeeName` (see below) |
| `GET /api/auth/me` | Returns the resolved `permissions` array (plus the user profile, including `roleTypeName`) | authenticated |

**Seeding** — `scripts/seed-role-types.js` seeds the six built-ins (additive; the resolver falls back to the built-ins if unseeded).

### `GET /api/auth/users` — resolved display names

The user-list endpoint returns each user with two server-resolved display fields (in addition to the raw `roleType`/`employeeId` values):

- **`roleTypeName`** — the Czech display name of the user's type, resolved from `roleTypes/{id}.name`. Falls back to the raw type id if the doc is missing.
- **`employeeName`** — the linked employee's surname-first name (`${lastName} ${firstName}`), resolved via `admin.firestore().getAll(...)` regardless of the employee's `status` and regardless of whether the viewer has `employees.view.*` access.

Both fields are resolved server-side so the Settings → Uživatelé tab shows readable type and linked-employee labels for any viewer holding only `users.view`, even if they lack access to the `roleTypes` collection or the employees list.

**Type column in Settings → Uživatelé:** if the viewer holds `users.setType` or `users.permissions.manage`, the type column renders as an editable `<select>`. Otherwise it renders as a static `<span>` showing `roleTypeName` (with a fallback to the resolved name from the locally-loaded types list, then the raw id). No editability bleeds through to users who lack the relevant permissions.

**Per-row action buttons in Settings → Uživatelé (2026-06-17):** each action is gated by its own permission so a `users.view`-only viewer sees a read-only row — **Upravit** (edit name + e-mail), **Deaktivovat/Aktivovat**, and **Resetovat heslo** require `users.manage`; **Oprávnění** (type + per-user permissions) requires `users.setType` or `users.permissions.manage`; **Propojit/Zrušit** (link employee) requires `users.linkEmployee`. The backend already enforces all of these — this is defense-in-depth that stops showing affordances that would otherwise 403 (notably "Resetovat heslo", which fires a client-side `sendPasswordResetEmail` rather than a gated endpoint).

## Per-type menu order

Settings → **Menu** (admin-only) lets admin configure the sidebar order independently for each **user type**. Each type renders as a card showing the items that type can see (its permissions), with ▲▼ buttons to reorder, plus a "Kopírovat z…" dropdown that overwrites the draft with another type's order (filtered to ids the target type can access). Single Uložit commits all lists.

**Storage** — `settings/menuOrder` Firestore doc keyed by **user-type id** (`{ <typeId>: [...ids] }`). Built-in type ids equal the old role names, so pre-existing per-role data maps over unchanged. Saved on every PUT through the audit log.

**Registry** — `frontend/src/lib/menuItems.ts` is the single source of truth for sidebar items (id, label, path, and the `permission` that gates them). When adding a new menu item, register it here and add the matching `<Route>` in `App.tsx` — the sidebar appends new items at the end of any saved order automatically. The backend (`functions/src/routes/menuOrder.ts`) validates that saved orders reference only real item ids; per-type *visibility* is enforced by the sidebar itself, so it isn't re-checked there.

**Layout consumption** — `frontend/src/components/Layout.tsx` calls `GET /api/settings/menu-order/me` on mount and resolves the order via `resolveOrderByPermission(can, savedOrder)`, which drops items the user lacks the permission for and appends any allowed items missing from the saved list. Falls back to the registry's default declaration order when none is saved. The configurator (`MenuOrderTab`) reuses the same resolver with a per-type `can`. Badges (Směny, Dovolená, Upozornění) are still resolved per-id.

**Endpoints**:
- `GET /api/settings/menu-order` — admin only; returns the full per-type map.
- `GET /api/settings/menu-order/me` — any authenticated user; returns just their **type's** order (keyed by `req.roleType`), or `null` for default.
- `PUT /api/settings/menu-order` — admin only; per-type-id arrays of valid item ids (unknown ids dropped, de-duplicated); audit-logged.
