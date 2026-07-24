# Custom Variable Engine (`{{var1}}`..`{{var25}}`)

The engine behind the free `{{varN}}` slots that **Šablony smluv** (`contractTemplates/{id}`, see [contracts.md](contracts.md)) and **Dokumenty** (`documentTemplates/{id}`, see [dokumenty.md](dokumenty.md)) both let an author bolt onto a template for values the rest of the data model has no field for — a penalty amount, a training date, a one-off clause. It lives in one file, `frontend/src/lib/contractVariables.ts`, and is mirrored (not imported — Cloud Functions cannot `import` from `frontend/src`) by two server-side validator copies, one per route file. This page documents the mechanics that are identical on both pages; the two page docs cover only what differs.

Widened substantially in **v5.2.0**: two new slot types (`longtext`, `math`), a `{{#case}}` switch block, conditions that can compare custom slots against each other (not just built-ins), and — on Dokumenty only — a much larger slot count. Everything below is the v5.2.0 shape unless marked otherwise.

## Why not `#var1`

The substitution regex is `\{\{(\w+)\}\}` and a leading `#` is reserved for a block opener (`{{#if x}}`, `{{#case x = v}}`). A slot literally named `#var1` would match none of the regexes used by `fillTemplate`, `getMissingVariables`, `usedCustomVars`, or the backend's `extractVariables` — it would be silently ignored end-to-end and print raw `{{#var1}}` text into the finished PDF. The plain-word form (`var1`, not `#var1`) is load-bearing, not a style choice — this is the single most important gotcha for anyone touching this code.

## Two slot counts, deliberately

- **`CUSTOM_VAR_MAX = 25`** — the engine's *recognition* ceiling: how far `isCustomVarKey` / `usedCustomVars` / `CUSTOM_VAR_KEYS` will recognise a slot at all, on either page.
- **`DOCUMENT_VAR_COUNT = 25`** and **`CONTRACT_VAR_COUNT = 10`** — how many slots each *page* offers in its picker and accepts server-side. One number until v5.2.0, when Dokumenty needed 25 while Šablony smluv stayed at 10 — a contract template is a signed legal document, and widening its slot space buys nothing there.

Recognition is shared at the higher ceiling rather than split per-page: a stray `{{var15}}` typed (or pasted from a Dokumenty template) into a contract can then be *seen* by the editor — it surfaces as an unnamed slot and a "Mimo rozsah" warning — instead of being silently printed as literal braces into a signed PDF. The contracts server validator still refuses to persist a `variableDefs` entry beyond `var10` (`isValidVariableDefs` in `functions/src/routes/contractTemplates.ts` checks membership in a 10-key set), so the gate holds where it matters; the picker just can't offer what it can't save.

`customVarKeys(count)` (`contractVariables.ts`) returns the first `count` of `CUSTOM_VAR_KEYS` — what a page's config panel and generate form actually list.

## The eight slot types

| Type | "Typ" label | Typed in at generation? | Notes |
|---|---|---|---|
| `text` | Text | yes | Passed through **unformatted, unescaped** — deliberately: production templates already rely on passing small HTML fragments through a plain `{{var1}}`, and silently escaping those would change what an already-signed contract renders. |
| `longtext` | Dlouhý text | yes (textarea) | The **only** slot type whose value is HTML-escaped. `\n` → `<br>` so multi-paragraph prose doesn't collapse to one run-on line inside the `<p>` the placeholder sits in (real `</p><p>` would nest block elements and lose the surrounding paragraph's styling). A blank line therefore prints as two `<br>` — a visible paragraph gap. |
| `date` | Datum | yes (`<input type="date">`) | `formatDateCZ` splits the ISO string rather than parsing a `Date` — no UTC-offset day-shift. |
| `number` | Číslo | yes | `Intl.NumberFormat("cs-CZ")` — Czech thousands grouping, same convention as every other numeric value in the app. |
| `bool` | Ano/Ne | yes (checkbox) | Resolves to `"ano"` / `""`, **not** `"ano"`/`"ne"` — matches the built-in `kind: "if"` permanent variables, where empty is what makes `{{#if var1}}` strip its block. Never "missing" — unchecked is a legitimate answer, not an omission. |
| `list` | Seznam | yes (`<select>`) | `CustomVarDef.options?: string[]` — up to `CUSTOM_VAR_MAX_OPTIONS = 30` choices, ≤100 chars each, stored as the **display strings themselves** (no code/label split — the picked value is substituted verbatim). An **optionless list is valid** (the author picks the type before typing values); the generate form degrades it to a free-text input rather than an unfillable empty dropdown, and the editor's `customVarWarning()` flags the omission instead. A list slot's default must be one of its own choices, so `"fixedVar"` ("Z proměnné") is not offered as a default source for it. |
| `condition` | Podmínka | **no — computed** | See "Condition slots" below. |
| `math` | Výpočet | **no — computed** | See "Math slots" below. |

`CUSTOM_VAR_TYPE_LABELS` (`contractVariables.ts`) is the canonical label map; both pages' type `<select>` iterate its keys, so a page's editor never lists a type the engine doesn't know about (in practice both pages currently offer all eight — see the per-page table at the bottom).

`COMPUTED_VAR_TYPES = ["condition", "math"]` / `isComputedVarType(type)` marks the two slot kinds above that never get a form field: their value is derived from other slots, so they can never be "missing" (`missingCustomVars` excludes them) and "Nepovinná" ("optional") is meaningless for them — the config UI shows a `–` instead of a checkbox for either.

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

`{{#case var1 = Praha}}…{{/case}}` (and `!=`) is how a template expresses "print different content — including a different image — depending on a value"; wrapping an `<img>` in a `{{#case}}` block per value is the supported way to show a different picture per answer. Grammar: `{{#case KEY OP VALUE}}…{{/case}}`, where `VALUE` is everything up to the closing `}}` (so it may contain spaces — a switch matches list choices, which are human labels — but not a literal `}`, which is the only way to find the tag's end without a real lexer).

**Matching is on raw values, normalised, never on the formatted display string.** A number prints with thousands separators ("1 500") that its raw form doesn't have ("1500"), so matching printed strings would make a numeric switch fail invisibly. `fillTemplate(html, vars, rawVars)` takes an optional third argument specifically for this; `renderBlocks` falls back to the formatted `vars` map only when a key is **absent** from `rawVars` (not when it is `null` or `""`, which are real answers a computed slot can legitimately produce) — this is what lets `{{#case firstName = Jana}}` still work against a purely-raw map that has no entry for a built-in.

Values are normalised before comparing (`normaliseCaseValue`): HTML entities are decoded (TipTap stores the document as HTML, so a typed `"Amigo & Alqush"` arrives as `"Amigo &amp; Alqush"`), non-breaking spaces and whitespace runs are folded, the result is trimmed and lower-cased. This is deliberate, not incidental precision: the author *retypes* the compared value by hand in the tag, and a switch that silently fails because they typed "praha" instead of "Praha" is a bug report, not a feature.

**The 1 MiB Firestore document ceiling is the practical limit on a `{{#case}}` image switch.** Both `PUT /api/dokumenty/:id` and `PUT /api/contractTemplates/:id` reject a template whose `htmlContent` would push the document over Firestore's per-document cap (1 MiB, with ~64 KB headroom reserved for the rest of the fields) before the write is attempted, and catch the same failure again around the actual write as a backstop. A template embeds images as base64 `data:` URIs, so a `{{#case}}` switch with one branch per city, each holding its own logo-sized image, hits this ceiling well before 30 branches — there is no per-branch or per-image cap, only the one document-wide byte budget shared with the rest of the template's HTML. See `docs/business-rules.md` § Dokumenty / Šablony smluv for the user-facing framing of this limit.

## Server validation — three copies, kept in lockstep

The engine's shape (`CustomVarType`, `CUSTOM_VAR_FORMULA_MAX`, `CUSTOM_VAR_DECIMALS_MAX`, `CUSTOM_VAR_MAX_OPTIONS`, …) is hand-mirrored in **three** places:

1. `frontend/src/lib/contractVariables.ts` — the source of truth for the grammar and every UI-facing rule.
2. `functions/src/routes/dokumenty.ts` — `isValidVariableDefs` / `isValidCondition` / `isValidCustomFormula` / `isValidCustomOptions` / `isValidCustomDecimals`, keyed to a 25-slot set.
3. `functions/src/routes/contractTemplates.ts` — the same set of validators, keyed to a 10-slot set (the one intended difference between the two backend copies).

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

The two config dialogs are **not a shared component** — each page implements its own, and there is no plan to extract one (see [dokumenty.md](dokumenty.md#the-custom-variable-configuration-dialog-stays-unshared) for why). What they share is the underlying engine documented on this page: the type set, the validators, the formula grammar, and the fixpoint/condition/`{{#case}}` semantics are identical on both pages as of v5.2.0 — only the operand catalogue (built-ins available or not) and the default-value source differ, both of which trace back to the same fact: Dokumenty binds no employee record.

## Related files

- `frontend/src/lib/contractVariables.ts` — the engine: types, `CustomVarDef`, formula parser, condition evaluator, `resolveComputedVars`, `{{#case}}` block parser, `fillTemplate`.
- `frontend/src/lib/templatePreview.ts` — the Šablony smluv editor's in-editor/PDF preview, which exercises `math`/`condition`/`{{#case}}` with mock data (`buildPreview`, `usedConditionOperands`) — see [contracts.md](contracts.md).
- `functions/src/routes/dokumenty.ts` / `functions/src/routes/contractTemplates.ts` — the two server-side validator copies.
- `frontend/src/pages/DokumentyPage.tsx` / `frontend/src/components/GenerateDocumentModal.tsx` — Dokumenty's config dialog and fill-in form.
- `frontend/src/pages/ContractTemplatesPage.tsx` / `frontend/src/components/GenerateContractModal.tsx` — Šablony smluv's config dialog and fill-in form.
