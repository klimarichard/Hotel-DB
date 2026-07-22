# Contracts & Templates

This document covers the contract module — contract types and their template variables, the Phase 4 implementation notes, and the full history of the TipTap-based contract template editor. It is a verbatim relocation of the contract-related sections from the root `README.md`.

---

## Contract Types

9 contract types: `nastup_hpp`, `nastup_ppp`, `nastup_dpp`, `ukonceni_hpp_ppp`, `ukonceni_dpp`, `ukonceni_zkusebni`, `zmena_smlouvy`, `hmotna_odpovednost`, `multisport`.
- 7 are history-tied (triggered from employment history rows)
- 2 are standalone (`hmotna_odpovednost`, `multisport`)

Templates stored as HTML in `contractTemplates/{type}` (doc ID = contract type string).
PDFs generated client-side via `html2pdf.js` — Puppeteer was too large for Gen 1 functions.

### Template variables (`frontend/src/lib/contractVariables.ts`)
`firstName`, `lastName`, `fullName`, `birthDate`, `birthNumber`, `idCardNumber`, `passportNumber`, `visaNumber`, `currentJobTitle`, `currentDepartment`, `address`, `city`, `zip`, `contractType`, `salary`, `startDate`, `endDate`, `companyName`, `companyAddress`, `ic`, `dic`, `companyFileNo`, `signatoryName`, `signatoryTitle`, `today`, `contractNumber`

---

### Phase 4 — Contracts
- Company data in `companies/{companyId}` (e.g. `companies/HPM`, `companies/STP`).
- TipTap extensions: StarterKit (configured via the shared `STARTER_KIT_OPTIONS` — no paragraph, and **no automatic hyperlinks**; see [dokumenty.md](dokumenty.md#libeditorextensionsts)), Underline, TextStyle, FontFamily, FontSize (custom), TextAlign, Color, Image, TabParagraph (custom), ListItemIndent (custom).

---

## Contract Templates — Editor (TipTap)

> **A note on `ContractsTab` / "Smlouvy tab" (deleted v4.6.0, 2026-05-06).** Several of the dated entries below (2026-04-28 through 2026-04-30) describe UI on a `ContractsTab` component and a standalone "Smlouvy" tab, as they existed at the time each entry was written. Both are gone: the Smlouvy tab folded into the **Historie pracovního poměru** tab (see docs/employees.md § "Employee detail — session-based history (2026-05-06)"), per-row contract actions (download / sign / split-upload / delete) now live in `frontend/src/components/ContractActionButtons.tsx`, and ad-hoc/standalone documents (Multisport, Hmotná odpovědnost, custom templates) moved to `frontend/src/components/OtherDocumentsTab.tsx` (see [Employees — Employee detail restructure](employees.md#employee-detail-restructure--ad-hoc-documents-move-to-další-dokumenty-v460)). The backend routes those older entries describe are unaffected and current; only the frontend component names are stale. One casualty of the rewrite: `ContractActionButtons` does not carry over the old `ContractsTab`'s per-row **Obnovit** / **Smazat podepsanou** actions for `archived`-status contracts — see the note in "Smlouvy tab — Obnovit + Smazat podepsanou actions" below.

### Custom extensions in `ContractTemplatesPage.tsx`
- **`FontSize`** (`addGlobalAttributes` on `textStyle`): dropdown 8–72 pt.
- **`TabParagraph`** (extends `Paragraph`): bakes `white-space:pre-wrap; tab-size:1.27cm` as inline style on every `<p>`. Tab key inserts `\t` → always lands on next 1.27 cm stop from left edge.
- **`ListItemIndent`** (priority 200, `addGlobalAttributes` on `bulletList`/`orderedList`): Tab inside a list is position-sensitive — at the start of a row it adjusts `margin-left` on the parent `<ul>/<ol>` (bullet/number + text shift together), anywhere else it inserts a literal `\t` into the paragraph (`TabParagraph`'s `tab-size: 1.27cm` paints the gap, so the bullet and text to the left of the caret stay put). Shift-Tab always outdents the whole row. `handleKeyDown` returns `false` for list items to let this extension's `addKeyboardShortcuts` handle them.

### A4 page preview
The editor renders inside a `.a4Page` div (210 mm wide, padding 1.5 cm top/bottom, 1 cm left/right) centered on a gray "desk" background. A `repeating-linear-gradient` makes the bottom 1.5 cm of every 297 mm repeat match the desk color — creating the visual of separate pages with a gray gap between them, without JavaScript pagination. Limitation: text that falls in the bottom-margin zone renders on the gray band.

**`.a4Page` stays white in dark mode (v4.8.1).** The paper itself (`background-color: #fff`, `color: #000`) is pinned white-with-black-text in both themes, since the printed contract is white and the editor is meant to be WYSIWYG — only the 12 mm inter-page "desk gap" (see below) is darkened for dark mode, and the surrounding scrollable `.editor` desk keeps its normal dark-mode background. `ContractTemplatesPage.module.css`'s `[data-theme="dark"] .a4Page` rule only overrides the gap color and deepens the `box-shadow`; it does not touch `background-color`/`color`.

### Multipage canvas + measured page break (2026-04-27)
The editor canvas (`.a4Page`) now has `min-height: 297mm` so an empty template always shows one full A4 page. A `repeating-linear-gradient` paints a 12 mm grey "desk gap" every 309 mm (297 + 12) to suggest stacked pages. The ↧ page-break node is no longer just a dashed divider: a `useEffect` on the editor's `transaction` event walks every `[data-page-break]` element in DOM order, resets heights to 0, then sets each break's height so the next content starts at `(floor(Y / 309) + 1) * 309 + 15mm` — i.e. at the top of the next A4 page with a proper top margin. Saved HTML still serialises `height: 0` and `page-break-before: always`; the dynamic height is purely editor-side, so html2pdf's PDF output uses its own pagination.

### Word-like editor polish (2026-04-27)
Toolbar additions to make the editor feel closer to Microsoft Word:
- **Undo/redo buttons** at the leftmost toolbar slot.
- **Find & Replace** (`Ctrl+F`) with a custom `SearchHighlight` extension that decorates matches via a ProseMirror plugin; the panel runs `editor.chain().insertContentAt(...)` for replacements, collecting ranges in reverse so positions stay stable.
- **Tables** — `@tiptap/extension-table` family with contextual +R/+C/−R/−C/×T buttons that appear when the cursor is in a table. The base extension's column-resize NodeView wraps `<table>` in a `<div class="tableWrapper">`, so any class applied via `Decoration.node` lands on the wrapper, not the table — CSS uses a descendant selector (`.hpm-borderless td/th`) so it matches whichever element carries the class.
- **▦ borderless toggle**: `Table.extend({ addAttributes: { borderless } })` plus a ProseMirror plugin that adds `class="hpm-borderless"` via `Decoration.node`. `useContractGeneration` injects matching `<style>` rules into the html2pdf wrapper so PDF output respects the toggle (the editor's CSS module is scoped to `.a4Page` and isn't present on the detached PDF wrapper).
- **Line spacing** dropdown (1.0 / 1.15 / 1.5 / 2.0 / 3.0) — custom `LineHeight` extension adds a `lineHeight` attribute to `paragraph`/`heading`.
- **List-marker font size**: browsers render `::marker` using the `<li>`'s font-size, not the inline `<span style="font-size:…">` inside the `<p>`. Custom `ListItemStyle` extension registers a `style` attribute on `listItem`; the FontSize dropdown handler propagates the chosen size onto the parent `<li>` via `setNodeMarkup` so the marker matches.
- **Page break** node ↧ — `<div data-page-break style="page-break-before:always">…</div>` in saved HTML so html2pdf forces a new page.
- **Paste-from-Word cleanup** — ProseMirror plugin's `transformPastedHTML` strips `<o:p>` tags, `MsoNormal` classes, `mso-*` styles, `<font>` tags, and StartFragment/EndFragment markers before TipTap parses the clipboard.
- **Reactivity fix**: TipTap React v3's `useEditor` doesn't subscribe to selection changes by default, so `isActive(...)`-driven toolbar state was stale. A `useEffect` on the editor's `transaction` event forces a rerender via `useReducer`. Without this, contextual buttons (like the table-context controls) wouldn't appear when the cursor entered a table.

### Image resize + alignment + wrapping toolbar (2026-04-28)
- **`ResizableImage`** = `Image.extend({...})` with two attributes that round-trip via inline style: `width` (e.g. `"50%"`) and `align` (`"left" | "center" | "right"`, rendered as `display: block; margin-left/right: …`). Percentage widths instead of drag-resize because html2pdf renders A4 PDFs from the editor HTML — pixel widths from drag handles render inconsistently across screen sizes vs paper, while presets keep the PDF predictable.
- **Contextual second toolbar row** (`.toolbarSecondary`, background `--color-surface-2`) renders only when an image or table is selected. Houses the image width presets (25/50/75/100% + ⤢ reset), image alignment (⬅ ↔ ➡), and the existing table row/col/border controls. Previously these all lived in the main toolbar, which pushed trailing buttons off-screen on narrow monitors.
- **Wrapping toolbars**: both `.toolbar` and `.toolbarSecondary` use `flex-wrap: wrap` + `justify-content: center` so buttons reflow onto a new centered line on narrow screens instead of overflowing.

### Conditional blocks in templates (2026-04-28)
`fillTemplate()` resolves Handlebars-style block markers before the standard `{{key}}` substitution: `{{#if X}}…{{/if}}` keeps its inner content iff `vars[X]` is a truthy non-empty string, `{{#unless X}}…{{/unless}}` is the inverse. After stripping a block, any leftover empty `<p></p>` wrappers are removed so a hidden line doesn't leave a blank paragraph in the PDF. `getMissingVariables()` runs the conditional pass first so a `{{var}}` that lives inside a stripped block isn't flagged as missing data.

⚠️ **Superseded (v4.8.0):** blocks originally could not nest (a pair of non-greedy regexes meant an inner `{{/if}}` closed the outer block). As of v4.8.0 the engine is a real block parser and nesting works to any depth — see ["Nested conditional blocks (v4.8.0)"](#nested-conditional-blocks-v480) below for the rewrite, the bug it fixed, and the deploy-order trap it shares with the variable-catalogue rule.

Three derived variables drive the typical "Czech vs foreigner" branch:
- `nationality` — raw string from `employee.nationality`.
- `isCzech` — `"ano"` iff `nationality.trim() === "CZE"` (the planned ISO-3 dropdown value); empty otherwise.
- `isForeigner` — inverse of `isCzech`.

Empty / unknown nationality is treated as foreign because the foreign branch typically adds legally required fields (passport / visa).

### Row-sourced template variables + probation/end-date conditionals (2026-04-29)
Four plain variables sourced from the employment row are exposed in the template variable picker (under "Pracovní podmínky"):
- `{{workLocation}}` / `{{probationPeriod}}` — free-form strings stored on the row.
- `{{signingDate}}` — raw ISO; `resolveVariables` formats it with the shared `formatDateCZ` helper, so it lands in the rendered contract as "DD. MM. YYYY".
- `{{hoursPerWeek}}` (v3.5.0) — effective hours per week from the PPP Nástup row (the `hoursPerWeek` field, absent for HPP/DPP). Used in PPP contracts to state the contracted fraction ("Počet hodin týdně (PPP)" in the picker).

Four derived conditional flags drive `{{#if}}` blocks for the common branches:
- `hasProbation` / `noProbation` — `noProbation` is true when the probation string is empty, `"0"`, `"0 měsíců"`, or otherwise contains no non-zero digit (heuristic: `/[1-9]/.test(probationPeriod)`). Anything with a real number is `hasProbation`.
- `hasEndDate` / `noEndDate` — `noEndDate` is true when `endDate` is null/empty (open-ended employment); useful for hiding the fixed-term clause on indefinite contracts.

Both polarities of each flag are emitted so templates can pick the more readable phrasing per block.

### Template variable pruning + hasPermanentResidence conditional (2026-04-29)
Trimmed the contract-template variable surface to just the keys real templates use. The picker (`VARIABLE_GROUPS` in `frontend/src/lib/contractVariables.ts`) and `resolveVariables` no longer emit:
- `birthNumber`, `idCardNumber`, `currentDepartment` (employee)
- `nationality` (kept on `EmployeeData` as the input for `isCzech` / `isForeigner`, but not emitted as a template var)
- `city`, `zip` (address is now a single line; templates use `{{address}}`)
- `dic` (company)
- `signatoryName`, `signatoryTitle` — entire `SignatoryData` interface and the `signatory` argument to `resolveVariables` are gone
- `contractNumber`

These removals only affect the contract-template surface — the underlying Firestore fields, encryption, Employee form, Employee detail page, CSV export, and audit logging are untouched. References to any of the above in old templates will render as literal `{{key}}` text now (templates are being redone, so back-compat shims aren't worth keeping).

Added under "Zaměstnanec":
- `hasPermanentResidence` / `noPermanentResidence` — conditionals driven by `documents.visaType === "trvalý pobyt"` (case-insensitive, trimmed). `visaType` is plumbed through both `GenerateContractModal` call sites (Historie row + Smlouvy standalone) so the flag resolves correctly in either flow.

### Human-readable contract download filenames (2026-04-29)
Contract storage paths stay short and stable (`contracts/{employeeId}/{contractId}.pdf`) — only the *download* filename is human-readable. The frontend computes a Czech display name at generation time via `frontend/src/lib/contractNaming.ts`'s `buildContractName(type, row, fullName)`:

- `nastup_hpp` / `nastup_ppp` / `nastup_dpp` → `"HPP 2026 Klíma Richard"` (year from `row.startDate`).
- `ukonceni_hpp_ppp` / `ukonceni_zkusebni` → `"Ukončení HPP Klíma Richard"` (subtype from `row.contractType`).
- `ukonceni_dpp` → `"Ukončení DPP Klíma Richard"`.
- `zmena_smlouvy` → `"DODATEK2026 navýšení, změna pozice Klíma Richard"` — a `DODATEK<YEAR>` prefix (year from `row.startDate`), then **every** change's label joined by `", "` (`mzda` → `"navýšení"`, `pracovní pozice` → `"změna pozice"`, `úvazek` and `počet hodin` → `"změna úvazku"`, `délka smlouvy` → `"doba určitá"` / `"doba neurčitá"`).
  - `délka smlouvy` derives its label from *whether* the change carries an end date, and never from the value itself: the value is an ISO date (the edit form renders a `type="date"` input), so a date means the dodatek sets a fixed end → `"doba určitá"`, and an empty value means it drops the end date → `"doba neurčitá"` (the same empty-means-open-ended convention the backend readers use as `ch.value || null`). Before v4.10.3 the raw value was used directly, which emitted filenames like `"DODATEK2026 2027-12-31 Klíma Richard"`.
- `hmotna_odpovednost` / `multisport` → `"Hmotná odpovědnost Klíma Richard"` / `"Multisport Klíma Richard"`.

The name is persisted on the contract doc as `displayName` (passed via `POST /contracts` body alongside `rowSnapshot`). `GET /contracts/:id/download` reads it and emits both an ASCII-folded fallback (`filename="HPP 2026 Klima Richard.pdf"`) and a UTF-8 form (`filename*=UTF-8''HPP%202026%20Kl%C3%ADma%20Richard.pdf`) on the `Content-Disposition` header. Signed copies append `" - podepsaná"` so the unsigned and signed PDFs don't collide in the user's Downloads folder. Older contracts (no `displayName` field) fall back to the previous `{contractId}_{kind}.pdf` form.

**Same-name disambiguation (2026-06-17).** Two contracts can share an identical `displayName` — e.g. two `zmena_smlouvy` "navýšení" amendments for the same employee in the same year both resolve to `"DODATEK2026 navýšení Jan Novák"`. To keep them distinct in the Downloads folder, the **download endpoint** disambiguates at stream time (no regeneration of existing docs): it loads the employee's contracts subcollection (`ref.parent.get()`), and when ≥2 carry the same `displayName` it appends an ISO-style date qualifier to *this* contract's filename — the month `(YYYY-MM)`, or the full date `(YYYY-MM-DD)` when another collision shares the same month. The date is resolved by the `contractDateIso()` helper (priority: `rowSnapshot.startDate` → `signingDate` → `validFrom` → `generatedAt` timestamp), mirroring the year `buildContractName` uses; a contract with no resolvable date falls back to a short `{contractId.slice(0,4)}` suffix. ISO form is used (not a Czech month name) because it carries the year — so it can't re-collide across years for year-less ad-hoc names — and contains no `/` (illegal in a filename). Purely a filename change; the stored `displayName` and storage paths are untouched.

The download handler (then `ContractsTab.handleDownload`; today `ContractActionButtons.handleDownload` / `OtherDocumentsTab.handleDownload` — see the note above) now performs a real download via a hidden `<a download="…">` link instead of opening a blob URL in a new tab. Blob URLs have no filename, so saving from a preview tab landed a generic name; the new flow parses the `Content-Disposition` header on the client (preferring the UTF-8 form), sets it on the temporary anchor, and clicks it. Matches the Czech button label "Stáhnout" (= download).

### Uniform "DD. MM. YYYY" date format across the app (2026-04-29)
Every user-facing date in the app now renders as "DD. MM. YYYY" — Czech-style with spaces between segments. The three formatter helpers in `frontend/src/lib/dateFormat.ts` (`formatDateCZ`, `formatTimestampCZ`, `formatDatetimeCZ`) all emit the spaced form, and `formatDateCZ` now also accepts JS Date objects so contract output uses the same helper as the rest of the UI. The previous duplicate `formatContractDate` in `contractVariables.ts` was removed; contract dates and UI dates can no longer drift apart. The convention lives in one place — change it in `dateFormat.ts` and every screen plus every contract follows.

### Contract PDF upload routes through backend (2026-04-28)
`storage.rules` deny all direct client access, so the PDF upload now happens server-side. `POST /api/employees/:employeeId/contracts` accepts an optional `pdfBase64` field; when present, the handler reserves a Firestore doc id, decodes the base64 buffer, writes `contracts/{employeeId}/{docId}.pdf` via the Admin SDK (`admin.storage().bucket().file().save()`), then creates the metadata record with `unsignedStoragePath` set — single atomic operation. `express.json` limit was bumped to 10 MB to fit PDFs with embedded base64 logos.

`useContractGeneration.uploadContract()` no longer calls `uploadBytes`; it base64-encodes the Blob (chunked `Uint8Array` → `btoa` loop to avoid stack overflow on large PDFs) and POSTs it. The rollback-delete is gone because the backend either succeeds atomically or fails before writing.

The remaining three Smlouvy-tab paths (download, signed-PDF upload, delete) were also routing through the locked client SDK and are now backend-routed too — see "Contract download / signed upload / delete via backend" below.

### Contract download / signed upload / delete via backend (2026-04-28)
Three new endpoints close the last `storage.rules` violations on the Smlouvy tab:

- `GET  /api/employees/:employeeId/contracts/:contractId/download?kind=unsigned|signed` — looks up the contract doc, resolves the requested storage path, and streams the PDF via `file.createReadStream().pipe(res)` with `Content-Type: application/pdf` so the browser opens it inline.
- `POST /api/employees/:employeeId/contracts/:contractId/signed-pdf` — accepts `{ pdfBase64 }`, writes `contracts/{employeeId}/{contractId}_signed.pdf` via the Admin SDK, then atomically updates the doc with `status: "signed"`, `signedStoragePath`, `signedAt`, `signedUploadedBy`.
- `DELETE /api/employees/:employeeId/contracts/:contractId` — now also deletes both `unsignedStoragePath` and `signedStoragePath` from Storage (best-effort `Promise.all` with per-file `.catch(() => undefined)` so a stray missing file doesn't 500 the whole request).
- `DELETE /api/employees/:employeeId/contracts/:contractId/signed-pdf` (2026-04-29) — deletes only the signed PDF from Storage and reverts the record to `status: "unsigned"`, clearing `signedStoragePath`/`signedAt`/`signedUploadedBy` via `FieldValue.delete()`. Used by the "Smazat podepsanou" action on signed rows.

Frontend: `ContractsTab.handleDownload(contractId, kind)` fetches the streamed body, converts to a blob URL, and `window.open`s it (URL revoked after 60s so the new tab has time to claim it). `handleUploadSigned` shares the `blobToBase64` helper extracted to `frontend/src/lib/blobToBase64.ts`. `confirmDeleteUnsigned` is now a single `DELETE` — backend handles Storage cleanup. The dead `useContractGeneration.deleteStorageFile` was removed.

### Smlouvy tab — Obnovit + Smazat podepsanou actions (2026-04-29)
⚠️ **Not carried over to `ContractActionButtons` (v4.6.0).** This section describes a `ContractsTab`-only feature. When the Smlouvy tab was folded into the session-based Historie tab (see the note at the top of this section), the replacement `ContractActionButtons.tsx` kept **Smazat** (delete, whole record), **Stáhnout**/preview, and the sign-menu (**Nahrát podepsanou smlouvu**), but did not reimplement per-row **Obnovit** or **Smazat podepsanou** for `archived`-status contracts — grep confirms neither string exists in the current frontend. The backend still supports both: `PATCH /api/employees/:employeeId/contracts/:contractId` can set/clear `status: "archived"`, and `DELETE .../signed-pdf` still exists (see "Contract download / signed upload / delete via backend" above); there is simply no current UI entry point for either. Kept below for historical context on the state graph and the endpoints involved.

`ContractsTab` row actions used to cover the full state graph:
- **Archived rows** show **Obnovit**, which PATCHes status back to `signed` (if `signedStoragePath` exists) or `unsigned` (otherwise). Previously archived rows had no actions, so the existing `DELETE` path was unreachable — un-archiving via Obnovit re-exposes the appropriate Smazat / Smazat podepsanou button.
- **Signed rows** show **Smazat podepsanou** (with confirm modal) which calls the new `DELETE /signed-pdf` endpoint to drop just the signed copy and revert to unsigned, leaving the original generated PDF and metadata intact. Useful when the wrong scan was uploaded.

### Server-side Puppeteer PDF rendering (2026-04-29)
Contract PDFs are now generated server-side by a real headless Chromium via Puppeteer rather than client-side html2pdf.js + html2canvas. The same engine that paints the editor preview paints the PDF, so the two match byte-for-byte — native `::marker` list bullets, font metrics, line-spacing, and CSS page-breaks all behave exactly as the browser shows them. html2pdf.js stays in place for the payroll and shift-plan PDF exports (different layout requirements; not affected).

- `functions/src/services/pdfRenderer.ts` — module-level browser singleton (one Chromium per Cloud Function instance, reused across requests so cold-start cost is paid only on the first render) + `renderPdf(html, margins)` Buffer. The disconnected event nulls the singleton so the next call relaunches.
- **SSRF guard (v3.2.1).** Before setting page content, `renderPdf` enables Puppeteer request interception. Any request whose URL does **not** start with `data:` or equal `about:blank` is **aborted** — the headless browser cannot make outbound HTTP/HTTPS/file requests. This prevents admin-editable contract HTML (which may contain arbitrary markup) from using the renderer to read internal services or the GCP metadata endpoint. Contract templates embed images as base64 `data:` URIs, so normal rendering is unaffected.
- `POST /api/contracts/render-pdf` — admin/director only, accepts `{ html, margins? }`, returns `application/pdf` binary. The route inlines the same CSS rules `.editorContent` uses (font, paragraph margins, table styles, etc.) so the rendered document is styled identically to the editor.
- `functions/src/index.ts` — bumped the `api` v1 function to `runWith({ memory: "1GB", timeoutSeconds: 60 })` so Puppeteer's Chromium (≈500 MB resident, ~3–5s cold start) fits.
- `frontend/src/hooks/useContractGeneration.ts` — `generatePdf` moved into the hook (needs an auth token to call the endpoint). It POSTs `{ html, margins }` and returns the response Blob; the existing `uploadContract` then base64-encodes the blob and POSTs to `/contracts` as before.
- `frontend/src/components/GenerateContractModal.tsx` — destructures `generatePdf` from the hook instead of importing the standalone function.
- `frontend/src/lib/contractVariables.ts`:
  - Conditional-block stripping uses an `HPM_STRIPPED` sentinel: `{{#if X}}…{{/if}}` blocks whose condition is false collapse to the marker; a follow-up regex drops only the wrapping `<p>` if the marker was the entire paragraph contents (or strips the bare marker if it sat between paragraphs). Intentional empty `<p></p>` elsewhere in the document is no longer collateral damage.
  - Empty `<p></p>` paragraphs are normalised to `<p><br></p>` so they render as visible blank lines — Chromium collapses bare empty `<p>` to zero height when re-rendered outside the editor's `contenteditable` surface, but `<br>` forces one line of height. Trailing empty paragraphs at the very end of the document are stripped first so they don't push content onto a blank second page.
  - Empty `<p></p>` runs immediately preceding a `<table>` are stripped before the `<br>` normalisation. Single-row tables can never break (Chromium implicit `break-inside: avoid` on `<tr>`), so the row's full natural height has to fit on whatever's left of the page; the author's blank paragraphs above the table — added for visual breathing room in the editor — would otherwise stack with the table's own `margin: 0.5cm 0` and push the row past the page boundary even when the rest of the page looks empty. Caught by the Nástup HPP signature table moving to page 2 for a Czech employee whose conditional blocks shrunk the doc but still left a blank `<p>` between the date line and the table.

### Denser list spacing (2026-04-29)
Numbered and bullet lists in templates were inheriting body `line-height: 1.6`, and TipTap wraps each `<li>` in a `<p>` that picked up the global `p { margin: 0 0 0.5em }` between items, making lists look loose. Two CSS rules fix it: `li { line-height: 1.3 }` and `li > p { margin: 0 }`. Applied in both `frontend/src/pages/ContractTemplatesPage.module.css` (editor preview) and `functions/src/services/pdfRenderer.ts` `RENDER_CSS` (Puppeteer renderer) so the PDF still matches the editor byte-for-byte.

### Nested lists + custom bullet glyphs (2026-04-29)
TipTap's schema permits `<ul>` inside `<ol>` (and arbitrary further nesting), but the `ListItemIndent` extension takes Tab/Shift-Tab inside a list to apply CSS `margin-left` on the whole `<ul>/<ol>`, which shadows TipTap's default `sinkListItem` keybinding. Two new toolbar buttons next to ≡ / `1.` expose nesting explicitly:
- **→]** Vnořit položku seznamu — `sinkListItem("listItem")`, disabled when `editor.can().sinkListItem` returns false (cursor not in a list, or already at the deepest possible level for that position).
- **[←** Vynořit položku seznamu — `liftListItem("listItem")`, disabled when there's nothing to lift out of.

After sinking, click the bullet/ordered toolbar button to convert the freshly-nested list to the desired type (e.g. `<ul>` inside `<ol>`).

Bullet glyphs: top-level `<ul>` uses `list-style-type: "– "` (en-dash + space) regardless of whether it sits at document root or inside an `<ol>`; `<ul>` nested inside another `<ul>` switches to `circle`. Both rules live in the editor CSS and the Puppeteer `RENDER_CSS`. `<ol>` markers stay default (decimal).

### Generovat button hidden when matching contract exists (2026-04-29)
Contract docs now carry an optional `rowSnapshot` field — a freeze-frame of the row's identifying parameters at generation time. Snapshot fields: `companyId, contractType, jobTitle, department, startDate, endDate, salary, hourlyRate, agreedReward, workLocation, probationPeriod, agreedWorkScope, signingDate`. `POST /api/employees/:id/contracts` accepts and persists `rowSnapshot`; `useContractGeneration.uploadContract` forwards it; `GenerateContractModal` takes a `rowSnapshot` prop; `EmployeeDetailPage` builds the snapshot from the row at modal open.

`EmployeeDetailPage` fetches the contracts list alongside the employee + employment data and exposes `hasMatchingContract(row, type)` — true when any contract exists with `employmentRowId === row.id`, `type === t`, and a snapshot field-by-field equal to the row's current snapshot. The Historie tab filters `getContractTypesForRow(row)` through this check before deciding whether to render the Generovat button (single applicable type), the Generovat ▾ dropdown (multiple), or nothing (all types already covered).

`ContractsTab` notifies the parent via the new `onContractsChanged` prop after every mutation (create/delete/upload-signed/delete-signed/archive/unarchive). The parent's `refetchContracts` reloads the list so the button reappears as soon as a contract is deleted, and the post-generation `onGenerated` flow also calls `refetchContracts` before navigating to Smlouvy. Backwards-compat: existing contracts without `rowSnapshot` always fail the equality check, so the button stays visible until a fresh contract is generated.

Also: the `useEffect` in `ContractsTab` that fires `fetchContracts` now lists `user` in its deps. The previous `[employeeId]` only caused a stuck "Načítám smlouvy…" state when auth hadn't hydrated by mount — `fetchContracts` returns early when `user` is null and never set `loading=false` because the effect didn't re-run when `user` changed.

### Probation-aware termination template selection + DPP fix (v4.8.2)
Generating a document from an **"Ukončení"** history row now picks the termination template with a shared `pickType(row)` closure (`EmployeeDetailPage.tsx`), used identically for the Generovat action, the row's default type, and the display-name computation so all three always agree:

1. `session.effective.contractType === "DPP"` → `ukonceni_dpp` (checked first — a DPP termination always wins, regardless of probation).
2. Otherwise, terminated **within probation** → `ukonceni_zkusebni`.
3. Otherwise → `ukonceni_hpp_ppp`.

The rule lives in `terminationContractType(session)` (`frontend/src/lib/employmentSessions.ts`), which replaces the old `expectedContractTypesForRow(row)[0]` call at the generate site — `expectedContractTypesForRow` is still used elsewhere (`mapContractsToRows`) to decide which *existing* contracts belong to a row, since a row can legitimately be matched against any of the three termination types; it was never meant to pick a *default*.

**"Within probation"** is a whole-months, half-open range: probation covers `[start, start + N months)`, so the *last* day of probation is `start + N months − 1 day`. A termination is in-probation when `endDate < start + N months` (i.e. `endDate <= start + N months − 1 day`). `parseProbationMonths()` reads the row's free-form `probationPeriod` string (bare number or "N měsíc/měsíce/měsíců", accent-insensitive); weeks/days or unparseable text fall back to `ukonceni_hpp_ppp` (no in-probation detection). This mirrors — and is now kept in sync with — the backend's probation-end-date calculation; see the "Probation alert generator" note in [Other Features & UI — Upozornění hub](other-features-and-ui.md#upozornění-hub) for the matching v4.8.2 backend fix.

**The DPP fix.** Before this change, the generate action and the row's default type both called `expectedContractTypesForRow(row)[0]`, which is unconditionally `"ukonceni_hpp_ppp"` (the array's declared order for `ukončení` rows). A DPP employee's termination therefore always opened the **HPP/PPP** template, never `ukonceni_dpp` — a latent bug from before templates were split into three termination types. `pickType()` fixes this for every termination row, DPP or not.

### DPP row defaults + auto-computed Sjednaná odměna (2026-04-30)
Two changes to how DPP rows behave on the employment-history modal:

1. **End date defaults to empty.** The previous form pre-filled "Konec smlouvy" with 31. 12. of the current year whenever DPP was selected. Open-ended DPP is the common case in this hotel's hiring pattern, so the auto-fill was misleading more often than helpful. The contract-type switch now clears `endDate` for every type — DPP behaves like the others, and a fixed-term DPP requires an explicit date.

2. **"Sjednaná odměna" auto-computes from a settings cap.** A new payroll setting `dppMaxMonthlyReward` (Mzdy → Nastavení tab, default **11 999 Kč/měsíc**) drives a `useEffect` that fills the field whenever `contractType === "DPP"`:
   - **No end date** → `max × 12`, ceil to the nearest 10 000 (= 150 000 Kč with default).
   - **With end date** → `max × ((endY−startY)·12 + (endM−startM) + 1)` months, ceil to the nearest 10 000.

   Typing in the input flips an `agreedRewardManual` flag and freezes the value; a small "↻ auto" link beside the label re-engages auto-compute. Editing an existing row that already has a saved reward starts in manual mode so historical values are never overwritten silently. Switching contract type clears the reward and resets the manual flag.

`GET/PATCH /payroll/settings` reads/writes `foodVoucherRate`, `dppMaxMonthlyReward`, `minimumWage`, `multisportBasePrice` and `mealAllowanceMinHours`; PATCH validates and accepts each field independently (each `> 0`) so editing one sub-section doesn't require sending the others. The Mzdy settings page (`SettingsPage.tsx`) renders each as its own sub-block — same "Upravit" → ConfirmModal pattern. `mealAllowanceMinHours` (default 3) is the minimum shift length in hours that earns a stravenkový paušál; it is frozen onto each `payrollPeriods/{id}` at creation (like `foodVoucherRate`) so a settings change never alters already-generated periods.

### DPP template variables — Rozsah práce + Odměna (2026-04-30)
Two new keys exposed under "Pracovní podmínky" in the contract-template variable picker:
- `{{agreedWorkScope}}` — "Rozsah práce DPP" (free-form string from the row, e.g. *"max. 300 hodin ročně"*).
- `{{agreedReward}}` — "Odměna DPP" (numeric Kč, stringified the same way as `{{salary}}`).

Both fields are populated from the employment row when `GenerateContractModal` is opened, so DPP templates can reference them directly instead of reusing the generic `{{salary}}` slot. The fields existed on the row schema before this commit; only the variable plumbing is new.

### Custom standalone contract templates (2026-04-30)
Admin / director users can now create their own contract templates via a **+ Nová šablona** button on the **Šablony smluv** page. The button opens a small modal with two fields — a snake_case ID slug and a Czech display name — and `POST /api/contractTemplates` creates the doc with `kind: "standalone"`, empty `htmlContent`, and default 15 mm margins. Custom templates are always standalone (history-tied templates stay locked to the 9 built-in IDs because their generation is keyed to specific changeType→contractType mappings).

The frontend `ContractType` was a closed union over the 9 built-in IDs; it's now a `string` alias so custom slugs flow through every type-tagged surface (state shapes, props, the `Record<>` indexes). `BUILTIN_CONTRACT_TYPES` retains the closed set for places that still need it. `CONTRACT_TYPE_LABELS` is now `Record<string, string>` and only carries the 9 built-in entries — custom-template labels resolve at runtime from the fetched list (`GET /api/contractTemplates`).

Surfaces that needed the runtime label resolution:
- `ContractTemplatesPage` sidebar concatenates `ALL_TYPES` (built-ins) with `customTypes` (filter `kind === "standalone"` from the fetched list); each entry renders with its proper label.
- The Generovat ▾ dropdown (then on `ContractsTab`; today the "+ Generovat dokument" picker on `OtherDocumentsTab` — see the note above) does the same — built-in standalone types plus custom — and the standalone signing-date prompt resolves its title via `CONTRACT_TYPE_LABELS[id] ?? customStandalone.find(...).name ?? id`.
- The contracts table's type column uses the same fallback chain.
- `buildContractName` got a `default` branch + optional `fallbackLabel` parameter so custom templates emit `"<TemplateName> Klíma Richard"` filenames.

Backend: `POST /api/contractTemplates` validates the slug (`^[a-z][a-z0-9_]{1,39}$`), rejects collisions with the 9 built-in IDs, rejects existing IDs (409). The existing `PUT /:id` body type was widened from `ContractType` to plain `string` so saves to custom-id slugs go through. The listing endpoint now returns the new `kind` field (`"standalone"` for custom, `null` for built-ins).

### Delete / deactivate contract templates (v3.8.2, 2026-07-05)
Template lifecycle management on the **Šablony smluv** page (all gated by the existing `contractTemplates.manage` permission — no new key). The rule is **custom → deletable, built-in → deactivate-only**: a custom (`kind:"standalone"`) template can be hard-deleted; the 9 built-in templates cannot (the seed recreates them and the employment-tied ones are structural), but any template can be flagged inactive.

New `active` field on the template doc — **absent = active**; only an explicit `active:false` marks it inactive. The list endpoint returns `active: data.active !== false`; `GET /:id` returns the raw field.

Backend routes added to `functions/src/routes/contractTemplates.ts` (all `requirePermission("contractTemplates.manage")`):
- `DELETE /:id` — hard-delete a custom template. Rejects the 9 built-in IDs with 409 (`BUILTIN_IDS` guard). Already-generated contracts are left untouched (their PDFs persist; they just lose the link to the template name). Audited via `logDelete`.
- `PATCH /:id { active: boolean }` — toggle the active flag (deactivate / reactivate). `merge:true` set; 404 if the doc doesn't exist. Audited via `logUpdate` (before/after `active`).
- `GET /:id/usage` → `{ count }` — collection-group count of generated contracts whose `type` equals the template id, used to warn before deleting a used custom template. Needs the `contracts.type` `COLLECTION_GROUP` field override added to `firestore.indexes.json`.

Frontend behaviour:
- **`ContractTemplatesPage`** — custom rows show a **Smazat** button (danger `ConfirmModal`; the message includes the best-effort usage count from `GET /:id/usage`). Built-in rows show a **Deaktivovat / Aktivovat** toggle (deactivate confirms; reactivate is immediate). The sidebar list is a flex column and splits into an active group and an inactive group; the inactive group's **"Neaktivní"** heading carries `margin-top:auto` so deactivated templates are anchored to the bottom of the sidebar under a clear separator.
- **Hide inactive from generation** — the `EmployeeDetailPage` "+ Adhoc dokument" picker filters out inactive built-in standalone types (`inactiveStandaloneIds`) and inactive customs (`active !== false`). `GenerateContractModal` refuses to generate when the fetched template has `active:false` (backend-sourced backstop for the row-tied flow, where the template id is forced by the employment row) — shows a notice and disables the generate button.

### Multisport template variables + 3-field signing-date prompt (2026-04-30)
⚠️ **Collection UI superseded (v4.8.2):** the standalone-contract signing-date *prompt* described below (and the one in "Standalone contract — signing date prompt" further down) no longer exists — see ["One-step ad-hoc document generation (v4.8.2)"](#one-step-ad-hoc-document-generation-v482) below. The three variables this section introduces (`{{requestedAt}}`, `{{validFrom}}`, `{{validFromMonth}}`) are unaffected; only how their raw dates are collected changed (now inline in `GenerateContractModal` instead of a separate prompt before it opens).

The standalone-contract signing-date prompt now collects **three** dates when the type is `multisport` (single date for `hmotna_odpovednost`): "Datum podpisu", "Datum žádosti", "Platnost od". All three are seeded to today on open and validated together — the Pokračovat button stays disabled until every required field has a value. Modal title dropped the "— datum podpisu" suffix since the prompt isn't single-purpose anymore.

The chosen values flow through `<GenerateContractModal>`'s `employeeData` and surface as three new picker entries under a new **Multisport** group in `VARIABLE_GROUPS`:
- `{{requestedAt}}` — "Datum žádosti", formatted via `formatDateCZ`.
- `{{validFrom}}` — "Platnost od", formatted via `formatDateCZ`.
- `{{validFromMonth}}` — "Měsíc začátku platnosti (např. leden 2026)". Computed from the raw ISO `validFrom` by `czechMonthYear()` (new helper) which indexes into a `CZECH_MONTHS` array and appends the year — e.g. `2026-01-15` → `"leden 2026"`. Empty string when the input isn't a valid `YYYY-MM-DD` prefix.

### PDF page 2+ top margin offset by page-1 logo (2026-04-30)
Contracts with a logo image at the top of page 1 used to look unbalanced on page 2: body text started flush at the template's `margins.top` distance from the page edge, far higher than the post-logo content on page 1. `pdfRenderer.ts` now measures where the first `<img>` ends in the rendered DOM (via `page.evaluate(() => img.getBoundingClientRect().bottom)` after `page.setContent`), converts to mm at 96 DPI, and injects `@page` CSS:

```css
@page { margin: <top + logoMm>mm <right>mm <bottom>mm <left>mm; }
@page :first { margin-top: <top>mm; }
```

`@page :first` reverts page 1 to the template's original top margin so the logo stays pinned where the template author placed it; the default `@page` rule pushes pages 2+ down so their body text starts at the same y-offset as page 1's post-logo content. When no `<img>` is present in the body, `logoMm` is 0 and no `@page` rules are injected — fully back-compatible. Existing `page.pdf({ margin })` call left intact as a fallback for the no-image path.

### Page-break divider hidden in PDF export (2026-04-30)
`PageBreak` previously baked `border-top: 2px dashed #999; margin: 1cm 0` into its `renderHTML` inline style so the editor could show the divider — but that style also reached the Puppeteer renderer and painted the dashed line on the actual PDF page. Split the visual concerns:
- `PageBreak.renderHTML` now emits only `page-break-before: always; height: 0;` — the structural part needed for paginated print, nothing visual.
- A new editor-only rule `.a4Page [data-page-break]` in `ContractTemplatesPage.module.css` paints the dashed divider, scoped so it never reaches the Puppeteer `RENDER_CSS`.
- Defensive override in `pdfRenderer.ts` `RENDER_CSS` strips `border` / `margin` / `padding` / `height` from `[data-page-break]` with `!important`, so older templates whose saved HTML still carries the inline border render cleanly without needing to be re-saved.

### Standalone contract — signing date prompt (2026-04-30)
⚠️ **Superseded (v4.8.2).** This separate prompt (and its "Smlouvy tab" / `ContractsTab` naming — that component and the standalone "Smlouvy" tab no longer exist; standalone documents live in `OtherDocumentsTab` since v4.6.0, see "Ad-hoc documents are row-first" above) is gone. Its job — collecting `signingDate` for a type not tied to a history row — is now done inline by `GenerateContractModal`'s `collectSigningDate` mode; see ["One-step ad-hoc document generation (v4.8.2)"](#one-step-ad-hoc-document-generation-v482) below. Kept for historical context (why `signingDate` exists on standalone contracts at all).

Standalone contracts (`hmotna_odpovednost`, `multisport`) are not tied to a history row, so they had no `signingDate` — `{{signingDate}}` resolved to an empty string in their templates. Picking either type from the **Generovat ▾** dropdown on the Smlouvy tab now opens a small "Datum podpisu" prompt (one `<input type="date">`, defaults to today, dismissed only via Zrušit / Pokračovat per the no-backdrop-dismiss convention). Confirming carries the chosen date through `<GenerateContractModal>` as `employeeData.signingDate`, which `resolveVariables` formats via `formatDateCZ` like every other date variable. The prompt reuses `ConfirmModal.module.css` (overlay/modal/header/title/body/footer) so it matches the rest of the app's modal styling without duplicating CSS.

### Dodatek template variables (2026-04-30)
New "Dodatky" group in the contract-template variable picker covers the four change kinds a `změna smlouvy` row can carry plus a salary-direction verb:

- `{{dodatekEffectiveDate}}` — "Platnost dodatku", date the dodatek takes effect (= `row.startDate`, formatted via `formatDateCZ`).
- `{{newSalary}}` / `{{isDodatekMzda}}` — value + conditional flag for `changeKind === "mzda"`.
- `{{newJobTitle}}` / `{{isDodatekPozice}}` — for `"pracovní pozice"`.
- `{{newWorkScope}}` / `{{isDodatekUvazek}}` — for `"úvazek"`.
- `{{newEndDate}}` / `{{isDodatekZmenaKonce}}` — for `"délka smlouvy"` (formatted as date).
- `{{newHoursPerWeek}}` / `{{isDodatekHodiny}}` (v3.5.0) — new hours/week value + conditional flag for `changeKind === "počet hodin"` (PPP part-time fraction change). `{{isDodatekHodiny}}` is `"ano"` when a "počet hodin" change is present; empty otherwise.

`EmployeeData` carries two raw fields — `dodatekEffectiveDate` (ISO) and `dodatekChanges: { changeKind, value }[]` — plus `oldSalary`. `resolveVariables` derives every dodatek-related output from these inputs, so the template surface is single-source-of-truth from the row's `changes` array. Conditional flags use `changes.some(c => c.changeKind === kind)` rather than checking value emptiness, so a present-but-blank entry still triggers the section.

⚠️ **`{{salaryChangeVerb}}` removed in v4.10.0.** It used to emit `"zvyšuje"` when the new salary was greater than the salary in force immediately before the dodatek, `"mění"` otherwise (empty if either side was missing/non-numeric), computed by `findOldSalary(row, employment)` in `EmployeeDetailPage.tsx`. `oldSalary` is still exposed on `EmployeeData` — `findOldSalary` still runs and still feeds it in — but it's now a **comparable operand** (`COMPARABLE_VARS`, label "Předchozí mzda") rather than a pre-baked verb string. A template now expresses the same "raise vs. other change" branch as a derived condition (`newSalary` `>` `oldSalary`) driving `{{#if var1}}zvyšuje{{/if}}{{#unless var1}}mění{{/unless}}` — one condition slot instead of a fixed two-word vocabulary baked into the resolver. See ["User-defined derived conditional variables (v4.10.0)"](#user-defined-derived-conditional-variables-v4100) below. Same deploy-order caveat as `{{isHalfTime}}` above: live templates must migrate off `{{salaryChangeVerb}}` before this removal ships.

### Ctrl+Shift+Space inserts non-breaking space (2026-04-30)
Small `NbspKeybind` extension binds `Mod-Shift-Space` (Ctrl on Win/Linux, Cmd on macOS — matches MS Word) to `view.dispatch(state.tr.insertText(' '))`. The character is indistinguishable from a regular space in the editor (matching Word's behaviour — no visual marker) but round-trips through saved HTML and the Puppeteer-rendered PDF as a real U+00A0, so wrapping never splits Czech one-letter prepositions ("v Praze") or `number + unit` pairs ("150 000 Kč").

### `{{originalSigningDate}}` template variable (2026-04-30)
New variable exposed under "Pracovní podmínky" labelled "Datum podpisu původní smlouvy". Distinct from `{{signingDate}}` (signing date of the document being generated) — `{{originalSigningDate}}` is the signing date of the most recent prior `nástup` row that the current row sits on top of. Used in dodatek and ukončení templates that reference "smlouva ze dne …".

`findOriginalSigningDate(row, employment)` in `EmployeeDetailPage.tsx` filters history to `nástup` rows with `startDate <= row.startDate` (excluding the row itself), sorts descending by `startDate`, and returns the first match's `signingDate`. Re-hire timelines resolve to the latest nástup (the contract currently in force). The value is plumbed via `EmployeeData.originalSigningDate` and formatted by `resolveVariables` through the shared `formatDateCZ` helper.

### Conditional variable picker inserts full {{#if}} block (2026-04-30)
The variable picker entries flagged as conditionals (the eight keys whose label ends with "(pro {{#if}})") now insert the entire `{{#if KEY}}{{/if}}` block in one click and place the cursor between the opening and closing markers. `VARIABLE_GROUPS` entries carry an optional `kind?: "if"` (new `VariableDef` type), and `insertVariable(key, kind)` in `ContractTemplatesPage.tsx` branches on it — for `if` it composes left/right, runs `insertContent(left + right)`, then `setTextSelection(from + left.length)` to land the caret at the insertion point. Plain variables still insert the bare `{{key}}` as before. Tooltip on the button shows whichever snippet would be inserted.

### List-item Tab is position-sensitive (2026-04-30)
`ListItemIndent.addKeyboardShortcuts.Tab` now branches on caret position. With an empty selection at the start of a row (`parentOffset === 0` and the paragraph is the first child of the `listItem`), Tab keeps the existing behavior — bumping `margin-left` on the parent `<ul>/<ol>` so bullet/number and text shift together. Anywhere else inside a list item, Tab dispatches `state.tr.insertText('\t')`; `TabParagraph`'s inline `tab-size: 1.27cm` (which applies to every `<p>`, including those inside `<li>`) paints the gap, so the bullet and any text to the left of the caret stay put. Shift-Tab is unchanged — always outdents the whole row. Wrap behavior is intentionally not handled: a caret tab on a wrapped second line still indents from the wrap origin, which would be visible only in extreme cases.

### Contract company resolved from row, not parent state (2026-04-28)
`GenerateContractModal` now takes a `companyId` prop and fetches `/api/companies/:id` itself, replacing the previous `companyData={company ?? {}}` parent-state pattern. The row-tied modal (history-row trigger) passes `companyId={row.companyId}` — the legally correct company for that specific contract, not whichever company the employee currently has assigned. The standalone modal (multisport / hmotná odpovědnost) passes `companyId={employeeData.currentCompanyId}`. Eliminates two failure modes: `currentCompanyId` being null (company never fetched, all `{{companyName}}/{{ic}}/...` were empty) and an old row pointing at a different company than current.

### Per-template page margins (2026-04-28)
Each `contractTemplates/{id}` doc now carries an optional `margins: { top, bottom, left, right }` field (mm, 0–100). Three places consume the same value so editor preview and generated PDF stay in sync:
1. `.a4Page` padding is applied via inline `style` (the static `1.5cm 1cm` was removed from CSS).
2. `generatePdf(filledHtml, margins)` passes them to html2pdf as `[top, left, bottom, right]` (html2pdf's expected order).
3. The page-break offset effect uses `margins.top` for `TOP_MARGIN_MM`, so the next-page-top after a ↧ break tracks the template's top margin. The effect now depends on `margins`, so changing them re-runs the measurement.

UI: a new ⊟ toggle in the main toolbar opens a `.marginsBar` slide-down (same pattern as the find bar) with four Word-style presets (Standardní 25 mm / Úzké 13 mm / Střední 25/19 mm / Široké 25/51 mm) plus four numeric inputs (Nahoře / Dole / Vlevo / Vpravo). The active preset is highlighted; numeric edits switch to "Vlastní" implicitly because no preset matches.

Defaults: `{15, 15, 15, 15}` (matches the previous hard-coded PDF margins) is applied when a doc has no `margins` field, so legacy templates render unchanged.

Backend: `PUT /api/contractTemplates/:id` validates each margin side as a finite number 0–100 mm and merges into the doc. `GET` returns the doc as-is so no read-side change was needed.

### First-load preview fix
The "load template into editor" effect depends on `templates[selected]?.id` (computed as `selectedTemplateId`), not on `selected` alone. Initial mount has `templates = {}` while `fetchTemplates()` is still in flight, so `selectedTemplateId` starts undefined; the effect renders an empty `<p></p>` and re-fires once the id materializes. Saving doesn't bounce the editor because the id stays the same after `fetchTemplates()` re-populates the map.

### Template variables — new additions
- `{{birthDate}}`: formatted date of birth (`formatDateCZ(employee.dateOfBirth)`).
- `{{passportNumber}}`, `{{visaNumber}}`: from `documents` sub-collection.
- `{{companyFileNo}}`: Spisová značka from `company.fileNo` (new field, editable in Settings → Společnosti).

### Editable "Hodnoty proměnných" overview (v3.1.0)

Before generating, `GenerateContractModal` shows a **"Hodnoty proměnných"** table listing every template variable that appears in the selected template. Every cell is now an editable `<input>` so the generator can override individual values — useful for back-dated contracts or ad-hoc corrections.

**How it works (`frontend/src/components/GenerateContractModal.tsx`):**

- `autoVars` — the full output of `resolveVariables(employeeData, companyData)`, computed on every render from the props.
- `editedVars` — React state (`Record<string, string>`), sparse patch. Starts empty; gains an entry whenever the user types in a cell.
- `vars = { ...autoVars, ...editedVars }` — the working copy passed to both `getMissingVariables()` and `fillTemplate()`. Auto-values win when no override is set; the override wins when one exists.
- **Per-field "Vrátit"** button appears beside any edited cell. Clicking it calls `revertField(key)`, which deletes that key from `editedVars` (restoring the auto-value). The button is hidden when the field has not been manually changed.
- **"Vrátit vše na automatické"** header button clears the entire `editedVars` map at once. Visible only when `Object.keys(editedVars).length > 0`.
- Edited cells receive the CSS class `.varInputEdited` (highlighted visually).

**Scope:** purely transient — overrides are held only in component state and are lost when the modal closes. Nothing is persisted; the backend is unaffected. The `missing` warnings re-evaluate on every keystroke against the overridden `vars`, so clearing a previously-empty field with a typed value removes it from the warning list immediately.

### Ad-hoc documents are row-first; signing date shown (2026-05-29)
Ad-hoc / standalone documents (the *Adhoc smlouvy* section on the Employee detail page — Multisport, Hmotná odpovědnost, custom standalone templates) now follow the **same row-first workflow as employment-history entries**: clicking **+ Adhoc dokument** and confirming the signing-date prompt no longer generates a PDF. Instead it creates the contract **record with no PDF** and the row displays the **signing date** entered in the prompt (not the generation date). The PDF is generated later, on demand, from the row.

- **Persisted fields** — `POST /api/employees/:id/contracts` (and `PATCH .../:contractId`) now whitelist `signingDate`, plus Multisport's `requestedAt` / `validFrom`. These are stored on the contract doc so the row can show the signing date and a later generation can fill the template. All additive — existing contracts without `signingDate` fall back to displaying `generatedAt`.
- **Row creation** — `EmployeeDetailPage.addAdhocRow()` POSTs `{ type, status: "unsigned", displayName, signingDate, requestedAt?, validFrom? }` with **no** `pdfBase64`, so the record materialises PDF-less. The prompt button changed from "Pokračovat" to "Přidat".
- **Generate later** — the parent (`OtherDocumentsTab` since v4.6.0; formerly `AdhocContractsSection`) passes an `onGenerate(contract)` that opens `GenerateContractModal` with `existingContractId` + the stored `signingDate`/`requestedAt`/`validFrom`. `ContractActionButtons` now shows **Generovat smlouvu** whenever an editable row has no unsigned and no signed PDF (previously only when `contract` was null), so an ad-hoc row that exists but hasn't been generated gets the button.
- **Attach to existing record** — generating against an `existingContractId` does NOT create a new record. `GenerateContractModal.handleGenerate` calls the new `useContractGeneration.attachUnsignedPdf()` →
  - `POST /api/employees/:employeeId/contracts/:contractId/unsigned-pdf` — accepts `{ pdfBase64 }`, writes `contracts/{employeeId}/{contractId}.pdf` via the Admin SDK, and updates the existing doc with `unsignedStoragePath` + a fresh `generatedAt`/`generatedBy`. The row's `signingDate` / `displayName` are preserved. Mirrors the existing `signed-pdf` endpoint; admin/director/hr only, audit-logged via `logUpdate`.
- **Display** — the ad-hoc row renders `formatDateCZ(c.signingDate)` when present (title "Datum podpisu"), falling back to `formatTimestampCZ(c.generatedAt)` for legacy rows. Employment-row contract generation is unchanged (still creates the record at generation time). (**v4.6.0:** `AdhocContractsSection` itself is deleted; this display logic now lives in `OtherDocumentsTab` — see the section below.)

⚠️ **Row-first creation superseded for NEW documents (v4.8.2)** — see the next section. The **attach-to-an-existing-row** path described above (`existingContractId`, `attachUnsignedPdf`, `generateModal.kind === "adhoc"`) is unchanged and stays live specifically to generate the PDF for any row that was already created PDF-less under the old flow.

### One-step ad-hoc document generation (v4.8.2)
Picking a template from **+ Generovat dokument** on the Další dokumenty toolbar (`OtherDocumentsTab`, `data-tour="emp-doc-generate"`) no longer creates an empty, PDF-less contract row first. It now opens `GenerateContractModal` directly with `generateModal.kind === "adhoc-new"`, which collects the signing date — and, for Multisport, the request/validity dates — **inside the modal**, alongside the usual variable tables, then creates the contract record together with the generated PDF in a **single `POST`**. The two-step "enter signing date → empty row → Generovat from the row" flow (the previous section, and the old standalone signing-date prompt below) is gone for brand-new documents.

- **New `GenerateContractModal` props** — `collectSigningDate?: boolean` and `initialSigningDate?: string` (seeded from `clock.today()`). `collectDates = collectSigningDate && !existingContractId` — the in-modal date fields are suppressed when the modal is instead attaching a PDF to an existing (legacy) row, since that record already carries its own `signingDate`.
- **In-modal fields** — a "Datum podpisu" block (+ "Datum žádosti" / "Platnost od" for `multisport`) renders above the "Hodnoty proměnných" table. The entered dates feed an `effectiveEmployeeData` override so `{{signingDate}}` / `{{requestedAt}}` / `{{validFrom}}` resolve live in the variable-values table underneath, exactly as `resolveVariables` always formatted them.
- **`signingReady`** gates generation the same way `missingCustom` does: a signing date (and, for Multisport, both extra dates) must be filled before `handleGenerate` proceeds. Pressing "Generovat PDF" too early sets `triedGenerate` and shows the warning only then — the same submit-time-only pattern as the custom-variable validation (see "Validation is on submit, not on open" below).
- **Single `POST`** — `useContractGeneration.uploadContract(employeeId, blob, { type, …, signingDate, requestedAt, validFrom })`. The backend already accepted and persisted these three fields on `POST /api/employees/:id/contracts` (built for the old row-first flow's initial PDF-less row); this feature is simply the first caller that supplies them together with the PDF at creation time instead of via a later `PATCH`/attach call.
- **Removed** — `EmployeeDetailPage.addAdhocRow()` and its accompanying `signingDatePrompt` state (the small `ConfirmModal.module.css`-styled date dialog) are deleted. The dropdown item's `onClick` now just sets `generateModal` directly.
- **Unaffected** — employment-row contract generation (Historie tab, `generateModal.kind === "row"`) and the attach-to-existing-row path for legacy PDF-less rows (`generateModal.kind === "adhoc"`, `existingContractId` set) both work exactly as before.
- **v4.11.0:** the in-modal "Datum podpisu" field also shows a non-blocking weekend/public-holiday advisory (`isWeekendOrHoliday` from `frontend/src/lib/workingDays.ts`), the same check used on the employment-history signing-date fields — see [Employees — Signing-date advisory warning](employees.md#signing-date-advisory-warning--weekend--public-holiday-v4110) for the shared helper and full rationale.

### Custom per-template variables (2026-07-13)
Ten free slots — `{{var1}}` … `{{var10}}` — that a template can use for values the employee record simply doesn't hold (a penalty amount, a training date, a one-off clause). Unlike every other variable in `VARIABLE_GROUPS`, a slot's meaning is **not global**: each template configures the slots it uses itself, so `{{var1}}` can be "Výše pokuty" in one template and "Datum školení" in another. Values are typed in at generation time and are **never persisted** — a fresh document, a blank slate, every time (contrast with the standalone signing-date prompt, which *does* persist onto the contract doc).

**Why not `#var1`.** The substitution regex is `\{\{(\w+)\}\}` and a leading `#` is reserved to mark a conditional block (`{{#if x}}…{{/if}}`, see "Conditional blocks in templates" above). A slot named `#var1` would match *none* of the regexes used by `fillTemplate`, `getMissingVariables`, or the backend's `extractVariables` — it would be silently ignored end-to-end and print raw `{{#var1}}` text into the finished PDF. This is the single most important gotcha for anyone touching this code: the plain-word form (`var1`, not `#var1`) is load-bearing, not a style choice.

**Config lives on the template, not globally.** `frontend/src/lib/contractVariables.ts` defines the fixed key set and shape:
- `CUSTOM_VAR_KEYS` — `["var1", …, "var10"]`, `isCustomVarKey(key)` checks membership.
- `CustomVarType` — `"text" | "date" | "number" | "bool"`.
- `CustomVarDef = { label: string; type: CustomVarType; default?: CustomVarDefault }` (the optional `default` was added in v4.8.2 — see "Default values for custom variables" below); `CustomVarDefs = Record<string, CustomVarDef>` is stored as `contractTemplates/{id}.variableDefs`.
- `usedCustomVars(html)` — which slots a template's HTML actually references, matched both as a plain `{{varN}}` placeholder and as a `{{#if varN}}` / `{{#unless varN}}` condition (so a custom slot can drive an existing conditional block). Returned in slot order (`var1`, `var2`, …), not order of appearance, so the config UI and the generate form list them predictably.
- `formatCustomValue(type, raw)` — turns the raw form input into the string that lands in the PDF:
  - `date` — `formatDateCZ(raw)`. `raw` is an `<input type="date">` ISO string; `formatDateCZ` splits the string rather than parsing a `Date`, so there's no UTC-offset day-shift (see the date-arithmetic gotcha in `CLAUDE.md`).
  - `number` — `Intl.NumberFormat("cs-CZ")`, i.e. Czech thousands grouping ("5 000"), consistent with every other numeric value in a contract.
  - `bool` — resolves to `"ano"` / `""`, **not** `"ano"`/`"ne"` — deliberately matching the built-in `kind: "if"` variables, where an empty string is what makes `{{#if var1}}` strip its block. A plain `{{var1}}` of an unchecked box therefore renders nothing.
  - `text` — passed through as typed.
- `missingCustomVars(html, defs, rawValues)` — slots still needing a value before generation may proceed. `bool` is **never** "missing" (unchecked is a legitimate answer, not an omission); `text`/`date`/`number` are required **unless the slot sets `optional: true`**.

**Optional slots — "Nepovinná" (v4.10.3).** `CustomVarDef.optional?: boolean` marks a slot that may be left blank at generation, for templates offering several fields of which only some apply to a given case. An unfilled optional slot resolves to an empty string (`formatCustomValue("")`), so a plain `{{var3}}` renders nothing. The flag is **absent = required**, which is why existing templates keep their current behaviour — it is deliberately not stored as `optional: false`, matching how `default`/`condition` are omitted rather than written as `undefined`.
- It is meaningless for `bool`/`condition` (neither ever blocks generation), so the editor renders a `–` for those instead of a no-op checkbox. `setDef` nonetheless *preserves* the flag across a type change — unlike `default`/`condition`, which are dropped because they can become invalid for the new type, a plain boolean can only become inapplicable.
- Editor: a "Nepovinná" checkbox column in the "Vlastní proměnné" modal (`ContractTemplatesPage.tsx`). Generation: `GenerateContractModal.tsx` appends a muted "(nepovinné)" after the slot's label, since otherwise the only way to discover a slot is optional is to try generating.
- Backend: `isValidVariableDefs` accepts `optional` only as a real boolean (`PUT /contractTemplates/:id` — the only route that takes `variableDefs`; `POST` creates `id`/`name` only). A truthy string would otherwise silently make a slot optional.

**Config UI — `ContractTemplatesPage.tsx`.** The variable side panel gets a new "Vlastní proměnné" group listing all ten slots (showing the configured label + key once set, otherwise the bare key) plus a "⚙ Nastavit…" button that opens a small modal. The modal reads `usedCustomVars(editor.getHTML())` live off the editor content — a slot appears the moment `{{varN}}` is inserted and disappears when deleted, no separate bookkeeping — and lets the author set a label (60-char max) and a type per used slot. Slots configured earlier whose placeholder was since deleted from the text stay in `variableDefs` (so an accidental deletion is recoverable) but are called out as "Nastavené, ale v textu nepoužité". `variableDefs` loads with the template (`GET /:id`) and saves with it (`PUT /:id` body) alongside `htmlContent`/`margins`.

**Layout (v4.8.2, widened v4.10.3).** The modal was widened and each slot's name/type/default value now sit in a **single table row** — previously the default-value control lived in a second, indented row underneath the name/type/(then-present Odstavec) row. Every field for a slot is edited in one place now.

One slot = one row is a **hard layout invariant**, and three things enforce it together (changing any one alone will let rows wrap again):
- the modal is `min(1100px, 96vw)` (raised from `880px` in v4.10.3, when the "Nepovinná" column made a `condition` row overflow);
- `renderConditionBuilder`'s flex row is `flexWrap: "nowrap"` — a `condition` slot carries four controls (left operand, operator, right kind, right value) inside the last column, and it was the wrapping culprit;
- the table sits in an `overflowX: "auto"` wrapper with `minWidth: 860`, so a viewport too narrow to hold a row scrolls sideways instead of wrapping it.

**Unconfigured-slot warning (authoring time).** A slot used in the text but never given a label/type still *works* — it falls back to type `text`, and the generate dialog shows the raw `{{var2}}` plus "(v šabloně bez nastavení)" as its field label, which reads like a bug to whoever generates the document. To catch it while the author is still on the page, **saving** the template computes `usedCustomVars(htmlContent).filter(k => !variableDefs[k]?.label?.trim())` and, when non-empty, sets a persistent `varWarning` rendered in the editor header: *"Bez nastavení: var2, var3. Nastavte název a typ…"*. The warning is a **button** — clicking it opens the config modal directly. It is re-evaluated (and cleared) when the config modal is closed with the primary button, so naming the slots makes it disappear without another save round-trip. It is a warning only: saving is never blocked.

**Default values for custom variables (v4.8.2).** Each slot can carry an optional `default` — pre-filled (editable) in the generate dialog and shown in the in-editor / PDF preview. `CustomVarDef.default?: CustomVarDefault` is either:
- `{ kind: "literal", value }` — a fixed value, in the slot's own raw form (typed text/number, ISO date, or `"true"`/`""` for a checkbox), or
- `{ kind: "fixedVar", key }` — a reference to one of the built-in permanent variables (e.g. `firstName`, `salary`), resolved from the employee/company data at generation time.

Configured per slot via a source `<select>` next to its type (**Žádná** / **Pevná hodnota** / **Z proměnné**); a "Pevná hodnota" input renders type-appropriate (checkbox/date/number/text), and a "Z proměnné" `<select>` is filtered by `fixedVarOptions(type)` — a `bool` slot only offers the permanent `kind: "if"` booleans, every other type offers the rest. Changing a slot's type drops an incompatible default (e.g. switching off `bool` clears a `fixedVar` default that pointed at a conditional-only variable).

- `customDefaultRaw(def, fixedValues)` — the raw value to seed the generate-dialog input from: a `literal` returns its stored raw form as-is; a `fixedVar` on a `bool` slot maps the resolved value back to `"true"`/`""` so the checkbox reflects it; a `fixedVar` on any other slot returns the resolved built-in value untouched.
- `isFixedVarPassthrough(def)` — true only for a **non-bool** slot whose default is a `fixedVar`: the resolved built-in value (e.g. `"1. 1. 2024"`, `"42 000 Kč"`) is already formatted, so re-running `formatCustomValue` over it at fill time would corrupt it — it passes through unformatted instead. `GenerateContractModal` also renders that slot's input as plain `type="text"` rather than a `date`/`number` widget, since neither can hold an already-formatted string. Literal defaults and `bool` defaults are unaffected — they still go through `formatCustomValue` normally.
- `GenerateContractModal` pre-fills `customRaw` from `customDefaultRaw(variableDefs[key], autoVars)` once the template + company data have loaded (a `useEffect` guarded by a `prefilledRef` so it runs once and never overwrites a value the user already typed).
- **Preview** — `buildPreviewVars()` (`frontend/src/lib/templatePreview.ts`) now prefers a custom slot's configured default over generic mock text: a `literal` default is formatted and shown as typed, a `fixedVar` default resolves against the same `MOCK_TEXT` sample values the rest of the preview already uses. Falls back to `MOCK_CUSTOM_BY_TYPE` sample text only when the slot has no default — a blank slot would otherwise collapse the line and misrepresent the layout being checked.
- **Backend validation** — `PUT /api/contractTemplates/:id`'s `isValidVariableDefs` (`functions/src/routes/contractTemplates.ts`) validates the optional `default` via `isValidCustomDefault`: a `literal` must carry a string `value` ≤ 200 chars; a `fixedVar` must carry a non-empty string `key` ≤ 60 chars. The fixed-variable catalogue itself (which keys are valid, and which are `kind: "if"`) lives only on the frontend, so the backend only length-checks the `key` — it does not verify it names a real built-in variable.

**Two-branch Ano/Ne paragraphs.** `{{#unless varN}}…{{/unless}}` is (and remains) supported by the substitution engine — see "Conditional blocks in templates" above. `insertVariable(key, kind)` in `ContractTemplatesPage.tsx` still takes an optional `kind?: "if" | "unless"` and wraps the caret between the opening and closing tags when set.

⚠️ **Dedicated UI removed (v4.8.2).** The config modal used to give a `bool` slot an **"Odstavec"** column with two one-click buttons ("Když Ano" → `{{#if varN}}…{{/if}}`; "Když Ne" → `{{#unless varN}}…{{/unless}}`) that inserted the block and closed the modal. That column is gone — a bool-driven paragraph is now typed manually in the editor, the same way any other conditional block is (see "Conditional variable picker inserts full {{#if}} block" below, which still one-click-inserts the `{{#if}}` form for the eight *permanent* `kind: "if"` variables). No caller passes `"unless"` to `insertVariable` any more, but the parameter itself was left in place rather than removed — it costs nothing kept and nothing currently calls it that way. Because `formatCustomValue("bool", …)` still resolves to `"ano"` / `""`, a manually-typed `{{#if varN}}…{{/if}}` / `{{#unless varN}}…{{/unless}}` pair still behaves as an either/or (e.g. "zaměstnanec souhlasí…" vs "zaměstnanec nesouhlasí…") — only the one-click authoring shortcut is gone.

**Generation UI — `GenerateContractModal.tsx`.** When the loaded template has custom slots (`usedCustomVars(template)`), a "Vlastní proměnné" input table renders above the existing "Hodnoty proměnných" overview: a checkbox for `bool`, a native `<input type="date">` for `date`, `type="number"` for `number`, plain text otherwise (also plain text for any slot under `isFixedVarPassthrough`, regardless of its configured type). Custom slots are **stricter than built-in variables**: an empty built-in variable only adds a "Chybějící údaje" warning and generation proceeds anyway, but an empty custom slot is a blank in the contract's own sentence (a penalty amount, a deadline), so `missingCustomVars(...)` actually blocks generation.

**Validation is on submit, not on open.** The "Generovat PDF" button stays **enabled** even while custom slots are empty. Pressing it calls `handleGenerate`, which — when `missingCustom.length > 0` — sets `triedGenerate` and returns *instead of* generating; the red "Vyplňte všechny vlastní proměnné:" box (listing the missing slots by label) is rendered only under `triedGenerate && missingCustom.length > 0`, so it first appears after that press. Rationale: a disabled button plus a red error box the moment the dialog opens flags a mistake the user has not made yet. The list re-evaluates on every keystroke afterwards, so it shrinks as fields are filled. (`disabled` on the button is now only about the template/company still loading, or the template being inactive.)

**Backend validation — `functions/src/routes/contractTemplates.ts`.** `PUT /:id` accepts an optional `variableDefs` field and rejects the write (400) via `isValidVariableDefs` when it isn't a plain object whose entries are all: a known key (`var1`..`var10` only), an object with a `type` in `{text, date, number, bool, condition}` (v4.10.0 adds `condition`), a `label` string ≤ 60 chars, a valid optional `default` (v4.8.2 — see "Default values for custom variables" above), and a valid optional `condition` (v4.10.0 — see "User-defined derived conditional variables" below). Omitting `variableDefs` from a `PUT` leaves the stored config untouched (`ref.set(payload, { merge: true })` only writes the field when present) — older templates saved before this feature are unaffected.

---

## User-defined derived conditional variables (v4.10.0)

A custom slot can now be type **`condition`** ("Podmínka" in the type dropdown): instead of a value typed in at generation time, its Ano/Ne resolves automatically from a **comparison of two operands**, then drives `{{#if varN}}` / `{{#unless varN}}` exactly like any other boolean slot. This is the general-purpose replacement for one-off permanent booleans that only ever encoded "is this built-in variable past/below/equal to some threshold" — see the `{{isHalfTime}}` and `{{salaryChangeVerb}}` removals above, both of which are now expressible as a `condition` slot instead of dedicated code in `resolveVariables()`.

**Shape (`frontend/src/lib/contractVariables.ts`).**
- `CustomVarType` gained `"condition"` alongside `"text" | "date" | "number" | "bool"`.
- `CustomVarDef.condition?: CustomVarCondition`, only meaningful when `type === "condition"`:
  ```ts
  type CustomVarCondition = {
    leftKey: string;              // a COMPARABLE_VARS key
    op: CompareOp;
    right: { kind: "var"; key: string } | { kind: "literal"; value: string };
  };
  ```
- `CompareOp` = `"lt" | "lte" | "gt" | "gte" | "eq" | "neq" | "empty" | "notEmpty"`. The last two (`UNARY_OPS`) test the **left operand alone** — no `right` is needed or read for them. `empty`/`notEmpty` treat `null`/`undefined`/`""` as empty; a real `0` is **not** empty (relevant for a numeric operand like `hoursPerWeek`).
- `COMPARABLE_VARS` is the fixed catalogue of built-in variables a comparison may reference — every date and number the app already resolves onto a contract: `startDate`, `endDate`, `signingDate`, `originalSigningDate`, `birthDate`, `dodatekEffectiveDate`, `requestedAt`, `validFrom`, `today` (dates), and `salary`, `agreedReward`, `hoursPerWeek`, plus the dodatek-derived `newEndDate`, `newSalary`, `newHoursPerWeek`, `oldSalary` (numbers/dates). Each entry carries its raw `type` (`"date" | "number"`), which drives both operand dropdowns in the config UI and which comparison an `input type="date"|"number"` widget uses for a literal `right`.

**Evaluation is on raw typed values, never the formatted display strings.** `resolveComparableRaw(employee)` returns the same operands as `resolveVariables()` would format, but as ISO `YYYY-MM-DD` strings / plain numbers (`toIsoDate`/`toNumber` helpers, `null` when missing/unparseable) — comparing `"1. 8. 2026" < "14. 7. 2026"` as strings would be meaningless, and comparing `"35 000"` as a number requires stripping the thousands separator first. `evalCondition(cond, raw)`:
- Unary `empty`/`notEmpty` reads only `raw[cond.leftKey]`.
- Binary ops coerce both sides through the left operand's declared type (`toNumber`/`toIsoDate`), compare (dates chronologically as ISO strings, numbers numerically), and switch on `op`.
- **Missing/unparseable operand → `false`** (block hidden), on either side — a condition never invents a comparison result on a real contract; an incomplete config or unfilled upstream field degrades safely to "off" rather than throwing or defaulting to "on".
- `resolveConditionVars(html, defs, raw)` computes `"ano"`/`""` for every `condition`-type slot the template's HTML actually uses (via `usedCustomVars`) and is merged into the vars map alongside the rest before `fillTemplate` — same contract as `resolveVariables()`'s output.

**Config UI — `ContractTemplatesPage.tsx`'s "Vlastní proměnné" dialog.** Picking "Podmínka" from a slot's type dropdown seeds a starter condition (`leftKey: COMPARABLE_VARS[0].key, op: "lt", right: { kind: "literal", value: "" }`) and swaps that slot's default-value cell for a **comparison builder**: a left-operand `<select>` (all of `COMPARABLE_VARS`), an operator `<select>` (`COMPARE_OP_LABELS` — `<`, `≤`, `>`, `≥`, `=`, `≠`, "je prázdné", "není prázdné"), and — hidden entirely for the two unary ops — a right-side kind toggle ("Hodnota" / "Proměnná") plus either a type-matched literal input (`<input type="date">`/`type="number"` depending on the left operand's type) or a second `<select>` restricted to `COMPARABLE_VARS` of the **same type** as the left operand (a date can only compare against a date, a number against a number). Changing the left operand resets an incompatible variable-typed right operand back to an empty literal rather than leaving a stale, type-mismatched selection. Switching a slot's type *away from* `condition` drops its `condition` (mirrors how switching away from a default-bearing type drops the `default`).

**Generation UI — `GenerateContractModal.tsx`.** A `condition` slot's row in the "Vlastní proměnné" table is **read-only** — "Ano"/"Ne" plus a "(vypočteno z podmínky)" hint, computed live via `evalCondition(def.condition, resolveComparableRaw(effectiveEmployeeData))` — there is nothing to type in, so it never appears in `missingCustomVars` (a computed value can't be "missing" any more than a checkbox can).

**Backend validation — `functions/src/routes/contractTemplates.ts`.** `isValidCondition(v)` gates the optional `condition` field inside `isValidVariableDefs`: `leftKey` a non-empty string ≤ 60 chars; `op` one of the eight known `CompareOp` values; for the two unary ops, nothing further is required; otherwise `right` must be `{ kind: "var", key }` (string, non-empty, ≤ 60 chars) or `{ kind: "literal", value }` (string, ≤ 200 chars). As with `default`, the `COMPARABLE_VARS` catalogue itself lives only on the frontend — the backend only length-checks keys, it does not verify `leftKey`/`right.key` name a real comparable variable.

---

## Nested conditional blocks (v4.8.0)

`processConditionals()` in `frontend/src/lib/contractVariables.ts` used to resolve `{{#if X}}…{{/if}}` and `{{#unless X}}…{{/unless}}` with a pair of non-greedy regexes applied in two passes. Consequence: blocks **could not nest** — an inner `{{/if}}` closed the *outer* block, and the leftover tags (the real inner closer, plus whatever followed it) were emitted as literal text into the generated contract. This failed silently in the app (no error, no warning) and visibly on the printed page.

That made an AND condition impossible to express through the conditional engine. The case that forced the fix: the "Nástup HPP" template prints a *Trvalý pobyt* line under `{{#if hasPermanentResidence}}` and a *PAS / VISA* line under `{{#unless isCzech}}` — a **foreigner who also holds permanent residence matched both conditions** and got both lines, which is wrong; the correct rule is "foreigner AND NOT permanent residence": `{{#unless isCzech}}{{#unless hasPermanentResidence}}…{{/unless}}{{/unless}}`.

**How it works now.** `parseBlocks(html)` builds a tree of text nodes and block nodes (each block carrying `kind`, `key`, and its own children); `renderBlocks(nodes, vars)` walks the tree and recurses into a kept block so nested conditions resolve correctly. Blocks nest to any depth. A dropped outer block discards its whole subtree without evaluating the children inside it — `renderBlocks` never even inspects a nested `{{#if}}` whose enclosing block was already false.

**Malformed input degrades rather than eating content** — the same contract this replaces:
- A stray or mismatched closer (e.g. an `{{/if}}` with no open `{{#if}}`, or one that doesn't match the innermost open block's kind) is emitted as literal text — exactly what the old regex-based engine did with it.
- An unclosed opener at end-of-document has its literal `{{#if X}}` / `{{#unless X}}` tag flushed back out, followed by its (still-parsed) children.

The `STRIP_MARKER` sentinel and the empty-`<p>`-cleanup regexes that run after conditional resolution are unchanged — only how the tree is built and walked changed, not how a dropped block's surrounding whitespace is cleaned up.

**Verified, not assumed.** The old two-pass regex engine and the new block-parser engine were compared render-for-render across all 13 PROD templates, for every combination of the boolean conditionals each template references — 832 total comparisons, 0 differences. (No prod template nests today, so this was a pure regression check: any difference would have meant the rewrite broke a live contract.)

**Deploy-order trap.** The engine change must reach production *before* any template is saved with a nested block in it — if an older frontend bundle is still live when a nested `{{#if}}…{{#if}}…{{/if}}…{{/if}}` is saved, the running (old) code prints the raw tags into generated contracts. This is the same class of trap already documented for the permanent-variable catalogue in ["Changing the permanent variable catalogue — deploy-order trap"](#changing-the-permanent-variable-catalogue--deploy-order-trap) below — read that section for the general phasing rule; it applies here too.

---

## Template editor — in-editor preview + byte-accurate PDF preview (v4.8.0)

`frontend/src/lib/templatePreview.ts` (new) plus a 👁 **Náhled** toggle in `ContractTemplatesPage.tsx`'s toolbar. Motivation: the raw `{{…}}` / `{{#if …}}` markers occupy space on the line, so tab stops, wraps, and page breaks could never be judged accurately while looking at the unfilled template — you were formatting against text that would never actually appear.

**In-editor preview.** Clicking 👁 swaps the `EditorContent` inside `.a4Page` for a read-only `dangerouslySetInnerHTML` render of `fillTemplate(html, buildPreviewVars(html, variableDefs, previewBools, previewRaw))` — the *same* `.a4Page` box, the *same* margins (`margins.top/bottom/left/right` inline styles), the *same* ProseMirror-authored inline typography, so the preview lays out exactly like the editor minus the markers. The dashed ↧ page-break divider (`.a4Page [data-page-break] { border-top: 2px dashed #999; margin: 1cm 0 }`, editor-only styling that never reaches the Puppeteer renderer) is suppressed in preview via `.previewContent [data-page-break] { border-top: none; margin: 0 }` — it's an editor affordance that prints nothing, and leaving its dashed line and 2 cm margin in would misrepresent where content actually breaks across pages.

- `usedConditionals(html, defs)` (in `templatePreview.ts`) returns the conditionals *this* template actually references — the permanent boolean vars (`CONDITIONAL_KEYS`, derived from `VARIABLE_GROUPS` entries with `kind: "if"`) plus any custom slot configured as `type: "bool"` — in that order. The preview bar renders one checkbox per key (label from `CONDITIONAL_LABELS` or the slot's configured `variableDefs[key].label`), defaulting **on** (`defaultBools`) so the preview opens showing the fuller document. Toggling a box re-renders both branches live.
- `buildPreviewVars(html, defs, bools, rawOverrides)` builds the full variable map the preview fills with: `MOCK_TEXT` supplies realistic, roughly realistically-**long** Czech sample values for every non-boolean permanent variable (e.g. `firstName: "Jana"`, `address: "Vinohradská 1511/230, 100 00 Praha 10"`, `salary: "35.000"`) — a blank `{{fullName}}`-style variable would collapse to nothing, making the line shorter than it will ever really be and any tab-alignment check against it a lie. Conditionals resolve to `"ano"`/`""` from the checkbox state; custom `text`/`date`/`number` slots get a per-type sample from `MOCK_CUSTOM_BY_TYPE` (a slot the template uses but never configured falls back to `text` sample data); a `condition` slot resolves via `evalCondition(def.condition, raw)` against `{ ...PREVIEW_RAW_DEFAULTS, ...rawOverrides }` — see "Editable condition operands (v4.10.0)" below. ⚠️ **Fixed in v4.10.0:** the `salary` sample used to read `"35 000 Kč"`, which double-counted the currency — `formatSalaryCZ` only ever emits the bare number (dot thousands-separator: `"35.000"`), the "Kč"/",- Kč" suffix is template text, so the old sample silently misrepresented how long the rendered line actually is.
- The 👁 button and preview bar are visible to anyone who can open the template editor (gated the same as the rest of the page, `contractTemplates.manage` for edit mode); the preview itself needs no extra permission.

### Editable condition operands (v4.10.0)
A `condition`-type custom slot (see "User-defined derived conditional variables" above) has nothing for `MOCK_TEXT` to fall back on — its Ano/Ne is computed, not sampled — so the preview needs a way to actually exercise both branches. `usedConditionOperands(html, defs)` (`templatePreview.ts`) walks every `condition` slot the template uses and collects the `COMPARABLE_VARS` keys its comparison touches (the `leftKey`, plus `right.key` when `right.kind === "var"`). The preview bar renders one labelled `<input type="date">`/`type="number"` per operand (`ContractTemplatesPage.tsx`, next to the conditional checkboxes), seeded from the exported `PREVIEW_RAW_DEFAULTS` (the same ISO-date/number stand-ins `MOCK_TEXT` mirrors, e.g. `startDate: "2026-08-01"`, `salary: 35000`) the first time `openPreview()` runs, and kept in `previewRaw` component state thereafter (edits persist across toggling the preview open/closed within the session, same as `previewBools`). Editing an operand — e.g. pushing `signingDate` past `startDate` — re-evaluates `evalCondition` live and flips whichever `{{#if}}`/`{{#unless}}` block depends on it, so an author can check both branches of a derived condition without leaving the editor. Only the operands a template's conditions actually reference are shown — an unrelated template's `COMPARABLE_VARS` don't clutter the bar.

**Náhled PDF — byte-accurate check.** A second button in the preview bar (`handlePdfPreview`) fills the *current* editor content the same way, then `POST`s `{ html: filled, margins }` to `POST /api/contracts/render-pdf` — the exact same Puppeteer endpoint (`functions/src/services/pdfRenderer.ts`, see "Server-side Puppeteer PDF rendering" above) that renders real, signed contracts — and opens the returned PDF blob in a new tab. The in-editor preview above uses the browser's own layout engine and can only *approximate* where a tab stop or page break lands; this is the byte-accurate version. Gated on `canPreviewPdf = can("contracts.generate")` — the endpoint's own permission — so a template editor without `contracts.generate` still gets the in-editor 👁 preview, just not this button. **No new permission key was introduced**; this reuses the existing `contracts.generate` check.

---

## Signed-contract split + client-side PDF compression (v4.6.0)

Staff sign a printed contract by hand and send back **one scan** whose leading page(s) are the contract and whose trailing page(s) are the "Prohlášení poplatníka daně". Those two documents belong in two different places (the contract record vs. the employee's Další dokumenty), and the scan itself is often large enough to hit the upload body-size cap. This feature does both jobs — split and shrink — entirely **client-side**, and adds one backend endpoint that files both halves atomically.

### Two-option upload menu

`ContractActionButtons`'s **"Nahrát podepsanou smlouvu"** button is now a menu with two entries (only shown when the caller also holds `documents.upload` — without it the button falls back to the original single-click "whole file as the contract" behaviour, since there's nowhere to file a Prohlášení):

- **"Smlouva"** — unchanged behaviour: the whole file becomes the signed contract (via `POST .../signed-pdf`, after compression).
- **"Smlouva + prohlášení"** — reads the file, rejects a single-page PDF ("není co rozdělit"), then opens a dialog showing the **real page count** and asking how many leading pages are the contract (default 1, max `pageCount - 1`). The 3-page layout used in earlier internal drafts of this feature is **not assumed** — a 2-page contract in a 4-page scan is a real case, and silently filing page 2 under the Prohlášení would be a quiet, hard-to-notice mistake. The dialog also collects a name for the declaration document (defaults to `"Prohlášení poplatníka <year>"`).

**The menu is portalled to `<body>` and positioned `fixed` from the button's bounding rect** (v4.7.2), not absolutely inside the component. `ContractActionButtons` renders inside the employment-history session card, and that card sets `overflow: hidden` to clip its children to its rounded corners — so an absolutely-positioned menu was cut off whenever the card was shorter than the menu, i.e. on one- and two-row sessions. Dropping the card's `overflow: hidden` would trade a dropdown bug for a border-radius bug on every card; portalling makes the menu immune to any ancestor's overflow/transform/stacking context instead. It costs three things, all handled in the component: the outside-click check must test the button *and* the portalled menu (they are no longer in the same subtree), the menu closes on scroll (capture phase) and resize because a fixed element does not travel with the page, and its `z-index` (900) sits below the modal overlay (1000). **Any future dropdown rendered inside a row should do the same.**

### Client-side compression + split — `frontend/src/lib/pdfCompress.ts`

`compressScannedPdf(file)` shrinks a scanned PDF by re-encoding each page as a JPEG, and is run before *either* upload path (whole-file or split):

- **Why client-side at all:** the scans staff upload are one big raster per page, and the file size is almost entirely that raster. `pdf-lib` (which the backend already uses for merges/splits) copies embedded image streams through **untouched** — it cannot re-encode them, so it can't shrink a scan. Re-encoding needs a rasteriser, and the browser already is one: `pdf.js` renders a page to `<canvas>`, which is then read back out as a JPEG. Doing this in the browser also means the **already-small** file is what crosses the wire, staying well under the backend's 10 MB `express.json` body cap instead of dying on an opaque body-parser 413.
- **Why it's conditional:** rasterising destroys a real text layer (selectable text, or the AcroForm fields of a generated Prohlášení). `compressScannedPdf` counts extractable characters across every page via `pdf.js`'s `getTextContent()`; above `TEXT_LAYER_THRESHOLD = 200` chars the document is treated as digitally generated and returned **untouched**. The re-encoded result is also discarded (original returned) whenever it comes out **no smaller**, or if anything throws — shrinking is an optimisation, never a reason to fail an upload or lose the document.
- **Render parameters:** `TARGET_DPI = 150` (the usual archival floor for scanned paper — still crisp and printable, roughly a quarter of the pixels of a 300 DPI scan) and `JPEG_QUALITY = 0.72` (keeps handwriting and stamps legible while cutting most of the bulk). Colour is **preserved**, never converted to grayscale, because signatures are usually blue ink and that's worth keeping.
- **Two landmines documented in the file itself:**
  - `pdf.js` **detaches** the `ArrayBuffer` it's handed (takes ownership of the ArrayBuffer's memory) — the code hands it a `.slice()` **copy**, so the original bytes survive for the "return untouched" fallback paths. Skipping the copy would silently upload an empty file on any fallback.
  - JPEG has no alpha channel. A scanned page is transparent where nothing was drawn; without painting the canvas white first, those areas render **black** in the JPEG output.
- **`getPageCount(bytes)`** — `pdf-lib`-based, used to drive the split dialog's page-count display and bounds.
- **`splitPdf(bytes, splitAfterPage)`** — cuts the (already-compressed) bytes into `{ first, second }` via `pdf-lib`'s `copyPages`; both halves are then base64-encoded (`bytesToBase64`, chunked to avoid the `String.fromCharCode(...)` argument-count blowup on multi-MB files) and POSTed together.
- Both `pdfjs-dist` and `pdf-lib` are imported **dynamically** inside the functions that need them (not at module top level) — `pdfjs-dist` alone is ~1 MB, and dynamic import keeps it out of the main bundle for the large share of users who never upload a signed contract; Vite gives it its own chunk.

### Explicit over-size message

`MAX_UPLOAD_BYTES = 7 * 1024 * 1024` (7 MB raw) in `ContractActionButtons.tsx` mirrors the backend's 10 MB JSON body cap adjusted for base64's ~4/3 inflation. Compression always runs first, so this only trips on originals that don't shrink enough; the message names the actual vs. max size and suggests re-scanning at lower quality, replacing what used to be an opaque body-parser 413. A real-world test scan shrank to roughly 60% of its original size while staying readable.

### `frontend/src/lib/czechPlural.ts`

Small helper for Czech's three-form noun agreement after a numeral (`1` → nominative singular, `2`–`4` → nominative plural, `0`/`5+` → genitive plural — note the rule keys off the whole number, so 11–14 still take the genitive plural, e.g. "11 stran"). Used by the split dialog's "Dokument má N stran(u)" copy (`pagesAccusative(n)`) and page-range labels (`pageWord(n)`).

### Backend — `POST /api/employees/:employeeId/contracts/:contractId/signed-pdf-with-declaration`

Body: `{ contractPdfBase64, declarationPdfBase64, declarationName }`.

- **Permission:** `contracts.sign` is the route-level gate; an explicit in-handler check additionally requires `documents.upload` (403 otherwise) since the endpoint also creates an `otherDocuments` record. **No new permission key** — both already exist.
- **Storage:** the contract half is written to `contracts/{employeeId}/{contractId}_signed.pdf` (same path `.../signed-pdf` uses), the declaration half to `other-documents/{employeeId}/{docId}.pdf` (same convention as [`POST /:id/other-documents`](employees.md#další-dokumenty-tab-2026-05-29)) — the `otherDocuments` doc id is reserved up front so the storage path can reference it.
- **Atomicity:** the contract-doc update (`status: "signed"`, `signedStoragePath`, `signedAt`, `signedUploadedBy`) and the new `otherDocuments` doc are committed in **one Firestore batch** — a partial failure here would otherwise leave a contract marked signed with its declaration silently missing, which is worse than the whole call failing outright. The two Storage `bucket.file().save()` calls run in parallel via `Promise.all` before the batch commits; an orphaned Storage blob from a failure at that stage is inert (nothing points at it yet), which is the safer failure mode.
- **Audit:** both writes are logged — `logUpdate` for the contract (`employees/contracts`) and `logCreate` for the declaration (`employees/otherDocuments`).
- Response: `{ ok: true, signedStoragePath, declarationDocId }`.

### Tour delta copy

The `emp-contract-sign` tour step (Historie tab) and the relocated `emp-doc-tax-declaration` / `emp-doc-generate` steps (see [Employees — Employee detail restructure](employees.md#employee-detail-restructure--ad-hoc-documents-move-to-další-dokumenty-v460)) carry `deltaTitle`/`deltaBody` overrides for the "Co je nového" mini-tour, explaining the new upload menu to returning users while first-timers see neutral copy. `appTour.version` 14 → 15.

---

## Boolean variable de-duplication + `{{isMale}}` (v4.7.0)

Every boolean permanent variable used to ship as a positive/negative pair (see "Row-sourced template variables + probation/end-date conditionals" and "Template variable pruning + hasPermanentResidence conditional" above) — two keys per concept that `{{#unless X}}` already made redundant, and that could silently disagree if a template author only updated one side. `VARIABLE_GROUPS` and `resolveVariables()` in `frontend/src/lib/contractVariables.ts` no longer emit the negative twins:

- `isForeigner` → use `{{#unless isCzech}}`
- `noPermanentResidence` → use `{{#unless hasPermanentResidence}}`
- `noProbation` → use `{{#unless hasProbation}}`
- `noEndDate` → use `{{#unless hasEndDate}}`

`fullName` was also removed — no template referenced it, and it's trivially `{{firstName}} {{lastName}}` when needed. The surviving canonical booleans are `isCzech`, `isMale`, `hasPermanentResidence`, `hasProbation`, `hasEndDate`, plus the `isDodatek*` family.

**New variable `{{isMale}}`** ("Je muž", under "Zaměstnanec") resolves from `employees.gender === "m"` (case-insensitive, trimmed) in `resolveVariables()`. `EmployeeData` gained a `gender?: string` field ("m" | "f" | empty), passed in from both `GenerateContractModal` call sites in `EmployeeDetailPage`. Before this, two prod templates had the employee's sex hand-rolled as a per-template **custom** bool (`{{var}}` slot) that had to be re-ticked on every document generated from them; it now resolves automatically from the employee record.

⚠️ **`{{isHalfTime}}` (added v4.8.2) was removed again in v4.10.0.** It briefly existed as a permanent `kind: "if"` variable resolving `true` only when the PPP row's `hoursPerWeek === 20`. It no longer exists in `VARIABLE_GROUPS` / `resolveVariables()` — the same "20 h/týdně" check is now expressed per-template as a **derived condition** custom slot (`hoursPerWeek` `=` `20`), which is strictly more flexible (any threshold, not just 20) and doesn't grow the permanent catalogue for a single template's phrasing. See ["User-defined derived conditional variables (v4.10.0)"](#user-defined-derived-conditional-variables-v4100) below. Any template still containing `{{#if isHalfTime}}` / `{{#unless isHalfTime}}` must be migrated to an equivalent `condition` slot **before** this removal reaches production — same deploy-order trap as any other permanent-variable removal (see "Changing the permanent variable catalogue — deploy-order trap" below).

**New variable `{{isHalfTime}}` (v4.8.2)** ("Je poloviční úvazek – 20 h/týdně", under "Pracovní podmínky", `kind: "if"`) resolves `true` (`"ano"`) only when the PPP row's `hoursPerWeek` is exactly `20` (`Number(employee.hoursPerWeek) === 20`); any other part-time amount, or no value at all, resolves to `""`. Lets the PPP template say "poloviční pracovní úvazek, tj. 20 hod./týdně" for the standard half-time case via `{{#if isHalfTime}}` and "zkrácený poloviční úvazek, tj. {{hoursPerWeek}} hod./týdně" for any other fraction via `{{#unless isHalfTime}}`, reusing the existing `{{hoursPerWeek}}` variable (see "Row-sourced template variables + probation/end-date conditionals" above) to fill in the actual number. Being a permanent `kind: "if"` variable, it's automatically included in the template-editor preview's checkbox row (`CONDITIONAL_KEYS`, derived from `VARIABLE_GROUPS`) — no preview-specific wiring needed.

### Changing the permanent variable catalogue — deploy-order trap

Contract template HTML lives in Firestore (`contractTemplates/{id}.htmlContent`) and the code that resolves variables (`resolveVariables()` / `processConditionals()`) lives in the deployed frontend bundle — **the two deploy independently**, and a mismatch between them does **not error**. An unresolved `{{#if X}}` / `{{#unless X}}` key is simply falsy (`vars[key]` is `undefined`), so `processConditionals()` silently takes the "false" branch — `{{#if}}` drops its paragraph, `{{#unless}}` keeps it — with no warning that the wrong paragraph shipped in the PDF. (This is the same reason the flat, non-nesting conditional engine — see "Conditional blocks in templates" — was safe to rely on here: no nested-block edge cases to reason about while rewriting.)

This bit the `isForeigner` → `{{#unless isCzech}}` migration directly: live templates had to have every `{{#if isForeigner}}…{{/if}}` block rewritten to `{{#unless isCzech}}…{{/unless}}` — note the **closing tag flips too**, not just the opening one — and that rewrite had to land *before* the code stopped emitting `isForeigner`, or the template would briefly resolve the old key to nothing and silently drop a paragraph that should have shown.

**Rule for next time:** any removal or rename of a permanent variable must be phased, never done in one shot:
1. Migrate live templates onto keys the **currently deployed** code already resolves.
2. Deploy the code change (add the new key / remove the old one).
3. Only then migrate anything that depends on a key the old code didn't have.

Skipping straight to step 2 (or reordering) risks a live contract quietly rendering the wrong branch — with no exception, no 500, nothing in the logs to flag it.

---

## Bulk standalone document generation — "Hromadné generování" (v4.12.0)

A **"Hromadné generování"** button next to "Exportovat CSV" on the Zaměstnanci list (`EmployeesPage.tsx`, `data-tour="emp-bulk-generate"`) opens `frontend/src/components/BulkGenerateModal.tsx`: generate the **same standalone document** (a built-in standalone type or a custom `kind:"standalone"` template) for many employees in one run. Flow: pick a template → filter the roster by stav/oddělení/pozice → tick/untick the resulting people → fill any shared custom-variable values once → **Generovat**. Each selected employee ends up with their own *Další dokumenty* entry, generated exactly as a single ad-hoc generation would (same `POST /employees/:id/contracts` call, same stored PDF); additionally, **one merged PDF opens in a new tab for printing** — it is never uploaded or stored anywhere.

### The architectural decision — client-orchestrated, no bulk endpoint

`handleGenerate` loops over the selected employees **client-side** and fires the *existing* single-document generation call once per person — there is no new "generate for N employeeIds" backend route. This is deliberate for three independent, load-bearing reasons, not just convenience:

1. **The 60-second Puppeteer budget.** Contract PDFs render server-side via a per-request headless-Chromium call (`functions/src/index.ts`, the `api` function's `runWith({ timeoutSeconds: 60 })` — see "Server-side Puppeteer PDF rendering" above). A single "generate 50 documents" call would blow that budget outright; N separate calls each get their own 60 s.
2. **Security — the per-id access guard only inspects one path segment.** `enforceEmpAccess` (see [Auth — Row-level scope](auth-and-permissions.md#row-level-scope)) reads the first segment of `req.path` under the `employees` router to decide whether the target employee is a management record hidden from a non-management-scoped caller. A hypothetical bulk endpoint taking `{ employeeIds: [...] }` in its body would never pass any single id through that check, so a non-management viewer could name a management employee's id directly inside the array and generate their document. Routing through `/employees/:id`, `/:id/contact`, `/:id/documents`, and `/:id/employment` — one id at a time — inherits the existing per-id scoping for free; the roster picker itself reads `GET /employees`, which is already filtered for the caller.
3. **The 10 MB JSON body cap is per-request.** `express.json({ limit: "10mb" })` is fine for one base64-encoded PDF; a bulk endpoint accumulating dozens of them in one request/response would blow it.

Two further consequences of doing this client-side, both intentional:
- **Renders run sequentially, never concurrently.** The `api` Cloud Function runs on a 1 GB instance with a module-level Chromium singleton (~500 MB resident — see `pdfRenderer.ts`). Firing N renders in parallel risks OOM-ing that instance for *every* user hitting it at the time, not just this batch, so `handleGenerate`'s `for` loop awaits each employee before starting the next.
- **The batch is non-atomic with no rollback.** N independent writes with no transaction across them; a failure partway through leaves every already-generated employee with a real, stored document. The run therefore never aborts on a single failure — each employee's `Outcome` (`{ employeeId, name, ok, error? }`) is recorded and the "Nepodařilo se vygenerovat pro: …" list at the end names exactly who needs a retry.

### Template picker — built-ins carry no `kind` field

The picker unions `STANDALONE_TYPES` (the two built-in standalone types, `hmotna_odpovednost` / `multisport`) with `GET /contractTemplates` entries where `kind === "standalone"`. Filtering on `kind` alone would **silently drop the two built-ins** — their template docs have no `kind` field at all (only custom templates do; see "Custom standalone contract templates" above) — so the union is explicit, not a single filter. Inactive templates (`active === false`) are excluded from both halves.

### Shared vs. per-employee custom-variable slots

When the chosen template has custom `{{varN}}` slots, the setup screen splits them into two groups (`sharedKeys` / `perEmployeeKeys` in `BulkGenerateModal.tsx`):

- **Shared** — a plain `text`/`date`/`number`/`bool` slot with no `fixedVar` default: typed in once and applied to every selected employee.
- **Per-employee, shown read-only** ("Vyplní se automaticky u každého zaměstnance") — a `condition` slot (its Ano/Ne is computed from *this* employee's comparable data, via the same `evalCondition(def.condition, resolveComparableRaw(data))` the single-generate flow uses) and any slot whose configured `default.kind === "fixedVar"` (it resolves to *this* employee's value, e.g. `{{firstName}}`). Neither is a value one operator could type once for a whole batch, so both are computed inside the per-employee loop and merely listed in the setup table so it's clear they're handled, not forgotten.

Employment tokens (`{{startDate}}`, `{{endDate}}`, `{{contractType}}`, `{{salary}}`, …) are resolved per employee via `resolveStandaloneEmployment()` — see the next section — the same helper the single ad-hoc-generation flow now uses.

### Merged print PDF — client-side, never stored

`frontend/src/lib/pdfMerge.ts` (new) concatenates the batch's generated PDF blobs into one document with `pdf-lib`'s `PDFDocument.create()` + `copyPages()`, purely in the browser — the merge never crosses the wire, so it costs nothing against the 10 MB body cap and needs no new endpoint. `pdf-lib` is dynamically imported, matching `lib/pdfCompress.ts`'s precedent, so it stays out of the main bundle for the majority of users who never run a batch. `merged.setTitle(title)` is called before `save()`: the result is opened via a `blob:` URL (`openPdfBlob()`, mirroring the generate-and-open idiom already used for the blank Dotazník/Prohlášení PDFs), and a blob-URL open **ignores `Content-Disposition`** — `setTitle` is the only thing that gives the browser tab (and its save-as suggestion) a real name instead of a random blob id. The merge is safe here specifically because every input PDF is Puppeteer-rendered and carries a real text layer — `pdf-lib` cannot re-encode image streams (the reason `pdfCompress.ts` rasterises scans via `pdf.js` instead), and a scanned upload must never be run through this path.

### Permission — `contracts.generate.bulk`

New key **`contracts.generate.bulk`** ("Hromadné generování", level 3, nested under `contracts.generate` in both `frontend/src/lib/permissions/catalog.ts` and `functions/src/auth/permissions.ts`). It is **display-only / inert server-side by necessity**, not by omission: a batch is N ordinary calls to the same single-document generation endpoint the "Generovat" button already uses, indistinguishable server-side from an operator clicking that button N times by hand — there is nothing extra for `requirePermission` to gate on the backend. Documented and reasoned about the same way as `system.version.view` (see [Auth — Hierarchical permission matrix](auth-and-permissions.md#hierarchical-permission-matrix-frontend-v220)): the key exists purely to control whether the button renders.

The button gates on **all three** of `contracts.generate.bulk` + `contracts.generate` + `nav.contractTemplates.view` — the last one is a separate key from `contracts.generate` (it gates *reading* a template's HTML via `GET /contractTemplates/:id`), and without it every row of the batch would fail on the template fetch. The `emp-bulk-generate` onboarding-tour step is gated on `contracts.generate.bulk` alone (tour steps support OR across a permission array, not AND; granting the bulk child pulls its `contracts.generate` parent in via the matrix's dependency hierarchy, and a caller who somehow holds the bulk key but lacks `nav.contractTemplates.view` just gets the step centered with no anchor).

---

## Standalone documents now resolve employment variables (v4.12.0)

New exported `resolveStandaloneEmployment(rows)` in `frontend/src/lib/employmentSessions.ts`, used by `EmployeeDetailPage`'s two standalone-generation branches (`generateModal.kind === "adhoc"` and `"adhoc-new"`) and by `BulkGenerateModal.loadEmployeeData()`.

**The gap it closes.** Standalone templates (Multisport, Hmotná odpovědnost, custom standalone templates) are tied to no employment row, so every employment token — `{{startDate}}`, `{{endDate}}`, `{{contractType}}`, `{{salary}}`, `{{hoursPerWeek}}`, … — used to render empty on these documents. `resolveStandaloneEmployment` picks the employee's currently **running** contract and folds its `effective` state + `nastup` fields into the same shape `resolveVariables()` expects (`contractType`, `startDate`, `endDate`, `salary`, `agreedReward`, `hoursPerWeek`, `workLocation`, `probationPeriod`, `agreedWorkScope`).

**The selection rule** (agreed 2026-07-17):
- **No running contract** → `null` — every employment token stays blank, same as before this feature.
- **Exactly one running** → that one.
- **Several running, and exactly one of their sessions carries a currently-RUNNING rodičovská** → that one (the on-leave contract).
- **Several running, otherwise** → `null` — ambiguous; a blank token beats a guessed one.

**This deliberately inverts the concurrent-contract tie-break** behind the employee's `current*` root fields (`computeEffectiveRootFields`, see [Employees — Concurrent contracts](employees.md#concurrent-contracts--simplified-model-v350-22)), which prefers the **latest active session** (the second job worked during leave) and *excludes* the on-leave contract from `current*`. For a standalone document the on-leave contract is the one that actually matters — it's the contract Multisport/Hmotná odpovědnost is really about — so `{{startDate}}` on one of these documents can legitimately disagree with the "current contract" the Zaměstnanci list shows for a concurrent-contract employee. This is intended, not a bug.

**Two traps recorded in the source, both worth knowing before touching this function:**
- **(a) "Running" is tested on `effective.endDate`, not `session.terminated`.** `session.terminated` is `true` for *any* Ukončení row on the session, including a future-dated one — so an employee whose notice is already filed for next month would wrongly count as "not running" today, even though they're still actively working. `effective.endDate` (which `computeEffectiveState` already folds an Ukončení's date into) is the correct signal: it's the *last active day*, so the test is `!effective.endDate || effective.endDate >= today`, matching the backend's own date-based rule.
- **(b) Rodičovská "running-ness" needs both a start AND an end check — not `hasOpenRodicovska`.** `hasOpenRodicovska` (used elsewhere to disable the "+ Rodičovská" button while one is already open) deliberately **omits** the start-date check, because its job is to also block stacking a *future-dated* leave on top of an existing one. Reusing it here would let a future leave — technically "open" but not yet begun — win the tie-break and pick the wrong contract. The local `rodicovskaRunning(r, today)` helper checks both: `r.startDate <= today && (!r.endDate || r.endDate >= today)`.

---

## Contract-split dropdown is employment-history only (v4.12.0)

`frontend/src/components/ContractActionButtons.tsx`'s **"Nahrát podepsanou smlouvu ▾"** dropdown (offering **Smlouva** vs. **Smlouva + prohlášení** — see "Signed-contract split + client-side PDF compression" above) previously rendered identically whether the button sat on an employment-history row or on a Další dokumenty (ad-hoc/standalone) entry. A "Prohlášení poplatníka daně" is the taxpayer's declaration, an onboarding artefact that belongs to an *employment contract* — it is meaningless attached to an ad-hoc document like Multisport or a custom template, so offering the split there was a trap waiting to file a declaration nobody meant to create.

**Fix:** the split option is now shown only when the component is rendering for an employment-history row. `canSplitUpload = canUploadDocuments && !!employmentRowId` is derived from the existing `employmentRowId` prop (already optional — absent means ad-hoc/standalone, per its doc comment) rather than a new prop threaded through both call sites, specifically so the two call sites (Historie tab vs. Další dokumenty) can never disagree about which mode they're in.

- **Employment-history row** (`employmentRowId` set): button reads **"Nahrát podepsanou smlouvu ▾"** and opens the two-item menu, unchanged.
- **Ad-hoc / standalone document** (`employmentRowId` absent): button reads **"Nahrát podepsaný dokument"**, single click straight to the file picker, no dropdown — matches the pre-split single-file upload behaviour.

**Backend unchanged.** `POST .../signed-pdf-with-declaration` never enforced this distinction server-side — it will happily file a declaration against any contract id it's given. This is purely a UI affordance to stop an operator from being *offered* a meaningless choice; it is not a new backend guard.
