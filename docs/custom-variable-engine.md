# Custom Variable Engine (`{{var1}}`..`{{var25}}`)

The engine behind the free `{{varN}}` slots that **Šablony smluv** (`contractTemplates/{id}`, see [contracts.md](contracts.md)) and **Dokumenty** (`documentTemplates/{id}`, see [dokumenty.md](dokumenty.md)) both let an author bolt onto a template for values the rest of the data model has no field for — a penalty amount, a training date, a one-off clause. It lives in one file, `frontend/src/lib/contractVariables.ts`, and is mirrored (not imported — Cloud Functions cannot `import` from `frontend/src`) by two server-side validator copies, one per route file. This page documents the mechanics that are identical on both pages; the two page docs cover only what differs.

Widened substantially in **v5.2.0**: two new slot types (`longtext`, `math`), a `{{#case}}` switch block, conditions that can compare custom slots against each other (not just built-ins), and — on Dokumenty only — a much larger slot count. A **ninth type, `image`** ("Obrázek"), shipped on top of that same body of work — a `list` whose choices each carry a picture, so a template can print a different image per answer without one `{{#case}}` branch per picture. Everything below is that shape unless marked otherwise.

## Why not `#var1`

The substitution regex is `\{\{(\w+)\}\}` and a leading `#` is reserved for a block opener (`{{#if x}}`, `{{#case x = v}}`). A slot literally named `#var1` would match none of the regexes used by `fillTemplate`, `getMissingVariables`, `usedCustomVars`, or the backend's `extractVariables` — it would be silently ignored end-to-end and print raw `{{#var1}}` text into the finished PDF. The plain-word form (`var1`, not `#var1`) is load-bearing, not a style choice — this is the single most important gotcha for anyone touching this code.

## Two slot counts, deliberately

- **`CUSTOM_VAR_MAX = 25`** — the engine's *recognition* ceiling: how far `isCustomVarKey` / `usedCustomVars` / `CUSTOM_VAR_KEYS` will recognise a slot at all, on either page.
- **`DOCUMENT_VAR_COUNT = 25`** and **`CONTRACT_VAR_COUNT = 10`** — how many slots each *page* offers in its picker and accepts server-side. One number until v5.2.0, when Dokumenty needed 25 while Šablony smluv stayed at 10 — a contract template is a signed legal document, and widening its slot space buys nothing there.

Recognition is shared at the higher ceiling rather than split per-page: a stray `{{var15}}` typed (or pasted from a Dokumenty template) into a contract can then be *seen* by the editor — it surfaces as an unnamed slot and a "Mimo rozsah" warning — instead of being silently printed as literal braces into a signed PDF. The contracts server validator still refuses to persist a `variableDefs` entry beyond `var10` (`isValidVariableDefs` in `functions/src/routes/contractTemplates.ts` checks membership in a 10-key set), so the gate holds where it matters; the picker just can't offer what it can't save.

`customVarKeys(count)` (`contractVariables.ts`) returns the first `count` of `CUSTOM_VAR_KEYS` — what a page's config panel and generate form actually list.

## The nine slot types

| Type | "Typ" label | Typed in at generation? | Notes |
|---|---|---|---|
| `text` | Text | yes | Passed through **unformatted, unescaped** — deliberately: production templates already rely on passing small HTML fragments through a plain `{{var1}}`, and silently escaping those would change what an already-signed contract renders. |
| `longtext` | Dlouhý text | yes (textarea) | The **only** slot type whose value is HTML-escaped. `\n` → `<br>` so multi-paragraph prose doesn't collapse to one run-on line inside the `<p>` the placeholder sits in (real `</p><p>` would nest block elements and lose the surrounding paragraph's styling). A blank line therefore prints as two `<br>` — a visible paragraph gap. |
| `date` | Datum | yes (`<input type="date">`) | `formatDateCZ` splits the ISO string rather than parsing a `Date` — no UTC-offset day-shift. |
| `number` | Číslo | yes | `Intl.NumberFormat("cs-CZ")` — Czech thousands grouping, same convention as every other numeric value in the app. |
| `bool` | Ano/Ne | yes (checkbox) | Resolves to `"ano"` / `""`, **not** `"ano"`/`"ne"` — matches the built-in `kind: "if"` permanent variables, where empty is what makes `{{#if var1}}` strip its block. Never "missing" — unchecked is a legitimate answer, not an omission. |
| `list` | Seznam | yes (`<select>`) | `CustomVarDef.options?: string[]` — up to `CUSTOM_VAR_MAX_OPTIONS = 30` choices, ≤100 chars each, stored as the **display strings themselves** (no code/label split — the picked value is substituted verbatim). An **optionless list is valid** (the author picks the type before typing values); the generate form degrades it to a free-text input rather than an unfillable empty dropdown, and the editor's `customVarWarning()` flags the omission instead. A list slot's default must be one of its own choices, so `"fixedVar"` ("Z proměnné") is not offered as a default source for it. |
| `image` | Obrázek | yes (`<select>` over choice labels) | A `list` whose choices each carry a **picture**. See "Image slots" below — it gets its own section because it introduces a security boundary (`isImageDataUri`), a document-size concern the plain types don't have, and an asymmetry in `missingCustomVars` versus `list`. |
| `condition` | Podmínka | **no — computed** | See "Condition slots" below. |
| `math` | Výpočet | **no — computed** | See "Math slots" below. |

`CUSTOM_VAR_TYPE_LABELS` (`contractVariables.ts`) is the canonical label map; both pages' type `<select>` iterate its keys, so a page's editor never lists a type the engine doesn't know about (in practice both pages currently offer all nine — see the per-page table at the bottom).

`COMPUTED_VAR_TYPES = ["condition", "math"]` / `isComputedVarType(type)` marks the two slot kinds above that never get a form field: their value is derived from other slots, so they can never be "missing" (`missingCustomVars` excludes them) and "Nepovinná" ("optional") is meaningless for them — the config UI shows a `–` instead of a checkbox for either.

## Image slots ("Obrázek")

`CustomVarDef.images?: CustomVarImageOption[]` — an `image` slot is a `list` whose choices each carry a picture: the author uploads one per choice, and picking a choice at generation substitutes the corresponding `<img>` into the document. It is the "different picture per answer" case, expressed as one variable instead of one `{{#case}}` block per image (though `{{#case}}` remains the right tool when the branches differ by more than just a picture — see below).

```ts
interface CustomVarImageOption {
  label: string;              // shown in the generate-time dropdown; the slot's raw value once picked
  src: string;                // base64 "data:image/…;base64,…" URI — never a remote URL
  width?: string;              // "25%" | "50%" | "75%" | "100%" (CUSTOM_VAR_IMAGE_WIDTHS); absent = natural width
  align?: "left" | "center" | "right"; // absent = inline, no alignment
}
```

`CUSTOM_VAR_MAX_IMAGES = 8` choices per slot; `CUSTOM_VAR_IMAGE_MAX_CHARS = 120_000` characters of base64 per picture (~90 KB).

**Why base64 inlined on the template document, and not a Firebase Storage URL.** This is forced, not chosen. `functions/src/services/pdfRenderer.ts` installs an SSRF guard before rendering: Puppeteer request interception aborts every request whose URL doesn't start with `data:` or equal `about:blank`, because the HTML being rendered comes from an admin-editable template and the headless browser must not be allowed to fetch internal services or the GCP metadata endpoint. A Storage URL would therefore render as a broken image in **every** generated PDF — there is no way to allow it without weakening a guard that exists for a real reason. Inlining as base64 is the only option left, and that is what puts every picture inside the *same* Firestore document as the template's HTML, sharing its 1 MiB ceiling (see "Interaction with the size guard" below). `frontend/src/lib/imageDownscale.ts` — a new shared module — reads the picked file, and if it doesn't fit `CUSTOM_VAR_IMAGE_MAX_CHARS`, downscales it through a `<canvas>` at progressively smaller widths, trading format before size (PNG → JPEG collapses a screenshot far more than shrinking pixels does, so format changes first). It refuses outright, with a Czech message, if even the smallest attempt doesn't fit — never truncates, since a truncated base64 string is a corrupt image that renders as a broken icon on a printed document, worse than being told to pick a smaller file. This logic began as a near-identical copy inside `FakturyPage.tsx` (invoice logos) and was lifted into the shared module for this feature; `FakturyPage` still carries its own copy — migrating it is a safe, deliberately unbundled follow-up.

**`isImageDataUri` is a security boundary, not a format check.** The `src` value is interpolated straight into `<img src="…">`, in both the browser preview and the Puppeteer renderer. The validator (present identically on the client, for UX, and — the one that actually holds — server-side in `functions/src/routes/dokumenty.ts` / `contractTemplates.ts`) requires an exact match against `^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$`, refusing:
- any remote URL or `javascript:`/other non-`data:` scheme;
- `data:text/html` and any other non-image MIME;
- a quote-breakout attempt (the regex admits only base64 alphabet after the comma, so a value can't inject `"` and escape the attribute);
- **SVG, despite being an image.** Deliberately excluded: an SVG can carry a `<script>`, and while today's `<img>` context doesn't execute it, allowing SVG would make "this never executes" an accident of how the file happens to be embedded rather than something this validator actually enforces.

The client's copy of this check is a convenience for the editor only — anyone can call the endpoint directly and skip it. The server copy is the one that holds, and it is the last gate before the string is persisted and later rendered.

**`renderCustomImage` must stay in lockstep with `ResizableImage`'s `renderHTML`** (`frontend/src/lib/editor/extensions.ts`) — same width-preset styling, same alignment CSS — so a picture that arrives through a variable is visually indistinguishable in the finished PDF from one the author pasted into the document by hand. A mismatch here would be invisible until someone compares a variable-driven page against a hand-authored one.

**The raw value of an image slot is the chosen LABEL — the non-obvious payoff of the design.** `formatCustomValue("image", raw, def)` looks the label up in `def.images` and renders its `<img>`; but `comparableTypeOfCustom("image")` returns `"text"`, so the same label also feeds `{{#case var1 = Ambiance}}` and an ordinary `condition` comparison, with **no second variable needed to hold "which picture was picked."** A `{{#case}}` branch that varies non-picture content (a whole paragraph, a clause, several images at once) still needs the switch; an `image` slot is the better tool specifically when *only the picture* changes per answer.

**The `missingCustomVars` asymmetry between `image` and `list`.** Both are "pick one of several configured choices" slots, but an unconfigured one is *not* treated the same way:
- An unconfigured **`list`** (no `options`) stays **required**, and the generate form degrades it to a free-text input — the typed text itself is what prints, so the document still comes out right no matter what the author types.
- An unconfigured **`image`** (no `images`, or none with a usable `src`) is **exempt from blocking** (`missingCustomVars` skips it). Its value is only a *key into a picture list* — an empty list offers no key to type. Left required, one authoring mistake (saving a template with the slot referenced but no picture ever uploaded) would make the document **permanently unprintable for everyone**, with no way to fix it from the fill-in dialog — the fill-in dialog has no picture-upload control. Instead the generate modals show a plain notice ("Pro tuto proměnnou nejsou nastavené žádné obrázky…") and print nothing for that slot; the *editor's* `customVarWarning()` flags the empty slot as "Bez obrázků", which is the only place it is actually fixable.

Same-looking slot types, opposite correct behaviour — this is worth remembering before "fixing" one to match the other.

**Interaction with the size guard on `PUT /:id`.** `PUT /api/dokumenty/:id` and `PUT /api/contractTemplates/:id` both pre-check `htmlContent`'s length against Firestore's ~1 MiB document cap before attempting the write, to surface a clear Czech 413 instead of an opaque Firestore error. ⚠️ **That pre-check measures `htmlContent` only** — `variableDefs.*.images` is a second pile of base64 living on the same document, invisible to it: eight choices at the per-picture cap is already ~960 KB on its own, enough to blow the ceiling even with modest HTML. This is deliberate, not an oversight left unfixed: the write itself (`ref.set(...)`) is wrapped in a `catch` that pattern-matches Firestore's own rejection message (`/maximum|too large|exceeds|size/i`) and returns the same Czech "too large" response either way, so a document pushed over the limit by its images alone still fails with the right message — just one step later than a document pushed over by its HTML. Widening the pre-check to also sum `variableDefs` was not done because the backstop already produces the correct user-facing outcome; duplicating the size arithmetic in two places would only be able to drift from Firestore's actual serialized size (base64 length in JS is not byte-for-byte identical to Firestore's on-disk encoding), where the `catch` never can. The client-side editors (`ContractTemplatesPage.tsx` / `DokumentyPage.tsx`) additionally track a running total across every image slot on the template — including orphaned ones, since they're still stored and still count — and Contracts shows a warning once that total passes `IMAGE_TOTAL_WARN_CHARS = 600_000` (~60 % of the ceiling), so the wall is visible while there's still something to do about it.

**⚠️ Landmine: an image variable can silently become "the logo" and shift page-2+ pagination.** `pdfRenderer.ts` (used by both `POST /contracts/render-pdf` and `POST /dokumenty/render-pdf`, both with the default `logoOffset: true`) measures `document.body.querySelector("img")` — the **first** `<img>` in the rendered body, whichever element that happens to be — and bumps the default `@page` top margin for pages 2+ by that image's rendered height, so body text on later pages starts at the same y-offset as the post-logo content on page 1. This logic predates the `image` custom-variable type and was written assuming the first image in a document is always its header logo. It has no way to distinguish that from an `image` slot's picture landing near the top of the document: if a variable-substituted picture happens to be (or become, after a template edit) the first `<img>` in the rendered body, `pdfRenderer.ts` treats it as "the logo" and offsets every subsequent page's top margin by its height — silently, with no warning anywhere, and only visibly wrong once the PDF is opened. Authors placing an `image` slot near the top of a template (above the real logo, or in a template with no logo at all) should be aware this can move page-2+ content. There is no code-level guard against it today.

## Math slots

`CustomVarDef.formula?: string` — an arithmetic expression over other slots and number literals, e.g. `"var1 * var2"` or `"(var1 - var2) / 3"`. `CustomVarDef.decimals?: number` (0–4, default 0) sets the printed precision.

**Grammar**, exactly:

```
expr    := term (("+" | "-") term)*
term    := factor (("*" | "/") factor)*
factor  := ("-" | "+")? primary
primary := number | identifier | "(" expr ")"
```

Numbers accept either a dot or a Czech decimal comma (`0,21`). Implemented as a small hand-written recursive-descent parser (`tokenizeFormula` / `evalMathFormula`, `contractVariables.ts`) — **never** `eval` / `new Function`. Those would execute arbitrary JavaScript typed by whoever can edit a template, with the page's full privileges and the signed-in user's token; a template editor is not a trust boundary the app wants to put a script engine behind. The server does not reproduce the parser (a second copy would drift); instead `isValidCustomFormula` applies a character allowlist (`/^[A-Za-z0-9_+\-*/(),.\s]*$/`, ≤200 chars) as defence in depth — whatever the client sends, nothing that even resembles code (quotes, brackets, semicolons, backticks, `$`) can ever be persisted, so a stored formula is inert no matter who later evaluates it.

**Failure is always `null`, never invented.** Division by zero, a malformed expression, trailing junk after a complete parse, or an operand with no usable numeric value all yield `null` — a document prints an empty string for that slot rather than `"NaN"` or a silently wrong total.

`formulaDependencies(formula)` returns every identifier a formula references, in first-appearance order — **not filtered to custom slots**. On Šablony smluv, `resolveComputedVars` looks each dependency up in the raw comparable map first (`salary`, `hoursPerWeek`, …), so a contract formula can say `salary * 0,15` for free; on Dokumenty there is no such map, so naming anything that isn't a custom slot makes that operand resolve to nothing, which collapses the *entire* formula to blank (a single unusable operand invalidates the whole expression) — Dokumenty's `customVarWarning()` therefore runs a second check specifically for unknown operands in a formula, which Šablony smluv's equivalent check cannot run (there, an unrecognised identifier might just be a valid built-in).

## Fixpoint resolution — `resolveComputedVars`

A formula may reference another `math` slot (`{{var3}} = var1 + var2`, `{{var4}} = var3 * 2`), so the resolution order is not knowable from a single top-to-bottom pass, and the author is never asked to declare slots in dependency order. `resolveComputedVars` instead runs a **fixpoint**: each pass resolves every `math` slot whose inputs are now known, and stops when a pass makes no progress. That termination condition doubles as the **cycle guard** — `var1 = var2 + 1` alongside `var2 = var1 + 1` simply makes no progress on the first pass, and both resolve to empty, rather than hanging the browser or overflowing a call stack. `condition` slots are evaluated in a final pass once every `math` result is available (so a condition may test a computed total); a condition can never be an operand of another condition (see below), so conditions need no fixpoint of their own.

## Condition slots

`CustomVarDef.condition?: CustomVarCondition` — `{ leftKey, op, right }`, where `op` is one of `CompareOp = "lt" | "lte" | "gt" | "gte" | "eq" | "neq" | "empty" | "notEmpty"` (the last two, `UNARY_OPS`, read the left operand alone). A condition slot has no typed-in value; its Ano/Ne is computed by `evalCondition` from the comparison and then drives `{{#if varN}}` / `{{#unless varN}}` exactly like any other boolean slot.

**Widened in v5.2.0**: a condition's operands can now be **custom slots**, not only the fixed built-in catalogue (`COMPARABLE_VARS` — dates and numbers the app already resolves onto a contract: `startDate`, `salary`, `hoursPerWeek`, the dodatek-derived `newSalary`/`oldSalary`, etc.). `comparableTypeOfCustom(type)` maps a custom slot's own type to the raw comparable type it contributes when used as an operand: `math` compares as a number, `date` as a date, `text`/`longtext`/`list`/`bool` as text (`bool` as `"ano"`/`""`, so `= ano` reads naturally). **It returns `null` for a `condition` slot** — a condition compared against another condition would be a cycle waiting to happen and expresses nothing that nesting two `{{#if}}` blocks can't already say, so the config UI's operand pickers never offer one.

`OPS_FOR_COMPARABLE` narrows the operator dropdown by the left operand's raw type: dates and numbers get the full set (`<`, `≤`, `>`, `≥`, `=`, `≠`, empty/notEmpty); `text` is restricted to equality and emptiness, because a locale-aware `<` on free text answers a question nobody filling in a document is actually asking.

**Evaluation is always on raw typed values, never the formatted display strings** — comparing `"1. 8. 2026" < "14. 7. 2026"` as strings would be meaningless, and `"35 000" < "5000"` as a string comparison would put the smaller number first. `resolveComparableRaw` (Šablony smluv) / the plain custom-slot raw map (Dokumenty) supply ISO date strings and plain numbers; `null` means missing/unparseable. **A missing or unparseable operand on either side makes the condition `false`** (block hidden) — a condition never invents a comparison result on a real document; an incomplete config or an unfilled upstream field degrades safely to "off" rather than throwing or defaulting to "on".

## `requiredCustomVars` vs `usedCustomVars`

- **`usedCustomVars(html)`** — which slots a template's *text* actually references: a plain `{{varN}}`, a `{{#if varN}}`/`{{#unless varN}}` condition, or the subject of a `{{#case varN = …}}` switch. Returned in slot order (`var1`, `var2`, …), not order of appearance.
- **`requiredCustomVars(html, defs)`** — `usedCustomVars` plus every slot reachable transitively through a used slot's `formula` or `condition` operands. **This, not `usedCustomVars`, is the set the generate form must ask for** — a `math` slot's operands very often never appear in the document text at all (`{{var3}} = var1 * var2` with only `{{var3}}` printed is the ordinary shape of a total), so scanning the text alone would leave those operands with no field, silently blank, and no total. Both `GenerateDocumentModal` and `GenerateContractModal` build their slot list from `requiredCustomVars`, and `missingCustomVars` (which slots still block generation) is defined in terms of it too.

## The `{{#case}}` switch

`{{#case var1 = Praha}}…{{/case}}` (and `!=`) is how a template expresses "print different content depending on a value" — a whole paragraph, several images, a mix of both. Grammar: `{{#case KEY OP VALUE}}…{{/case}}`, where `VALUE` is everything up to the closing `}}` (so it may contain spaces — a switch matches list choices, which are human labels — but not a literal `}`, which is the only way to find the tag's end without a real lexer).

Wrapping an `<img>` in a `{{#case}}` block per value still works and remains the right tool when what varies per answer is **more than just a picture**. When the *only* thing that changes is which picture prints, an `image` slot (see "Image slots" above) is the better tool: one variable instead of N `{{#case}}` branches, with its own per-slot caps (8 pictures, ~90 KB each after automatic downscaling) rather than sharing the document-wide `{{#case}}`/HTML budget below.

**Matching is on raw values, normalised, never on the formatted display string.** A number prints with thousands separators ("1 500") that its raw form doesn't have ("1500"), so matching printed strings would make a numeric switch fail invisibly. `fillTemplate(html, vars, rawVars)` takes an optional third argument specifically for this; `renderBlocks` falls back to the formatted `vars` map only when a key is **absent** from `rawVars` (not when it is `null` or `""`, which are real answers a computed slot can legitimately produce) — this is what lets `{{#case firstName = Jana}}` still work against a purely-raw map that has no entry for a built-in.

Values are normalised before comparing (`normaliseCaseValue`): HTML entities are decoded (TipTap stores the document as HTML, so a typed `"Amigo & Alqush"` arrives as `"Amigo &amp; Alqush"`), non-breaking spaces and whitespace runs are folded, the result is trimmed and lower-cased. This is deliberate, not incidental precision: the author *retypes* the compared value by hand in the tag, and a switch that silently fails because they typed "praha" instead of "Praha" is a bug report, not a feature.

**The 1 MiB Firestore document ceiling is the practical limit on a `{{#case}}` image switch.** Both `PUT /api/dokumenty/:id` and `PUT /api/contractTemplates/:id` reject a template whose `htmlContent` would push the document over Firestore's per-document cap (1 MiB, with ~64 KB headroom reserved for the rest of the fields) before the write is attempted, and catch the same failure again around the actual write as a backstop. A template embeds images as base64 `data:` URIs, so a `{{#case}}` switch with one branch per city, each holding its own logo-sized image, hits this ceiling well before 30 branches — there is no per-branch or per-image cap on a `{{#case}}`-embedded image the way there is on an `image` slot's choices, only the one document-wide byte budget shared with the rest of the template's HTML. See `docs/business-rules.md` § Dokumenty for the user-facing framing of this limit, and for the `image` slot's own, smaller caps.

## Server validation — three copies, kept in lockstep

The engine's shape (`CustomVarType`, `CUSTOM_VAR_FORMULA_MAX`, `CUSTOM_VAR_DECIMALS_MAX`, `CUSTOM_VAR_MAX_OPTIONS`, `CUSTOM_VAR_MAX_IMAGES`, `CUSTOM_VAR_IMAGE_MAX_CHARS`, `CUSTOM_VAR_IMAGE_WIDTHS`, `CUSTOM_VAR_IMAGE_ALIGNS`, …) is hand-mirrored in **three** places:

1. `frontend/src/lib/contractVariables.ts` — the source of truth for the grammar and every UI-facing rule.
2. `functions/src/routes/dokumenty.ts` — `isValidVariableDefs` / `isValidCondition` / `isValidCustomFormula` / `isValidCustomOptions` / `isValidCustomDecimals` / `isValidCustomImages` / `isImageDataUri`, keyed to a 25-slot set.
3. `functions/src/routes/contractTemplates.ts` — the same set of validators, keyed to a 10-slot set (the one intended difference between the two backend copies).

`isValidCustomImages` rejects (rather than silently drops) an `images` entry with unknown keys or an out-of-range `width`/`align` value — a def the validator doesn't fully understand is a def the renderer has never been checked against, and silently persisting it would let the next reader assume it had been vetted. It also re-runs the server's own `isImageDataUri` on every `src` — this is deliberately **not** "the same check the client already does": the client's copy is an editor convenience, skippable by calling the endpoint directly, so the server copy is the one that actually gates what gets persisted and later rendered.

Cloud Functions cannot `import` from `frontend/src`, so the duplication is deliberate rather than an oversight — but **all three must change together**. Adding a slot type, widening a limit, or changing the formula-allowlist regex in the frontend engine without updating both server copies means the editor happily produces a definition the server then silently rejects on save (400, with a Czech message naming the exact constraint it failed).

## What differs per page

| | Dokumenty (25 slots) | Šablony smluv (10 slots) |
|---|---|---|
| Employee/company binding | none | `EmployeeData` / `CompanyData` |
| Default source (`CustomVarDef.default`) | `{ kind: "literal" }` only | `{ kind: "literal" }` or `{ kind: "fixedVar", key }` (a resolved built-in, e.g. `salary`) |
| `condition` operands | other custom slots only | `COMPARABLE_VARS` (built-ins) **and** other custom slots (v5.2.0) |
| `math` formula identifiers | custom slots only (anything else silently blanks the result — flagged by an explicit "unknown operand" warning) | custom slots **or** built-ins (e.g. `salary * 0,15`) |
| Config dialog | `DokumentyPage.tsx`'s own "Vlastní proměnné" modal | `ContractTemplatesPage.tsx`'s own "Vlastní proměnné" modal |
| `{{#case}}` authoring helper | "+ Přepínač…" in the variable panel | "⇄ Přepínač…" in the variable panel |

The two config dialogs are **not a shared component** — each page implements its own, and there is no plan to extract one (see [dokumenty.md](dokumenty.md#the-custom-variable-configuration-dialog-stays-unshared) for why). What they share is the underlying engine documented on this page: the type set, the validators, the formula grammar, and the fixpoint/condition/`{{#case}}` semantics are identical on both pages — only the operand catalogue (built-ins available or not) and the default-value source differ, both of which trace back to the same fact: Dokumenty binds no employee record. The `image` type is likewise identical on both pages, including its caps (`CUSTOM_VAR_MAX_IMAGES`, `CUSTOM_VAR_IMAGE_MAX_CHARS` are shared constants, not per-page); the one page-specific difference worth noting is that Šablony smluv additionally tracks and warns on a running image-byte total across the whole template (`IMAGE_TOTAL_WARN_CHARS`), where Dokumenty's editor shows the running kB total but no explicit warning threshold.

## Related files

- `frontend/src/lib/contractVariables.ts` — the engine: types, `CustomVarDef`, formula parser, condition evaluator, `resolveComputedVars`, `{{#case}}` block parser, `fillTemplate`, `image`-slot helpers (`isImageDataUri`, `renderCustomImage`, `findImageOption`).
- `frontend/src/lib/imageDownscale.ts` — reading a picked file into a base64 data URI and downscaling it through a canvas until it fits the per-picture character budget; shared by the `image` custom-variable type (and, not yet migrated, `FakturyPage.tsx`'s invoice logos).
- `frontend/src/lib/templatePreview.ts` — the Šablony smluv editor's in-editor/PDF preview, which exercises `math`/`condition`/`{{#case}}` with mock data (`buildPreview`, `usedConditionOperands`) — see [contracts.md](contracts.md).
- `functions/src/routes/dokumenty.ts` / `functions/src/routes/contractTemplates.ts` — the two server-side validator copies, including `isValidCustomImages` / `isImageDataUri`.
- `functions/src/services/pdfRenderer.ts` — the SSRF guard that forces images to be inlined as `data:` URIs, and the first-`<img>` logo-offset measurement that an `image` slot can be caught up in (see the landmine above).
- `frontend/src/pages/DokumentyPage.tsx` / `frontend/src/components/GenerateDocumentModal.tsx` — Dokumenty's config dialog and fill-in form.
- `frontend/src/pages/ContractTemplatesPage.tsx` / `frontend/src/components/GenerateContractModal.tsx` — Šablony smluv's config dialog and fill-in form.
- `frontend/src/components/BulkGenerateModal.tsx` — bulk standalone-document generation; resolves an `image` slot's choice the same way the single-document generate modals do.
