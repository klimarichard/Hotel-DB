# Shifts (Shift Planner)

Implementation notes for the Phase 5 Shift Planner: the shift expression parser, plan workflow, MOD badges, shift change requests, shift types, and automatic `displayOrder` management.

### Phase 5 — Shift Planner
- `parseShiftExpression` is duplicated verbatim in `functions/src/services/shiftParser.ts` AND `frontend/src/lib/shiftConstants.ts` — they cannot share code across packages. Keep in sync manually.
- **A second hand-maintained mirror, same convention:** `cellHoursForType` — the shift-counting rule behind manual hour splits (see "Manual hour splits" further down this file) — is duplicated verbatim between `functions/src/services/shiftCounting.ts` and `frontend/src/lib/shiftConstants.ts`. Change one, change the other.
- Shift cell composite doc ID: `${employeeId}_${date}`.
- `ShiftGrid.module.css` wrapper must use `overflow-x: auto` (NOT `overflow: hidden`) — required for sticky employee name column.
- **Sticky-left labels** (v3.0.2): the employee-name column and the section/separator rows (Management/Recepce/Portýři, "Přehled obsazení", "Volné směny") all stay pinned on horizontal scroll. `position: sticky; left: 0` only sticks an element that is *narrower* than its row (it needs slack), so each separator row is a **narrow label cell + a filler `colSpan` cell** (both painted with the bar background) rather than one full-width `colSpan` cell — a full-width cell fills its row and cannot stick.
- Plan status transitions: `created → opened → closed → published` (one-way, server-enforced). All three forward transitions run on the same 5-minute `checkPlanDeadlines` scheduler in `planTransitions.ts` — each checks a deadline field (`openedAt` / `closedAt` / `publishedAt`) against `Date.now()`.
- **Manager R auto-fill on `closed → published`:** `autoFillManagerRShifts(planRef, year, month)` (in `planTransitions.ts`) writes `R` (8 h, status `assigned`) for every **active** FOM/manager row (`section === "vedoucí"`) on each **Mon–Fri non-holiday** workday whose cell is currently **empty**. Data-safe: `X` (days off) and any existing entry (HO, a covered shift) are never overwritten. Holidays are skipped because the payroll calculator already grants managers Mon–Fri holiday credit (`countMonFriHolidays`) — an `R` there would double-count VÝKAZ. Shared by the manual transition route (`PATCH /plans/:id`, runs **before** `createOrUpdatePayrollPeriod` so the hours land in payroll) and the scheduled deadline transition. Logs a single `plan.autoFillManagerR` "Systém" audit event summarising the fill (never per cell).
- **Workflow gate (admin/director only):** creating a plan, transitioning its status (open/close/publish), setting auto-deadlines, and copying employees from a prior plan are all restricted to admin + director. Managers can view every status and fill shifts inside an opened plan, but cannot move it through the workflow. Enforced both in the backend (`requireRole` on `POST /plans`, `PATCH /plans/:id`, `PATCH /plans/:id/deadlines`, `POST /plans/:id/copy-employees`) and the frontend (`canPublish` gate on the corresponding buttons in `ShiftPlannerPage.tsx`).
- **CREATED visibility:** employees do not see plans in `created` state (filtered in `GET /shifts/plans` and 404 from `GET /shifts/plans/:planId`). The plan only appears once it auto-opens on `openedAt`. Admin/director/manager always see all statuses.
- **`GET /shifts/plans-upcoming?year&month` (v4.11.0).** Those two hiding rules above are correct and deliberately unchanged, but they left a self-service viewer seeing "Plán pro tento měsíc neexistuje" for a month whose plan already exists and is already scheduled to open — a lie. This route closes that gap by exposing exactly one field for a still-`created` plan: `{ openedAt: string | null }` (`null` when no plan exists for that year/month, or the plan isn't `created`). Never the roster, never any other field. Route is deliberately named `/plans-upcoming`, not `/plans/upcoming` — a nested path under `/plans` risks being captured by `/plans/:planId` as `planId="upcoming"` depending on declaration order. `ShiftPlannerPage.tsx` calls it whenever `plan` is `null` for the selected month and renders "Vyškrtávání od 20. 07. 2026 08:00 (za 3h 12m)" (`formatIsoDatetimeCZ` + the existing `deadlineCountdown`) in place of the "no plan" message.
- **Absolute deadline time for non-editors (v4.11.0).** The three deadline rows (`openedAt`/`closedAt`/`publishedAt`) previously showed only a relative countdown ("za 3h 12m") to everyone. A user who **cannot** edit deadlines (`!can("shifts.plan.edit")`) has no `datetime-local` input to read the absolute moment off, so `deadlineWhen(iso)` now renders `formatIsoDatetimeCZ(iso)` beside the countdown for that group specifically — editors are unaffected since their input already shows the exact value.
- One plan per (month, year) — enforced in `POST /shifts/plans` with a Firestore query.
- Employee `status` field: `"active"` | `"before-start"` | `"terminated"` (string). Shift plans include employees of all three statuses.
- X limits: HPP = 8/month, PPP = 13/month, DPP = unlimited. Day/night recepce coverage minimum = 5 active employees.
- **Consecutive X limit**: max 6 X in a row for employees/managers (hard block, no override). Admins/directors exempt.
- **Real-time reload**: every mutation bumps `updatedAt` on the plan doc; `loadPlan()` is called after each API response so the UI refreshes immediately. There is no client-side `onSnapshot` listener — `firestore.rules` block direct client SDK reads (all data flows through `/api`), so the listener was permission-denied and silently never fired. It was removed in v3.2.1.
- **Optimistic-concurrency cell guard.** The cell `PUT`/`DELETE` (`shifts.ts`) accept an optional `baseRawInput` (body for PUT, query string for DELETE) — the `rawInput` the client believes is currently stored. A mismatch against the stored value 409s with `{ conflict: true, current }` instead of silently clobbering a colleague's edit; applied identically on both the self-service X path and the manager/admin direct-write path. On the frontend, `ShiftPlannerPage.tsx` polls `GET /shifts/plans` every 15s while the tab is visible (and on focus/`visibilitychange`), comparing the selected month's plan `updatedAt`; the check is **skipped while a cell `<input>`/`<textarea>` is focused** so a background poll can't disrupt active typing or invalidate an in-flight save's compare-and-swap base. A detected change triggers a **silent** `loadPlan(true)` (reload in place, no blank-grid flash). Same pattern (poll + compare-and-swap, no realtime channel) as the Recepce Předávací protokol — see [Recepce — Concurrency guard](recepce.md#concurrency-guard-optimistic-no-realtime-channel).
- **Server-side self-service X enforcement.** The X-limit (8 HPP / 13 PPP, vacation-tied override), the ≥5-recepce coverage rule, and the ≤6-consecutive-X rule were previously client-advisory only. `PUT /shifts/plans/:planId/shifts/:employeeId/:date` now enforces all three **server-side inside a Firestore transaction** whenever the caller is entering an all-`X` cell for themself and lacks `shifts.xAllowance.manage`/`system.admin` (managers/admin bypass this path entirely; approved overrides and vacation auto-fill write through other handlers and are unaffected). The transaction also reads and bumps the shift-plan doc itself purely to add it to the transaction's read set — because any two transactions that read a document one of them writes conflict under Firestore's optimistic model, this serializes every concurrent self-service X-write on the same plan, closing a coverage-check race (including the "phantom new-cell" case where the racing X is a brand-new cell the day-query never saw). A rule violation throws `RuleBlock` → **403** with the Czech message; a stale `baseRawInput` throws `CellConflict` → **409**.
- **Double-click X on open plans (v3.6.0):** On an **opened** plan, double-clicking an editable cell toggles the X marker: empty → X, and X → empty. A cell that already has a real shift value (anything other than empty or X) is never touched — the guard `if (cur !== "" && cur !== "X") return` is the single check. The handler `handleCellToggleX` in `ShiftPlannerPage` delegates straight to `handleCellSave`, so the existing X-limit exception dialog (`XOverrideModal`), the consecutive-6-X hard block, and all coverage checks fire exactly as if the user had typed X manually. Wiring: `onCellDoubleClickX` prop threaded `ShiftPlannerPage` → `ShiftGrid` → `ShiftCell` (the `onDoubleClickX` prop). **Single-click behaviour change:** when `onDoubleClickX` is present, a single click on that cell only focuses it — it no longer opens the text editor (prevents the race between click-to-edit and double-click-to-toggle). Typing, keyboard entry, and Backspace to clear still open or operate the editor normally.
- `ShiftOverridesContext` provides global pending override count for the "Směny" nav badge.
- **Shift legend**: mandatory work-law legend (shift types D/N/R/ZD/ZN, hotel codes A/S/Q/K, break rule) displayed below the grid on `ShiftPlannerPage`. Hidden on phones (v3.0.1) where the planner runs full-screen.
- **PDF export** (admin/director): "Exportovat PDF" button builds a standalone HTML table from plan data with inline light-mode styles (6pt compact fonts, `table-layout:fixed`, colgroup percentages) and renders to single-page landscape A4 via `html2pdf.js`. Includes title, full grid with cell colors, MOD badges on vedoucí names, and legend. No DOM cloning — built programmatically from `plan.shifts`, `plan.employees`, `plan.modShifts`.

## Shift Planner — Additional Notes

### Remaining-vacation badge (v5.7.0)

A read-only pill at the right edge of the frozen name column, on the same gate as the gap badge below (`plan.status === "closed"` + `shifts.counterTable.view`) — closed is the state in which *next* month's plan is being built, which is when "how much leave does this person still have?" gets asked. It shows the employee's vacation balance **entering the plan's month**, projected past the ledger over every month whose payroll is not locked yet, so it already counts the leave the current month is consuming. Red when negative; blank for DPP and for anyone with no ledger for the year.

`GET /shifts/vacation-remaining?year&month` returns `{ values, projectedMonths }` for the plan's own employees. The figure, the projection rule and the reason it cannot be derived from shift cells are documented once, with the ledger: [Employees — Projected remaining balance](employees.md#projected-remaining-balance--shift-plan--payroll-badges-v570).

### Previous-month gap badge (v4.13.0)

A read-only badge over the **1st-of-month cell** of every employee row, shown **only** when `plan.status === "closed"` and only to holders of `shifts.counterTable.view`. It says how that employee's **previous** month ended: negative = they were working into the month end (`|n|` consecutive worked days, so `-2` = worked the last two), positive = they were off (`n` consecutive non-worked days before the 1st), `"N/A"` = unknown.

- **`GET /shifts/prev-month-gap?year&month`** (`shifts.ts`) — `year`/`month` are the **current** plan's; the server derives the previous month itself. Returns `{ available: boolean, values: Record<employeeId, number | null> }`. `available:false` (no previous plan, or one that never reached `closed`/`published`) and a `null` value both render as `N/A`. Gated on `shifts.counterTable.view` — the first non-display use of that key, which until now only toggled the occupancy table. Route named `/prev-month-gap`, **not** nested under `/plans/…`, for the same `/plans/:planId` capture reason as `/plans-upcoming`.
- **Returns ~30 integers, not a plan.** Deriving this client-side would mean fetching the whole previous `PlanDetail` (roster + ~900 cell docs) to extract one number per employee.
- **Mirrors the snapshot substitution** of `GET /plans/:planId`: a viewer without `shifts.view.all` reading a `closed` previous plan is aggregated from `shiftsSnapshot`, not live `shifts`. Without this the badge is a side channel disclosing post-close edits that viewer cannot see in the grid.
- **"Worked" = a real shift only.** `NON_WORK_CODES = {X, R, HO}`; a cell counts when **any** segment is outside that set (so composites like `DA+2` count). This is deliberately **neither** existing convention: not `status === "assigned"` (counts R and HO) nor the grid's `hoursComputed > 6` "Směny" column (counts R). `R` is auto-filled at publication (see `planTransitions.autoFillManagerRShifts`), so counting it would change the number between a plan being closed and published.
- **`prevMonthGap(workedDates, year, month)` and `isWorkedCell(rawInput)` are exported** from `shifts.ts` for testing. The walk starts at the last day, takes its kind (worked/not) as the run's kind, and counts back; it terminates because a `null` is returned up-front when there are zero worked days.
- **The vedoucí rule is presentation, not data.** Management rows render **only** the negative case and are otherwise **blank** (not `N/A`) — with `R` excluded, a positive number for them would mostly measure desk time. This lives in `ShiftPlannerPage.tsx`'s `prevMonthGapFor` prop, not the endpoint, because the section that matters is the one in the **current** month's roster, which the endpoint never sees.
- **Rendering:** `ShiftGrid.tsx` `prevMonthGapFor?: (emp) => string | null`, badge emitted in the `<td>` at `colIdx === 0` — *not* inside `ShiftCell`, which is `overflow: hidden` and already owns its top-right corner for the `typeTag` badge. `.cell` gained `position: relative` (it had none); `.prevGapBadge` sits top-left and uses `var(--color-*)` tokens, so it is theme-correct without the light/dark branch the inline `typeTag` badge carries.
- **No cross-month logic existed to reuse.** Both the 6-in-a-row rule (`consecutiveXRun`) and the X-limit walk only the current plan's own `shifts` subcollection, so their runs silently truncate at the 1st. This is the first server-side read that spans a month boundary.
- User-facing rule (Czech, incl. every `N/A` case): [`business-rules.md`](business-rules.md) → "Ukazatel u 1. dne měsíce".

### MOD badge + shift counts
- `showModCounts` prop (admin/director): shows `MOD: N (X PD, Y V+S)` below vedoucí name. PD = Mon–Fri non-holiday; V+S = weekend or holiday (counted once). Shown in **`created`/`closed`/`published`** — every state except `opened` (see "Compact name-cell rows" below for why `opened` is the odd one out).
- MOD letter per manager is per-plan: stored **only** on `shiftPlans/{id}.modPersons` (letter → employeeId) — this is the single source of truth. There is no other data source and no fallback.
- Editable badge: click → inline text input (1 char, any A–Z not taken by another manager in the plan). `PATCH /shifts/plans/:planId/mod-persons` batch-renames all `modRow` entries for the old letter. The handler wraps the read + modPersons-map update + modRow renames in a **`runTransaction`** (v3.2.1) so concurrent letter reassignments cannot clobber each other's map entries.
- `VALID_MOD_CODE = /^[A-Z]$/` in `shifts.ts`.
- Badge only shown for `vedoucí` section (not recepce/portýři).
- **MOD-row editing is gated on `shifts.mod.manage`** (`canEditMod` prop, added 2026-08-04). Before that the grid passed `onModSave` unconditionally and `<ModCell>` received a bare `readOnly={readOnly}` — unlike `<ShiftCell>`, which has always been `readOnly={readOnly || alwaysReadOnlySections.includes(emp.section)}`. Two consequences: any holder of `shifts.cells.edit` could type in the MOD row and get a raw English "Insufficient permissions" inside the cell (the write endpoints require `shifts.mod.manage`), and a **plain employee** could edit it too — `selfServiceOnly` leaves `readOnly` false on an opened plan, and the MOD row belongs to the `vedoucí` section that `alwaysReadOnlySections` was supposed to protect. The sibling `onModPersonChange` (the letter badge) was already correctly gated; only the row was missed.
- Name cell layout: `[nameLines: name + MOD count] [badge] [edit/delete actions on hover]`.

#### `MOD_PERSONS` removal (v4.7.1)

Before v4.7.1, `frontend/src/lib/shiftConstants.ts` also exported `MOD_PERSONS` — a hardcoded table of six real employees' **names** keyed by letter (e.g. `V → "Viktor Vondra"`). Each of four call sites string-matched the plan roster against that table at render time to guess who held which letter, with the per-plan `modPersons` map (above) layered on top as an override. Nothing about the *static* assignment was ever persisted. This caused three bugs, now fixed:

1. The four reimplementations of the match had drifted: the CSV export (`ShiftPlannerPage.tsx`) compared names surname-first (`"${lastName} ${firstName}"`) against a table stored first-name-first, so its static pass never matched anything — MOD letters were silently missing from every CSV export.
2. That masked a second bug in the same export: it seeded overrides by `employeeId` first, then let the static (name) pass run for anyone not yet assigned — so reassigning a letter left the *originally-named* person holding it too, i.e. two employees sharing one letter.
3. Matching on the name at all is brittle: since v4.6.0 plan rows carry the **live** employee name ([Data Model — live name resolution](data-model.md#live-employee-name-resolution--read-time-never-a-backfill-v460)), so correcting a typo in someone's legal name would silently drop their MOD letter.

**Fix:** `MOD_PERSONS` is deleted outright — no employee names remain in `shiftConstants.ts` or anywhere else in the MOD code. A single shared helper, `frontend/src/lib/modPersons.ts`, is now the only place that reads `modPersons`:
- `modLettersByEmployeeId(modPersons)` → `Map<employeeId, letter>`
- `modEmployeeIdForLetter(modPersons, letter)` → `employeeId | undefined`

`ShiftGrid.tsx`, `ShiftPlannerPage.tsx` (both the PDF/print path and the CSV export), and `OverviewPage.tsx` all call these helpers instead of their own copy of the match — there is exactly one implementation now, keyed by the stable `employeeId` rather than a name string.

**`copy-employees` now carries MOD letters** (`POST /shifts/plans/:planId/copy-employees` in `functions/src/routes/shifts.ts`): copying the roster into a new month also merges the source plan's `modPersons` into the target's, but only for letters whose holder (`employeeId`) was actually copied onto the new plan, and only where neither the letter nor the employee is already taken on the target (an assignment made directly on the target always wins — a letter and an employee may each hold at most one of the other). Before v4.7.1 this copy step was unnecessary because the hardcoded table silently "re-supplied" the same six letters every month regardless of what was stored; removing the table without this step would have left every newly-copied month with no MOD assignments at all.

**Migration note (general pattern, not just MOD):** because the letter used to be *derived at render time* from `MOD_PERSONS` and never actually written to `modPersons`, every plan's `modPersons` map was `{}` in Firestore even though the UI appeared to show assignments. Deleting the constant without first writing down the derived state would have blanked every MOD badge in production. A one-off backfill populated `modPersons` on all (six, at the time) existing plans before this code shipped. This is safe to run **before** deploy specifically because the pre-v4.7.1 code already preferred a stored `modPersons` entry over the static name match — so a backfilled plan renders identically under old and new code, and the rollout has no moment where the two are inconsistent. The general lesson: when a constant that *drives* rendered state is being removed, the state it was silently deriving must be captured as real, persisted data first — and if the existing code already prefers stored data over the derived fallback, the backfill can safely land ahead of the code that stops falling back.

### Shift change requests (v3.6.0 — structured picker + auto-apply)

`shiftChangeRequests` sub-collection under `shiftPlans/{id}`.

#### Employee dialog — `ShiftChangeRequestModal`

On a **published** plan, employees double-click any read-only cell to open `ShiftChangeRequestModal` (`frontend/src/components/ShiftChangeRequestModal.tsx`). The modal is a structured picker, not a free-text box:

- **12 shift-type buttons** laid out as three rows of four: `DA DS DQ DK / NA NS NQ NK / DPQ NPQ DPA NPA`. The selected button shows its own shift-plan colour (`getCellColor`).
- **"vyměnit s:" dropdown** — every employee in the same plan (surname-sorted, Czech collation), excluding the requester.
- **"zadat počet hodin"** toggle — expands a numeric sub-input (0–24; decimal allowed; comma is normalised to period).
- **"smazat"** toggle.
- **"Jiné:" textarea** — free-text note; optional unless no other preset is selected (in which case it becomes the whole request).

Exactly one preset (type / hours / delete / swap) or a non-empty "Jiné" must be present before "Odeslat žádost" enables. Reason is **optional** when a preset is chosen; it becomes the request body for the "other" action.

The submit payload carries a `requestedChange` object (typed in `frontend/src/lib/shiftChangeRequest.ts`):

```ts
interface RequestedChange {
  action: "set-type" | "set-hours" | "delete" | "swap" | "other";
  value?: string;               // set-type: e.g. "DA"; set-hours: e.g. "8"
  swapWithEmployeeId?: string;  // swap
  swapWithName?: string;        // swap — denormalized surname-first for display
}
```

`formatRequestedChange(rc)` (same file) renders a human-readable Czech label for the review tables.

#### Backend validation — `POST /shifts/plans/:planId/shiftChangeRequests`

The endpoint validates the `requestedChange` from the body for `kind === "change"` requests:

- `set-type` / `set-hours` — value must parse as a valid shift expression (`parseShiftExpression` must return `isValid`).
- `swap` — `swapWithEmployeeId` required and must not equal the requester.
- `other` — `reason` is **mandatory** (the only case where reason is still required).
- Any other `action` → 400.

`requestedChange` is stored on the doc only when present; legacy reason-only docs (no `requestedChange`) continue to coexist.

#### Shared-terminal attribution — "who is really requesting?" (v4.2.15)

The three self-service shift actions — **change request, X-override request, and free-shift claim** — are attributed to `requestedBy: req.uid`. On a **shared terminal** (a user type with `roleTypes.sharedTerminal === true`, e.g. Recepce — one login used by many people) `req.uid` names nobody, so the real person must be picked in the dialog:

- The three dialogs (`ShiftChangeRequestModal`, `XOverrideModal`, `FreeClaimModal`) render a required **"Kdo žádá / přebírá"** dropdown of the plan roster (surname-sorted) when `useAuth().sharedTerminal` is true. `GET /auth/me` now returns `sharedTerminal` (read from the roleType doc) to drive this. Non-shared-terminal users see the dialogs unchanged.
- The picked id is sent as `requestedByEmployeeId`. `resolveSharedTerminalRequester()` (shifts.ts) **requires and validates** it (must be rostered in `planEmployees`) for shared-terminal callers, and is a no-op returning `null` for everyone else. It is stored on both `shiftChangeRequests` and `shiftOverrideRequests` docs. For a **free-claim** the picked person is also the claimant (`employeeId`), so the shift is assigned to them on approval — not to the shared account.
- **Default pre-selection**: `GET /shifts/on-shift-requester` returns the employee scheduled on the reception shift happening now (`scheduledEmployeeId` + `currentReceptionShiftPrague`), but **only when the shared terminal maps to exactly one accessible hotel** (a single `hotelViewPerm`); with zero or several it returns `null` and the picker stays empty (admin's responsibility). Same source as the Walkiny / Lobby bar "on shift now" default. The pre-selection is applied only if that employee is in the plan roster.
- The review tabs (`PendingShiftChangeRequestsTab`, `PendingShiftOverridesTab`) show **"Přes recepci: ‹jméno›"** when `requestedByEmployeeId` is present, so the reviewer sees who actually filed it. Reuses the existing submit permissions — no new key. Distinct from the [Recepce shared-terminal *write* attribution](recepce.md) (which infers the actor from the previous Převzal signature); this is an explicit picker.

#### Auto-apply on approval — `PATCH /shifts/plans/:planId/shiftChangeRequests/:reqId`

When approving a structured change request (`status === "approved"`, `kind !== "free-claim"`, and `requestedChange` is present), the handler **auto-applies** the change to the plan cells before marking the request approved:

| `action` | Effect |
|---|---|
| `set-type` | Writes `value` (e.g. `"DA"`) into the cell via `writeCell`. |
| `set-hours` | Writes the numeric value into the cell; **carries the previous shift type** (from the old `rawInput` or its `typeTag`) onto the new cell as a `typeTag` corner badge. |
| `delete` | Deletes the cell doc (`writeCell` with empty string). |
| `swap` | Reads both employees' cells for that date, then writes each other's value (two `writeCell` calls). |
| `other` | No auto-apply — left for manual editing. |

All writes are audited via `logUpdate` (`collection: "shiftPlans/shifts"`). `plan.updatedAt` is bumped after every approval so connected clients reload the grid immediately (`loadPlan()` called in the frontend after the API responds).

Legacy reason-only requests (no `requestedChange`) are approved without any cell mutation — existing manual-edit workflow preserved.

#### "Požadovaná změna" display column

A "Požadovaná změna" column was added to three review surfaces, all via `formatRequestedChange`:

- **Per-plan panel** — `ShiftChangeRequestPanel` (`frontend/src/components/ShiftChangeRequestPanel.tsx`).
- **Cross-plan Upozornění tab** — `PendingShiftChangeRequestsTab` (`frontend/src/pages/upozorneni/PendingShiftChangeRequestsTab.tsx`).
- **Employee's own list** — `MyRequestsPanel` (`frontend/src/components/MyRequestsPanel.tsx`).

Free-claim rows render "—" in this column (they have no `requestedChange`).

#### Live employee-name resolution (v4.6.0)

`planEmployees` rows and the `requestedChange.swapWithName` denormalization are both write-time snapshots that a later display-name edit (or a plan created before the display-name feature existed) never reaches. `GET /plans/:planId`, `GET /plans/:planId/employees`, `GET /changeRequests/pending`, and `GET /plans/:planId/shiftChangeRequests` now re-resolve names against the live employee record on every read (the last two via a `withLiveSwapNames` wrapper for the swap partner's name specifically) instead of trusting the stored snapshot. Full pattern and the shared helper (`functions/src/services/employeeNames.ts`) are documented in [Data Model — Live employee-name resolution](data-model.md#live-employee-name-resolution--read-time-never-a-backfill-v460).

### Other notes
- `ShiftChangeRequestsContext` mirrors `ShiftOverridesContext`; fetches `GET /shifts/changeRequests/pending-count`.
- **Pending-count `orderBy` requirement (v3.5.1):** both count endpoints (`/overrides/pending-count`, `/changeRequests/pending-count`) must include `.orderBy("requestedAt","desc")`. Without it, a bare collection-group equality query is not served by the `(status, requestedAt)` composite index on real Firestore and throws `FAILED_PRECONDITION`; the badge contexts swallow it silently, leaving counts at 0. Full explanation in [Upozornění hub](other-features-and-ui.md#upozornění-hub).
- `alwaysReadOnlySections` prop on `ShiftGrid` locks specified sections. Employees get `["vedoucí"]`.
- Employees can set/delete **X only** (enforced frontend + backend).
- **Approval idempotency (v3.2.1).** The three approval endpoints (unavailability, shift-override, shift-change-request `PATCH`) now return **404** when the request doc is missing and **409** when its `status` is not `"pending"`. A re-approval race therefore cannot run a second `.set()` on the shift cell and clobber a later manual edit. Free-claim approval additionally re-checks `isSlotCovered` and 409s if the slot has been filled in the meantime.

### Shift types
- Bare `D` and `N` are invalid — hotel code required (e.g. `DA`, `NS`). `R` and `X` are valid standalone.
- `ZD`/`ZN` also require hotel code (e.g. `ZDA`). Hour dotation: 12h.
- `HO` (Home Office): 6h, standalone, admin/director/manager only.
- Cell IDs: `${employeeId}_${date}`.

### Numeric-cell shift-type tag (`typeTag`, v3.4.0)

A bare-number cell (e.g. `8`) records *worked hours* but carries no shift type, so it was invisible to the per-type occupancy tally ("Přehled obsazení"). A cell can now be **tagged** with the type those hours were worked as; the tagged cell then counts toward that type in the tally. **Tally-only — it never affects pay** (hours, night/holiday/weekend buckets, vouchers are all unchanged). A composite like `DA+2` already parses a `DA` segment, so it needs no tag.

- **Allowed tags** — two kinds, both defined in `frontend/src/lib/shiftConstants.ts` (backend mirror in `services/shiftParser.ts`):
  - **Counted (12):** the occupancy types `DA DS DQ DK NA NS NQ NK DPQ NPQ DPA NPA`, as `SHIFT_TYPE_TAGS`. Each has a `code_hotel` counter key. `ShiftGrid`'s `COUNTER_ROWS` *is* `SHIFT_TYPE_TAGS`, so the tally rows and these tags can never drift.
  - **Annotation-only (4, v3.4.4):** `R HO ZD ZN`, as `EXTRA_TYPE_TAGS`. Pickable on a numeric cell purely as a note — they have **no counter key**, so they add no tally row, are never counted, and never affect free-shift coverage. `ZD`/`ZN` (trainee) deliberately carry no hotel appropriation.
  - The picker offers `ALL_TYPE_TAGS = [...SHIFT_TYPE_TAGS, ...EXTRA_TYPE_TAGS]`; only the 12 are ever counted. The "no tally for the 4" guarantee falls out of `typeTagToCounterKey` returning `null` for any label not in `SHIFT_TYPE_TAGS`.
- **Storage:** optional `typeTag: string | null` on the `shifts/{employeeId}_{date}` doc. The cell upsert (`PUT /shifts/plans/:planId/shifts/:employeeId/:date`) accepts an optional `typeTag` in the body and persists it **only when the expression is pure-numeric** (`isPureNumericExpression` — every segment a bare number). It is auto-cleared when the cell stops being numeric, and **preserved across numeric→numeric edits** when the request omits `typeTag` (a plain rawInput edit). Validated against the allowed list via `sanitizeTypeTag` (unknown → `null`). Audit-logged with the Czech label "Typ směny (štítek)", and the cell-edit log now records only the fields that actually changed.
- **Tally:** a tagged numeric cell contributes its *hours* to its type — `ShiftGrid`'s `counterStats` calls `cellHoursForType(cell, row.label)`, matching `typeTag` against the row label directly. (Before the split feature this was `shiftCounts` bumping `typeTagToCounterKey(label)` → `"<code>_<hotel>"` by one; `typeTagToCounterKey` now serves free-shift coverage only.) See "The occupancy number is WHOLE SHIFTS, not people" below.
- **Free-shift coverage (v3.4.1):** a tagged numeric cell also *covers* the matching Volné směny slot, so it stops showing as claimable. Both layers honor the tag: the frontend `freeShiftCoverage` map adds `typeTagToCounterKey(typeTag)`, and the backend `isSlotCovered` matches `sanitizeTypeTag(typeTag) === code + hotel` (the tag label equals `code+hotel` for all 12 types) so a stale free-claim approval 409s. Keep all three consumers (tally, frontend coverage, backend coverage) in sync when changing the tag model.
- **UI / gating:** in `ShiftCell`, a numeric cell shows an **absolutely-positioned corner badge** (top-right) — the tag label, or a faint `+` when untagged. For the 12 occupancy types the badge wears that shift type's own colour (`getCellColor(parseShiftExpression(label))`, gated on a non-null `typeTagToCounterKey`); the 4 annotation tags keep the neutral translucent badge (v3.4.4). Clicking it opens a 4-column picker popover (4×4 with the annotation tags; `createPortal` to `document.body` to escape the cell's `overflow:hidden`; portal clicks `stopPropagation` so selecting a type doesn't fall through to the cell's number editor). The badge is out of normal flow so a long number (e.g. `10.5`) plus a 3-letter tag never widens the fixed 40px column (v3.4.2; was an inline `<sup>`). The affordance is shown **only to users who can edit shifts in every plan state** — `onCellTagSave` is passed only when `!selfServiceOnly && can("shifts.cells.edit")`, and `showTag === tagEditable`, so read-only viewers and self-service employees see nothing. No new permission key; no tour step.

### Manual hour splits (`shiftSplits`, feature/shift-hour-splits)

**The problem.** A numeric cell tagged with a type (e.g. `8` tagged `DS`) records only the hours actually worked, not a whole shift. The 4D Recepce summary has always credited such a cell `hoursComputed / 12` of a shift — so if the tagged cell says `8`, the summary counts 8/12 of a `DS` shift and the other 4 h are credited to **nobody**, silently shrinking the monthly shift total (and the money share derived from it). Managers can now click a cell in the occupancy table ("Přehled obsazení") and hand those leftover hours to other employees.

#### The single counting rule — `cellHoursForType`

`functions/src/services/shiftCounting.ts` exports `cellHoursForType(cell, type)` — the **one** function that answers "how many hours of shift-type `type` does this cell credit". Everything that counts shifts must go through it:

- A parsed **code** cell adds `FULL_SHIFT_HOURS` (12) for **every segment** matching `{code, hotel}` — a composite `DA+DA` therefore adds 24, matching the historical behaviour of adding 1 per matching segment (deliberate, not a bug). A **double** cell (`isDouble`, e.g. `DA²`) counts as 0.
- A **tagged numeric** cell adds `hoursComputed` when `typeTag === type`.
- Both branches sum (a cell can in principle be both).

`recepceSummary.ts`'s shift-counting loop (`functions/src/routes/recepceSummary.ts:233-245`) was refactored to call `cellHoursForType` instead of re-implementing the same two branches inline. **The refactor is behaviour-preserving for existing data** — same two cases, same math, just centralized.

⚠️ **Hand-maintained frontend mirror.** `frontend/src/lib/shiftConstants.ts` carries a verbatim copy of `cellHoursForType` (plus `COUNTED_TAGS`/`FULL_SHIFT_HOURS`) so `ShiftGrid` can compute the same hour accounting client-side without a round trip. This is the **same convention** the shift-expression parser already uses (see the top of this file) — a second thing that will silently drift if only one side is changed. Both copies read the **stored parse result** (`segments`/`isDouble`/`typeTag`/`hoursComputed`), never a re-parse of `rawInput`, so client and server agree exactly.

#### Schema — `shiftPlans/{planId}/shiftSplits/{date}__{TYPE}`

```ts
{
  date: string;      // "YYYY-MM-DD"
  type: string;      // one of the 8 counted desk tags: DA DS DQ DK NA NS NQ NK
  entries: { employeeId: string; hours: number }[];
  employeeIds: string[];   // == entries.map(e => e.employeeId) — see below
  updatedAt: FieldValue.serverTimestamp();
}
```

**Why a separate sub-collection rather than a real shift cell:** shift cells are keyed `{employeeId}_{date}` — one per person per day — and whoever covers the leftover hours almost always already has their **own** cell that day. A split is keyed by `date` + shift `type` instead, holding a list of `{employeeId, hours}` entries.

**Why `employeeIds` mirrors `entries`:** Firestore cannot query *inside* an array of objects — `array-contains` needs a flat array of primitives. The [employee-delete guard](employees.md#delete-protection-referential-integrity--2026-06-11) must find "does any split still reference this employee" without a `collectionGroup` scan of every plan's every split doc, so the write path also stores a flat `employeeIds` array purely as an `array-contains` target. Same reasoning as the pre-existing stray-shift-cell check.

#### Endpoints — `functions/src/routes/shifts.ts`

- **`GET /shifts/plans/:planId/splits`** — gated on `shifts.counterTable.view` (the same permission that shows the occupancy table itself). Returns `{ splits: [{ date, type, entries }] }` for every split doc under the plan, silently dropping malformed docs (bad `date`/`type`).
- **`PUT /shifts/plans/:planId/splits/:date/:type`** — gated on `shifts.cells.edit`. **Full replacement** of the entry list for that one `(date, type)`: an empty `entries` array **deletes** the split doc rather than storing `{ entries: [] }`. Validation, in order:
  1. `date` must be `YYYY-MM-DD` and fall inside the plan's own month (derived from the plan doc's `year`/`month`, falling back to the plan id's first 7 characters).
  2. `type` must be one of the 8 counted tags (`isCountedTag`).
  3. `entries` must be an array; each entry needs a non-empty `employeeId` and a `hours` that is `0 < hours ≤ 12` with at most 2 decimal places.
  4. No duplicate `employeeId` across entries ("Zaměstnanec je uveden vícekrát").
  5. Every `employeeId` must be on the plan's roster (`planEmployees`) — "Zaměstnanec není v tomto plánu".
  6. **Double-count rejection:** an employee who already covers that `(date, type)` from their **own** shift cell (`cellHoursForType(cell, type) > 0`) cannot also receive an assignment — "Zaměstnanec už na tento den má tuto směnu v rozpisu" (`shifts.ts:1862-1872`).
  7. **The 12 h cap:** `cellHours` (what real shift cells already contribute that day for that type) **plus** the sum of the submitted `entries`' hours must not exceed `FULL_SHIFT_HOURS` (12) — "Součet hodin přesahuje 12 h" (`shifts.ts:1876-1877`). Only the **12 hours of one shift are ever counted, and nothing more** — this is a hard cap on the assignable remainder, not a proportional split.

  On success the response echoes `{ ok, entries, cellHours, assignedHours, remaining }`.

- **Deliberately NOT gated on plan status.** Every other cell-mutating endpoint respects the plan lifecycle (`created → opened → closed → published`), but this PUT works identically on a **closed or published** plan. A split is a retroactive reporting correction discovered after the fact (the numbers only make sense once the month's real hours are known), so it must stay editable regardless of where the plan is in its lifecycle.

#### `firestore.indexes.json` — mandatory `COLLECTION_GROUP` index

`recepceSummary.ts` reads `db.collectionGroup("shiftSplits").where("date", ">=", from).where("date", "<=", to)`. This requires the `shiftSplits.date` composite index (`COLLECTION_GROUP` scope) added to `firestore.indexes.json`. **Without it deployed, the 4D summary page 500s** as soon as any split doc exists in the target month range — the emulator does not enforce missing indexes, so this failure mode only shows up against real Firestore (see the general index gotcha in [Deployment & Environments](deployment.md)).

#### Occupancy-table UI — `ShiftGrid.tsx`

The split affordance and its two markers apply **only** to the 8 counted desk types (`DA DS DQ DK NA NS NQ NK`) — the porter rows (`DPQ NPQ DPA NPA`) are untouched, both visually and functionally.

- **Clickable cell** — when `onOpenSplitCell` is supplied (wired only for `shifts.counterTable.view` holders), a counted-type cell in the occupancy table opens `ShiftSplitModal` on click/Enter/Space, showing the day's real cell contributors (read-only) and the current manual entries (editable when the caller also has `shifts.cells.edit`).
- **`!` shortfall marker** — shown when the day already has *some* real cell hours for that type (`cellHours > 0`) but the total (`cellHours + splitHours`) is still under 12. A day with **no** cell contribution at all is left blank rather than flagged — otherwise every empty day would light up.
- **`•` split marker** — shown whenever `splitHours > 0`, i.e. a manual split is recorded for that day+type, independent of whether it closed the shortfall.
#### The occupancy number is WHOLE SHIFTS, not people (changed with this feature)

The displayed number was a head count: one bump per matching code segment or `typeTag`, hours ignored. That overstated coverage as soon as a shift was split — `8` + `4`, both tagged `DS`, is **one** DS shift covered but read as `2`.

It is now derived from hours: `shiftsFromHours(occupancyHours)` = `max(1, round(hours / 12))`, and `0` for no hours. So **anything under 18 h reads as 1**, 18 h and up as 2, and so on. All 12 rows use this, porter types included.

`occupancyHours` differs from the 4D credit in exactly one way: it passes `includeDouble: true`, so a **double cell (`DA²`) contributes its full 12 h** instead of 0. The occupancy table answers *"is this shift covered"*, where a double plainly is; the 4D summary answers *"who gets credited"*, where the historical rule is that a double credits nothing. Without the flag a day covered only by a double would render `0` and colour as uncovered.

It also falls back to `parseShiftExpression(rawInput)` when a cell carries no stored `segments` (pre-schema docs), so old cells cannot silently vanish from the table. The 4D credit path deliberately does **not** do this — it must agree with the server byte for byte.

Because the write endpoint caps cell + assigned hours at 12, adding a split can never push a day's `occupancyHours` past one shift, so **a split never changes the displayed number**. It only clears the `!`.

#### Three different tallies over the same grid — the actual source of the original bug

The grid computes **three separate counts** that look similar but answer different questions, and conflating them is exactly what caused the leftover hours to go unattributed in the first place:

| Tally | What it counts | Where |
|---|---|---|
| Occupancy number ("Přehled obsazení") | **Whole shifts**, hours ÷ 12 rounded, min 1; doubles count their full hours | `ShiftGrid.tsx`'s `counterStats.occupancyHours` + `shiftsFromHours` |
| Per-employee "Směny" column | **Rows**, one per cell where `hoursComputed > 6`, regardless of shift *type* | `ShiftGrid.tsx`'s `employeeMonthShifts` (`shift.hoursComputed > 6`) |
| 4D Recepce summary + shortfall/split markers | **Hours**, hour-accurate via `cellHoursForType` (÷12 for a shift-equivalent); doubles count 0 | `services/shiftCounting.ts`, `recepceSummary.ts`, `ShiftGrid.tsx`'s `counterStats.cellHours` |

Manually assigned split hours feed **only** the third tally (and, by extension, the money share the 4D summary derives from shift totals) — they never change the occupancy number, the "Směny" column, or free-shift coverage. User-facing rule (Czech): [`business-rules.md`](business-rules.md), section "Směny".

#### Employee-delete guard extension

`DELETE /api/employees/:id` (`functions/src/routes/employees.ts`) now also blocks when the employee is referenced by any `shiftPlans/*/shiftSplits` doc (`employeeIds array-contains id`), matching the existing stray-shift-cell reasoning documented in [Employees — Delete protection](employees.md#delete-protection-referential-integrity--2026-06-11): a dangling split would otherwise keep crediting shift totals (and money) to a deleted `employeeId` on the Recepce summary forever.

### planEmployee displayOrder auto-management (feature/shift-plan-auto-position)

`displayOrder` is kept contiguous (1..N) per section automatically — no manual bookkeeping needed.

**Add employee** — the dialog defaults to `count(section) + 1`. Changing the section resets the default to the next free slot in the new section. If the user types an existing position, the new employee inserts there and existing employees shift down.

**Edit position** — typing a new `displayOrder` moves the employee to that slot. Moving up (lower number): collisions shift down. Moving down (higher number): the vacated slot closes and the employee lands at the requested position. Section changes compact the leaving section and insert into the new one.

**Delete** — the section is compacted after removal so no gaps remain.

**Backend** — `renumberSection(planRef, section, target?)` in `shifts.ts` handles all three cases. Uses ±0.5 tiebreak offsets so the targeted doc always lands at exactly the requested position regardless of move direction. POST/PUT/DELETE all bump `shiftPlans/{id}.updatedAt` so connected clients reload.

**Frontend** — mutations call `loadPlan(true)` (silent reload — no `setPlan(null)` blank flash) immediately after the API responds, giving instant correct feedback. The `onSnapshot` listener also uses silent mode for background changes from other users.

## Batch 4 — Shifts enhancements

### Volné směny (free shifts)
- Shown on **published** plans to anyone with `shifts.freeShift.claim` or `shifts.freeShift.manage`, **and** on **closed** (`Uzavřený`) plans to holders of `shifts.freeShift.manage` — so managers can prepare the free-shift slots before the plan is published. Gated by the `showFreeShifts` prop = `(status === "published" && canSeeFreeShifts) || (status === "closed" && can("shifts.freeShift.manage"))`.
- `FREE_SHIFT_ROWS` in `ShiftGrid.tsx`: `DPQ`/`NPQ`/`NPA` are standing daily requirements (`auto:true`); `DPA` appears only on admin-marked days. Marked days live in `plan.freeShiftDpaDays[]` (array of `YYYY-MM-DD`), toggled by a `shifts.freeShift.manage` holder clicking a DPA cell → `PATCH /shifts/plans/:id/free-dpa-day`. The DPA toggle (`onToggleDpaDay`) is active in both **published** and **closed** states; **claiming** (`onClaimFreeShift`) stays **published-only**, since closed is a pre-publish setup state.
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
- **Compact name-cell rows + section label** (admin/director): the MOD-count line (`MOD: N (PD/V+S)`, `showModCounts`) shows in **`created`/`closed`/`published`**, the X-limit line **only in `created`/`opened`** — so `created` carries **both** and is the one state where a Management row is two guide lines tall. This partly retires the original "at most one guide line per row" rule (commit `19d383c`, which had the MOD line in `closed`/`published` only): that rule bought compactness at the price of hiding the MOD tally during `created`, which is precisely when the planner is filling the MOD row and needs to see the running balance. `opened` deliberately keeps the X-line alone — that state belongs to employees entering their own requests, not to MOD balancing. `.nameLines` is `display: flex; flex-direction: column`, so the two badges stack with no layout change. The manager section is **displayed as "Management"** via `SECTION_LABELS["vedoucí"]` in `shiftConstants.ts`; the stored section data key stays `"vedoucí"` (display-only rename). (Previously this label was "FOM".) Per-section Σ summary rows have been removed from the grid — sections are now separated by header rows only.
- **Delete gate**: `DELETE /shifts/plans/:id` returns **409 unless `status === "created"`**; the UI hides the delete button otherwise. Deleting a created plan still cascades its sub-collections (`planEmployees`, `shifts`, `shiftsSnapshot`, `modRow`, `rules`, `unavailabilityRequests`, `shiftOverrideRequests`, `shiftChangeRequests`).
- **Click-time timestamp** (#32): a shift-change-request captures `requestedAtClient` at the moment of the double-click (carried through to the POST); the server validates it against a window and falls back to its own serverTimestamp if out of range.
- **Grid remount** (#35): `ShiftGrid` is keyed on the sorted employee-id list so it remounts on membership change, fixing the sticky / `table-layout:fixed` rendering glitch after an employee is removed.
- **DNES** (#53): a button in the month nav, shown only when the user is viewing a month other than the current one.
- **Day/night section ordering**: in `recepce` & `portýři`, day employees (`D`/`DP`) always sort above night (`N`/`NP`), with displayOrder ordering within each group; a 3px `.shiftPeriodDivider` marks the boundary. The single source of truth is `sortSectionEmployees()` (+ `isNightShiftType()`) in `shiftConstants.ts`, used by `ShiftGrid`, the PDF export, and the CSV export so all three match. Auto-grouping overrides cross-group manual displayOrder; the Management (`vedoucí`) section is unaffected.
- **Schedule all transitions from Created** (#56): the deadline bar shows each *upcoming* transition's deadline in every earlier state — so from `created` admin can set Otevření **and** Uzavření **and** Publikování at once (Uzavření also editable in `opened`; Publikování in `opened`/`closed`). The backend `PATCH /plans/:id/deadlines` already accepts any field in any state; `handleDeadlineChange` guards chronological order (open ≤ close ≤ publish). `transitionPlanDeadlines` advances one step per 5-min run, so a full chain cascades created→opened→closed→published as each deadline passes.
