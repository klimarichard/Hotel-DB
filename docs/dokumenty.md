# Dokumenty

A second, standalone template editor beside **Šablony smluv** for documents that have nothing to do with a contract — protocols, checklists, anything printable. Introduced in **v4.15.0**. Route `/dokumenty`, backed by `documentTemplates/{id}` (`functions/src/routes/dokumenty.ts`).

An author writes the document in the same TipTap editor Šablony smluv uses and declares which of the ten `{{var1}}..{{var10}}` slots it uses (label, type, optional default). A viewer picks the document, fills the slots in a modal, and gets a PDF in a new tab. Nothing about the fill-in is stored anywhere.

## Deliberately not a contract

Dokumenty shares the editor and the PDF pipeline with Contracts, but the two are shaped very differently, and the gap is intentional rather than a gap to close later:

- **Custom variables only — no employee.** A document template has no bound employee/company record, so there is nothing for `VARIABLE_GROUPS` or `COMPARABLE_VARS` (`frontend/src/lib/contractVariables.ts`) to resolve against. The `"condition"` custom-var type — a slot computed by comparing two built-in employee/contract variables — is therefore meaningless here: the Dokumenty editor never offers it (`DOC_VAR_TYPES` in `DokumentyPage.tsx` omits `"condition"`), and `functions/src/routes/dokumenty.ts:80-85` refuses it server-side too, so a hand-crafted request can't sneak one in either. The same absence rules out a `fixedVar` default source (a default sourced from a resolved employee field) — every default a document stores is a `{kind:"literal"}`.
- **Nothing is persisted from a render.** `POST /api/dokumenty/render-pdf` streams a PDF straight back and writes no Storage blob, no Firestore record, no history, no audit entry — matching `POST /contracts/render-pdf`'s own render-only path. That is also why there is no `usage` endpoint (nothing downstream ever references a filled document to report on).
- **No built-ins to protect.** Every `documentTemplates/{id}` is user-created, so `DELETE /api/dokumenty/:id` is a plain hard delete — there is no seeded/system template to guard against deletion the way some contract templates are.

## Endpoints

All in `functions/src/routes/dokumenty.ts`, mounted at `/api/dokumenty` (`functions/src/index.ts:44,143`).

| Method & path | Permission | Notes |
|---|---|---|
| `POST /render-pdf` | `nav.dokumenty.view` | Registered before the `/:id` routes so the literal path always wins. Reuses `services/pdfRenderer.ts` — the same Puppeteer service `POST /contracts/render-pdf` uses, unchanged by this feature — but gated on `nav.dokumenty.view`, **not** `contracts.generate`: a Dokumenty viewer must not need any contracts permission to print. Body `{ html, margins? }`; returns `application/pdf`. No audit entry (nothing is stored). |
| `GET /` | `nav.dokumenty.view` | List without `htmlContent` (can approach 1 MB/doc). Filtered server-side by section — see below. |
| `POST /` | `dokumenty.manage` | Creates an empty template. Body `{ id, name, section? }`; `id` is a snake_case slug (`^[a-z][a-z0-9_]{1,39}$`), 409 if it already exists. |
| `POST /:id/duplicate` | `dokumenty.manage` | Copy an existing template under a new id. Body `{ id, name, section? }`; same slug validation and 409-on-collision as `POST /`. Copies `htmlContent`, `variableDefs` and `margins` from the source — see [Duplicating](#duplicating). |
| `GET /:id` | `nav.dokumenty.view` | Full template incl. `htmlContent`. Returns **404, not 403**, when the caller may not see the document's section — see below. |
| `PUT /:id` | `dokumenty.manage` | Upsert. Body `{ name, htmlContent, margins?, variableDefs?, section? }`. Re-extracts `variables` from the HTML server-side. |
| `PATCH /:id` | `dokumenty.manage` | `{ active: boolean }` — deactivate/reactivate. Absent `active` field = active; only an explicit `false` marks it inactive. Reversible. |
| `DELETE /:id` | `dokumenty.manage` | Hard delete. |

`PUT /api/auth/me/dokumenty-default` (in `functions/src/routes/auth.ts`) is the ninth Dokumenty-adjacent endpoint but lives on the auth router — see [Per-user default section](#per-user-default-section).

### Size guard on `PUT /:id`

Firestore caps a document at 1 MiB; `htmlContent` is by far the largest field and balloons when the editor inlines base64 images. `PUT /:id` rejects an oversized payload up front with a Czech 413 (`functions/src/routes/dokumenty.ts:356-366`) rather than letting a raw Firestore error surface, and catches the same failure again around the actual write in case something slips past the pre-check (`:394-407`). Same pattern as the contract-template editor.

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
- `section` — taken from the request body, not inherited. Duplicating is the moment
  the author decides who the copy is for; silently inheriting the source's audience
  is the kind of default that files a document into the wrong section unnoticed. The
  UI pre-fills the source's section as a visible, editable suggestion.

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
  section: "ambiance" | "superior" | "amigo" | "ankora" | null,
  htmlContent: string,
  variables: string[],              // {{varN}} keys found in htmlContent, server-derived
  variableDefs?: {                  // per-slot config, keyed "var1".."var10"
    [slot: string]: {
      label: string,                 // ≤60 chars
      type: "text" | "date" | "number" | "bool" | "list",
      default?: { kind: "literal", value: string },   // ≤200 chars; never "fixedVar" here
      options?: string[],            // "list" only, ≤30 entries, ≤100 chars each
      optional?: boolean,            // "Nepovinná" — absent = required
    }
  },
  margins: { top: number, bottom: number, left: number, right: number },  // mm, default 15 each
  active?: boolean,                  // absent = active
  createdAt, createdBy, updatedAt, updatedBy,
}
```

`section` is stored as `null` rather than being omitted on creation (`functions/src/routes/dokumenty.ts:261-263`) — "unfiled" is a real, explicit state, distinct from a doc that predates the `section` field ever existing.

## Sections

Four hard-coded values, mirroring the Recepce hotel stems but an **independent** registry — holding `recepce.amigo.view` grants nothing here, and vice versa:

| id | Label | View permission |
|---|---|---|
| `ambiance` | Ambiance | `dokumenty.ambiance.view` |
| `superior` | Superior | `dokumenty.superior.view` |
| `amigo` | Amigo & Alqush | `dokumenty.amigo.view` |
| `ankora` | Ankora | `dokumenty.ankora.view` |

Defined twice, deliberately kept in lockstep: `functions/src/services/documentSections.ts` (server) and `frontend/src/lib/documentSections.ts` (client, typed as `Permission` so a key missing from `catalog.ts` fails the build). A document filed under a section is visible only to holders of that section's key (plus the two short-circuits below); a document with **no** section is visible to anyone with `nav.dokumenty.view` — a section only ever narrows the audience.

**Why hard-coded and not admin-creatable**, unlike the fully configurable user-type/permission system elsewhere in the app: a section's audience gate *is* a permission key, and permission keys must exist in the static catalogue to be grantable. `sanitizePermissionList` filters every grant through the static `ALL_SET` and silently drops anything it doesn't recognise — a runtime-created key would show up as grantable in the matrix UI and simply never stick on save. Adding a fifth section is therefore a code change (new id in both `documentSections.ts` files, new key in both permission catalogues), not an admin action.

### Enforcement (`maySeeDocumentSection`, `functions/src/services/documentSections.ts`)

- `GET /` filters the list server-side, not just hidden in the UI — the list is the only place a document's existence is disclosed.
- `GET /:id` returns **404, not 403**, when the caller can't see the section (`functions/src/routes/dokumenty.ts:306-311`), so the status code itself never confirms that a restricted document exists.
- `dokumenty.manage` short-circuits to "sees everything": an editor who couldn't see a section could neither fix nor delete what's filed there.
- `system.admin` is checked **explicitly**, even though the permission resolver already expands `system.admin` to the full static permission set (so an admin implicitly holds every section key anyway). The explicit check exists so this gate doesn't rest on a coincidence of how the resolver happens to expand wildcards — a resolver change could otherwise silently reopen or close every section for admins.
- An **unknown stored `section` value is treated as RESTRICTED, not unfiled** (`isDocumentSectionId` fails → `maySeeDocumentSection` returns `false`). If a section is ever retired, its documents must not fall open to everyone just because the id no longer resolves.

## Per-user default section

`users/{uid}.dokumentyDefaultSection: DocumentSectionId | null`, set via `PUT /api/auth/me/dokumenty-default` (`functions/src/routes/auth.ts:905-920`) and read back on `GET /api/auth/me` (spread from the user doc, consumed by `useAuth`).

- **`requireAuth` only, no permission key** — same precedent as `theme` and `recepceDefaultHotel`: a user may only ever set their *own* default, so there is nothing to gate beyond being logged in.
- The endpoint still rejects a section the caller cannot currently see (`maySeeDocumentSection` check before the write), keeping the stored value honest; if a later permission revoke strands the default, the read path re-checks live permissions on every render, so it simply stops applying rather than erroring.
- **It is a sort order, never an access grant.** `sortedDocs` in `DokumentyPage.tsx` (`:515-526`) splits the active-document list into a `preferred` group (the default section's documents) shown first, then the rest after a divider — nothing more. Picking a default cannot surface a document the section gate would otherwise hide.
- Not audit-logged, matching `theme`/`recepce-default`: a personal view preference, not a change to business data.
- Only offered in the UI when there's more than one visible section to choose between (`visibleSections.length > 1`) — with one section or none, a default would reorder nothing.

### ⚠️ Landmine: read straight from `useAuth`, never mirrored via `useEffect`

`DokumentyPage.tsx:190-206` reads `dokumentyDefaultSection` directly off `useAuth()` into a local `pendingDefault` override, explicitly **not** via `useEffect(() => setState(authValue), [authValue])`. The code comment spells out why: an effect runs *after* the render that would consume it, so the very first render once `authLoading` clears would sort with a `null` default and only settle a frame later — invisible on a fresh browser (nothing to sort yet) but visibly wrong for every returning user with a saved default. This is the same trap already documented for the Recepce default hotel; Dokumenty repeats the same fix rather than the same bug.

## The `"list"` / "Seznam" custom-variable type

Added to the **shared** custom-variable engine in `frontend/src/lib/contractVariables.ts`, so it exists in both Šablony smluv and Dokumenty simultaneously — it is not Dokumenty-specific, it just shipped alongside this feature.

- `CustomVarDef.options?: string[]` — the dropdown's choices, in author-entered order, **stored as the display strings themselves** (no separate code/label pair, since the picked value is substituted verbatim). Capped at `CUSTOM_VAR_MAX_OPTIONS = 30` entries, ≤100 chars each — validated both client-side (`renderOptionsEditor`) and server-side (`isValidCustomOptions`, `functions/src/routes/dokumenty.ts:130-137`).
- Behaves like `"text"` for required/optional purposes: required until a choice is picked, released the same way by "Nepovinná" (`optional: true`).
- A list slot's **default must be one of its own choices** — `renderLiteralDefault` renders a `<select>` over `options`, not a free-text box, for a list-typed default, so the stored default can never hold a value the dropdown doesn't offer. Because of this, "Z proměnné" (a `fixedVar` default) was never applicable to list slots anyway — Dokumenty has no fixed variables at all, so the point is moot here, but it holds in Šablony smluv too.
- **Optionless list is accepted on purpose.** The server's `isValidCustomOptions` allows `options: []` / absent — rejecting it mid-configuration would punish an author for picking the type before typing the first value. The generate form (`GenerateDocumentModal.tsx:172-190`) degrades an empty-options list slot to a plain free-text input rather than an unfillable empty `<select>`, so the document stays producible. Because that degradation is invisible to whoever is editing the template, `customVarWarning()` (`DokumentyPage.tsx:118-132`) flags it explicitly as "Bez možností: … – seznam nemá žádné hodnoty."

## `lib/editor/extensions.ts`

`frontend/src/lib/editor/extensions.ts` is the set of TipTap extensions (`Table` with the `borderless` attribute, `ResizableImage`, `ListItemIndent`, `NbspKeybind`, `LineHeight`, `PageBreak`, `PasteCleanup`, `SearchHighlight`, `ListItemStyle`, `FontSize`, `TabParagraph`, …) extracted **verbatim** out of `ContractTemplatesPage.tsx` when Dokumenty needed a second editor of the same kind (`ContractTemplatesPage.tsx` dropped from roughly 2483 to 2081 lines; the module itself is ~414 lines). Both pages still each run their own `useEditor(...)` call with their own extension list and their own toolbar — only the extension *definitions* are shared, because that's the part that's genuinely identical, and the part where a fix landing on one page but not the other would silently diverge the two editors' output HTML (and therefore their PDFs, since `pdfRenderer.ts`'s CSS has to match both).

The module also exports **`STARTER_KIT_OPTIONS`**, which both pages pass to `StarterKit.configure(...)` for exactly that reason. Two settings live there:

- `paragraph: false` — replaced by `TabParagraph`.
- `link: { autolink: false, linkOnPaste: false, openOnClick: false }` — **StarterKit v3 bundles the Link extension**, whose defaults hyperlink anything URL- or e-mail-shaped on their own (while typing, and when pasting over a selection). Neither editor has a link button, so such a link could never be removed again. ⚠️ The extension is deliberately **not** disabled with `link: false`: ProseMirror silently drops marks missing from the schema, so that would make every `<a>` in an already-saved template or document vanish on load — rewriting stored content to fix a typing annoyance. Keeping the mark and disabling only its automatic creation leaves existing documents byte-identical. Note this is preventative only: links created before v5.0.4 are still in those documents, and there is still no UI to remove one.

**The custom-variable *configuration dialog* was deliberately not extracted**, even though it looks like an obvious second candidate. Roughly a third of that dialog in `ContractTemplatesPage.tsx` is the `"condition"` slot's comparison builder plus the `fixedVar` default-source picker — both built directly on employee-coupled catalogues (`COMPARABLE_VARS`, the fixed-variable list) that Dokumenty has none of. Sharing it would mean parameterising the dialog across three independent axes (available types, available comparison operands, available default sources) for a component that would then be more complex than either of the two call sites it replaces. The two editors share a *shape* (a table of slot → label/type/default/optional), not code — `DokumentyPage.tsx` implements its own smaller dialog restricted to `DOC_VAR_TYPES = ["text","date","number","bool","list"]`.

## Related files

- `functions/src/routes/dokumenty.ts` — REST endpoints, validation, audit-log calls (`logCreate`/`logUpdate`/`logDelete` on every write except the render).
- `functions/src/services/documentSections.ts` / `frontend/src/lib/documentSections.ts` — the section registry, kept in lockstep on both sides.
- `functions/src/services/pdfRenderer.ts` — unchanged, shared Puppeteer renderer (also used by Contracts).
- `functions/src/routes/auth.ts` — `PUT /me/dokumenty-default`, and `GET /me` returning `dokumentyDefaultSection`.
- `frontend/src/pages/DokumentyPage.tsx` / `.module.css` — the editor + list page.
- `frontend/src/components/GenerateDocumentModal.tsx` / `.module.css` — the fill-in-and-print modal.
- `frontend/src/lib/editor/extensions.ts` — shared TipTap extensions (also used by `ContractTemplatesPage.tsx`).
- `frontend/src/lib/contractVariables.ts` — the shared custom-variable engine, incl. the `"list"` type.
- `frontend/src/lib/menuItems.ts` (`id: "dokumenty"`, `hideOnMobile: true`) and `functions/src/routes/menuOrder.ts` (`VALID_IDS` already includes `"dokumenty"`).
- `frontend/src/App.tsx` — `<Route path="dokumenty">` wrapped in `RequirePermission allow={["nav.dokumenty.view"]}`.

## Permissions summary

| Key | Meaning |
|---|---|
| `nav.dokumenty.view` | the page, the document list, reading a template, and rendering a PDF |
| `dokumenty.manage` | create/edit/deactivate/delete a template; also short-circuits every section gate |
| `dokumenty.ambiance.view` | see documents filed under Ambiance |
| `dokumenty.superior.view` | see documents filed under Superior |
| `dokumenty.amigo.view` | see documents filed under Amigo & Alqush |
| `dokumenty.ankora.view` | see documents filed under Ankora |

Own **Dokumenty** section in the permission matrix, registered in both `frontend/src/lib/permissions/catalog.ts` and `functions/src/auth/permissions.ts`. Not granted to any built-in user type by default — `admin` reaches everything via the `system.admin` wildcard (and the explicit check in `maySeeDocumentSection`); everyone else needs an explicit grant, same posture as Recepce and Tabulky.
