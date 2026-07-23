import type { Permission } from "@/lib/permissions/catalog";

/**
 * Dokumenty section registry – the fixed set of sections a document may belong
 * to, and the permission that gates seeing the documents in it.
 *
 * Sections are deliberately HARD-CODED rather than admin-created. A section
 * carries its own permission key, and keys have to exist statically: the backend
 * sanitiser (`sanitizePermissionList`) filters every grant through the static
 * catalog and drops anything it doesn't recognise, silently. A runtime-created
 * key would therefore look grantable in the matrix and never actually stick.
 *
 * Stems match the Recepce hotel registry (`lib/hotels.ts`) on purpose – same four
 * properties, same key shape `<area>.<stem>.view` – but the two are independent:
 * holding `recepce.amigo.view` grants nothing here, and vice versa.
 *
 * A document with NO section is visible to anyone holding `nav.dokumenty.view`.
 * That is the default and the common case; a section narrows the audience, it
 * never widens it.
 */

export const DOCUMENT_SECTION_IDS = ["ambiance", "superior", "amigo", "ankora", "temp"] as const;
export type DocumentSectionId = (typeof DOCUMENT_SECTION_IDS)[number];

export interface DocumentSection {
  readonly id: DocumentSectionId;
  readonly label: string;
  /**
   * `dokumenty.<id>.view` – gates seeing documents filed under this section.
   *
   * The client reads this only to decide which sections to OFFER in the
   * "Výchozí sekce" picker. It is never the access gate: the server filters the
   * list and gates the read, so nothing here can widen what a user sees.
   *
   * Typing it as `Permission` also makes this file cross-check `catalog.ts` at
   * compile time – a section whose key is missing or misspelled there fails the
   * build rather than silently gating on a key nobody can ever hold.
   */
  readonly viewPerm: Permission;
}

export const DOCUMENT_SECTIONS: readonly DocumentSection[] = [
  { id: "ambiance", label: "Ambiance", viewPerm: "dokumenty.ambiance.view" },
  { id: "superior", label: "Superior", viewPerm: "dokumenty.superior.view" },
  { id: "amigo", label: "Amigo & Alqush", viewPerm: "dokumenty.amigo.view" },
  { id: "ankora", label: "Ankora", viewPerm: "dokumenty.ankora.view" },
  // Not a hotel: a workspace for drafting documents and trying features out,
  // kept out of everyone else's list. It is an ordinary section in every other
  // respect — `dokumenty.manage` and `system.admin` still see into it, as they
  // do for the four above.
  { id: "temp", label: "TEMP", viewPerm: "dokumenty.temp.view" },
];

/** Display label for a stored section value; null/unknown reads as "no section". */
export function documentSectionLabel(id: string | null | undefined): string | null {
  if (!id) return null;
  return DOCUMENT_SECTIONS.find((s) => s.id === id)?.label ?? null;
}
