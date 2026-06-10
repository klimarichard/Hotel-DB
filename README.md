# HPM Intranet

HPM Intranet is a cloud-based HR platform for **Special Tours Prague (STP)** and **Hotel Property Management (HPM)**, two Czech hospitality companies. It replaces a stack of Excel workbooks with a single web application for employee records, contract generation, shift planning, vacation tracking, and payroll.

The application UI is in **Czech**. This README and the developer documentation are in English; the end-user manuals are in Czech.

## Features

- **Employees** — central records with AES-256-GCM-encrypted sensitive fields, session-based employment history (Nástup → Dodatek → Ukončení), three-tab lifecycle (Před nástupem → Aktivní → Ukončení with automatic date-driven transitions), document-expiry alerts, and CSV export.
- **Contracts & templates** — a Word-like (TipTap) template editor with variables and conditional blocks; contracts are generated server-side as PDFs.
- **Shifts** — a monthly shift planner with a shift-expression parser, plan lifecycle (Created → Opened → Closed → Published), MOD (manager-on-duty) tracking, change requests, and X-limit rules.
- **Vacation** — request/approval workflow with automatic shift-collision handling.
- **Payroll** — monthly computation from the published shift plan, manual adjustments, notes, period locking, and PDF export.
- **Dashboard, alerts & audit** — a per-role dashboard (Přehled), an alerts hub (Upozornění), and a complete change log (Log změn).
- **Onboarding tour & help** — a guided first-login tour (auto-starts once, fully replayable from Nápověda) that spotlights controls based on each user's permissions; section-jump navigation lets users skip ahead or back a whole page at a time; returning users who have already completed the tour see only a short "Co je nového" card for newly-added features rather than the full tour again; a searchable Nápověda reference page; all permission-driven with no per-role duplicates.
- **Administration** — companies, job positions, departments, education levels, payroll settings, user management, per-role menu ordering, and manual job triggers (Settings → Úlohy).

Granular permission-based access control gates every screen, route, and API endpoint.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript (Vite) — `frontend/` |
| Backend | Firebase Cloud Functions (Express) — `functions/` |
| Database | Firestore (NoSQL) |
| Auth | Firebase Auth with custom role claims |
| File storage | Firebase Storage |
| Contract PDFs | TipTap editor + server-side Puppeteer |
| Encryption | AES-256-GCM (Cloud Functions) |

## Roles

`admin` · `ředitel` (director) · `FOM` (manager / front office manager) · `zaměstnanec` (employee) · `účetní` (accountant) · `personalista` (HR)

## User manuals (Czech)

Per-role manuals — each covers **only** what that role can do in the app. (These may later be surfaced as in-app help.)

- [Administrátor a ředitel](manuals/admin-a-reditel.md)
- [FOM (vedoucí)](manuals/vedouci.md)
- [Zaměstnanec](manuals/zamestnanec.md)
- [Účetní](manuals/ucetni.md)
- [Personalista](manuals/personalista.md)

> When a new role is added, add a matching manual under `manuals/`.

## Developer documentation

Architecture, data model, per-feature implementation notes, and deployment are in **[DOCUMENTATION.md](DOCUMENTATION.md)** (which indexes the topic files under `docs/`).

## Repository layout

```
frontend/    React + TypeScript app (Vite)
functions/   Firebase Cloud Functions (Express API)
docs/        Developer documentation (indexed by DOCUMENTATION.md)
manuals/     Czech per-role user manuals
```
