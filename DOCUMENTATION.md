# HPM Intranet — Developer Documentation

Master index of the developer / implementation documentation for the **HPM Intranet** (formerly "Hotel HR App") — a cloud HR platform for Special Tours Prague (STP) / Hotel Property Management (HPM).

Looking for how to *use* the app? See the per-role Czech user manuals in **[`manuals/`](manuals/)** (also linked from the [README](README.md)).

## Technology stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript (Vite) — `frontend/` |
| Backend | Firebase Cloud Functions (Express) — `functions/` |
| Database | Firestore (NoSQL) |
| Auth | Firebase Auth with custom role claims |
| File storage | Firebase Storage |
| Contract generation | TipTap WYSIWYG + server-side Puppeteer PDF |
| Encryption | AES-256-GCM in Cloud Functions |

Firebase project: `hotel-hr-app-75581` (production), `hote-hr-app-staging` (staging).

## Topics

| Document | Covers |
|---|---|
| [Data Model & Build Phases](docs/data-model.md) | Firestore top-level collections, sub-collections, denormalized fields, and build-phase status. |
| [Authentication, Roles & Permissions](docs/auth-and-permissions.md) | Login + password reset, the configurable permission model (catalogue + editable user types + per-user grants/revokes), `requirePermission` enforcement, the admin type/permission UI, per-role menu order, the phone-only `mobilePermission` gating pattern, and the `sharedTerminal` user-type flag (Recepce write attribution). |
| [Employees](docs/employees.md) | Employee module, session-based employment history (incl. parental-leave RODIČOVSKÁ rows with optional end date), concurrent contracts (simplified model — latest active contract wins), PPP part-time `hoursPerWeek` field, minimum-wage non-blocking warning, non-+420 phone format modal, `Můj profil` self-service (signed-contract-only history filter + self contract download), self document-expiry alerts + Můj profil badge. |
| [Shifts (Shift Planner)](docs/shifts.md) | Shift-expression parser, monthly grid, MOD badges, structured shift-change-request picker + auto-apply on approval, double-click X on open plans, X-limits (incl. server-side self-service enforcement), plan lifecycle, numeric-cell shift-type tagging (per-type tally), optimistic-concurrency cell guard. |
| [Vacation (Dovolená)](docs/vacation.md) | Request/approval workflow, pendingEdit pattern, shift-collision handling. |
| [Recepce (Reception)](docs/recepce.md) | Permission-driven per-hotel hub (Ambiance/Superior/Amigo & Alqush/Ankora); per-user default hotel (`recepceDefaultHotel`, self-service + admin write paths); Předávací protokol (cash/trezor counting, sm/sm-trezor/wata, virtual dual-signature handover, freeze-on-sign, element-level history + undo/redo, coalesced typing edits, single "created" floor entry); Walkiny and Taxi (visible-range gating, global taxi ceník, manager Provize total); Lobby bar (Ambiance only — server-side snapshotted price/provision/doSpolecne per sale, per-currency item ceník + provision rates); Terminál (Amigo & Alqush only — enum transaction types + optional note, manage-only "Předáno" settlement flag); shared-terminal write attribution (`sharedTerminal` roleType flag → `resolveRecepceActor`/`resolveOnDutyActor`, `viaUid`/`viaEmail`); recepce retention sweep; mobile-only `recepce.mobile.view` gating pattern; and an internal low-profile summary page (`recepce.summary.view` — see docs/recepce.md). |
| [Contracts & Templates](docs/contracts.md) | Contract types, TipTap template editor, server-side PDF generation, template variables (incl. PPP `{{hoursPerWeek}}` / `{{newHoursPerWeek}}` / `{{isDodatekHodiny}}`), editable variable overview at generation time. |
| [Other Features & UI](docs/other-features-and-ui.md) | Dashboard (`Přehled`), audit log, `Upozornění` hub, dark mode, mobile responsiveness (`BottomNav`, breakpoints, card-on-mobile), shared UI components, companies. |
| [Onboarding Tour & Nápověda](docs/onboarding-and-help.md) | Guided first-login tour, permission/exclude gating, demo-route mock architecture, tour persistence, and the Nápověda Help page. |
| [Deployment & Environments](docs/deployment.md) | Project aliases, deploy scripts, Secret Manager, Firestore indexes, manual triggers, test clock. |

## Local-only references (not committed to git)

These live in the working tree but are gitignored:

- `payroll.md` — the canonical payroll-computation reference (calculation rules, cascades, `payrollPeriods/*` schema, locking/recalc, DPP/FAKTURA, Multisport, notes). All payroll detail lives here, intentionally not in the docs above.
- `CLAUDE.md` — working guidelines and project conventions for the AI assistant.
- `TODO.md` / `TODO_BIG.md` — the prioritised backlog.
