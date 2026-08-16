# Tabulky (Směnárna + ČNB)

A standalone top-level page (`/tabulky/:tab`) for tables and tools that belong to no single hotel. Introduced in **v4.14.0** with one tab, **Směnárna + ČNB**, ported from `excels/smenarna_cnb.xlsx`. Deliberately built as a hub so later tables slot in without restructuring.

Two tabs today. **Objednávky** was added second and cost exactly what the hub promised — a registry entry, a permission key, and one `case` in `TabBody`; `TabulkyPage.tsx` was not touched beyond the import.

> **Which section describes which tab:** everything from *Rates* down to *Not built* is **Směnárna + ČNB**. **Objednávky** has its own section at the end of this file.

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
| `tabulky.objednavky.view` | 1 | the Objednávky tab, and `GET /api/objednavky/config` |
| `tabulky.objednavky.manage` | 2 | the Objednávky číselník — `PUT /api/objednavky/config` |

Own **Tabulky** section in the matrix, between Recepce and Zaměstnanci (that position also fixes where it reads in Nápověda, which orders sections by `PERMISSION_SECTIONS`). Granted to **no** built-in type, mirroring Recepce — `admin` gets both via the `system.admin` wildcard; everyone else needs an explicit grant.

## Rates: `GET /api/exchange/rates`

Returns the three global sm rates from `settings/sm` to prefill *kurz u nás*.

**It is not a reuse of `GET /handovers/sm/rates`**, which is gated on `nav.recepce.view`: Směnárna's users need not have Recepce access, so reusing that route would 403 exactly the people the page is for, and widening its gate would make one permission mean two things. Same data, same `readSmRates()` helper (exported from `routes/handovers.ts`), separate gate. Read-only — the rates are owned by the Recepce sm row and edited there under `recepce.sm.manage`.

> ⚠️ **Positional coupling.** The three rates are deliberately unlabelled in the sm modal (no "Kurz"/"Kurzy" text anywhere, by requirement), so nothing in `settings/sm` records that `rates[0]` means euro. The calculator maps `[0,1,2] → € / $ / £` **by convention** and renders the symbol + ISO code beside each prefilled rate so a mismatch is visible at a glance. Reorder the sm badges and the sm row keeps totalling correctly (a dot product is order-independent) while this page would misprice silently.

## The calculator (`pages/tabulky/SmenarnaTab.tsx`)

Rows are free-text labels, **one shared list across all four blocks**, seeded with `AMBI / SUP / A&A / ANKORA` and freely renamed, added, removed.

1. **PŘEDKLÁDÁM / POŽADUJI** — a CZK note swap over `CZK_DENOMS`. It **need not balance**: a shortfall is funded from the exchange money (see below). PŘEDKLÁDÁM carries a `ze směnárny` column = `max(0, POŽADUJI − PŘEDKLÁDÁM)`.
2. **SMĚNÁRNA** — € / $ / £ amounts × two rate triples → `CELKEM směnárna` (kurz sm.), `CELKEM u nás` (kurz u nás), `ROZDÍL` = the margin, and `zbývá ze směnárny`. The **CELKEM row also totals each currency column** (`exTotals.amt`, positional € / $ / £ like everything else here) so the run's total foreign holding is readable without adding the rows up by hand. Those three cells are formatted with `fx()`, **not** `czk()` — foreign amounts are genuinely fractional (the inputs are `step="any"`), so they keep two decimals instead of rounding to whole units.
   - ⚠️ The second rate row was labelled **`kurz ČNB`** until 2026-08-05 and is now **`kurz sm.`** (the exchange office's own rate). Only the label changed — the field, its `settings/sm` prefill and every formula are untouched. The page and tab titles still say ČNB.
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

---

# Objednávky

**v5.11.0.** Composes the recurring cleaning-supply order e-mail — in practice the **Hygop** order, which is what the seeded catalogue is: pick a hotel, search the catalogue, set quantities, copy the finished message into Outlook. It replaces retyping the same e-mail by hand; it is not an ordering system and talks to no supplier's system. Nothing in the code is Hygop-specific, though — the catalogue, units and hotels are all číselník data, so a second supplier needs no code change.

`pages/tabulky/ObjednavkyTab.tsx` (tab + číselník panel), `lib/objednavky.ts` (types, rendering, clipboard, search), `functions/src/routes/objednavky.ts` + `services/orderTypes.ts` (config CRUD, seed).

## There is no order resource, and that is the design

Nothing about an order is persisted. Working state lives in component state and dies with the component; the page always opens blank. So there is no collection, no list route, no history, no retention sweep — **less** than Směnárna, which at least has explicit snapshots.

The only stored state is `settings/objednavkyConfig`, served by `GET /config` and replaced wholesale by `PUT /config`. Lazy seed: a GET on a missing document returns `DEFAULT_OBJEDNAVKY_CONFIG` **without writing**, and the defaults only become a real document the first time someone saves. Same contract as `settings/fakturyConfig`.

`PUT /config` **is** audit-logged (counts per array, not contents), and this is the one place the feature disagrees with Faktury's "scratch pad isn't audited" reasoning: a wrong delivery address here dispatches real goods to the wrong building, and the e-mail that results carries no record of who changed it.

## A fourth hotel registry

`OrderHotel` is a **separate list** from `lib/hotels.ts` (four Recepce desks, Amigo+Alqush merged) and from `invoiceTypes.ts` (five invoicing entities). Reusing the invoice hotels was requested, investigated and rejected on a concrete finding:

**`InvoiceHotel` has no address field.** The nearest thing is `footer`, a printed contact block — `"Hotel Ambiance, Tyrsova 8, 120 00 Prague 2, Czech Republic, VAT Reg No. CZ06947697\ne-mail: …, Tel.: …, Web: …"`. Substituted into *"s doručením na adresu …"* that drops the VAT number, phone and website into the middle of a sentence, and parsing the street out of admin-editable free text means an invoice-formatting edit silently rewrites an order e-mail.

Note the split that fell out of this: the **delivery address** is local to this registry (it exists nowhere else), while the **billing identity** is *not* duplicated — it references `companies/{id}`, which is where that data already lives. Reuse was rejected for the field that had no shared source, and adopted for the field that did.

The general rule this instance of it follows: **reuse a field only when both features would always want it to change together.** A printed footer and a delivery address would not. See the matching warning in `invoiceTypes.ts`.

Hotels ship with an **empty** `deliveryAddress` and `companyId: null` — neither is in the repo nor derivable, and a seeded guess would put a wrong address into a real supplier e-mail.

## Billing details are a reference, not free text

`OrderHotel.companyId` points at `companies/{id}` — the registry **Nastavení → Společnosti** owns (HPM, STP). The billing block is composed at **read time** by `companyInvoiceDetails()`:

```
{name}, IČO: {ic}, {address}
→ Hotel Property Management s.r.o., IČO: 06947697, Panská 897/12, Praha 1, 110 00
```

⚠️ **`DIČ` is not printed, and the IČO precedes the address.** Both were corrected by the customer on 2026-08-16 after a first version that read `name, address, IČO, DIČ` — the supplier wants the company identified before it is located. `dic` stays on `OrderCompany` even though nothing reads it: removing the field would make its absence from the output look like an oversight rather than a decision.

Empty parts are dropped rather than printed as a dangling `IČO: ,`. Read-time resolution, not a stored copy, so correcting an address in Nastavení fixes every future order e-mail with nothing to re-save here — the same choice `project_displayname_readtime_resolution` made for names.

⚠️ **`abbreviation` must never reach the e-mail.** It is an internal handle (HPM, STP), not part of the legal identity, and it is deliberately absent from `OrderCompany` so it cannot be interpolated by accident. `fileNo` is likewise not modelled.

`companyId` is **not validated against the live collection** on save (`objednavky.ts`): the registry is edited elsewhere, so a company deleted after a hotel pointed at it must degrade gracefully rather than 400 and leave the číselník unsaveable. A dangling id resolves to `""` — exactly like an unset one — so it **blocks the copy** instead of silently dropping the billing block out of a sentence that still reads as complete. Same reasoning as `faktury.ts` not validating a draft's `vatRateId`.

`GET /api/companies` needs only `requireAuth` (it populates form dropdowns app-wide), so the tab's own permission is the only gate involved.

## Keyboard flow

The tab is built to be driven without the mouse, because an order is a burst of a dozen search-and-quantity pairs:

**search → ↑/↓ → Enter → quantity → Tab → search →** …

- `activeIndex` is **clamped at render** (`Math.min(active, results.length - 1)`), not corrected by an effect. The result set shrinks as you type *and* as items are added, so a stored index goes stale constantly; deriving it removes the window where it points past the end.
- `ArrowDown` on a **closed** list opens it on row 0 rather than advancing to row 1.
- Hovering a row **sets** the active index, so hover and keyboard highlight can never disagree about what Enter will pick.
- Result buttons are `tabIndex={-1}` — the list is arrow-driven, and Tab out of the search box belongs to the rest of the form.
- Adding a line mints its id **in the handler, not inside the `setBlocks` updater** (an updater can run twice under StrictMode, which would mint two ids and focus neither line) and parks it in `focusLineId`. The matching `QtyInput` focuses **and selects** — the field already holds `1`, and typing a quantity should replace it.
- `Tab` inside `QtyInput` is intercepted back to that block's search input. **Shift+Tab is left alone** so reversing out of the form keeps working.

## Rendering: two clipboard flavours, one source string

`copyOrderEmail()` writes **one `ClipboardItem` carrying both** `text/html` and `text/plain`. The paste target chooses: Outlook/Gmail take the HTML and render a real table, a plain-text field takes the list. Falls back to `writeText` when `ClipboardItem` is missing or the write is refused, and **returns which flavour it managed** — the tab says so out loud, because "the table didn't come through" must not be discovered in the sent mail.

⚠️ **The HTML is written for Outlook's converter, not for a browser.** Pasting into a compose window hands the HTML over as a **CF_HTML** clipboard payload, which Outlook converts with its Word-derived engine: stylesheets are discarded and CSS is normalised hard. Hence presentational **attributes** (`border`, `cellpadding`, `cellspacing`) plus **inline styles repeated on every cell**, no classes, no `<style>` block, no flex/grid. Modern CSS arrives as an unstyled column of text. There is deliberately **no `font-family`**, so the pasted table inherits the mail's own font instead of standing out.

### Every table in one message is the same size

`columnWidths()` scans **all** blocks before any table is rendered, so a message with three orders does not come out as three ragged boxes sized to their own longest row. The two widths can legitimately come from different blocks (the label column from one order's longest product, the quantity column from another's largest number).

Width is **estimated from character count** — there is no way to measure text for a document that will render in an unknown font at an unknown size. `CHAR_PX = 8` is deliberately generous (a proportional 11pt face averages nearer 6px/char): overshooting costs whitespace, undershooting breaks the requirement that the widest label fit on one line. `white-space:nowrap` backs it up — if the estimate ever falls short, Word widens the column instead of wrapping.

⚠️ The widths are repeated on the table **and on every cell**, as both an HTML attribute and an inline style. Word recomputes table geometry per row, so a width declared once — in a `<colgroup>`, or only on the first row — is exactly what it discards.

The **first column is bold**, declared twice for the same reason: `font-weight:bold` on the cell *and* a `<strong>` around the text. Word honours the element unconditionally; the inline weight covers a target that keeps the CSS but flattens the markup. The plain-text flavour has no equivalent and does not try to fake one.

### Spacing is explicit, not inherited

One blank line above every table, two below every table except the last, emitted as `<p>&nbsp;</p>`. The `&nbsp;` matters: an empty `<p></p>` is liable to be dropped as insignificant whitespace. `buildOrderText` mirrors the same rhythm (`parts.join("\n\n\n")`).

Consequence for the preview: `.preview p` / `.preview table` margins in the CSS module are near zero **on purpose**, because the copied HTML now carries its own spacing. Restoring generous margins there would show a layout the pasted e-mail does not have.

### Shared input

Both renderers take `ResolvedBlock[]`, never raw blocks + config — the two flavours of one copy must agree line for line, and identical input is the only thing that guarantees it. `resolveBlocks()` drops a line whose item was deleted mid-session and a block whose hotel was: a nameless row in a supplier e-mail is worse than a missing one.

The on-screen preview uses `dangerouslySetInnerHTML` **on the same string that goes to the clipboard**, so it physically cannot show one thing and paste another. That is safe because every interpolated value is escaped at its single point of interpolation (`escapeHtml`), and it is the reason the preview is not hand-built JSX — two renderers would be two things to keep in step.

`inline()` collapses whitespace in the address and billing fields at **render** time, because they are substituted mid-sentence; the stored value stays exactly as typed.

## Catalogue

`code` is stored **apart** from `name` and rendered back as `name (code)`. Search then matches either, a code can be fixed without retyping the name, and `CLEAMEN 220 (nerez)` — whose name legitimately contains parentheses that are *not* a code — is expressible at all. An empty code renders with no parentheses (`Prachovka`).

`unit` is `"ks" | "balení"`, **printed verbatim** into the e-mail, so there is no label map to fall out of step with it. Both forms are invariant in Czech across every quantity, so no pluralisation exists. The sanitizer whitelists the two values and falls back to `"ks"` — the narrower claim — rather than letting an unrecognised value reach a supplier.

Search (`searchKey`) is NFD-strip diacritic-insensitive, so `uterka` finds `Mikroutěrka`; same approach as `employmentSessions.ts` uses for names.

## Blocked copy, not a warning

A hotel in the order with a blank address or billing block **disables the copy** rather than warning beside it. A blank substitution does not leave a visible gap — it yields `"s doručením na adresu  a fakturačními údaji ."`, which reads as a finished sentence and would be sent as one.

## Not built

- **No tour step.** `appTour.ts` records a deliberate decision that Tabulky gets one nav-level step and no per-tab steps, because the tabs' own on-screen hints carry the detail and would otherwise go stale independently. Consequence: like `tabulky.smenarna.view`, this tab's permissions do not surface as Nápověda topics.
- **No editable message template.** The two sentences are hard-coded. Making them editable needs `{hotel}`/`{adresa}` tokens, and a mistyped token yields a broken e-mail with nothing to catch it.
- **No sending.** The app has no mail transport and none was added; the message is composed and copied, and Outlook sends it.

User-facing rules: [`business-rules.md`](business-rules.md) → "Tabulky – Objednávky".
