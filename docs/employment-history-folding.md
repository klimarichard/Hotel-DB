# Employment History: Session Folding & As-Of Reads

This page documents one reusable concept that a **repo-wide correctness sweep (v5.11.14)** put a
name to after it caused the same class of bug in six unrelated places: how to correctly read an
employee's compensation/contract-type/job-title **as of a particular date**, rather than as of
today. If you are about to read anything under `employees/{id}/employment/*` for a date-scoped
purpose — a payroll month, a generated document, a tax period, a year's vacation entitlement — read
this first. The per-module docs ([Employees](employees.md), [Shifts](shifts.md),
[Vacation](vacation.md), [Contracts & Templates](contracts.md)) link back here rather than
repeating the mechanics.

## The model

An employee's employment history lives in `employees/{id}/employment/*`. Each row has:

- `changeType` — `"nástup"` (hire) | `"změna smlouvy"` (Dodatek/amendment) | `"ukončení"`
  (termination) | `"rodičovská"` (parental leave, informational only — never folds into
  compensation).
- `startDate` — the date the change **becomes valid**, not the date it was entered.

Rows group into **sessions**: a Nástup, the Dodatky that followed it, and the Ukončení that closed
it (if any) — see [Employees — Session derivation](employees.md#session-derivation).

**A Dodatek row stores its payload in `changes[]` and has no `salary`, `hourlyRate`, `jobTitle`,
`contractType`, `companyId` or `hoursPerWeek` of its own.** Its `startDate` is the amendment date,
not the hire date. Those fields live only on the session's Nástup row and are *overridden* by
whichever Dodatek `changes[]` entries apply as of the date you care about.

## The bug class

Two read patterns look reasonable and are both wrong for a date-scoped purpose:

1. **Reading the employee root's denormalized `current*` fields**
   (`currentContractType`, `currentJobTitle`, `currentDepartment`, `currentCompanyId` — see
   [Data Model](data-model.md)) inside anything scoped to
   a month/year/date gives **today's** value. Those fields are re-folded nightly at 00:00 Europe/Prague
   by `refreshEmployeeEffective` and on every employment write by `computeEffectiveRootFields`
   (`functions/src/routes/employees.ts`) — correct for lists, filters, delete guards and
   current-staff dashboards, and wrong for anything anchored on a different date. A Dodatek that
   switches PPP → HPP from 1 October is invisible in these fields while a September plan for
   October is being filled.
2. **Picking "the latest employment row"** — `.orderBy("startDate", "desc").limit(1)`,
   `rows[rows.length - 1]`, `.find(r => r.status === "active")` — returns a row that is **empty**
   for every compensation field once that row is a Dodatek. On production this affected **31 of 96
   active employees** (the export/questionnaire/tax-declaration bug below) and, independently, **21
   active employees** (the job-position rate-cascade bug below): anyone who had ever received an
   amendment.

Both patterns silently produce blanks or stale values — no error, no exception, just a wrong number
on a payslip, a blank field on a signed PDF, or an incorrectly-sized X-day limit.

## The shared fold API

### Backend — `functions/src/services/payrollCalculator.ts`

```ts
interface EffectiveComp {
  salary: number | null;
  hourlyRate: number | null;
  contractType: string;
  jobTitle: string;
  hoursPerWeek: number | null;
  positionChanged: boolean;         // a "pracovní pozice" Dodatek moved the employee off the Nástup position
  companyId: string;                // Dodatky never move an employee's company
  nastupStartDate: string;          // the session's Nástup date — the real hire date, never a Dodatek's
  sessionEndDate: string | null;    // the session's effective end, or null while open-ended
}

function effectiveCompAsOf(rows: EmploymentRowLite[], asOfDate: string): EffectiveComp | null;
function effectiveCompFromRows(rows: EmploymentRowLite[], year: number, month: number): EffectiveComp | null;
```

- **`effectiveCompAsOf(rows, asOfDate)`** is the date-anchored fold. It finds the session in force
  on `asOfDate` and folds the Nástup plus every Dodatek whose `startDate` has arrived by that date.
- **`effectiveCompFromRows(rows, year, month)`** is the month-scoped fold used by payroll and the
  shift planner. Since v5.11.14 it **delegates to `effectiveCompAsOf`**, anchored on the month's
  last day, so the month and date paths cannot drift apart the way two independent
  implementations previously could.
- **Fallback behaviour, important:** when no session is in force on the given date, the fold falls
  back to the **last** session rather than returning `null` — a not-yet-started hire shows what
  they are joining as, and a leaver shows the contract they left from. Returning `null` there is
  exactly what the old export/questionnaire/tax-declaration blanks looked like, so a caller adding
  a new use of this function should not "fix" this fallback without checking what it's protecting.
  `null` is returned only when the employee has **no** employment rows at all.

Both functions are pure and unit-tested; `EmploymentRowLite` is the minimal row shape (no UI-only
fields) shared by every server-side caller.

### Frontend — `frontend/src/lib/employmentSessions.ts`

```ts
function computeEffectiveState(
  nastup: EmploymentRow,
  dodatky: EmploymentRow[],
  ukonceni: EmploymentRow | null,
  asOfDate: string = clock.today()
): EffectiveState;

function groupBySession(rows: EmploymentRow[]): EmploymentSession[];
```

`computeEffectiveState` is the frontend twin of `effectiveCompAsOf`/`foldSessionAsOf` — same fold
logic (Nástup + applicable Dodatky), one session at a time, over the same `changes[]` change kinds
(see [Employees — Session derivation](employees.md#session-derivation) for the full kind-by-kind
list, incl. the legacy `úvazek`/`počet hodin` split).

⚠️ **`groupBySession` deliberately still folds every session as of *today*** (its default
`asOfDate` parameter) — that is correct for the session cards on the employee detail page and Můj
profil, which are meant to show current state (see "Deliberate non-changes" below). **A caller that
needs a specific date must call `computeEffectiveState` directly** with an explicit `asOfDate`,
rather than assuming `groupBySession`'s output is date-flexible. This is exactly the mistake the
v5.11.14 `EmployeeDetailPage.tsx` fix had to route around — see the per-row generation context call
site below.

## Anchor-choice rule

Every call site anchors the fold on a different date, chosen by what the read is *for* — this is
the part to get right when adding a new one:

| Context | Anchor | Why |
|---|---|---|
| Payroll month / shift-plan month | the month's **last day** (use the month variant, `effectiveCompFromRows`) | A Dodatek counts for the month once its validity has arrived by the month's end. |
| Document generated for an employment row | **that row's own `startDate`** | Includes the row itself, so a Dodatek's generated PDF states the newly agreed values; `{{oldSalary}}` supplies the "before" side separately. |
| Tax-period document | that period's **year end** (`${year}-12-31`) | The employer/contract stamped on a back-year declaration must be the one in force at the end of that tax year, not today's. |
| Annual vacation entitlement | **`${year}-01-01`** | The whole year's entitlement is sized by the contract in force on 1 January of the year being seeded. |
| Year-overview table | **`${year}-12-31`** | The year's final contract type is the figure the year's Zůstatek is reconciled against. |
| Current-state read (dashboards, lists, "what does this look like right now") | **`clock.today()`** | **Not** the month variant — anchoring a current-state read on "this month's last day" would wrongly count a Dodatek that hasn't taken effect yet but is dated later in the current month. |

`clock.today()` / `clock.now()` (not `new Date()`) so the non-prod test clock still drives these
folds — see [Deployment — Test clock](deployment.md).

## Call sites fixed in v5.11.14

Every one of these read a stale or empty value before this sweep; none of them are payroll
*calculation rules* (those live in the local, gitignored `payroll.md`) — they are all instances of
the read pattern above.

- **`functions/src/routes/shifts.ts` — `contractTypesForMonth()`.** Both the plan `GET
  /shifts/plans/:planId` (the `contractType` shown per employee, which sizes the X-limit line under
  their name) and the self-service X-limit rule inside the cell-write transaction now size the
  8 HPP / 13 PPP monthly limit by the contract in force **in the plan's own month**, via
  `effectiveCompFromRows`, instead of today's root `currentContractType`. Filling in October's plan
  during September no longer offers 13 Xs to someone whose Dodatek switches them to HPP on 1
  October. See [Shifts — Contract type as of a plan's month](shifts.md#contract-type-as-of-a-plans-month-v51114)
  and the updated [business rule](business-rules.md#limity-vlastního-volna-x-podle-typu-smlouvy).
- **`functions/src/services/payrollCalculator.ts` (×2 — the batch orchestrator and the single-row
  recalc).** `contractType` precedence was `currentContractType || eff?.contractType` — the
  opposite order from `salary`/`jobTitle`/`hoursPerWeek` on the adjacent lines, which all correctly
  prefer the fold. Because `refreshAllPublishedPayrollPeriods` recomputes every published unlocked
  period **daily**, a Dodatek stamped its new contract type onto already-computed **earlier**
  months every night until the period was locked. `contractType` drives `isDpp`, `resolveHourlyRate`
  and the PPP vacation factor, so this silently rewrote historical pay logic. Fixed to
  `eff?.contractType || currentContractType || …`, matching the other fields' precedence.
- **`frontend/src/pages/EmployeeDetailPage.tsx` — per-row contract/document generation.** Folds as
  of the row's own `startDate` via `computeEffectiveState(rowSession.nastup, rowSession.dodatky,
  null, r.startDate)` (called directly, **not** through `groupBySession`, for the reason noted
  above). Also fixes the `endDate` subtlety: when a fold is available its `endDate` is authoritative
  and is **not** `??`-chained onto the parent Nástup — a "délka smlouvy" Dodatek with an *empty*
  value means "změna na dobu neurčitou" (`endDate: null`), and falling through to the parent's
  `endDate` there would print the **original fixed end date** on the very document that abolishes
  it. See [Employees — Dodatek/Ukončení generation context](employees.md#dodatekukončení-generation-context).
- **`functions/src/routes/employees.ts`:**
  - `GET /employees/export` — the employment block in the CSV export now folds as of `clock.today()`
    instead of reading the latest row; before the fix, "Ve firmě od" showed the amendment date
    instead of the hire date for 31 of 96 active employees, and salary/contract-type/company columns
    were blank for the same rows.
  - `GET /:id/questionnaire-pdf` — `jobTitle` and `startDate` now resolve from **one** fold anchored
    on today, instead of two different points in time (`root.currentJobTitle` for the job title,
    the latest employment row's `startDate` for the date) that could disagree with each other.
  - `GET /:id/tax-declaration-pdf?period=…` — anchors on the tax period's **year end**
    (`${periodYear}-12-31`), not today. Previously `employment.companyId` was read off the latest
    row; since a Dodatek carries no `companyId`, this *always* fell through to
    `root.currentCompanyId` (today's company), silently stamping the current employer onto a
    back-year declaration after a company transfer.
- **`functions/src/routes/jobPositions.ts` — the hourly-rate cascade (`analyzeHourlyRateCascade`).**
  Two independent fixes:
  - **Read side.** `isManualOverride` (does this employee's current rate already differ from the
    position default?) now compares against `effectiveCompAsOf(rows, today).hourlyRate` instead of
    the most-recent-active row's `hourlyRate`. 21 production employees with an amendment previously
    read as `null` and were falsely flagged "ručně upraveno" in the confirmation dialog.
  - **Apply side.** The cascade now writes the new rate to the session's **Nástup** row (plus any
    Dodatek in the same session that already carries its own `hourlyRate`, so the fold genuinely
    changes) instead of "whatever the latest row was". Writing a rate onto a Dodatek would have made
    it take effect only from that Dodatek's `startDate`, not from today, which is what the cascade
    promises. `AffectedEmployee.employmentId` (a single row id) was replaced with `rateRowIds:
    string[]` — server-internal, the frontend never read the old field.
  - **Unchanged on purpose:** the `status === "active"` row-level gate that decides which employees
    are even candidates for the cascade — see "Deliberate non-changes" below.
- **`functions/src/routes/vacation.ts` — `GET /vacation/ledger-overview`.** `contractType` per row
  now folds as of `${year}-12-31` (the year being viewed), instead of reading
  `root.currentContractType`. Previously opening a past year after an HPP→PPP Dodatek showed "PPP"
  next to a Nárok the rollover had sized as HPP for that year — the two columns on the same row
  contradicted each other. `employmentEndDate` on this same response is **deliberately still read
  from the root field**, not `sessionEndDate` — see "Deliberate non-changes".
- **`functions/src/services/vacationYearRollover.ts` — `rolloverVacationEntitlement`.** The
  contract type that sizes a new year's Letošní entitlement (HPP 160 / PPP 80 / DPP 0) now folds as
  of `${year}-01-01`, with `currentContractType` staying only as the fallback for legacy/seeded
  records with no employment rows at all. The scheduled 1 January 01:00 run is behaviourally
  unchanged (it happens to agree with today's root value at that instant), but this job is also
  manually re-runnable for an arbitrary year — a March re-run for an employee whose HPP→PPP Dodatek
  took effect 1 March would otherwise hand out 80 h for a year that opened as HPP.

## Deliberate non-changes

Not everything that reads a session as-of-today was "fixed" — these stay exactly as they were,
on purpose:

- **Employment session cards** on the Zaměstnanec detail page and Můj profil still render
  as-of-today (`groupBySession`'s default). Product decision: these cards answer "what does this
  person's contract look like right now", not "what did it look like on some other date".
- **Ad-hoc and bulk standalone documents** (Multisport, Hmotná odpovědnost, custom standalone
  templates via `resolveStandaloneEmployment()`) keep resolving `{{currentJobTitle}}` /
  `{{currentCompanyId}}` from today's root fields. Product decision: these documents are generated
  "as of now", not tied to a specific employment row.
- **`GET /vacation/ledger-overview`'s `employmentEndDate`** stays a read of the root field, not
  `sessionEndDate` from the fold. It drives the year-membership filter ("did this employee leave
  before the selected year?"), which needs the employee's **final** termination date;
  `sessionEndDate` would conflate a fixed-term contract's end with an actual termination, and would
  drop terminated rows whose root end date is blank — rows the filter deliberately keeps.
- **The job-position rate cascade's `status === "active"` gate** (`functions/src/routes/jobPositions.ts`)
  is preserved exactly as it was — it is a row-level `status` check, known to lag the derived
  employee `status` (nothing flips a Nástup row to `"inactive"` when an Ukončení row is later
  added). It was **not** widened as part of this fix, so the cascade's breadth (which employees are
  even considered) is unchanged; only the value it reads/writes for the employees it already
  reached was fixed.
- **Historical LOCKED payroll periods are never auto-recalculated.** `refreshAllPublishedPayrollPeriods`
  only touches published, unlocked periods, so a period that was locked before the contractType
  precedence fix above landed keeps whatever value it was locked with. As of v5.11.14, 37 entry rows
  across 6 employees in production carry a contract type that disagrees with the contract actually
  in force that month — a known, accepted discrepancy in already-locked history, not a bug to chase
  further.

## See also

- [Employees — Session derivation](employees.md#session-derivation) — the kind-by-kind Dodatek
  `changes[]` fold (mzda, pracovní pozice, úvazek, délka smlouvy…), shared between
  `computeEffectiveState` and `foldSessionAsOf`.
- [Data Model — Denormalized fields on `employees` root doc](data-model.md)
  — what `current*` is for and who refreshes it.
- [Shifts — Contract type as of a plan's month](shifts.md#contract-type-as-of-a-plans-month-v51114).
- [Business rules — Limity vlastního volna (X) podle typu smlouvy](business-rules.md#limity-vlastního-volna-x-podle-typu-smlouvy).
