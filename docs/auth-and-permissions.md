# Authentication, Roles & Permissions

This document covers how users authenticate (login + password reset), how the six roles gate routes and menus across the frontend/backend layers, and how the per-role sidebar menu order is configured and stored.

## Auth — Login & Password Reset

**Login**: username + password. The login form accepts a bare username (e.g. `vondra`) and appends `@hotel.local` automatically. Typing a full email also works as a fallback.

Two password-reset flows using Firebase Auth built-in email:
- **Self-service**: "Zapomenuté heslo?" on login → `sendPasswordResetEmail(auth, email)`.
- **Admin-initiated**: "Resetovat heslo" button in Settings → Uživatelé → calls `sendPasswordResetEmail` from frontend with user's email. Inline feedback clears after 4 s.

### Route & menu role gating

Six roles: `admin` → `director` → `manager` → `employee`, plus `accountant` (Účetní) and `hr` (Personalista) added 2026-05-21. Visibility is enforced in three layers; the backend is the real gate:

- **Menu** — `frontend/src/lib/menuItems.ts` is the single registry; each item lists the roles that see it, and `Layout.tsx` renders the per-role (optionally reordered) list.
- **Routes (`frontend/src/App.tsx`)** — `RequireRole allow={[…]}` wraps each route; unauthorized roles redirect to `/`. A role-aware `DefaultRedirect` lands each role on its first accessible page (the fallback must be a page the role can open, or the redirect loops). Allow lists:
  - `/prehled`: admin, director, manager, employee, hr, accountant (accountant sees a **stats-only** dashboard — see below)
  - `/smeny`: admin, director, manager, employee, hr
  - `/dovolena`: admin, director, manager, employee, hr (hr in employee-mode — request own + see others' approved, no approve/reject)
  - `/muj-profil`: admin, director, manager, employee, hr (NOT accountant — no own record to manage)
  - `/zamestnanci`, `/zamestnanci/:id`: admin, director, accountant, hr
  - `/zamestnanci/novy`, `/zamestnanci/:id/upravit`: admin, director, hr (accountant is read-only)
  - `/mzdy`, `/smlouvy`, `/upozorneni`, `/audit`: admin, director
  - `/nastaveni`: admin only

The route guard is the source of truth — the menu is just for discoverability. Backend endpoints are the final gate regardless.

#### accountant + hr roles (2026-05-21)

Two function-only roles (no per-hotel scoping; access is code-set):
- **accountant (Účetní)** — read-only viewer of ALL employees incl. sensitive-field reveal, per-employee contract download, and bulk CSV export. No editing. Lands on a read-only **Přehled** HR-stats dashboard (headcount / ages / nationalities / positions via `/stats/headcount`; the shift-staffing sections are hidden — accountant has no shifts access). No `Můj profil`.
- **hr (Personalista)** — full employee + per-employee contract management, full shifts, dashboard, and employee-mode vacation, **except** records whose linked login is admin/director/manager (hidden from the list; detail/sub-resource/contract endpoints 403).

Backend enforcement is **centralised, not per-route**: `employees.ts` and `contracts.ts` apply `requireAuth` at the router level plus an `enforceEmpAccess` / `enforceContractAccess` guard — accountant is blocked from any mutation; hr is blocked from any record in `getManagementEmployeeIds()` (employees linked to an admin/director/manager user). The list + export handlers filter management records out for hr; `shifts.ts` grants hr full access. Frontend capability helpers live in `frontend/src/lib/permissions.ts`.

The config-catalogue list GETs `/departments`, `/jobPositions`, `/educationLevels`, and `/stats/headcount` are open to the employee-viewing roles (admin/director/hr/accountant — `/stats/headcount` excludes hr) so hr can pick a department/position when adding a contract and accountant can render the stats dashboard; catalogue **mutations** stay admin/director.

## Per-role menu order

Settings → **Menu** (admin-only) lets admin configure the sidebar order independently for each of the four roles. The four roles render side-by-side as cards; each card shows the role's items with ▲▼ buttons to reorder, plus a "Kopírovat z…" dropdown that overwrites the draft with another role's order (filtered to ids the target role can access — e.g., copying admin → employee drops `nastaveni` because employee can't see it). Single Uložit at the bottom of the tab commits all four lists.

**Storage** — `settings/menuOrder` Firestore doc with shape `{ admin: [...ids], director: [...], manager: [...], employee: [...] }`. Saved on every PUT through the audit log.

**Registry** — `frontend/src/lib/menuItems.ts` is the single source of truth for sidebar items (id, label, path, allowed roles). When adding a new menu item, register it here and add the matching `<Route>` in `App.tsx` — the sidebar appends new items at the end of any saved order automatically, so existing orderings don't need backfilling. The backend mirrors this list (validates ids + role permissions on PUT) at `functions/src/routes/menuOrder.ts`.

**Layout consumption** — `frontend/src/components/Layout.tsx` calls `GET /api/settings/menu-order/me` once on mount and runs `resolveOrderForRole(role, savedOrder)`, which drops forbidden/unknown ids and appends any allowed items missing from the saved list. Falls back to the registry's default declaration order when no order is saved. The three previous hardcoded arrays (`navItems` / `staffItems` / `adminItems`) are gone — replaced by one flat list keyed by item id, with badges (Směny, Dovolená, Upozornění) still resolved per-id.

**Endpoints**:
- `GET /api/settings/menu-order` — admin only; returns the full map.
- `GET /api/settings/menu-order/me` — any authenticated user; returns just their role's order (or `null` for default).
- `PUT /api/settings/menu-order` — admin only; validated against the registry (ids must exist, must be allowed for the target role); audit-logged.
