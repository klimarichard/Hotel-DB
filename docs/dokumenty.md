# Dokumenty

A second, standalone template editor beside **Šablony smluv** for documents that have nothing to do with a contract — protocols, checklists, anything printable. Introduced in **v4.15.0**. Route `/dokumenty`, backed by `documentTemplates/{id}` (`functions/src/routes/dokumenty.ts`).

⚠️ **Access model changed in a later release, after the custom-variable engine grew `{{#case}}`.** Documents used to be filed into one of five hard-coded per-hotel sections, each gating visibility with its own permission key. That model is gone, replaced by a single `public`/private flag — see [Public vs. private](#public-vs-private). If you're reading old notes or an old PR that mention "dokumenty sections," they describe the retired design.

An author writes the document in the same TipTap editor Šablony smluv uses and declares which of up to **twenty-five** `{{var1}}..{{var25}}` slots it uses (label, type, optional default). A viewer picks the document, fills the slots in a modal, and gets a PDF in a new tab. Nothing about the fill-in is stored anywhere.

The custom-variable engine itself — the nine slot types (including `image`, "Obrázek" — a `list` whose choices each carry a picture), the formula parser, condition evaluation, the `{{#case}}` switch, and how the three validator copies are kept in lockstep — is shared with Šablony smluv and documented once, in **[custom-variable-engine.md](custom-variable-engine.md)**. This page covers only what's specific to Dokumenty.

## Deliberately not a contract

Dokumenty shares the editor and the PDF pipeline with Contracts, but the two are shaped very differently, and the gap is intentional rather than a gap to close later:

- **Custom variables only — no employee.** A document template has no bound employee/company record, so there is nothing for `VARIABLE_GROUPS` or `COMPARABLE_VARS` (`frontend/src/lib/contractVariables.ts`) to resolve against — every default a document stores is a `{kind:"literal"}`; the `fixedVar` default source (a value sourced from a resolved employee field) is meaningless here and never offered.
  - ⚠️ **Reasoning partially overturned in v5.2.0.** Until then, the `"condition"` custom-var type was refused here entirely, on the grounds that a condition compares two built-in employee/contract variables and a document binds no employee. That specific reasoning was wrong rather than merely restrictive: a document condition can compare **custom slots** against each other or against a literal (`{{var1}} > {{var2}}`, `{{var3}} = Praha`), which needs no employee record at all — the comparison engine already accepted custom operands (`comparableTypeOfCustom`), so excluding the type here only meant a document had no way to say "print this paragraph only when the amount exceeds the deposit." `functions/src/routes/dokumenty.ts`'s `isValidCondition` was already written for exactly this case (its operands can only be other custom slots, unlike the contracts version) and needed no change to accept it. `"math"` arrived in the same release and is likewise computed, and likewise restricted to custom-slot operands (naming anything else — a built-in that doesn't exist here — silently blanks the whole formula; see the engine doc). What's still true: no `fixedVar` default, and no `COMPARABLE_VARS`-sourced condition operand — both require an employee/company record this page never has.
- **Nothing is persisted from a render.** `POST /api/dokumenty/render-pdf` streams a PDF straight back and writes no Storage blob, no Firestore record, no history, no audit entry — matching `POST /contracts/render-pdf`'s own render-only path. That is also why there is no `usage` endpoint (nothing downstream ever references a filled document to report on).
- **No built-ins to protect.** Every `documentTemplates/{id}` is user-created, so `DELETE /api/dokumenty/:id` is a plain hard delete — there is no seeded/system template to guard against deletion the way some contract templates are.

## Endpoints

All in `functions/src/routes/dokumenty.ts`, mounted at `/api/dokumenty` (`functions/src/index.ts:44,143`).

| Method & path | Permission | Notes |
|---|---|---|
| `POST /render-pdf` | `nav.dokumenty.view` | Registered before the `/:id` routes so the literal path always wins. Reuses `services/pdfRenderer.ts` — the same Puppeteer service `POST /contracts/render-pdf` uses, unchanged by this feature — but gated on `nav.dokumenty.view`, **not** `contracts.generate`: a Dokumenty viewer must not need any contracts permission to print. Body `{ html, margins? }`; returns `application/pdf`. No audit entry (nothing is stored). |
| `GET /` | `nav.dokumenty.view` | List without `htmlContent` (can approach 1 MB/doc). Filtered server-side to what the caller may see — see [Public vs. private](#public-vs-private). |
| `POST /` | `dokumenty.manage` | Creates an empty template. Body `{ id, name, public? }`; `id` is a snake_case slug (`^[a-z][a-z0-9_]{1,39}$`), 409 if it already exists. `public` defaults to `false` when omitted. |
| `POST /:id/duplicate` | `dokumenty.manage` | Copy an existing template under a new id. Body `{ id, name, public? }`; same slug validation and 409-on-collision as `POST /`. Copies `htmlContent`, `variableDefs` and `margins` from the source — see [Duplicating](#duplicating). |
| `GET /:id` | `nav.dokumenty.view` | Full template incl. `htmlContent`. Returns **404, not 403**, when the caller may not see the document — see [Public vs. private](#public-vs-private). |
| `PUT /:id` | `dokumenty.manage` | Upsert. Body `{ name, htmlContent, margins?, variableDefs?, public? }`. Re-extracts `variables` from the HTML server-side. Omitting `public` leaves the stored value untouched (merge write). |
| `PATCH /:id` | `dokumenty.manage` | `{ active: boolean }` — deactivate/reactivate. Absent `active` field = active; only an explicit `false` marks it inactive. Reversible. |
| `DELETE /:id` | `dokumenty.manage` | Hard delete. |

⚠️ **`PUT /api/auth/me/dokumenty-default` is gone.** It used to live on the auth router and set `users/{uid}.dokumentyDefaultSection`, the per-user sort preference described below in the pre-rewrite text this file used to carry. Dokumenty dropped sections entirely — see [Public vs. private](#public-vs-private) — so there is nothing left to prefer, and the endpoint had no meaning left to keep. See [What replaced the per-user default](#what-replaced-the-per-user-default-hotel-valued-slot-pre-fill).

### Size guard on `PUT /:id`

Firestore caps a document at 1 MiB; `htmlContent` is by far the largest field and balloons when the editor inlines base64 images. `PUT /:id` rejects an oversized payload up front with a Czech 413 (`functions/src/routes/dokumenty.ts:356-366`) rather than letting a raw Firestore error surface, and catches the same failure again around the actual write in case something slips past the pre-check (`:394-407`). Same pattern as the contract-template editor.

⚠️ The pre-check measures `htmlContent` only — an `image` slot's `variableDefs.*.images` is a separate pile of base64 on the same document that this check cannot see (eight choices at the per-picture cap is already ~960 KB on its own). It is still caught, one step later, by the write-time `catch` that pattern-matches Firestore's own oversized-write error — see [custom-variable-engine.md](custom-variable-engine.md#image-slots-obrázek) for why widening the pre-check itself was not done.

## Duplicating

`POST /:id/duplicate` exists as a server endpoint rather than a client-orchestrated
`GET` + `POST` + `PUT` because those three calls are not atomic: a failure between
the create and the content write leaves an empty document behind that looks like a
real one. The endpoint either lands the copy whole or not at all.

Copied from the source: `htmlContent`, `variableDefs`, `margins` (the last two only
when the source actually stored them, so the copy doesn't gain defaults the
original never had).

**Deliberately not copied:**
- `active` — a duplicate always starts active, even when the source is deactivated.
  You copy a document in order to use it.
- `public` — taken from the request body, not inherited. Duplicating is the moment
  the author decides who the copy is for; silently inheriting the source's audience
  is the kind of default that quietly publishes a document to everyone holding
  `nav.dokumenty.view`. The UI pre-fills the source's value as a visible, editable
  checkbox.

The audit entry records `duplicatedFrom: <sourceId>` in its summary.

**Frontend.** The `Duplikovat` button lives in the editor header (`.headerActionsFixed`),
not on the sidebar rows: `.templateActions` is `flex-shrink: 0` inside a 240 px
sidebar and already carries Deaktivovat + Smazat, so a third button overflowed the
row — and acting on the open document makes it unambiguous which one is copied. The
create modal doubles as the duplicate form (same three fields) keyed off
`duplicateSource`; `closeCreateModal()` is the single reset path so duplicate mode
cannot leak into the next plain "new document".

Two details that matter:
- The copy is made from the **saved** document. When the open document is dirty the
  modal says so in bold, rather than silently copying stale content.
- After creating or duplicating, the page switches to the new document through
  `requestSwitch`, **not** `setSelected` — the latter bypasses the unsaved-changes
  prompt. That was latent for plain creation; duplicating made it likely, because
  the document you duplicate is usually the one you have open and are editing.

## Firestore shape: `documentTemplates/{id}`

```
{
  name: string,
  public?: boolean,                  // absent = PRIVATE — see "Public vs. private" below
  htmlContent: string,
  variables: string[],              // {{varN}} keys found in htmlContent, server-derived
  variableDefs?: {                  // per-slot config, keyed "var1".."var25"
    [slot: string]: {
      label: string,                 // ≤60 chars
      type: "text" | "longtext" | "date" | "number" | "bool" | "list" | "image" | "condition" | "math",
      default?: { kind: "literal", value: string },   // ≤200 chars; never "fixedVar" here
      condition?: { leftKey: string, op: CompareOp, right: {kind:"var",key} | {kind:"literal",value} },  // "condition" only; operands are other custom slots
      options?: string[],            // "list" only, ≤30 entries, ≤100 chars each
      images?: {                     // "image" only, ≤8 entries — see custom-variable-engine.md
        label: string,                 // the choice's name, and the slot's raw value once picked
        src: string,                   // "data:image/(png|jpeg|webp|gif);base64,…", ≤120 000 chars
        width?: "25%" | "50%" | "75%" | "100%",
        align?: "left" | "center" | "right",
      }[],
      formula?: string,              // "math" only, ≤200 chars, allowlisted characters only
      decimals?: number,             // "math" only, 0–4, default 0
      optional?: boolean,            // "Nepovinná" — absent = required
    }
  },
  margins: { top: number, bottom: number, left: number, right: number },  // mm, default 15 each
  active?: boolean,                  // absent = active
  createdAt, createdBy, updatedAt, updatedBy,
}
```

⚠️ A document created before this change may still carry a stale `section: "ambiance" | "superior" | "amigo" | "ankora" | "temp" | null` field. Nothing reads it any more, on either side, and it is left in place deliberately (`functions/src/routes/dokumenty.ts` — see the comment above the spread in `GET /:id`): stripping the field from every stored document would be a bulk production write bought for tidiness alone. Do not "clean it up."

## Public vs. private

⚠️ **This chapter used to be "Sections."** Until this change, a document was filed into one of five hard-coded sections (Ambiance/Superior/Amigo & Alqush/Ankora/TEMP), each with its own view permission, and the sections did double duty: they gated *who* could see a document and they set the list's sort order. The custom-variable engine's `{{#case}}` block plus the `Seznam`/`Obrázek` slot types removed the reason the gate existed — **one document now serves all four hotels itself** (a `{{#case var1 = "Ambiance"}}…{{/case}}` per hotel, or an `Obrázek` slot whose choice is the hotel), so there was no per-hotel *audience* left to gate. What a document's audience still needs is a single, coarser question: is this for everyone who can open Dokumenty, or only for the people who maintain it? That is the `public` flag.

- `nav.dokumenty.view` → the page, the document list, and every document with `public === true`.
- `dokumenty.manage` → the same, **plus every private document** (create/edit/deactivate/delete, unchanged).

**The single most important fact about this field: it is optional, and absent means PRIVATE.** Every document written before this change lacks `public` entirely — there was nothing to write it — and the moment this shipped, every one of them started reading as private, with **zero writes to production**. No backfill script exists or was needed; the read path (`maySeeDocument` below) treats "field missing" and "field explicitly `false`" identically. This is also why the create form's `Veřejný` checkbox defaults **unticked**: a brand-new document is private until its author deliberately says otherwise.

Compare `active?: boolean` on this same collection, where absent means **active** — same shape (an optional boolean with a meaningful absent-state), opposite default, both deliberate. Do not "normalise" `public` to match `active`'s polarity, and do not write a migration that backfills `public: false` onto old documents — the backfill would be a real production write that changes nothing a reader can already see, since absent already reads as `false`.

### Enforcement (`maySeeDocument`, `functions/src/routes/dokumenty.ts`)

The security posture carries over unchanged from the section gate it replaced — only the predicate got simpler:

- `GET /` filters the list server-side, not just hidden in the UI — the list is the only place a document's existence is disclosed.
- `GET /:id` returns **404, not 403**, when the caller may not see the document, so the status code itself never confirms that a private document exists — it is indistinguishable from one that was never created.
- `dokumenty.manage` short-circuits to "sees everything": an editor who couldn't see a private document could neither fix nor delete it.
- `system.admin` is checked **explicitly**, even though the permission resolver already expands `system.admin` to the full static permission set (so an admin holds `dokumenty.manage` anyway). The explicit check exists so this gate doesn't rest on a coincidence of how the resolver happens to expand wildcards — a resolver change could otherwise silently open or close every private document for admins.
- `public` is validated as a **real boolean only** (`isValidPublic`), never coerced — a truthy string (`"false"`, `"0"`) sent by a hand-crafted request must not be able to publish a document to everyone holding `nav.dokumenty.view`.

**Deleted by this change:** `functions/src/services/documentSections.ts`, `frontend/src/lib/documentSections.ts`, `PUT /api/auth/me/dokumenty-default`, and the five `dokumenty.<section>.view` permission keys (from both `frontend/src/lib/permissions/catalog.ts` and `functions/src/auth/permissions.ts`).

**Deliberately NOT deleted:** the stored `section` field on existing documents (see the Firestore-shape note above) and `users/{uid}.dokumentyDefaultSection` (see below) — neither is read by anything any more, and deleting either would be a production write bought for nothing but tidiness.

### What replaced the per-user default (hotel-valued slot pre-fill)

The old per-user "Výchozí sekce" only ever reordered the list — it never granted or withheld access. There is no replacement for *that* specific behaviour: a public/private split has nothing to sort by preference the same way, since a private document is only ever shown to an editor at all, and splitting the visible list the way sections did would only ever be visible to that editor — for a distinction the `Veřejný` checkbox on the document already shows them directly.

What Dokumenty gained instead, in the same release, is a **fill-in-time convenience**: `GenerateDocumentModal.tsx` pre-fills a hotel-valued custom slot (a `list`/`Seznam` or `image`/`Obrázek` slot whose choices happen to be the four hotel names) with the hotel the person printing the document actually works at — the same question the old default section answered, but asked at the moment it matters (filling in a specific document) rather than baked into a standing preference.

- `resolveOwnHotel(can, recepceDefaultHotel)` (`GenerateDocumentModal.tsx`) resolves against the **Recepce hotel registry** (`frontend/src/lib/hotels.ts` — `accessibleHotels(can)`), not a Dokumenty-specific one: Dokumenty used to keep its own five-value registry with its own permission keys, and that is exactly what the public/private flag replaced — but "which hotel is this person at?" outlived it, and Recepce is where the app already answers that question, per hotel, permission-driven.
  - Exactly **one** accessible hotel → that hotel.
  - **Several** accessible hotels → the user's `recepceDefaultHotel`, if it's one of the accessible ones.
  - **None accessible, or several with no matching default** → no pre-fill; the user picks. Guessing wrong here would be worse than asking.
- **Matching is by choice label, not by id** (`customChoiceLabels(defsNow[key]).find((l) => fold(l) === fold(ownHotel.label))`, trimmed + case-folded). This is what keeps the feature self-limiting: a slot whose choices have nothing to do with hotels simply never matches and is left alone, and a slot that only offers some of the four hotels only pre-fills for the users it covers.
- The user's own hotel **outranks** the slot's configured default value: a configured default is one statement for every viewer, this pre-fill is specific to the person actually printing.
- This is a **convenience, never an access decision** — it only seeds a form field the user can still change; it can never surface a choice, a document, or a value that a permission gate would otherwise withhold. Holding no Recepce permission at all simply means "no pre-fill," not an error.

`users/{uid}.dokumentyDefaultSection` itself is the inert leftover of the retired feature: `GET /api/auth/me` still spreads the whole user document, so an account that once set a default still carries the field in that response, but nothing on either side reads it any more (`frontend/src/hooks/useAuth.ts` — the field is deliberately left untyped there). See `functions/src/routes/auth.ts`, where the deleted endpoint's old location now carries a comment explaining the same thing.

## Custom-variable types, `{{#case}}`, math and conditions

The engine mechanics — the nine slot types (`text`, `longtext`, `date`, `number`, `bool`, `list`, `image`, `condition`, `math`), the formula parser, `resolveComputedVars`'s fixpoint resolution, condition evaluation, and the `{{#case}}` switch block — are documented once, shared with Šablony smluv, in **[custom-variable-engine.md](custom-variable-engine.md)**. What follows is specific to how Dokumenty surfaces them.

**Authoring-time warnings (`customVarWarning()`, `DokumentyPage.tsx`).** Several slot mistakes still "work" — the document stays producible — but silently print something other than what the author intended, so saving the template computes a warning covering seven distinct cases and shows it as a clickable button in the editor header:

- **Unnamed** — a slot used in the text (or reachable via a formula/condition) with no configured label/type. Falls back to `"text"` and shows the raw key to whoever fills the document in.
- **Bez možností** — a `list` slot with no choices (see below).
- **Chybný vzorec** — a `math` slot whose formula is empty or fails to evaluate even with a dummy value of `1` substituted for every operand it names (a formula that can't produce a number from all-ones can't produce one from real input either).
- **Neznámá proměnná ve vzorci** — a `math` slot whose formula names an identifier that isn't one of this document's own custom slots. Unlike on Šablony smluv, where an unrecognised identifier might legitimately be a built-in (`salary`, `hoursPerWeek`, …) the formula resolves against, Dokumenty has no built-ins at all — so any operand that isn't a custom slot key is *definitely* wrong, and the check can name it explicitly rather than merely flag a broken evaluation.
- **Bez podmínky** — a `condition` slot with no comparison configured (`leftKey` empty), which is always false and silently drops every `{{#if}}` block it guards.
- **Bez obrázků** — an `image` slot used in the text (or reachable via a formula/condition) with zero configured choices. Unlike an empty `list`, this is harder to diagnose from the fill-in side alone: a list degrades to a free-text box a viewer can still type into, but an image slot has nothing behind it to fall back on — a typed string names no picture — so the generate modal can only show a plain "no pictures configured" notice and print an empty space. See [custom-variable-engine.md](custom-variable-engine.md#image-slots-obrázek) for why this — unlike an empty `list` — is also exempt from `missingCustomVars` rather than blocking generation.
- **Neúplná možnost** — an `image` choice with a label but no uploaded picture, or a picture but no label (so it can never be picked by name). Either half alone renders nothing for that choice.

The warning is re-evaluated (and cleared) when the "Vlastní proměnné" modal closes via its primary button, so fixing the last flagged slot makes it disappear without a separate save round-trip. It never blocks saving.

### The `"list"` / "Seznam" type

- `CustomVarDef.options?: string[]` — the dropdown's choices, in author-entered order, **stored as the display strings themselves** (no separate code/label pair, since the picked value is substituted verbatim). Capped at `CUSTOM_VAR_MAX_OPTIONS = 30` entries, ≤100 chars each — validated both client-side (`renderOptionsEditor`) and server-side (`isValidCustomOptions`, `functions/src/routes/dokumenty.ts`).
- Behaves like `"text"` for required/optional purposes: required until a choice is picked, released the same way by "Nepovinná" (`optional: true`).
- A list slot's **default must be one of its own choices** — the config UI renders a `<select>` over `options`, not a free-text box, for a list-typed default, so the stored default can never hold a value the dropdown doesn't offer. Because of this, "Z proměnné" (a `fixedVar` default) was never applicable to list slots anyway — Dokumenty has no fixed variables at all, so the point is moot here, but it holds in Šablony smluv too.
- **Optionless list is accepted on purpose.** The server's `isValidCustomOptions` allows `options: []` / absent — rejecting it mid-configuration would punish an author for picking the type before typing the first value. The generate form (`GenerateDocumentModal.tsx`) degrades an empty-options list slot to a plain free-text input rather than an unfillable empty `<select>`, so the document stays producible. Because that degradation is invisible to whoever is editing the template, `customVarWarning()` flags it explicitly as "Bez možností: … – seznam nemá žádné hodnoty."

### The `"image"` / "Obrázek" type

Full mechanics — why base64, why `isImageDataUri` is a security boundary, the raw-value-is-the-label design, the `missingCustomVars` asymmetry with `list`, the interaction with the size guard, and the first-`<img>` pagination landmine — are documented once in **[custom-variable-engine.md](custom-variable-engine.md#image-slots-obrázek)**. This is Dokumenty's specific editor surface for it.

- **Per-choice upload.** The "Vlastní proměnné" modal's editor for an `image` slot is shaped like the `list` editor (one row per choice, ordered as entered), because an image slot *is* a list whose choices additionally carry a picture — each row adds a name (the choice's label) plus a file picker. `prepareImageDataUri` (`frontend/src/lib/imageDownscale.ts`) reads the picked file and downscales it if needed; a failure (unreadable file, or too large even after every downscale attempt) surfaces as a plain error modal ("Obrázek se nepodařilo načíst. Zkuste prosím jiný soubor.") rather than silently dropping the choice. A shrunk picture is flagged inline ("Obrázek byl automaticky zmenšen, aby se vešel do dokumentu.") so the author knows the stored file isn't byte-identical to what they uploaded.
- **Running size total.** The modal computes and shows a combined kB figure across **every** image slot's pictures on the document — including slots whose `{{varN}}` placeholder was since deleted from the text ("orphaned"), because those pictures are still stored on the same document and still count against its 1 MiB ceiling. Unlike Šablony smluv (which additionally flags a hard warning once the running total passes a fixed character threshold — see the engine doc), Dokumenty's editor surfaces the running total as a plain readout with no explicit warning threshold of its own; the same server-side size guard (below) is what ultimately catches an oversized document either way.
- **Fill-in.** `GenerateDocumentModal.tsx` renders an image slot as a `<select>` over the configured choice labels, with a live thumbnail preview of the picked choice's picture underneath — the last chance to notice a mismatch before the PDF opens (unlabelled/pictureless template mistakes aside, two visually similar pictures are otherwise indistinguishable until seen). A slot with zero usable choices (label **and** picture both present) shows a plain notice instead of an unfillable dropdown, and prints nothing for that slot — see "Bez obrázků" above.

### Read-only preview for a viewer without `dokumenty.manage`

`readOnlyHtml` (`DokumentyPage.tsx`) renders the stored HTML with every custom slot replaced by its configured label in brackets (`"[Výše pokuty]"` instead of a bare `{{var1}}`), so someone who can only view a document still sees roughly what it says before opening the fill-in modal. The computed types, and `image`, need their own treatment, since the bracketed-label trick describes a *fillable text* slot, not these:

- **`condition`** resolves to `"ano"` — the branch it guards is kept, as if the condition had been satisfied, which is the useful default for a document about to be filled in for real.
- **`math`** keeps the bracketed label (`"[Celkem]"`) — its result is a number nobody has typed the inputs for yet, so there is nothing honest to compute.
- **`image`** is the one type where the bracketed-label trick would be actively misleading — the document prints a *picture* there, not the label text, so showing `"[Logo hotelu]"` would misrepresent what actually renders. The preview instead picks a stand-in choice (a configured default, else the first `{{#case}}` branch written for the slot, else the slot's first configured choice) and renders that choice's real picture via `renderCustomImage`/`findImageOption`; only with no choice configured at all does it fall back to the bracketed label, which is what the author actually needs to see in that case.

A `{{#case}}` switch needs a **third**, raw-value map to preview correctly — matching it against the bracketed labels would make every `"="` branch miss and every `"!="` branch hit, showing the exact opposite of the real document (and, for a multi-branch switch, several mutually exclusive alternatives stacked on top of each other). The preview instead picks one stand-in answer per slot: the configured default if there is one, otherwise the value of the first `"="` branch written in the text (guaranteeing exactly one branch renders), otherwise a list slot's first choice — with none of those, the answer is blank and every `"="` branch drops, which is what an unanswered switch genuinely prints.

## `lib/editor/extensions.ts`

`frontend/src/lib/editor/extensions.ts` is the set of TipTap extensions (`Table` with the `borderless` attribute, `ResizableImage`, `ListItemIndent`, `NbspKeybind`, `LineHeight`, `PageBreak`, `PasteCleanup`, `SearchHighlight`, `ListItemStyle`, `FontSize`, `TabParagraph`, …) extracted **verbatim** out of `ContractTemplatesPage.tsx` when Dokumenty needed a second editor of the same kind (`ContractTemplatesPage.tsx` dropped from roughly 2483 to 2081 lines; the module itself is ~414 lines). Both pages still each run their own `useEditor(...)` call with their own extension list and their own toolbar — only the extension *definitions* are shared, because that's the part that's genuinely identical, and the part where a fix landing on one page but not the other would silently diverge the two editors' output HTML (and therefore their PDFs, since `pdfRenderer.ts`'s CSS has to match both).

The module also exports **`STARTER_KIT_OPTIONS`**, which both pages pass to `StarterKit.configure(...)` for exactly that reason. Two settings live there:

- `paragraph: false` — replaced by `TabParagraph`.
- `link: { autolink: false, linkOnPaste: false, openOnClick: false }` — **StarterKit v3 bundles the Link extension**, whose defaults hyperlink anything URL- or e-mail-shaped on their own (while typing, and when pasting over a selection). Neither editor has a link button, so such a link could never be removed again. ⚠️ The extension is deliberately **not** disabled with `link: false`: ProseMirror silently drops marks missing from the schema, so that would make every `<a>` in an already-saved template or document vanish on load — rewriting stored content to fix a typing annoyance. Keeping the mark and disabling only its automatic creation leaves existing documents byte-identical. Note this is preventative only: links created before v5.0.4 are still in those documents, and there is still no UI to remove one.

### The custom-variable configuration dialog stays unshared

**The custom-variable *configuration dialog* is still not extracted into a shared component**, even though it looks like an obvious candidate now that both pages offer the identical nine-type set (`DOC_VAR_TYPES` in `DokumentyPage.tsx` now lists all nine, same as `CUSTOM_VAR_TYPE_LABELS`'s keys on the contracts side). What used to be the stated reason — that a third of the contracts dialog was `"condition"`-builder machinery Dokumenty had no use for — is **obsolete**: Dokumenty's own condition builder (`renderConditionBuilder` in `DokumentyPage.tsx`) is now exactly that same kind of machinery, just narrower.

What's left to justify keeping them separate is genuinely two different catalogues feeding the *same* dialog shape, not a difference in what the dialog needs to do:
- **Condition operands.** Šablony smluv's builder offers `COMPARABLE_VARS` (built-in employee/contract fields) *and* the template's own custom slots, in two visually separated groups; Dokumenty's offers only its own custom slots — there is no employee-coupled catalogue to add a second group from.
- **Default source.** Šablony smluv's "Z proměnné" (`fixedVar`) option resolves a slot's default from a built-in variable; Dokumenty has no built-ins to resolve one from, so its default source is always `"literal"`.

Sharing the dialog would mean parameterising it across those two axes (which operand catalogues exist, whether a `fixedVar` source is offered) for a component that would then carry conditional logic neither call site needs on its own. The two editors share a *shape* — a table of slot → label/type/default/optional, plus the same math-formula and `{{#case}}` authoring UI — not code.

## Related files

- `functions/src/routes/dokumenty.ts` — REST endpoints, validation (incl. `maySeeDocument`/`isValidPublic`), audit-log calls (`logCreate`/`logUpdate`/`logDelete` on every write except the render).
- `functions/src/services/pdfRenderer.ts` — unchanged, shared Puppeteer renderer (also used by Contracts).
- `functions/src/routes/auth.ts` — `GET /me` still spreads a legacy `dokumentyDefaultSection` field for accounts that once set one (see [Public vs. private](#public-vs-private)); the endpoint that used to write it is gone.
- `frontend/src/pages/DokumentyPage.tsx` / `.module.css` — the editor + list page, incl. the `Veřejný` toggle in the header.
- `frontend/src/components/GenerateDocumentModal.tsx` / `.module.css` — the fill-in-and-print modal, incl. `resolveOwnHotel` (hotel-valued slot pre-fill).
- `frontend/src/lib/hotels.ts` — `accessibleHotels(can)` / `recepceDefaultHotel`, the Recepce hotel registry the hotel pre-fill resolves against.
- `frontend/src/lib/editor/extensions.ts` — shared TipTap extensions (also used by `ContractTemplatesPage.tsx`).
- `frontend/src/lib/contractVariables.ts` — the shared custom-variable engine; see **[custom-variable-engine.md](custom-variable-engine.md)** for the full write-up (types, formula parser, conditions, `{{#case}}`, `image` slots).
- `frontend/src/lib/imageDownscale.ts` — reads a picked file into a base64 data URI and downscales it to fit an `image` slot's per-picture budget; shared with Šablony smluv.
- `frontend/src/lib/menuItems.ts` (`id: "dokumenty"`, `hideOnMobile: true`) and `functions/src/routes/menuOrder.ts` (`VALID_IDS` already includes `"dokumenty"`).
- `frontend/src/App.tsx` — `<Route path="dokumenty">` wrapped in `RequirePermission allow={["nav.dokumenty.view"]}`.

## Permissions summary

| Key | Meaning |
|---|---|
| `nav.dokumenty.view` | the page, the document list and every **public** document, reading a template, and rendering a PDF |
| `dokumenty.manage` | create/edit/deactivate/delete a template; also see every **private** document |

The five `dokumenty.<section>.view` keys are gone (see [Public vs. private](#public-vs-private)). Own **Dokumenty** section in the permission matrix, registered in both `frontend/src/lib/permissions/catalog.ts` and `functions/src/auth/permissions.ts`. Not granted to any built-in user type by default — `admin` reaches everything via the `system.admin` wildcard (and the explicit check in `maySeeDocument`); everyone else needs an explicit grant, same posture as Recepce and Tabulky.
