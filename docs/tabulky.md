# Tabulky (Směnárna + ČNB)

A standalone top-level page (`/tabulky/:tab`) for calculation tables that belong to no single hotel. Introduced in **v4.14.0** with one tab, **Směnárna + ČNB**, ported from `excels/smenarna_cnb.xlsx`. Deliberately built as a hub so later tables slot in without restructuring.

## Shell

Mirrors the Recepce hub minus the hotel dimension.

- **`frontend/src/lib/tabulky.ts`** owns the tab registry (`TABULKY_TABS: {id, label, viewPerm}[]`) — not the page component, exactly as `lib/hotels.ts` does for Recepce. Gating is **by omission**: `visibleTabulkyTabs(can)` filters the array, so a tab the user cannot see never enters it, can never be selected, and never mounts.
- **`frontend/src/pages/TabulkyPage.tsx`** renders the tab bar and canonicalizes the URL. The canonicalizing effect is gated on `authLoading` — `useAuth` starts with an empty permission set, so acting earlier would redirect away from a tab the user can actually see.
- Two `<Route>`s (`tabulky`, `tabulky/:tab`), one per URL arity, both wrapped in `RequirePermission allow={["nav.tabulky.view"]}`.
- `hideOnMobile: true` on the menu entry — the tables are too wide to fill in on a phone. Matches `Šablony smluv`; like that precedent it hides the phone nav entry only, the URL still resolves.

Adding a tab: registry entry + permission key in all four catalogues + a case in `TabulkyPage`'s `TabBody`. **`"tabulky"` is in `VALID_IDS` in `functions/src/routes/menuOrder.ts`** — an id missing there is silently stripped from every saved menu order, so the page works but sits permanently at the bottom of the menu with no error anywhere.

## Permissions

| Key | Level | Meaning |
|---|---|---|
| `nav.tabulky.view` | 0 | the page |
| `tabulky.smenarna.view` | 1 | the Směnárna tab, and every backend read/write it makes |

Own **Tabulky** section in the matrix, between Recepce and Zaměstnanci (that position also fixes where it reads in Nápověda, which orders sections by `PERMISSION_SECTIONS`). Granted to **no** built-in type, mirroring Recepce — `admin` gets both via the `system.admin` wildcard; everyone else needs an explicit grant.

## Rates: `GET /api/exchange/rates`

Returns the three global sm rates from `settings/sm` to prefill *kurz u nás*.

**It is not a reuse of `GET /handovers/sm/rates`**, which is gated on `nav.recepce.view`: Směnárna's users need not have Recepce access, so reusing that route would 403 exactly the people the page is for, and widening its gate would make one permission mean two things. Same data, same `readSmRates()` helper (exported from `routes/handovers.ts`), separate gate. Read-only — the rates are owned by the Recepce sm row and edited there under `recepce.sm.manage`.

> ⚠️ **Positional coupling.** The three rates are deliberately unlabelled in the sm modal (no "Kurz"/"Kurzy" text anywhere, by requirement), so nothing in `settings/sm` records that `rates[0]` means euro. The calculator maps `[0,1,2] → € / $ / £` **by convention** and renders the symbol + ISO code beside each prefilled rate so a mismatch is visible at a glance. Reorder the sm badges and the sm row keeps totalling correctly (a dot product is order-independent) while this page would misprice silently.

## The calculator (`pages/tabulky/SmenarnaTab.tsx`)

Rows are free-text labels, **one shared list across all four blocks**, seeded with `AMBI / SUP / A&A / ANKORA` and freely renamed, added, removed.

1. **PŘEDKLÁDÁM / POŽADUJI** — a CZK note swap over `CZK_DENOMS`. It **need not balance**: a shortfall is funded from the exchange money (see below). PŘEDKLÁDÁM carries a `ze směnárny` column = `max(0, POŽADUJI − PŘEDKLÁDÁM)`.
2. **SMĚNÁRNA** — € / $ / £ amounts × two rate triples → `CELKEM směnárna` (kurz ČNB), `CELKEM u nás` (kurz u nás), `ROZDÍL` = the margin, and `zbývá ze směnárny`.
3. **Ideální složení** — the note mix to request, plus **Změny nominálů** beside it.

### `zbývá ze směnárny` — the spreadsheet's H column

```
zbývá ze směnárny = CELKEM směnárna − (POŽADUJI − PŘEDKLÁDÁM)
```

Restored verbatim from `H20 = $F20-($O11-$O3)`. A *surplus* of presented notes makes the difference negative and therefore **adds** to what remains — that falls out of the formula rather than needing a special case.

**Red fires exactly when this value is negative**, i.e. neither the presented notes nor the exchange money can fund POŽADUJI. Mere inequality is not an error. One computed value drives both the column and the alert, so they cannot drift apart.

`CELKEM směnárna` deliberately stays **raw** rather than becoming the netted figure, so the row still reconciles on screen: `směnárna − u nás = rozdíl`. The spreadsheet made the same choice — its `I` column reads `F`, not `H`.

### Decomposition (`frontend/src/lib/denominations.ts`)

`decompose(amount, available5000)` is a greedy cascade; `decomposeAll(rows, pool)` decomposes 2N piles (per row: the guest money at our rate, and the margin) that must be formed as **separate physical piles** from one delivery.

- **5000 is capped** at however many the exchange office actually handed over (the `směnárna` row's 5000 cell, default 0 → behaves exactly like the original spreadsheet). The calculator never *asks* for 5000s.
- The pool goes to the **largest amounts first**. Not for note count — each 5000 absorbed saves the same three notes wherever it lands — but because the small margin rows cannot fit a 5000 at all, so a top-down pass could strand notes.
- ⚠️ Greedy is provably minimal for CZK only because the denomination system is **canonical**. Capping a denomination breaks that guarantee in general; it survives here only because the cap is on the largest denomination and everything below stays unbounded, so after the cap the remainder is an ordinary canonical greedy run. **Cap a second denomination and this reasoning no longer holds.**

`CZK_DENOMS` / `EUR_DENOMS` were lifted here from `HandoverTab.tsx` so the two pages cannot diverge on which denominations exist. They are **labels only** — a build-time constant carrying no state.

### Warnings

| Condition | Why |
|---|---|
| `zbývá ze směnárny < 0`, per row and in total | the swap cannot be funded |
| `potřebuji` total > `směnárna` total | less money than the piles need. **Total only** — a per-denomination gap is absorbed by breaking bigger notes |
| an amount entered against a **blank rate** | silently values that currency at zero and overstates the margin. A blank rate alone is normal (not every run has every currency); this is the live `E19`/GBP bug in the source spreadsheet |

## Historie (snapshots)

`smenarnaSnapshots/{id}` — `{ data, createdAt, createdBy, createdByEmail }`.

The page **never autosaves and always opens blank**; a saved entry is recalled explicitly and never restored on mount. That is deliberate: the collection is shared, so auto-restoring would greet a user with someone else's half-finished run presented as their own.

- **Shared.** Everyone holding `tabulky.smenarna.view` sees and may delete every entry. The same key governs read, write and delete, so no new permission key exists.
- Endpoints in `functions/src/routes/exchange.ts`: `GET /snapshots` (list, newest first, no payload), `GET /snapshots/:id` (with payload), `POST /snapshots`, `DELETE /snapshots/:id`. Create and delete are audit-logged.
- **64 kB payload ceiling.** The real payload is a few kB; the cap only stops a malformed client parking megabytes in Firestore.
- Author names resolve at **read time** from `users/{uid}.name`, so a later rename shows on old entries; falls back to email then uid so a deleted user still renders.
- Loading replaces all state and cannot be undone → `ConfirmModal` whenever there is input to lose. `rowSeq` is bumped past any restored row id so a subsequent "Přidat řádek" cannot collide with a loaded row.

### Retention

`sweepSmenarnaSnapshots` (`functions/src/index.ts`, daily 00:15 Europe/Prague) → `services/smenarnaRetention.ts`, deleting entries older than 6 months in batches. Time comes from the test clock, so the cutoff can be exercised on staging by jumping the clock.

Deliberately a **separate scheduled function** rather than folded into `sweepRecepceHistory`: renaming a deployed scheduled function leaves the old one orphaned in GCP. It is the 9th scheduled function — note that `scripts/_preflight-prod.js` does not enumerate all of them, so a clean preflight is not proof it deployed; check `firebase functions:list`.

## Vocabulary

The UI calls a saved entry **data** ("Uložit", "Zobrazit historii", "Načíst data?", "Smazat data?"). The Firestore collection and all internal identifiers keep **snapshot** naming — renaming a live collection means a migration, and the internal name never reaches a user.

## Not built

**Print/PDF** — dropped by decision, not deferred. The user-facing rules live in [`business-rules.md`](business-rules.md) → "Tabulky – Směnárna + ČNB".
