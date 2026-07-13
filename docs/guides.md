# Guides (Návody)

Reference-material feature for staff: uploaded PDF tutorials and links to external resources (Google Drive folders, videos, …), grouped into named categories. Route `/navody`, page component `frontend/src/pages/GuidesPage.tsx`, backend router `functions/src/routes/guides.ts` (mounted at `/guides` in `functions/src/index.ts`, so the public path is `/api/guides`).

## Data model

Two top-level Firestore collections, no sub-collections:

```
guideCategories/{id} = {
  name: string,
  order: number,           // display order within the page
  createdAt, createdBy,
  updatedAt?, updatedBy?,
}

guides/{id} = {
  title: string,
  description: string,     // "" when omitted, never undefined
  categoryId: string,      // guideCategories/{id}
  kind: "pdf" | "link",    // fixed for the life of the doc — never changes on edit
  order: number,           // display order within its category
  createdAt, createdBy,
  updatedAt?, updatedBy?,

  // kind === "link"
  url: string,             // http(s) only, validated server-side

  // kind === "pdf"
  storagePath: string,     // "guides/{id}.pdf"
  contentType: "application/pdf",
  fileName: string,        // original upload filename, display-only
}
```

`GET /api/guides` returns `{ categories, guides }` in one call, both already sorted by `order` — the whole page loads from a single request. The PDF bytes are never included; the viewer fetches them separately only when a PDF guide is opened.

## Storage

PDFs live in Firebase Storage at `guides/{guideId}.pdf` — one blob per guide, named by the guide's own Firestore id (so `PUT` replacing a file reuses the same path instead of orphaning the old blob). `storage.rules` denies **all** direct client read/write (`allow read, write: if false` on `/{allPaths=**}`), matching the rest of the app — every guide upload and download goes through a Cloud Function using the Admin SDK.

## Upload transport and the 7 MB ceiling

There is no multipart upload endpoint. The client reads the chosen `File` into a base64 string (`frontend/src/lib/blobToBase64.ts` — chunked over a `Uint8Array` to avoid the `String.fromCharCode(...bytes)` call-stack overflow on multi-MB files) and sends it as a JSON field (`pdfBase64`) on `POST /guides` or `PUT /guides/:id`.

`express.json()` is configured with `limit: "10mb"` (`functions/src/index.ts`) for the whole app, and base64 inflates the raw byte count by ~33%. A 7 MB PDF becomes ~9.3 MB of JSON — just inside that ceiling; anything bigger would either blow the body-parser limit (an opaque 413 with no useful message) or get uncomfortably close to it. `guides.ts` therefore enforces its own `MAX_PDF_BYTES = 7 * 1024 * 1024` **before** touching Storage, decoding the base64 back to a `Buffer` and rejecting oversized files with a readable `413 { error: "Soubor je příliš velký (max 7 MB)." }`. `GuidesPage.tsx` mirrors the same constant client-side so the common case never round-trips a doomed upload.

If the raw-PDF ceiling ever needs to change, `express.json`'s limit and `MAX_PDF_BYTES` must be moved together — raising one without the other either wastes body-parser headroom or reintroduces the opaque 413.

## Viewing a PDF — why fetch→blob→iframe, not a direct `<iframe src>`

`GET /api/guides/:id/file` streams the PDF back (`Content-Type: application/pdf`, `Content-Disposition: inline` with the same UTF-8/ASCII-fallback filename convention as employee documents) but is gated by `requireAuth`, i.e. it needs an `Authorization: Bearer <idToken>` header. An `<iframe>` cannot send custom headers, so it can't point directly at the endpoint.

`GuideViewerModal.tsx` instead: gets the current user's ID token, `fetch()`s the endpoint with the header, reads the response as a `Blob`, wraps it in `URL.createObjectURL(blob)`, and sets that object URL as the `<iframe src>` — handing rendering to the browser's built-in PDF viewer (zoom, page nav, print) for free. The object URL is revoked on unmount/guide-change to release the in-memory blob.

**Phones don't get the iframe.** Mobile Safari/Chrome render an embedded PDF as a blank box or a one-page thumbnail rather than a real viewer, so `useIsPhone()` switches the modal to a fallback: a message plus an "Otevřít návod" button that opens the same blob URL in a new tab (`window.open`), where the OS's native PDF handling takes over. Desktop always gets the inline iframe plus explicit "Stáhnout" / "Otevřít v novém okně" buttons in the footer.

The modal closes only via its buttons (✕ / Zavřít) — never on backdrop click, per the project-wide modal rule.

## Link guides — why only http(s)

A `kind: "link"` guide's `url` is rendered as `window.open(guide.url, ...)` from a plain click handler. `isSafeHttpUrl()` in `guides.ts` parses the value with `new URL(...)` and requires `protocol === "http:" || "https:"`, on both create and update. This blocks a stored `javascript:` (or other non-http scheme) URL from ever becoming a client-side XSS vector — the check exists purely because the value is persisted and later re-rendered as a navigable link, not because the input form does anything unusual.

## Categories

- `POST /guides/categories` — appends to the end (`order` = current max + 1).
- `PUT /guides/categories/:id` — rename only.
- `PUT /guides/categories/order` — bulk reorder via `{ orderedIds: string[] }`.
- `DELETE /guides/categories/:id` — **refused with `409`** while the category still contains any guide (`Kategorie obsahuje návody. Nejprve je přesuňte do jiné kategorie nebo smažte.`). Guides are grouped strictly by `categoryId` with no "uncategorized" bucket in the UI, so a silent delete would orphan them off the page entirely; the admin must move or delete the guides first.

## Guides — create/edit/delete/reorder

- `POST /guides` — body `{ title, description?, categoryId, kind, url? (kind=link), pdfBase64? + fileName? (kind=pdf) }`. `order` is computed server-side (append to the end of the target category).
- `PUT /guides/:id` — edits metadata; `kind` can never change (a guide is either always a PDF or always a link). For a PDF guide, `pdfBase64` is optional — omitting it keeps the existing file; supplying it re-uploads to the **same** `storagePath`, so no blob is orphaned. Moving `categoryId` re-appends the guide to the end of the new category (`order` recomputed).
- `PUT /guides/order` — bulk reorder within a category via `{ orderedIds: string[] }`. `GuidesPage.tsx` calls this from the ↑/↓ row buttons with an optimistic local reorder, rolling back (`load()`) on failure.
- `DELETE /guides/:id` — best-effort deletes the Storage blob first (a missing/already-gone file does not block the Firestore delete), then removes the doc.

All writes are audit-logged (`logCreate`/`logUpdate`/`logDelete`, category `navody` — see below); reads are not.

## Permissions

Two keys, catalog group **"Návody"**:

| Key | Label | Granted to (built-in types) |
|---|---|---|
| `nav.guides.view` | Zobrazit Návody | every built-in type (in `BASE_SELF`) — guides are reference material for everyone |
| `guides.manage` | Spravovat návody | `director`; `admin` via `system.admin` expansion |

`nav.guides.view` gates the page/menu item **and** every read endpoint (`GET /guides`, `GET /guides/:id/file`) — there is no separate `guides.view`. `guides.manage` gates every write endpoint (categories + guides, including reorder). `manager`/`employee`/`accountant` can see and open guides but not manage them; nothing needs an explicit grant to view guides on a fresh environment.

See [Authentication, Roles & Permissions](auth-and-permissions.md) for the general permission model, and `PERMISSIONS_LIST.md` for the flat catalog notation.

> **Deploy note — additive backfill only.** `nav.guides.view` and `guides.manage` are new catalog keys. Existing `roleTypes/*` docs in Firestore predate them, so their `permissions` arrays won't contain either key until an admin adds them in-app (Nastavení → Uživatelské typy) — the built-in `BUILTIN_TYPE_PERMISSIONS` defaults only apply when a type falls back to the built-in default (no Firestore doc, or the resolver's anti-lockout fallback). **Do not re-run a role-type seed script to fix this** — it overwrites each type's whole `permissions` array from the built-in defaults, discarding any in-app customisation. Custom (non-built-in) user types need both keys granted explicitly if their holders should read/manage guides.

## Menu & routing

- `frontend/src/lib/menuItems.ts` — `{ id: "navody", label: "Návody", path: "/navody", permission: "nav.guides.view" }`.
- `functions/src/routes/menuOrder.ts` — `VALID_IDS` includes `"navody"` (backend order-validation mirror; visibility itself is enforced by the sidebar, not here — see [Authentication, Roles & Permissions → Per-type menu order](auth-and-permissions.md#per-type-menu-order)).
- Route `/navody` in `App.tsx` wraps `GuidesPage` in `<RequirePermission allow={["nav.guides.view"]}>` (owned by the onboarding-tour work; not detailed further here).

## Audit log

`guides` and `guideCategories` both map to audit category `navody` (`COLLECTION_CATEGORY` in `functions/src/services/auditLog.ts`; Czech label `"Návody"` in `frontend/src/lib/audit/labels.ts`), so every create/update/delete on either collection shows up under the **Návody** page filter in `/audit`. There is no `reveal`/`export` surface here — guides carry no sensitive fields.
