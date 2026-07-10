# Recepce (Reception)

This document covers the **Recepce** feature area: the per-hotel hub, the Předávací
protokol (shift handover), Walkiny (walk-in sales), Taxi, and the cross-cutting
concurrency/retention/permission machinery that supports them. Everything here is
new — there is no legacy predecessor to reconcile against.

## Overview & hub

`frontend/src/pages/RecepcePage.tsx`, route `/recepce/:hotel?/:tab?`. A single hub
page for four hotels, each with its own tab set. Access is **entirely
permission-driven** — there is no `users.hotel` field or custom claim gating a
hotel; visibility is derived purely from the caller's permission set:

- `accessibleHotels(can)` — the hotels the user holds `recepce.<stem>.view` for, in
  the fixed display order Ambiance → Superior → Amigo & Alqush → Ankora.
- `visibleTabs(hotel, can)` — the tabs of a hotel the user holds the tab's
  `recepce.<stem>.<tab>.view` key for.
- With zero accessible hotels the page shows a "Žádný přístupný hotel" notice.
  With exactly one accessible hotel the user drops straight into it (the hotel
  pill bar still renders, so the user always sees which hotel they're on).
- The URL is **canonicalized** (`navigate(..., { replace: true })`) whenever the
  `:hotel`/`:tab` param is missing, invalid, or inaccessible, so deep-links
  degrade gracefully to a valid selection. The last-used hotel is remembered in
  `localStorage` (`recepce.lastHotel`) as the fallback when no `:hotel` param is
  present.

### Hotel registry — `frontend/src/lib/hotels.ts` (frontend) / `functions/src/services/hotels.ts` (backend)

Both files are the single source of truth for the slug → shift-code → label →
permission-key-stem mapping (they can't share code across packages — keep them in
sync manually, same rule as `parseShiftExpression`).

| Slug | Shift code | Label | Permission stem | Tabs |
|---|---|---|---|---|
| `ambiance` | `A` | Ambiance | `ambiance` | Předávací protokol, Walkiny, Taxi, Lobby bar |
| `superior` | `S` | Superior | `superior` | Předávací protokol, Walkiny, Taxi |
| `amigo-alqush` | `Q` | Amigo & Alqush | `amigo` | Předávací protokol, Walkiny, Taxi, Terminál |
| `ankora` | `K` | Ankora | `ankora` | Předávací protokol, Walkiny, Taxi |

**⚠️ Slug↔stem asymmetry**: the URL slug `amigo-alqush` maps to permission-key
stem `amigo` (keys are `recepce.amigo.*`). This mapping exists **only** in these
two registry files — never hard-code the stem elsewhere.

**Lobby bar** (Ambiance only) and **Terminál** (Amigo & Alqush only) are
placeholder tabs today — `LobbyBarTab.tsx` / `TerminalTab.tsx` render a
"Připravujeme" (coming soon) notice. Their `recepce.<stem>.lobbyBar.view` /
`recepce.amigo.terminal.view` permission keys exist and gate the tab already, so
no catalogue change will be needed when they ship.

### Mobile gating — `recepce.mobile.view`

Recepce is desktop-oriented (dense grids/tables) but reception staff also need it
from a phone at the desk. Rather than a blanket phone block, a **second,
phone-only permission** narrows *who* gets the bottom-nav entry and the route on a
phone, independent of desktop access:

- `MenuItem.mobilePermission` (`frontend/src/lib/menuItems.ts`) — when set, the
  item is dropped from `BottomNav`'s item list on a phone unless the user also
  holds this key (`Layout.tsx`: `!m.mobilePermission || can(m.mobilePermission)`).
  The desktop sidebar is unaffected.
- `RequirePermission`'s `mobileAllow` prop (`frontend/src/App.tsx`) — ANDs an
  extra permission onto the route guard **only when `useIsPhone()` is true**;
  failing it redirects home. Desktop access via `allow` is untouched.
- Both are wired for the `/recepce*` routes with `mobilePermission="recepce.mobile.view"`.
  A user can hold `nav.recepce.view` (desktop access) without `recepce.mobile.view`
  and simply not see/reach Recepce on a phone.

This is a general-purpose mechanism (not specific to Recepce) — any future page
that should be desktop-first but phone-optional for a subset of users can reuse
the same two fields. See also [Auth, Roles & Permissions — mobile-only
gating](auth-and-permissions.md#mobile-only-gating-mobilepermission--mobileallow).

## Permission model

The **Recepce** catalogue group (`functions/src/auth/permissions.ts`,
`frontend/src/lib/permissions/catalog.ts`) holds **41 keys**, plus the
`nav.recepce.view` master in the "Stránky / navigace" group — **42 Recepce-related
keys total**:

- **Global (3):** `recepce.sm.manage` ("Spravovat sm"), `recepce.taxi.manageRates`
  ("Spravovat ceník taxi"), `recepce.mobile.view` ("Zobrazit Recepci na mobilu").
- **Per-hotel (38, ~9-10 per hotel):** `recepce.<stem>.view` (hotel master) +
  `recepce.<stem>.protokol.{view,create,delete,manage}` +
  `recepce.<stem>.walkiny.{view,manage}` + `recepce.<stem>.taxi.{view,manage}` +
  `recepce.ambiance.lobbyBar.view` (Ambiance only) +
  `recepce.amigo.terminal.view` (Amigo & Alqush only).

**No built-in user type is granted any Recepce permission by default** —
`BUILTIN_TYPE_PERMISSIONS` has no `recepce.*` entries for `director`/`manager`/
`employee`/`accountant` (only `admin` gets everything via `system.admin`
expansion). Recepce access must be granted explicitly per user type or per user
in Nastavení → Uživatelské typy / per-user Oprávnění — this is by design (front
desk staff are typically not `director`/`manager`), but it means **a fresh
environment needs Recepce permissions granted in-app before anyone but admin can
use the feature.**

### Per-key semantics

| Key pattern | Confers |
|---|---|
| `recepce.<stem>.view` | Hotel appears in the hub's hotel pill bar at all. |
| `recepce.<stem>.protokol.view` | Read the hotel's protokol tab **and** create/edit its content (the `protokol.view` key confers edit — anyone who can open the tab can fill it in; see `handoverEditPerm` in `services/hotels.ts`). |
| `recepce.<stem>.protokol.create` | Create a **brand-new** protokol from scratch (bootstrap). Not needed to continue an already-signed previous shift (see "Create exception" below) or to edit an existing one. |
| `recepce.<stem>.protokol.delete` | Delete a protokol document. |
| `recepce.<stem>.protokol.manage` ("Spravovat protokol") | Revert **someone else's** signature (self-unsign needs only a valid password, no permission); lock/unlock individual Poznámky/Účty rows; add/subtract the "wata" scalar. |
| `recepce.sm.manage` ("Spravovat sm") | Global: edit the shared sm rates (`settings/sm`), transfer sm→sm trezor, clear sm trezor — across **all** hotels. |
| `recepce.<stem>.walkiny.view` | See the Walkiny tab; add/edit/delete entries (subject to the visible range for non-managers). |
| `recepce.<stem>.walkiny.manage` ("Spravovat walkiny") | Set the visible date range; see/add entries with no range restriction. |
| `recepce.<stem>.taxi.view` | See the Taxi tab; add/edit/delete rides (subject to the visible range for non-managers). |
| `recepce.<stem>.taxi.manage` ("Spravovat taxi") | Set the taxi visible date range; see/add rides with no restriction; see the manager-only Provize total. |
| `recepce.taxi.manageRates` ("Spravovat ceník taxi") | Global: edit the shared common-routes ceník (`settings/taxiRoutes`) — all hotels. |

`system.admin` always satisfies every Recepce gate, on both frontend and backend.

## Předávací protokol (shift handover)

`frontend/src/pages/recepce/HandoverTab.tsx` (frontend), `functions/src/routes/handovers.ts`
+ `functions/src/services/handoverShared.ts` + `functions/src/services/handoverHistory.ts`
+ `functions/src/services/scheduleLookup.ts` (backend).

### Data model

```
hotels/{hotelSlug}/shiftHandovers/{shiftDate}_{shiftType}   -- shiftType: "den" | "noc"
```

```ts
interface HandoverDoc {
  shiftDate: string;              // YYYY-MM-DD
  shiftType: "den" | "noc";
  notes?: NoteRow[];               // { id, text, done, locked? }
  cashCounts?: {                   // per-denomination piece counts
    kasaCZK: Record<string, number>;   // "5000".."1"
    trezorCZK: Record<string, number>;
    kasaEUR: Record<string, number>;   // "500".."1"
    trezorEUR: Record<string, number>;
  };
  accounts?: AccountRow[];         // { id, name, amount, locked? } — free-form Účty rows
  smCounts?: number[];             // [c1, c2, c3] — per-protocol sm counts
  smTrezor?: number;                // accumulated scalar, carries shift→shift
  wata?: number;                    // free +/- scalar, carries shift→shift, may go negative
  predal?: StampedSignature | null;
  prevzal?: StampedSignature | null;
  histSeq?: number;                 // undo/redo cursor bookkeeping
  histCursor?: number;
  createdBy?, updatedBy?, createdAt?, updatedAt?;
}
```

Per-protocol change history: `hotels/{hotel}/shiftHandovers/{id}/history/{seq}`
(zero-padded seq, see "History & undo/redo" below).

Global (shared across all four hotels): `settings/sm` (`{ rates: [r1,r2,r3] }`) and
`settings/taxiRoutes` (see Taxi below).

### Cash / trezor counting

A shift's protokol counts **KASA** (till) and **TREZOR** (safe), separately for
**CZK** (denominations 5000…1) and **EUR** (500…1), as piece counts per
denomination. `sanitizeDenomMap` drops non-finite/negative values and zero counts
(no entry = 0 pieces).

### Účty — three special rows + free-form rows

Above the free-form Účty rows (name + CZK amount, added via "+ Přidat účet") sit
three special rows, all backed by dedicated endpoints rather than the generic
content PUT:

1. **`sm`** — the protocol's own `smCounts: [c1,c2,c3]`. Its **CZK value is the
   dot product** `Σ rateᵢ·cᵢ` against the **global** rates in `settings/sm`
   (`readSmRates()` / `dot()` in `handovers.ts`). Editable by any protocol-edit
   user via the normal content PUT (`smCounts` flows through it); the *rates*
   themselves are `recepce.sm.manage`-only (`PUT /handovers/sm/rates`).
   `GET /handovers/sm/rates` is open to anyone who can see Recepce
   (`nav.recepce.view`) since the row's CZK value needs it to render.
2. **`sm trezor`** — an accumulated scalar. `POST /:hotel/:id/sm-transfer`
   (body `{ transfer: [t1,t2,t3] }`, `recepce.sm.manage`) MOVEs: subtracts the
   (clamped-to-available) transfer amounts from `smCounts`, adds their CZK dot
   product to `smTrezor`. `POST /:hotel/:id/sm-trezor/clear` resets it to 0.
   **Always carries forward** shift→shift — seeded server-side from the previous
   shift's `smTrezor` on create (never from the client body, so the manage gate
   can't be bypassed at creation time).
3. **`wata`** — a free +/- scalar (`POST /:hotel/:id/wata`, body `{ delta }`,
   gated by the hotel's `protokol.manage`). May go negative. Also **always
   carries forward** shift→shift, seeded the same way as `smTrezor`.

### Notes (Poznámky) & lockable rows

`NoteRow { id, text, done, locked? }`. Checking a note `done` strikes it through.
`AccountRow { id, name, amount, locked? }` — likewise lockable.

**Locking**: any `protokol.manage` holder may lock/unlock a Poznámky or Účty row.
A **locked** row can only be changed by a `manage` holder — `mergeLockable()` in
`handovers.ts` enforces this server-side on every content PUT: for a non-manage
caller, any stored row with `locked: true` is preserved verbatim regardless of
what the client sent for that row id, and a non-manage caller can never newly set
`locked: true` on an incoming row (`{ ...inc, locked: false }`).

### Virtual signature (Předat / Převzít / revert)

Handover is confirmed by **two independent password checks**, not by the logged-in
session — a shared front-desk terminal is typically logged in as one generic
account, but Předat/Převzít must attribute the action to the actual person signing
off.

- **`frontend/src/lib/secondaryAuth.ts`** — a **second Firebase App instance**
  (`initializeApp(config, "secondary")`) holds its own `Auth`. `verifyCredential(username, password)`
  signs in on this secondary instance, captures the resulting `idToken`, then
  **always signs the secondary instance back out** (`finally`) — the primary
  session (`auth.currentUser`) is never touched. `usernameToEmail()` applies the
  same `@hotel.local` convention as the login page.
- `SignModal.tsx` — a shared credential-prompt component (name dropdown + password
  field) used for Předat, Převzít, and self/manage-unsign. Closes only via its
  buttons (✕/Zrušit), never backdrop click, per the project modal rule.
- The frontend POSTs `{ idToken }` to `POST /handovers/:hotel/:id/predal` or
  `.../prevzal` (sign) or `.../predal/revert` / `.../prevzal/revert` (unsign).
  The backend independently `admin.auth().verifyIdToken(idToken)`s it — the
  *logged-in* caller's `requireHotelPerm("edit")` only gates that they're allowed
  to *initiate* a sign/revert action on this hotel; the *signer identity* comes
  entirely from the password-verified token, decoupled from who is logged in.
- **Sign rules**: a slot can't be signed twice (409); `prevzal` requires `predal`
  first (400); the same person can't be both `predal` and `prevzal` on one
  protocol (400).
- **Revert rules**: `predal` can't be reverted while `prevzal` stands (would
  orphan it, 400). Authorized to revert: the **signer themself** (self-unsign,
  no permission needed beyond a valid password) or a `protokol.manage`/
  `system.admin` holder.
- **Signer pool** — `GET /:hotel/signers?date=&shift=` returns the users eligible
  to sign: everyone whose linked employee is in that month's shift plan, falling
  back to **all active users** when the month has no plan (never dead-ends
  signing). Also returns `scheduled: { predal, prevzal }` — the employees actually
  rostered for this shift (Předal) and the next one (Převzal), resolved via
  `scheduleLookup.ts`'s `scheduledSigner()` (matches `D`/`ZD` day or `N`/`ZN`
  night reception segments for the hotel), used as the modal's pre-selected
  default.
- **Revoker pool** — `GET /:hotel/revokers?signer=<uid>` is narrower: the signer
  themself, plus everyone holding the hotel's `protokol.manage` (resolved via
  `resolveEffectivePermissions` per candidate user — this endpoint evaluates
  effective permissions for a set of *other* users, not the caller).

### Freeze on signature

Once **either** `predal` or `prevzal` is set, the protocol's **content is
frozen** for everyone except `system.admin` (`PUT /:hotel` checks
`(before?.predal || before?.prevzal) && !isAdmin(req)` → 403). This includes the
sm-transfer, sm-trezor-clear, and wata mutations (`loadForFieldMutation` applies
the identical check). **Undo/redo is frozen for everyone, with no admin
override** — an admin can still hand-edit a signed protocol's fields directly,
but cannot rewind its history; reverting a signature is the only way back into
undo/redo.

### Non-consecutive handover warning ("Nenavazující předání")

`syncChainWarning()` (called after every sign/revert) compares this shift's
`predal.uid` against the **previous** shift's `prevzal.uid`. A mismatch means the
person signing this shift over wasn't the one who received the prior shift — a
chain break, upserted as a `handoverWarnings/{hotel}_{id}` doc:

```
handoverWarnings/{hotel}_{shiftDate}_{shiftType} = {
  hotel, handoverId, shiftDate, shiftType,
  actorUid, actorName,        // who signed THIS shift's predal
  expectedUid, expectedName,  // who was expected (prev shift's prevzal)
  createdAt, read, readAt, readBy
}
```

Self-healing: cleared automatically when the chain re-aligns (re-sign, revert).
Surfaced on the **Upozornění → Nenavazující předání** tab
(`frontend/src/pages/upozorneni/HandoverWarningsTab.tsx`, `GET/POST /api/handover-warnings`,
`functions/src/routes/handoverWarnings.ts`) — read/unread mirrors the
`alerts`/`probationAlerts` pattern (`POST /handover-warnings/read`). Gated on the
existing **`changeRequests.review`** permission (no new key). **Not** included in
the sidebar `/upozorneni` badge total (which still sums the original six review
queues) — it's a data-integrity flag, not a review backlog item.

### History & undo/redo

`functions/src/services/handoverHistory.ts`. Every content PUT is diffed at the
**element level** — one record per changed note / účet / cash denomination / sm
count — against a per-protocol `history` subcollection (one small doc per change,
not an on-doc array, to avoid O(n) rewrite cost on every save):

- **Creation floor.** A protocol's very first history entry is always a
  synthetic `{ target: { kind: "created" } }` change (`createdChange()`), never a
  diff against an empty document — carrying a signed shift's content forward
  would otherwise record every note, účet, denomination and sm count as a
  separate "Přidáno…" entry. Its label is `"Protokol vytvořen"` for a blank
  create, or `"Protokol vytvořen převzetím z předchozí směny"` when the previous
  shift's protocol was fully signed at creation time (`prevClosed` in
  `handovers.ts` — covers both "Vytvořit prázdný protokol" landing on an
  already-signed chain and "Vytvořit protokol pro další směnu"). It carries no
  `before`/`after` and `applyChange` is a no-op on it. It is the **floor of the
  undo stack**: `planUndo` returns `null` once the cursor reaches it (you cannot
  undo the protocol into existence — deleting the doc is `DELETE
  /:hotel/:id`'s job), and `canUndoRedo` correspondingly reports `canUndo:
  false` at that point, so the Undo button never offers a step that would 409.
- **Diff** (`diffHandover`) compares before/after snapshots of the four content
  fields (`notes`, `accounts`, `cashCounts`, `smCounts`) on every save **after**
  creation and emits Czech-labelled `HandoverChange` records (e.g. `"Poznámka
  změněna: „a“ → „b“"`, `"Hotovost kasa 500 Kč: 3 → 5 ks"`, `"SM počet #1: 10 →
  12"`).
- **Coalescing free-typing edits.** Content autosaves ~800 ms after the last
  keystroke, so typing one Poznámka would otherwise produce a fresh history
  entry per thinking-pause. A save carrying **exactly one** change to a
  "typing" field (`note.text`, `account.name`, `account.amount`, any `cash`
  denomination, any `sm` count — `isTypingField()`) is a coalescing candidate:
  `tryCoalesce()` folds it into the entry at the **tip** of the stack instead of
  appending a new one, provided the tip is by the same `byUid`, not `undone`,
  there is no redo tail (`histCursor === histSeq`), and it's within
  `COALESCE_WINDOW_MS` (2 minutes) of the tip's `at`. Two shapes fold:
  - **same field edited again** — the merged entry keeps the tip's *original*
    `before` (so one Undo reverts the whole edit, not just the last keystroke);
    `after` and the label are updated to the new value (`labelFor()` rebuilds the
    label from the before/after pair, since the entry's stored label described
    only the slice of edit that produced it, not the merged span).
  - **a field of the row the tip entry itself just added** — e.g. typing into a
    freshly-added Poznámka's text keeps the whole thing a single `"Přidána
    poznámka…"` entry rather than an "added" entry followed by a "changed" one.
  - If a fold would return the field to its value **before the tip entry**
    (typed, then undone by hand within the window), the entry is **deleted
    outright** and the cursor rewinds to `prevActiveSeq` — "typed it, then
    deleted it" leaves no trace in the history panel at all.
  - A save carrying more than one change (a bulk edit — paste, or an add+remove
    in one flush) is never a coalescing candidate, only a single-change save is.
- **Undo/redo is a command-pattern cursor** (`histCursor`/`histSeq` on the parent
  doc). Undo moves the cursor back and applies the *inverse* of one change; redo
  moves forward and re-applies; a brand-new edit **truncates the redo tail**
  (deletes history entries above the cursor). Scoped to a single protocol
  document — can never reach across shifts.
- Money moves (sm→trezor, wata) and signatures are **not** part of the content
  PUT and therefore never enter history or the undo stack.
- `GET /:hotel/:id/history` returns entries newest-first plus `canUndo`/`canRedo`;
  `POST /:hotel/:id/undo` / `.../redo` step the cursor.
- **Audit log**: one **compact** entry per save (`event: "recepce.protokol.edit"`,
  up to 6 change labels in `extra.changeLabels`) — the element-level detail lives
  in the `history` subcollection, not duplicated into `auditLog`. **Skipped on
  creation** (guarded by `beforeSnap.exists && changes.length > 0`) — `logCreate`
  already stands for the whole new document there, including its `created`
  history entry, so creating a protocol writes exactly one audit entry, not two.
  Undo/redo write their own compact events (`recepce.protokol.undo` / `.redo`).
- **Attribution.** Every history entry's `byUid`/`byEmail` is the resolved actor
  (see "Shared-terminal write attribution" below) and carries
  `viaUid`/`viaEmail` when that actor was substituted from a Převzal signature
  rather than being the session account.

### Concurrency guard (optimistic, no realtime channel)

`firestore.rules` block direct client SDK reads — every read and write goes
through Cloud Functions (see the "Real-time reload" note in
[Shifts — Phase 5](shifts.md#phase-5--shift-planner) for the same boundary
applied to the shift grid) — so an `onSnapshot` listener is impossible and the
protocol has no realtime channel. Two mechanisms cover this:

1. **Compare-and-swap on save.** The client sends `baseUpdatedAt` (the millis of
   the `updatedAt` Timestamp it currently holds; `null` means it believes it is
   *creating*). The server computes the stored doc's millis the **same way** the
   client does (`tsMillis()` — `seconds*1000 + floor(nanos/1e6)`, duplicated
   verbatim frontend/backend so they agree bit-for-bit) and rejects with **409**
   if it doesn't match — "created by someone else", "deleted by someone else", or
   "edited by someone else" get distinct messages. This check runs **before** the
   freeze/create-permission checks, so a genuine external-change race surfaces as
   a reload conflict, not a confusing 403.
2. **Poll + focus refetch.** `HandoverTab` polls `GET /:hotel/:id` every 15s while
   `document.visibilityState === "visible"`, and on `window` focus /
   `visibilitychange`. If the server's `updatedAt` has moved and the user has **no
   unsaved edits**, it silently reloads (`applyDoc`). If the user **has** unsaved
   edits, it raises a non-destructive banner (`externalChange` state) offering to
   reload — never auto-discards local work.

Every write endpoint that returns the saved document (`PUT` content, sign,
revert, sm-transfer, sm-trezor-clear, wata, undo, redo) returns the **full
persisted doc** from the same request handler (a same-invocation read-back),
rather than requiring the client to issue a separate GET — the comment in
`handovers.ts` notes the hosting→function read-after-write round trip was racy.

### Print

Once both signatures are present (`predal` **and** `prevzal`), "Tisk protokolu"
(`window.print()`) becomes available — the tour step gates it on
`DEMO_PROTOKOL_SIGNED`.

### "Vytvořit protokol pro další směnu"

After `prevzal` is set, a button duplicates the current shift's cash/účty/notes
into the **next** shift's protocol (`predal`/`prevzal` excluded — the new doc has
no signatures), or simply navigates to it if it already exists. Implemented
client-side in `createNextShift()` (`HandoverTab.tsx`): `GET` the next shift's doc
(404 → not yet created), else `PUT` a fresh one with the current content, then
`onNavigate()` into it — the created/fetched doc is handed to the target editor
directly so it renders without a racy read-after-write GET.

**Poznámky marked `done` are NOT carried to the next shift** — only the still
outstanding ones are. `createNextShift()` filters `notes.filter((n) => !n.done)`
client-side before the `PUT`; the same rule is additionally enforced **server-
side** as an invariant on the PUT's create branch (`incomingNotes.filter((n) =>
!n.done)`, only applied `!beforeSnap.exists` — see `handovers.ts`), so a
`done` note can never slip into a brand-new protocol no matter what the client
sends. A note ticked off *during* the shift that just ended stays behind with
that shift's record — not even struck through in the new one, simply absent.

### Blank-create ("Vytvořit prázdný protokol") frontend gate

The empty state's "Vytvořit prázdný protokol" button is **hidden** whenever the
*previous* shift's protocol both exists and is fully signed (`predal &&
prevzal`) — on mount, `HandoverTab.tsx` probes `GET /:hotel/:id` for the previous
shift (`prevHandedOver` state) and, when that comes back true, shows a hint to
open that protocol and use "Vytvořit protokol pro další směnu" instead (the only
path that actually carries `smTrezor`/`wata`/outstanding poznámky forward). An
**unsigned or missing** previous protocol still shows the blank-create button, so
the handover chain can never deadlock waiting on a previous shift that may never
get signed.

⚠️ **Known limitation — frontend-only gate.** This is enforced **only** in the
UI. `PUT /:hotel` — the very same endpoint both the hidden button and "Vytvořit
protokol pro další směnu" call — cannot distinguish the two flows server-side; it
has no signal for "the client arrived via the button that should have been
hidden": a carry-over from an *empty* previous protocol and a blank create send
byte-identical bodies. A client that bypasses the UI (a stale tab, a direct API
call) can therefore still create a blank protocol when the previous shift is
signed. The running balances survive it — `smTrezor`/`wata` are seeded
server-side from the previous shift on **every** create, never from the body —
but the outstanding poznámky and účty that "Vytvořit protokol pro další směnu"
would have carried across are silently lost. Accepted as a UX nudge against an
easy mistake, not a data-integrity guarantee.

### Create exception

Creating a **brand-new** protocol (no doc exists yet for that shift) normally
needs `recepce.<stem>.protokol.create`. **Exception**: if the *previous* shift's
protocol is fully signed (`predal && prevzal`), no `create` permission is needed —
continuing a signed handover chain is treated as part of ordinary `protokol.view`
edit access, not as "starting from scratch". `smTrezor`/`wata` seed from the
previous shift regardless of which path created the doc.

## Walkiny (walk-in sales)

`frontend/src/pages/recepce/WalkinsTab.tsx`, `functions/src/routes/walkins.ts` +
`functions/src/services/walkinShared.ts`.

### Data model

```
hotels/{hotelSlug}/walkins/{autoId} = {
  date: string;            // YYYY-MM-DD
  employeeId: string;
  employeeName: string;    // snapshotted at entry time (survives employee edits)
  resNo: string;           // č. rezervace v Protelu
  amount: number;
  currency: "CZK" | "EUR"; // never converted between the two
  createdBy?, updatedBy?, createdAt?, updatedAt?;
}
hotels/{hotelSlug}/config/walkins = { from: string|null, to: string|null }  -- visible range
```

### Continuous table + visible range

`GET /:hotel` returns every entry, **newest first** (`orderBy("date","desc")`,
no composite index needed — one field). **Managers** (`walkiny.manage` or
`system.admin`) see everything; everyone else is bounded by the hotel's visible
**date range**, applied **in-app** (not via a Firestore query) so a one-sided
range (only `from` or only `to`) gates just that one side. Non-managers adding,
editing, or deleting an entry are 403'd (`"Datum je mimo povolené období."`) if
the entry's date falls outside the range — checked against **both** the old and
new date on edit.

### Employee dropdown

`GET /:hotel/employees?date=` returns the employees to pick from: everyone active
in that date's month shift plan (deduped by `employeeId`). When the month has **no
plan**, it falls back to non-terminated employees whose `currentJobTitle`
case-insensitively matches a fixed reception-role set
(`WALKIN_FALLBACK_POSITIONS`: recepční, portýr, noční portýr, noční recepční,
front office manager, senior front office manager, director of front office,
general manager) — so the dropdown is never empty even before a plan exists.

## Taxi

`frontend/src/pages/recepce/TaxiTab.tsx`, `functions/src/routes/taxi.ts` +
`functions/src/services/taxiShared.ts`.

### Data model

```
hotels/{hotelSlug}/taxiRides/{autoId} = {
  date: string; time: string;       // "HH:MM" or "" (roundtrips may omit it)
  room: string; pax: number | null;
  routeName: string;                 // "" = "Other" (custom) ride
  amount: number; provision: number; // snapshotted from the route, or manual for "Other"
  note: string;                      // mandatory for "Other"
  createdBy?, updatedBy?, createdAt?, updatedAt?;
}
hotels/{hotelSlug}/config/taxi = { from: string|null, to: string|null }  -- visible range
settings/taxiRoutes = { routes: TaxiRoute[] }   -- GLOBAL common-routes ceník
```

```ts
interface TaxiRoute { id: string; name: string; price: number; provision: number; roundtrip: boolean; }
```

### Global routes ceník

A shared price/provision list across all four hotels (`settings/taxiRoutes`).
`GET /taxi/routes` is readable by anyone in Recepce (`nav.recepce.view`, needed to
fill the ride form); `PUT /taxi/routes` is gated on the global
`recepce.taxi.manageRates`. Editing (`RoutesModal` in `TaxiTab.tsx`) supports
add/remove/reorder (array position **is** the persisted order) and a `roundtrip`
flag that makes the ride form's time field optional for that route.

### Ride entry

Picking a route from the "Destinace" dropdown **auto-fills and locks** the
amount + provision fields from the route's ceník values; picking **"Jiné…"**
(`OTHER` sentinel, no `routeId`) makes amount manual and requires a note
explaining the ad-hoc destination. Time is required unless the selected route is
a roundtrip (or it's "Jiné…", where time is always required). Same visible-range
gating as Walkiny (`taxi.manage` bypasses; others bounded, checked in-app).

### Manager-only "Provize" total

`TaxiTab.tsx` — visible only to `taxi.manage` holders (`canManage`), it sums the
`provision` field over the rides falling inside the **effective visible period**
(the saved range, re-applied client-side since managers receive *all* rides
unfiltered from the API — `visibleProvize` in `TaxiTab.tsx` mirrors the backend's
one-sided range semantics). Rendered above the toolbar, right-aligned to match the
rides table's right border.

## Shared-terminal write attribution

`functions/src/services/recepceActor.ts`. The front desk typically runs on a
**shared terminal** — one generic account stays logged in all day and every
receptionist uses it — so attributing history/audit entries to that account
records nothing useful ("recepce" edited the protokol tells you nobody edited
it). The person actually at the desk already proved their identity, though: they
signed **Převzal** on the *previous* shift's protocol with a password check (see
"Virtual signature" above) — that signature *is* the handover, so it names
whoever is standing at the desk now.

### `sharedTerminal` roleType flag

A boolean field on `roleTypes/{id}` (`RoleTypeData.sharedTerminal`; see also
[Auth & Permissions — User types](auth-and-permissions.md#user-types-editable-data)),
edited via the **"Sdílený terminál"** checkbox in Nastavení → Uživatelské typy
(alongside the existing "Vedení" checkbox). Attribution substitution only
happens when the caller's session user type has this flag set — it defaults to
`false` for every type, including all the seeded built-ins. A manager or admin
who opens Recepce from their own personal account holds an ordinary user type,
so they are attributed to themselves, exactly as everywhere else in the app.

⚠️ **Post-deploy step.** Because the flag defaults to `false`, this feature is a
no-op until an admin explicitly ticks "Sdílený terminál" on the reception user
type in Nastavení → Uživatelské typy. Deploying the code alone changes nothing
observable — attribution keeps naming the shared account until the flag is set.

### Resolvers

- **`resolveRecepceActor(req, hotel, shiftDate, shiftType)`** — attribution for a
  write against **one named protocol**: the person who signed Převzal on the
  shift immediately before it. Exact by construction (no clock involved) — the
  protocol being edited says which shift it belongs to. Used by the protokol
  content `PUT`, undo/redo, sm-transfer, sm-trezor/clear, and wata.
- **`resolveOnDutyActor(req, hotel)`** — attribution for **Walkiny and Taxi**
  entries, which are filed against a date but not a shift: the newest
  `prevzal.at` signature across the hotel's protocols (`orderBy("prevzal.at",
  "desc").limit(1)` — `prevzal.at` is a scalar subfield, so Firestore's
  automatic single-field index already serves this query), ignored (falls back
  to the session account) if older than **36 hours** (`ON_DUTY_MAX_AGE_MS`) —
  covers a long shift plus a chain left unsigned overnight, without attributing
  a write to someone who went home two days ago. Used by the Walkiny/Taxi entry
  `POST`/`PUT`/`DELETE` handlers.

Both resolvers fall back to the plain **session actor** (`sessionActor(req)`) —
never block or error — whenever: the caller's type isn't `sharedTerminal`, there
is no previous protocol, the previous protocol has no Převzal signature, the
signature has no resolvable `uid`, or any lookup throws. Every fallback path is
the session account; attribution resolution failing never blocks a write.

### What is / isn't substituted

- **Substituted**: protokol content `PUT`, protokol undo/redo, sm-transfer,
  sm-trezor/clear, wata (all via `resolveRecepceActor`); Walkiny + Taxi entry
  create/update/delete (via `resolveOnDutyActor`).
- **Deliberately NOT substituted**:
  - **Signature endpoints** (`predal`/`prevzal` stamp + revert) — they already
    record the password-verified signer directly (see "Virtual signature"
    above); there is nothing to substitute.
  - **Config endpoints** — the Walkiny/Taxi visible `range` (per hotel) and the
    global Taxi `/routes` ceník — stay on the ordinary `ctxFromReq(req)` context.
    These are manager/admin actions on shared configuration, not shift-floor
    activity, so the session account is the correct attribution as-is.

### `viaUid`/`viaEmail` — the substitution is never silent

When an actor is substituted, the **session account is preserved**, never
discarded:

- `RecepceActor.viaUid`/`viaEmail` carry the shared-terminal session's uid/email.
- `actorCtx(actor)` (adapts a `RecepceActor` to `AuditContext`, shape-compatible
  with `ctxFromReq`) copies them onto `AuditContext.viaUid`/`viaEmail`; the audit
  writer's `baseEntry()` stamps them onto `AuditEntry.viaUid`/`viaEmail` (dropped
  by `stripUndefined` at write time for an ordinary, non-substituted login — see
  [Other Features & UI — Audit log](other-features-and-ui.md#audit-log--log-změn)).
- `appendHistory()`'s `HistoryActor.viaUid`/`viaEmail` are stamped onto
  `HistoryEntry.viaUid`/`viaEmail` the same way, feeding the protokol history
  panel.

So an entry attributed to the on-shift receptionist still records *which
terminal session* the write physically came through — the substitution adds
information, it never loses any.

## Retention sweep

`functions/src/services/recepceRetention.ts`, scheduled export `sweepRecepceHistory`
in `functions/src/index.ts` — `onSchedule("0 0 * * *", { timeZone: "Europe/Prague" })`,
i.e. daily at 00:00 Prague time (same cadence as the other daily sweeps).

Deletes only the **change history** of the Recepce features once it's 6 months or
older (`RETENTION_MONTHS = 6`), computed from the [test clock](deployment.md#test-clock-non-prod-time-override)
so it can be exercised on staging without waiting for real time:

- `auditLog` entries whose `collection` is `shiftHandovers`, `walkins`, or
  `taxiRides` (the compact per-save summaries + money/signature entries) older
  than the cutoff.
- The per-protocol `history` subcollections (a `collectionGroup("history")` query
  on the `at` field — the sole reason `firestore.indexes.json` declares a
  `fieldOverrides` exemption for `history.at`, see
  [Deployment — Firestore indexes](deployment.md#firestore-indexes)).

**It never touches the live business records** — taxi rides, walk-in sales, and
protocol documents themselves persist forever; only their audit/history trail
ages out. Manual re-run: `POST /api/recepce/trigger-retention-sweep`, gated
`system.triggers` (same pattern as the other manual-trigger jobs, writes a
`manual-trigger` audit entry). Not wired into Settings → Úlohy yet — curl or a
future addition to `JobsTab.tsx`.

## Guided tour & demo routes

14 permission-driven Recepce tour steps, added at `appTour.version: 12`
(`frontend/src/lib/tours/appTour.ts`), covering: the `nav-recepce` sidebar entry
(1), the full Předávací protokol walkthrough (9 steps: shift toolbar, cash/trezor
counting, Účty, sm/sm-trezor/wata special rows, Poznámky, signatures, next-shift
creation, history/undo-redo, print — plus a separate "založení protokolu" step),
Walkiny (2: table, add form), and Taxi (2: ride table + "Jiné…", ceník). All are
`hideOnMobile: true` — they spotlight wide grids/tables that don't lay out on a
phone; only the top-level `nav-recepce` step (which points at the "Více" sheet on
phones via `mobileAnchor: "bottomnav-more"`) survives on mobile.

**Demo architecture** — `RecepceDemoPage.tsx` wraps a single real tab
(`HandoverTab`/`WalkinsTab`/`TaxiTab`) fed by mock fixtures, mounted at dedicated
`/napoveda/ukazka-*` routes:

| Route | Scenario | Purpose |
|---|---|---|
| `/napoveda/ukazka-protokol` | `protokol` | Populated, unsigned protocol |
| `/napoveda/ukazka-protokol-prazdne` | `protokol-empty` | No record → "Založit protokol" button |
| `/napoveda/ukazka-protokol-podepsany` | `protokol-signed` | Both signatures present → next-shift + print buttons |
| `/napoveda/ukazka-walkiny` | `walkiny` | Populated walk-ins table |
| `/napoveda/ukazka-taxi` | `taxi` | Populated rides + routes ceník |

Mock responses are served by `frontend/src/lib/tours/demoData.ts`'s
`getDemoResponse()` intercept (the same single wiring point used by every other
tour demo — see [Onboarding Tour & Nápověda — demo-route
architecture](onboarding-and-help.md#demo-route-architecture)); non-GET requests
are swallowed, so the tour can never write real data even from a Recepce demo tab.

**Hotel choice on the demo page** — among the hotels the current user can access,
`RecepceDemoPage` prefers one where the user also holds the tab's **manage** key
(`protokolCreatePerm`/`protokolManagePerm`, `walkinyManagePerm`, `taxiManagePerm`),
so manager-only controls the tour spotlights (protokol create button, the
walkiny/taxi visible-range editor, the taxi Provize total) actually render for
that step. Users with no accessible hotel simply render nothing (they never reach
these steps — permission-gated away upstream).

## Server-side shift business-rule enforcement (self-service X)

Not Recepce-specific, but shipped in this batch and load-bearing for the
Předávací protokol's staffing assumptions (the `recepce` shift-plan section feeds
`scheduledSigner()` above). Previously, the shift-planner X-limit, coverage, and
consecutive-day rules were **client-advisory only** — a determined or buggy
client could write an X that violated them. `functions/src/routes/shifts.ts`
(`PUT /shifts/plans/:planId/shifts/:employeeId/:date`) now enforces all three
**server-side inside a Firestore transaction**, for a self-service X entry by a
caller who lacks `shifts.xAllowance.manage`/`system.admin` (managers/admin still
bypass; approved overrides and vacation-auto-fill write via other code paths and
are unaffected):

1. **Max 6 consecutive voluntary X** (`consecutiveXRun`) — hard block, no admin
   override at this layer (an admin editing directly bypasses the whole
   transaction path).
2. **Monthly X limit** — 8 (HPP) / 13 (PPP), or the admin's
   `xLimitOverride` when the employee has an approved vacation that month.
3. **Coverage** — at least 5 `recepce`-section employees of the same primary
   shift type (`D`/`N`) must remain available (not on X) after this write.

**Transaction-based serialization** — the transaction reads the shift-plan doc
itself (`tx.get(planRef)`) purely to add it to the transaction's read set, then
writes an `updatedAt` bump to it alongside the cell write. Because Firestore's
optimistic-concurrency model conflicts any two transactions that read a document
one of them writes, **every concurrent self-service X-write on the same plan now
conflicts on that shared read**, closing a coverage-check race (including the
"phantom new-cell" case, where the racing X is a brand-new cell the day-query
never saw). A `RuleBlock` thrown inside the transaction surfaces as **403** with
the Czech violation message; a stale `baseRawInput` (see below) throws
`CellConflict`, surfacing as **409**.

## Optimistic-concurrency guard on the shift plan grid

Applies the same "no realtime channel, so poll + compare-and-swap" pattern as the
Předávací protokol, on the shift-plan cell grid:

- **Backend** (`shifts.ts`) — the cell `PUT`/`DELETE` accept an optional
  `baseRawInput` (body for PUT, query string for DELETE) — the `rawInput` the
  client believes is currently stored. If the stored value has moved, the request
  409s with `{ conflict: true, current }` instead of silently clobbering a
  colleague's edit. Applied identically on both the self-service transaction path
  and the manager/admin direct-write path.
- **Frontend** (`ShiftPlannerPage.tsx`) — polls `GET /shifts/plans` every 15s
  while the tab is visible, and on focus/visibilitychange, comparing the selected
  month's plan `updatedAt`. **Skipped while a cell `<input>`/`<textarea>` is
  focused** (`document.activeElement` check) so a background poll can't disrupt
  active typing or invalidate the in-progress save's compare-and-swap base. On a
  detected change it calls `loadPlan(true)` — a **silent** reload that updates the
  plan in place without blanking the grid.

## Naming & UI conventions

- **En dashes only.** Visible frontend text uses en dashes (`–`), never em dashes
  (`—`) — e.g. date ranges ("Od – Do"), the RecepceDemoPage title
  ("Recepce – Ambiance"). Keep this convention when adding new Recepce (or any
  other) UI copy.
