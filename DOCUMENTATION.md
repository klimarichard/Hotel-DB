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
| [Authentication, Roles & Permissions](docs/auth-and-permissions.md) | Login + password reset, the configurable permission model (catalogue + editable user types + per-user grants/revokes), `requirePermission` enforcement, the admin type/permission UI, and per-role menu order. |
| [Employees](docs/employees.md) | Employee module, session-based employment history, `Můj profil` self-service. |
| [Shifts (Shift Planner)](docs/shifts.md) | Shift-expression parser, monthly grid, MOD badges, shift-change requests, X-limits, plan lifecycle. |
| [Vacation (Dovolená)](docs/vacation.md) | Request/approval workflow, pendingEdit pattern, shift-collision handling. |
| [Contracts & Templates](docs/contracts.md) | Contract types, TipTap template editor, server-side PDF generation, template variables. |
| [Other Features & UI](docs/other-features-and-ui.md) | Dashboard (`Přehled`), audit log, `Upozornění` hub, dark mode, shared UI components, companies. |
| [Onboarding Tour & Nápověda](docs/onboarding-and-help.md) | Guided first-login tour, permission/exclude gating, demo-route mock architecture, tour persistence, and the Nápověda Help page. |
| [Deployment & Environments](docs/deployment.md) | Project aliases, deploy scripts, Secret Manager, Firestore indexes, manual triggers, test clock. |

## Local-only references (not committed to git)

These live in the working tree but are gitignored:

- `payroll.md` — the canonical payroll-computation reference (calculation rules, cascades, `payrollPeriods/*` schema, locking/recalc, DPP/FAKTURA, Multisport, notes). All payroll detail lives here, intentionally not in the docs above.
- `CLAUDE.md` — working guidelines and project conventions for the AI assistant.
- `TODO.md` / `TODO_BIG.md` — the prioritised backlog.
