/**
 * Dokumenty section registry — backend mirror of frontend/src/lib/documentSections.ts.
 *
 * A document filed under a section is visible only to holders of that section's
 * key; a document with NO section is visible to anyone with `nav.dokumenty.view`.
 * A section narrows the audience, it never widens it.
 *
 * Sections are HARD-CODED rather than admin-created because permission keys must
 * exist in the static catalog: `sanitizePermissionList` filters every grant
 * through `ALL_SET` and drops unknown keys silently, so a runtime-created key
 * would look grantable in the matrix and never actually stick.
 *
 * Stems match services/hotels.ts, but the two registries are independent —
 * holding `recepce.amigo.view` grants nothing here.
 */

export const DOCUMENT_SECTION_IDS = ["ambiance", "superior", "amigo", "ankora"] as const;
export type DocumentSectionId = (typeof DOCUMENT_SECTION_IDS)[number];

export function isDocumentSectionId(value: unknown): value is DocumentSectionId {
  return typeof value === "string" && (DOCUMENT_SECTION_IDS as readonly string[]).includes(value);
}

/** `dokumenty.<id>.view` — required to see documents filed under this section. */
export function documentSectionViewPerm(id: DocumentSectionId): string {
  return `dokumenty.${id}.view`;
}

/**
 * Whether a permission set may see a document filed under `section`.
 *
 * `system.admin` is checked EXPLICITLY even though the resolver expands it to the
 * full static permission set (so an admin does hold every section key). Relying
 * on that expansion would couple this gate to the resolver's internals, and a
 * gate should not rest on a coincidence.
 *
 * `dokumenty.manage` short-circuits too: an editor who could not see a section
 * could neither fix nor delete what is filed there.
 */
export function maySeeDocumentSection(
  perms: ReadonlySet<string>,
  section: unknown
): boolean {
  if (perms.has("system.admin") || perms.has("dokumenty.manage")) return true;
  if (section === null || section === undefined || section === "") return true;
  // An unknown stored value is treated as RESTRICTED, not unfiled: if a section
  // is ever retired, its documents must not fall open to everyone.
  if (!isDocumentSectionId(section)) return false;
  return perms.has(documentSectionViewPerm(section));
}
