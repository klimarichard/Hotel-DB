# Shifts (Shift Planner)

Implementation notes for the Phase 5 Shift Planner: the shift expression parser, plan workflow, MOD badges, shift change requests, shift types, and automatic `displayOrder` management.

### Phase 5 — Shift Planner
- `parseShiftExpression` is duplicated verbatim in `functions/src/services/shiftParser.ts` AND `frontend/src/lib/shiftConstants.ts` — they cannot share code across packages. Keep in sync manually.
- Shift cell composite doc ID: `${employeeId}_${date}`.
- `ShiftGrid.module.css` wrapper must use `overflow-x: auto` (NOT `overflow: hidden`) — required for sticky employee name column.
- Plan status transitions: `created → opened → closed → published` (one-way, server-enforced). All three forward transitions run on the same 5-minute `checkPlanDeadlines` scheduler in `planTransitions.ts` — each checks a deadline field (`openedAt` / `closedAt` / `publishedAt`) against `Date.now()`.
- **Workflow gate (admin/director only):** creating a plan, transitioning its status (open/close/publish), setting auto-deadlines, and copying employees from a prior plan are all restricted to admin + director. Managers can view every status and fill shifts inside an opened plan, but cannot move it through the workflow. Enforced both in the backend (`requireRole` on `POST /plans`, `PATCH /plans/:id`, `PATCH /plans/:id/deadlines`, `POST /plans/:id/copy-employees`) and the frontend (`canPublish` gate on the corresponding buttons in `ShiftPlannerPage.tsx`).
- **CREATED visibility:** employees do not see plans in `created` state (filtered in `GET /shifts/plans` and 404 from `GET /shifts/plans/:planId`). The plan only appears once it auto-opens on `openedAt`. Admin/director/manager always see all statuses.
- One plan per (month, year) — enforced in `POST /shifts/plans` with a Firestore query.
- Employee `status` field: `"active"` | `"before-start"` | `"terminated"` (string). Shift plans include employees of all three statuses.
- X limits: HPP = 8/month, PPP = 13/month, DPP = unlimited. Day/night recepce coverage minimum = 5 active employees.
- **Consecutive X limit**: max 6 X in a row for employees/managers (hard block, no override). Admins/directors exempt.
- **Real-time reload**: `ShiftPlannerPage` uses Firestore `onSnapshot` on the plan doc. Every mutation bumps `updatedAt`, triggering a full `loadPlan()` on all clients within ~1 s.
- `ShiftOverridesContext` provides global pending override count for the "Směny" nav badge.
- **Shift legend**: mandatory work-law legend (shift types D/N/R/ZD/ZN, hotel codes A/S/Q/K, break rule) displayed below the grid on `ShiftPlannerPage`.
- **PDF export** (admin/director): "Exportovat PDF" button builds a standalone HTML table from plan data with inline light-mode styles (6pt compact fonts, `table-layout:fixed`, colgroup percentages) and renders to single-page landscape A4 via `html2pdf.js`. Includes title, full grid with cell colors, MOD badges on vedoucí names, and legend. No DOM cloning — built programmatically from `plan.shifts`, `plan.employees`, `plan.modShifts`.

## Shift Planner — Additional Notes

### MOD badge + shift counts
- `showModCounts` prop (admin/director): shows `MOD: N (X PD, Y V+S)` below vedoucí name. PD = Mon–Fri non-holiday; V+S = weekend or holiday (counted once).
- MOD letter per manager is per-plan: stored in `shiftPlans/{id}.modPersons` (letter → employeeId). Falls back to static `MOD_PERSONS` name match.
- Editable badge: click → inline text input (1 char, any A–Z not taken by another manager in the plan). `PATCH /shifts/plans/:planId/mod-persons` batch-renames all `modRow` entries for the old letter.
- `VALID_MOD_CODE = /^[A-Z]$/` in `shifts.ts`.
- Badge only shown for `vedoucí` section (not recepce/portýři).
- Name cell layout: `[nameLines: name + MOD count] [badge] [edit/delete actions on hover]`.

### Shift change requests
- `shiftChangeRequests` sub-collection under `shiftPlans/{id}`.
- Employees double-click any cell on a published plan to open `ShiftChangeRequestModal`.
- Approving does NOT automatically update the shift — admin handles that manually.
- `ShiftChangeRequestsContext` mirrors `ShiftOverridesContext`; fetches `GET /shifts/changeRequests/pending-count`.
- `alwaysReadOnlySections` prop on `ShiftGrid` locks specified sections. Employees get `["vedoucí"]`.
- Employees can set/delete **X only** (enforced frontend + backend).

### Shift types
- Bare `D` and `N` are invalid — hotel code required (e.g. `DA`, `NS`). `R` and `X` are valid standalone.
- `ZD`/`ZN` also require hotel code (e.g. `ZDA`). Hour dotation: 12h.
- `HO` (Home Office): 6h, standalone, admin/director/manager only.
- Cell IDs: `${employeeId}_${date}`.

### planEmployee displayOrder auto-management (feature/shift-plan-auto-position)

`displayOrder` is kept contiguous (1..N) per section automatically — no manual bookkeeping needed.

**Add employee** — the dialog defaults to `count(section) + 1`. Changing the section resets the default to the next free slot in the new section. If the user types an existing position, the new employee inserts there and existing employees shift down.

**Edit position** — typing a new `displayOrder` moves the employee to that slot. Moving up (lower number): collisions shift down. Moving down (higher number): the vacated slot closes and the employee lands at the requested position. Section changes compact the leaving section and insert into the new one.

**Delete** — the section is compacted after removal so no gaps remain.

**Backend** — `renumberSection(planRef, section, target?)` in `shifts.ts` handles all three cases. Uses ±0.5 tiebreak offsets so the targeted doc always lands at exactly the requested position regardless of move direction. POST/PUT/DELETE all bump `shiftPlans/{id}.updatedAt` so connected clients reload.

**Frontend** — mutations call `loadPlan(true)` (silent reload — no `setPlan(null)` blank flash) immediately after the API responds, giving instant correct feedback. The `onSnapshot` listener also uses silent mode for background changes from other users.

## Batch 4 — Shifts enhancements

### Volné směny (free shifts)
- Shown only on **published** plans, as extra rows at the bottom of `ShiftGrid` (gated by the `showFreeShifts` prop = `plan.status === "published"`).
- `FREE_SHIFT_ROWS` in `ShiftGrid.tsx`: `DPQ`/`NPQ`/`NPA` are standing daily requirements (`auto:true`); `DPA` appears only on admin-marked days. Marked days live in `plan.freeShiftDpaDays[]` (array of `YYYY-MM-DD`), toggled by admin/director clicking a DPA cell → `PATCH /shifts/plans/:id/free-dpa-day`.
- **Coverage** is derived from the parsed shift segments: a `{code,hotel}` slot on a date is "covered" if any employee's cell that day parses to a segment with that code+hotel. Covered slots render a muted `✓`; uncovered slots render a claimable chip.
- **Chip colour** matches how the shift appears in the plan — `getCellColor(parseShiftExpression(code+hotel), dark)` (theme-aware), not a flat colour. Chips are centered (flex) and fill the cell like a real `ShiftCell`.
- **Claiming**: an employee double-clicks an uncovered chip → `ConfirmModal` → `POST /shifts/.../changeRequests` with `kind:"free-claim"` + `{date,code,hotel}` (no reason required). Duplicate same-slot claim by the same employee → 409; claiming a now-covered slot → 409.
- **Approving a free-claim** (admin/director/hr) writes the porter shift into the claimant's row (`status:"assigned"`) and **auto-rejects** competing pending claims for the same slot. Approving a slot covered in the meantime → 409. `ShiftChangeRequestPanel` + `MyRequestsPanel` render free-claims with their slot label.

### X-limit allowance (vacation-gated)
- Vacation-origin Xs are tagged `source:"vacation"` in `applyVacationXs` (manual Xs have no `source`). The voluntary-X count and the consecutive-6-X rule **exclude** vacation Xs — only employee-entered Xs count toward the 8 HPP / 13 PPP base.
- **Removal is content-aware.** When a vacation is deleted or an approved edit replaces its dates, `removeVacationXsFromPlans` reads each candidate cell and deletes **only** those tagged `source:"vacation"`. A real shift entered over a vacation day — one kept via the approval-time `excludedDates` collision dialog, or an admin overwriting an X after approval — survives, so worked shifts (and their payroll hours) are never silently destroyed. (The range is walked with local-date math, not `toISOString()`, which would roll back a day in UTC+2.)
- Admin/director may **raise the month's X limit only when the employee has an approved vacation overlapping the month** (i.e. `vacationXCount > 0`). The entered number is the **absolute new limit** for the month (not an increment).
- Storage: `xLimitOverride` on the `planEmployee` doc (per-month). Effective limit = `xLimitOverride` when a vacation exists, else base. `PATCH /shifts/plans/:id/employees/:docId/x-allowance` body `{limit}` (0–31), admin/director, audited (`fieldPath:"xLimitOverride"`).
- `copy-employees` strips `xLimitOverride` (and the legacy `xAllowanceExtra`) so a month-specific override never carries into a copied month.
- Inline badge under the employee name (`ShiftGrid`): `X: used / limit`, plus `(N dovolená)` when the employee has vacation Xs that month; red when over. The `✎` editor appears only when a vacation exists; editing shows the vacation-X count as a hint.
- Shown to **admin/director only** (never managers — `xInfoFor`/`onSetXAllowance` gated on `canPublish`), and **only in `created`/`opened`** plan states. Hidden in `closed`/`published` to keep rows compact.

### Other Batch 4 items
- **Count/occupancy table** (`showCounterTable`) is shown to **admin in every plan state** (previously only when closed).
- **Compact name-cell rows + section label** (admin/director): the MOD-count line (`MOD: N (PD/V+S)`, `showModCounts`) shows **only in `closed`/`published`**, the X-limit line **only in `created`/`opened`** — at most one guide line per row. The manager section is **displayed as "Management"** via `SECTION_LABELS["vedoucí"]` in `shiftConstants.ts`; the stored section data key stays `"vedoucí"` (display-only rename). (Previously this label was "FOM".) Per-section Σ summary rows have been removed from the grid — sections are now separated by header rows only.
- **Delete gate**: `DELETE /shifts/plans/:id` returns **409 unless `status === "created"`**; the UI hides the delete button otherwise. Deleting a created plan still cascades its sub-collections (`planEmployees`, `shifts`, `shiftsSnapshot`, `modRow`, `rules`, `unavailabilityRequests`, `shiftOverrideRequests`, `shiftChangeRequests`).
- **Click-time timestamp** (#32): a shift-change-request captures `requestedAtClient` at the moment of the double-click (carried through to the POST); the server validates it against a window and falls back to its own serverTimestamp if out of range.
- **Grid remount** (#35): `ShiftGrid` is keyed on the sorted employee-id list so it remounts on membership change, fixing the sticky / `table-layout:fixed` rendering glitch after an employee is removed.
- **DNES** (#53): a button in the month nav, shown only when the user is viewing a month other than the current one.
- **Day/night section ordering**: in `recepce` & `portýři`, day employees (`D`/`DP`) always sort above night (`N`/`NP`), with displayOrder ordering within each group; a 3px `.shiftPeriodDivider` marks the boundary. The single source of truth is `sortSectionEmployees()` (+ `isNightShiftType()`) in `shiftConstants.ts`, used by `ShiftGrid`, the PDF export, and the CSV export so all three match. Auto-grouping overrides cross-group manual displayOrder; the Management (`vedoucí`) section is unaffected.
- **Schedule all transitions from Created** (#56): the deadline bar shows each *upcoming* transition's deadline in every earlier state — so from `created` admin can set Otevření **and** Uzavření **and** Publikování at once (Uzavření also editable in `opened`; Publikování in `opened`/`closed`). The backend `PATCH /plans/:id/deadlines` already accepts any field in any state; `handleDeadlineChange` guards chronological order (open ≤ close ≤ publish). `transitionPlanDeadlines` advances one step per 5-min run, so a full chain cascades created→opened→closed→published as each deadline passes.
