# Faktury

A visual **reproduction** tool for guest invoices, not an invoicing system. Route `/faktury`, backed by `functions/src/routes/faktury.ts` (mounted at `/api/faktury`, `functions/src/index.ts:45,145`), `functions/src/services/invoiceTypes.ts` (types, seed defaults, arithmetic — mirrored client-side by `frontend/src/lib/faktury.ts`) and `functions/src/services/invoiceHtml.ts` (the printable A4 layout). Ported from the customer's own workbook, `excels/invoice.xlsx` (sheets `INVOICE`, `TAA`, `Invoice Details`, `Hotel Details`).

## The app is not the issuer — Protel is

Read this before touching audit coverage, numbering, or draft mutability in this router: the hotel PMS (Protel) issues the real invoice. This feature exists purely because Protel occasionally produces an invoice **it can then no longer display**, and someone re-types it here so it can be printed looking like the original. Every consequence below follows from that one fact:

- **`invoiceNo` is a user-typed INPUT**, not an allocated number. There is no counter, no sequence, no uniqueness check anywhere in this feature — two drafts may legitimately carry the same number (e.g. a corrected retype of the same Protel document).
- **A saved draft is a scratch pad, not an accounting record.** Draft CRUD (`POST /`, `PUT /:id`, `DELETE /:id`) writes **no audit-log entry**, and `DELETE /:id` is a **hard delete** with no soft-delete tombstone. This is deliberate, not an oversight — every other write endpoint in this codebase calls `logCreate`/`logUpdate`/`logDelete` (see [`project_audit_log`](../DOCUMENTATION.md) precedent), so the absence here reads as a bug unless you already know why. Auditing a scratch pad would bury the change log in noise while implying these documents carry a legal weight they don't have. The confirm-delete dialog spells this out to the user too: "Faktura vystavená v Protelu tím nijak nezmizí – maže se pouze tento koncept" (`FakturyPage.tsx:487`).
- **The config endpoint (`PUT /config`) is the one exception and IS audited** (`logUpdate`, `functions/src/routes/faktury.ts:431-446`). Config is shared — VAT buckets, the posting catalogue, the agency address book, per-hotel bank/footer blocks — and every reproduction on the page depends on it, so a bad edit there is worth tracing. The array payloads are verbose, so the audit entry logs **counts per array**, not full contents.
- `POST /render-pdf` persists nothing and is not audited either, matching `POST /contracts/render-pdf` and `POST /dokumenty/render-pdf`'s render-only contract — the draft in the request body need not even be saved.

**If you are the next person touching this file: do not "fix" the missing audit calls on the draft CRUD routes.** That would be adding noise to the audit log for data this feature explicitly treats as disposable.

## Invoice-number decode: hotel + deposit flag from four digits

An invoice number has the shape `[26][book no.][sequence]`. Characters 3–4 (0-indexed slice `[2,4)`) are the **book number**, which is decoded to both the invoicing hotel and whether the invoice is a deposit invoice:

```ts
// functions/src/services/invoiceTypes.ts:248-271 (mirrored in frontend/src/lib/faktury.ts:222-244)
function decodeBookNo(invoiceNo): number | null   // digits 3–4, or null if not two digits
function matchHotelByInvoiceNo(invoiceNo, hotels): { hotel, deposit } | null
```

Each `InvoiceHotel` carries **two** book numbers — `bookNo` (normal invoices) and `depositBookNo` (deposit invoices) — and a normal book number and its hotel's deposit book number both resolve to the *same* hotel, just with `deposit` flipped. Example from the seed data: `264505337` → book `45` → Ankora, normal; `261401298` → book `14` → Superior, deposit.

`decodeBookNo`/`matchHotelByInvoiceNo` return `null` when the number is too short or non-numeric — the UI then leaves the hotel picker to the user rather than guessing (`FakturyPage.tsx:639-647`, rendered as a quiet hint, never a validation error, since the number is typed digit by digit).

### The manual-override latch

`FakturyPage.tsx` holds a `manualHotelRef` (a `useRef<boolean>`, not state — it must not trigger a re-render loop with the decode effect). It starts `false` on a new invoice and flips to `true` the moment the user picks a hotel or toggles "Zálohová faktura" by hand, **or** the instant an existing draft is opened (a stored invoice already has its hotel decided — `openInvoice()` sets it `true` unconditionally, `FakturyPage.tsx:233`). Once latched, retyping the invoice number in `setInvoiceNo()` (`FakturyPage.tsx:288-302`) no longer overwrites `hotelId`/`deposit` — the decode still runs (for the informational hint text) but its result is never applied. This exists so the automatic decode is a *convenience*, never a fight: without the latch, finishing a manual correction and then adjusting a digit in the invoice number would silently reassign the hotel back.

## VAT buckets are (percent, block) pairs, not percentages

Czech VAT law requires a **received advance** to be recapped on its own line, separate from the supply it will later settle. The source workbook encodes this as two parallel blocks of rate rows — normal 10/12/15/21 (workbook rows 73–79, which also carries the three 0%-rate exempt buckets) then advance 10/12/15/21 (rows 80–83) — verified directly against `excels/invoice.xlsx`. That is why a `VatRate` is a `(percent, block)` pair (`block: "normal" | "advance"`, `invoiceTypes.ts:23,37-45`) and not a bare number: **two rates can share the same percent** (a 12% normal sale and a 12% advance) and must never be summed together.

`computeTotals()` (`invoiceTypes.ts:194-239`, mirrored in `frontend/src/lib/faktury.ts:170-214`) groups line amounts by `vatRateId`, then for each rate that actually carries money produces one `RecapRow` (`base`, `vat`, `total`), keeping `block` on the row. `buildInvoiceHtml()` then splits `totals.recap` into `normalRecap`/`advanceRecap` by that flag and renders the advance rows under their own "Zálohy / Advances" sub-heading, omitted entirely when there are none (`invoiceHtml.ts:472-501`). **Losing the `block` flag on a rate silently merges a deposit into the normal recap** — the two would print together and the advance-specific accounting line the law requires would disappear. See the matching entry in [`business-rules.md`](business-rules.md).

Base is derived by *stripping* VAT out of the gross line total (`gross / (1 + percent/100)`), because prices are entered VAT-inclusive exactly as Protel posts them and exactly as the source workbook computed — not the other way round (line price → base → +VAT).

The seed VAT rates (`DEFAULT_VAT_RATES`, `invoiceTypes.ts:287-317`) ship 10% and 15% **inactive**: both are historical Czech rates that could return, and the whole list is admin-editable, so they sit dormant rather than being deleted.

## Five invoice hotels, not the app's four Recepce hotels

`DEFAULT_INVOICE_HOTELS` (`invoiceTypes.ts:402-513`) seeds **Ambiance, Superior, Amigo, Alqush, Ankora** — five entries. Everywhere else in this app (`frontend/src/lib/hotels.ts`, Recepce, Dokumenty sections) Amigo and Alqush are merged into one `amigo-alqush` slug because they share a physical reception desk. Here they stay **separate**, because they have distinct Protel book numbers and distinct printed footers (different address, phone, email per property) even though they share one bank account (`bankEur`/`bankCzk` are identical between the two seed entries). `invoiceTypes.ts:81-86` calls this out explicitly: **this registry is independent of `lib/hotels.ts`/`services/hotels.ts` on purpose** — do not attempt to reuse or reconcile the two.

Each `InvoiceHotel` also points at an optional `companyId` (`companies/{id}`) that supplies the issuer footer line (name/address/IČ/DIČ/spisová značka) printed at the very bottom of the PDF. A hotel with no `companyId`, or one pointing at a company doc that no longer exists, is **not an error** — that footer line is simply omitted while the hotel's own `footer` block still prints (`faktury.ts:483-497`, `invoiceHtml.ts:535-547`).

## Line groups

`InvoiceLine.group` is one of three values (`invoiceTypes.ts:26-35`), and the distinction drives which totals a line feeds:

| Group | Meaning | Total | VAT recap |
|---|---|---|---|
| `item` | A charge (accommodation, breakfast, city tax, …) | ✅ Celkem | ✅ |
| `payment` | Money already received, stored **negative** (cash, card, bank transfer, rounding, exchange diff) | ✅ Uhrazeno only | ❌ |
| `transfer` | The single folio→agency **"Invoice"** line, also negative | ❌ | ❌ |

The `"Invoice"` transfer line is printed on the PDF like any other line, but `computeTotals()` deliberately skips it for **both** totals (`invoiceTypes.ts:211`, `"transfer" deliberately contributes to neither`): it documents that the guest folio was zeroed out to the agency's account, it is not itself a supply (so it must not inflate the VAT recap) and it is not a payment received by the hotel (so it must not inflate Uhrazeno). It exists in the catalogue purely so the printed line-item list matches Protel's own folio transfer entry.

A line's `vatRateId` is deliberately **not validated against the current config's rate list** on save (`faktury.ts:173-176`): the catalogue is admin-editable, so an older draft may reference a rate that has since been deleted. That must degrade gracefully — the recap simply omits the bucket — rather than 400 and leave the draft unopenable.

## Storage

Two Firestore locations, both under the fixed collections declared in `functions/src/routes/faktury.ts`:

### `settings/fakturyConfig` — one document, four arrays

```
{
  vatRates: VatRate[],       // { id, label, percent, block, active }
  items:    CatalogItem[],  // { id, description, vatRateId | null, group, active }
  agencies: Agency[],       // { id, name, ...PartyAddress, active }
  hotels:   InvoiceHotel[], // { id, name, bookNo, depositBookNo, companyId, logoDataUri, footer, bankName, bankEur, bankCzk, active }
  updatedAt, updatedBy,
}
```

Read via `readConfig()` (`faktury.ts:348-358`), which returns the shipped `DEFAULT_FAKTURY_CONFIG` when the doc doesn't exist yet — **lazily seeded on purpose**: a `GET` must never write, so the defaults only become a real document the first time an admin saves the číselníky panel.

⚠️ **900 kB write guard, because five embedded logos can approach Firestore's 1 MiB document ceiling.** `PUT /config` computes `Buffer.byteLength(JSON.stringify(config))` and rejects anything over 900 000 bytes with a 413 and a Czech message naming logos as the likely cause (`faktury.ts:409-420`), rather than letting an oversized write fail with an opaque Firestore 500. Each individual logo is separately capped at `LOGO_MAX = 150_000` characters of base64 (`faktury.ts:124-125`), enforced both server-side (`sanitizeConfig`, `faktury.ts:309-317`) and client-side, where `prepareLogo()` (`FakturyPage.tsx:1330-1351`) tries three progressively smaller re-encodes (600px PNG → 500px JPEG q0.85 → 360px JPEG q0.75) before giving up and telling the admin to use a smaller image. **This is a real trap for the next config field**: five hotels × a future new base64-ish field is the same ceiling again: budget accordingly, don't just raise `LOGO_MAX`.

A logo must be a `data:image/(png|jpeg|webp);base64,...` URI — the same three raster formats `services/pdfRenderer.ts`'s headless Chromium reliably prints, and the only URI scheme its SSRF guard (`pdfRenderer.ts:172-180`) lets through in the first place. `LOGO_RE`/`DATA_URI_RE` (`faktury.ts:124`, `invoiceHtml.ts:233`) enforce the same pattern on both the write path and the render path.

### `invoiceDrafts/{autoId}` — one document per saved reproduction

Shape is `InvoiceDraft` (`invoiceTypes.ts:132-153`) plus bookkeeping fields (`createdAt`/`createdBy`/`createdByName`, `updatedAt`/`updatedBy`/`updatedByName`). The id is always a Firestore auto-id (`faktury.ts:588` — `db().collection(COLLECTION).add(...)`), **never** the invoice number, precisely because the invoice number carries no uniqueness guarantee. `PUT /:id` is a whole-document `.set()` (not a merge) since the client always holds the complete draft and a merge would leave orphaned fields behind after an edit that clears something (`faktury.ts:622-657`) — it does preserve `createdAt`/`createdBy`/`createdByName` from the existing doc across the replace.

`MAX_LINES = 200` per draft (`faktury.ts:117`).

## Endpoints

All in `functions/src/routes/faktury.ts`, mounted at `/api/faktury`. Config routes are registered **before** `/:id` so `config` and `render-pdf` are never swallowed as an id.

| Method & path | Permission | Notes |
|---|---|---|
| `GET /config` | `nav.faktury.view` | Current číselníky, or the shipped defaults if `settings/fakturyConfig` doesn't exist yet. |
| `PUT /config` | `faktury.manage` | Whole-document replace of the four arrays. **Audited** (`logUpdate`, counts only). 413 above 900 kB. |
| `POST /render-pdf` | `nav.faktury.view` | Body `{ draft }`. Renders via `buildInvoiceHtml()` + `renderPdf()` and streams `application/pdf` straight back — nothing persisted, no audit entry. The draft need not be saved first; this is what makes "print whatever is on screen" work. |
| `GET /` | `nav.faktury.view` | Saved-draft summaries, newest-first by `updatedAt`, sorted **in memory** (not Firestore `orderBy`) so a legacy doc missing `updatedAt` isn't silently excluded by Firestore's missing-field behaviour. ⚠️ **returns a bare JSON array** — see the frontend mismatch note below. |
| `POST /` | `nav.faktury.view` | Create a new draft, Firestore auto-id. Gated on the **view** permission, not manage: retyping an invoice is the job of anyone who can open the page. Returns `{ id }`. |
| `GET /:id` | `nav.faktury.view` | Full draft, `{ id, ...docData }`. |
| `PUT /:id` | `nav.faktury.view` | Whole-draft replace (see above). |
| `DELETE /:id` | `nav.faktury.view` | Hard delete, no soft-delete, no audit. |

### ⚠️ `GET /faktury` response-shape mismatch (verify before relying on the list)

The route sends the array of summaries directly — `res.json(list)` (`faktury.ts:554`), **not** `res.json({ invoices: list })`. `frontend/src/pages/FakturyPage.tsx` calls it as `api.get<{ invoices: InvoiceSummary[] }>("/faktury")` and then reads `list.invoices ?? []` in three places (`loadAll`, the post-save refresh in `handleSave`, and the post-delete refresh in `doDelete`). `api.get()` does no response-shape unwrapping (`frontend/src/lib/api.ts:105` — it is a plain `res.json()` cast to the generic type), so as written `list.invoices` reads a property that does not exist on the server's payload. **This looks like a genuine frontend/backend contract mismatch that would leave the saved-invoice list permanently empty** — flagged here rather than silently documented as working; confirm against a live run before treating either side as authoritative, and fix whichever side is wrong (either wrap the route's response in `{ invoices }`, or read the array directly on the client).

## Rendering: `buildInvoiceHtml()` + `renderPdf(..., { extraCss, logoOffset: false })`

`invoiceHtml.ts` is pure — no Firestore, no I/O, no async, no clock, no randomness; the same `InvoiceDraft` + `FakturyConfig` + `CompanyInfo | null` always yields the same HTML bytes. It lays out the page with tables and explicit column widths rather than flexbox, because print pagination across a page break is more predictable that way and the line-item table is the one region allowed to overflow onto a second page.

`services/pdfRenderer.ts` (shared with Contracts and Dokumenty) grew two options specifically for this feature (`pdfRenderer.ts:139-156`):

- **`extraCss`** — appended after the shared `RENDER_CSS`, because that stylesheet's defaults (a 1px border on every `td`/`th`, a 0.5cm margin on every `table`) are right for a contract and wrong for an invoice. `INVOICE_CSS` (`invoiceHtml.ts:53-162`) undoes both before laying out its own borders and spacing.
- **`logoOffset: false`** — **must** be passed by Faktury. Without it, `renderPdf()` measures the first `<img>`'s rendered bottom edge and bumps the page-2+ top margin by that amount, a behaviour that exists because a *contract* template's logo is part of the flowing document body (so page 2 must start lower, level with where page-1 text resumes after the logo). The Faktury header logo is part of a **fixed** layout that repeats by its own rules, not a flowing image — measuring it would silently inflate the top margin of every page after the first. `faktury.ts:501-507` sets this explicitly; **any new Faktury render call that forgets it will get a wrong page-2+ margin with no error anywhere.**

A normal and a deposit invoice differ **only** in the header title ("INVOICE"/"Faktura – daňový doklad" vs. "DEPOSIT INVOICE"/"Zálohová faktura", `invoiceHtml.ts:401-405`), matching the source workbook.

Money is formatted by a hand-rolled `fmt()` (`invoiceHtml.ts:192-205`, mirrored by `formatMoney()` in the client lib) rather than `toLocaleString("cs-CZ")`, because the Cloud Functions runtime may ship a trimmed ICU that silently degrades locale formatting to the C locale. Dates go through `fmtDate()`/`formatDateCZ()`, string surgery on the `YYYY-MM-DD` prefix — **never** `new Date(iso)`, which lands on the previous day in UTC+2 (the same date-arithmetic pitfall documented project-wide).

## Permissions

| Key | Level | Meaning |
|---|---|---|
| `nav.faktury.view` | 0 | The page itself: open it, list/open/create/edit/delete drafts, print. |
| `faktury.manage` | 1 | The číselníky panel only — VAT rates, posting catalogue, agency address book, per-hotel bank/footer/logo. |

Own **Faktury** section in the permission matrix (`frontend/src/lib/permissions/catalog.ts:301-317`, mirrored in `functions/src/auth/permissions.ts:41`), placed directly after Dokumenty — both produce a printed document from a form, and Nápověda renders sections in this order. Not granted to any built-in user type by default; `admin` reaches it via the `system.admin` wildcard, everyone else needs an explicit grant (same posture as Recepce, Tabulky, Dokumenty).

`"faktury"` is already present in `VALID_IDS` in `functions/src/routes/menuOrder.ts:18` and the menu entry (`frontend/src/lib/menuItems.ts:44`) carries `hideOnMobile: true` — the invoice editor's line table is too wide for a phone, matching the Šablony smluv / Tabulky precedent.

## Related files

- `functions/src/routes/faktury.ts` — endpoints, validators, size guards.
- `functions/src/services/invoiceTypes.ts` — types, seed defaults, `computeTotals`, `decodeBookNo`/`matchHotelByInvoiceNo`.
- `functions/src/services/invoiceHtml.ts` — the A4 print layout.
- `functions/src/services/pdfRenderer.ts` — shared Puppeteer renderer; `extraCss`/`logoOffset` options added for this feature.
- `frontend/src/lib/faktury.ts` — client mirror of the types + arithmetic (never imports the server module, by the same pattern as `lib/hotels.ts` ↔ `services/hotels.ts`).
- `frontend/src/pages/FakturyPage.tsx` / `.module.css` — the list + editor page and the číselníky panel.
- `frontend/src/lib/menuItems.ts` (`id: "faktury"`, `hideOnMobile: true`) and `functions/src/routes/menuOrder.ts` (`VALID_IDS` already includes `"faktury"`).
- `frontend/src/App.tsx` — `<Route path="faktury">` wrapped in `RequirePermission allow={["nav.faktury.view"]}`.
- `excels/invoice.xlsx` — the source workbook this page reproduces (sheets `INVOICE`, `TAA`, `Invoice Details`, `Hotel Details`).
