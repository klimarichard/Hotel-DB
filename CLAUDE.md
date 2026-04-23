# HPM Intranet — Claude Guidelines

## Git Workflow

- **Always create a new branch before making any changes.** Never work directly on `master`.
- Branch naming: `feature/short-description`, `fix/short-description`, `chore/short-description`
- **Commit after every logical step** on the branch — don't batch everything into one commit.
- **Only the user decides when to merge and push.** Never do either without explicit instruction.
- **Never delete branches** — they serve as backups.
- Use clear, descriptive commit messages explaining *why*, not just *what*.
- **Before any `git push`**, update `CLAUDE.md` + `README.md` (implementation details) and project memory as the last commit on the branch.

## Data Safety — TOP PRIORITY

- If there is **any suspicion** an operation could compromise, corrupt, or delete data — **stop and tell the user immediately**.
- This applies to: Firestore migrations, schema changes, bulk updates, deleting collections/documents, changing encryption keys, modifying Cloud Functions that write to the database, or anything touching production data.
- When in doubt: **ask first, act second.**
- Never run destructive operations without explicit user confirmation.
- `ENCRYPTION_KEY` must never be changed once data is stored — doing so makes all encrypted fields unreadable.

## Database Backups

- When deployed to production, **scheduled Firestore backups must be in place** (daily minimum, separate GCS bucket).
- Before any migration or bulk operation in production, a manual backup must be confirmed first.

## Project Overview

A cloud-based HR management platform for a Czech hospitality company (Special Tours Prague / STP, Hotel Property Management / HPM). Replaces Excel workbooks for employee records, contract generation, shift planning, and payroll.

Full technical spec: `HR_App_Specification.docx` (excluded from git). Key sections: roles & permissions (§3), DB schema (§4), shift expression parser (§8.3), payroll calculation rules (§9.3).

### Technology stack
| Layer | Technology |
|---|---|
| Frontend | React + TypeScript (Vite) — `frontend/` |
| Backend | Firebase Cloud Functions (Express) — `functions/` |
| Database | Firestore (NoSQL) |
| Auth | Firebase Auth with custom role claims |
| File storage | Firebase Storage |
| Contract generation | TipTap WYSIWYG + html2pdf.js (client-side PDF) |
| Encryption | AES-256-GCM in Cloud Functions |

### Firebase project
- Project ID: `hotel-hr-app-75581`
- Web App ID: `1:261269048570:web:9bb9e3b02efac0c31d8d43`
- Functions emulator port: **5002** (not 5001 — that port is taken on this machine)

### Roles
`admin` → `director` → `manager` → `employee` (least privileged).
Custom claims set via Firebase Admin SDK; stored on `users/` Firestore collection.

Frontend enforces role gating in two layers (see README → "Route & menu role gating"):
- **Menu** in `frontend/src/components/Layout.tsx` hides privileged links.
- **Routes** in `frontend/src/App.tsx` wrap privileged pages in `<RequireRole allow={[…]}>`, which redirects unauthorized roles to `/`.

When adding a new page, add both — the route guard is the real gate; the menu entry is for discoverability. Backend endpoints must still enforce the role independently.

### Sensitive encrypted fields
AES-256-GCM encrypted in Cloud Functions — never store in plaintext or return raw to frontend:
- `employees.birthNumber` (rodné číslo)
- `documents.idCardNumber`
- `benefits.insuranceNumber`, `benefits.bankAccount`

Every reveal is logged to `auditLog/`.

### Settings page
Uses a **tab-based layout** — every new settings section must be a new tab, never appended below.

### Modal dismissal
Modals close **only** via explicit buttons (✕, Zrušit, or the action button) — never on backdrop click. Clicking the overlay was dismissing half-edited forms and causing data loss. When adding a new modal, do not wire `onClick={onClose}` onto the overlay `<div>`.

### Shared `<Button>` component
Use `frontend/src/components/Button.tsx` for any new text-bearing button. Variants: `primary` | `secondary` | `danger` | `ghost`. Sizes: `sm` | `md`. Passes through native `<button>` props (`type`, `disabled`, `onClick`, `style`, etc.). `block` prop makes it full-width.

Out of scope (keep local CSS): toolbar buttons (TipTap `toolBtn`/`varBtn`), inline field togglers (`revealBtn`, `clearBtn`), row-level status pills (green `approveBtn`, red-outline `rejectBtn`), month nav (`navBtn`).

### Shared `<IconButton>` component
Use `frontend/src/components/IconButton.tsx` for modal-header close (`✕`) and other icon-only dismissal buttons. Only variant today is `close`. `aria-label` is a required prop because the visible content is a glyph — screen readers need the label. Passes through native `<button>` props like `<Button>`.

Out of scope (keep local CSS): `empActionBtn` (7px on-hover row action, shift grid), `revealBtn` / `navicRevealBtn` (opacity-based field togglers), and the one-off micro-actions `lockBtn` / `nemocBtn` / `notesDashBtn` / `removeChangeBtn`. `themeToggle` / `logoutBtn` are text-bearing buttons despite their CSS names; if ever shared, they would move to `<Button>`, not `<IconButton>`.

## Development

### Backend build step
After any change to `functions/src/`, run:
```
cd functions && npm run build
```
Then restart emulators. The emulator runs compiled JS from `functions/lib/` — forgetting this means the old code keeps running silently.

### Running locally
```
# Terminal 1 — Firebase emulators
node "C:\Users\Richard Klima\AppData\Roaming\npm\node_modules\firebase-tools\lib\bin\firebase.js" emulators:start

# Terminal 2 — Frontend dev server
cd Hotel-DB/frontend && npm run dev
# → http://localhost:3000
```

### Environment files (not in git)
- `functions/.env` — contains `ENCRYPTION_KEY`
- `frontend/.env` — contains `VITE_FIREBASE_*` config values

### Known issues / quirks
- Firebase CLI must be run via full path until PATH is refreshed in a new terminal session.
- PowerShell execution policy blocks `.ps1` scripts — use `cmd` or full `node` path.
- Node.js v24 at `C:\Program Files\nodejs\node.exe` — not always on PATH.
- Auth after emulator restart: existing sessions are invalidated — users must log out and back in.
- **Date arithmetic in the browser**: never use `new Date("YYYY-MM-DD").toISOString()` — in UTC+2 it returns the previous day. Use `new Date(y, m-1, d)` (local time) and format with `getFullYear/Month/Date`.

## Implementation details

See `README.md` for full implementation notes: Firestore schema, build phase status, feature-level notes, and post-merge fix history.

## TODO list

A local `TODO.md` file exists in the project root (gitignored — not tracked in git). It contains the prioritised backlog of features, bugs, and improvements. Read it at the start of a session if you need context on what to work on next.
