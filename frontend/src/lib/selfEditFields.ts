/**
 * Fields an employee may propose edits to on their own profile (Task 4).
 * MIRRORS the backend whitelist in
 * `functions/src/services/employeeChangeRequests.ts` (EDITABLE_FIELDS) — keep
 * the two in sync. The backend re-validates every submitted field, so this
 * list only drives which inputs the self-page renders.
 *
 * Employment/contract terms are intentionally absent — those flow through the
 * Nástup/Dodatek employment workflow, not self-service.
 */
export type SelfEditSection = "root" | "contact" | "documents" | "benefits";

export interface SelfEditField {
  key: string;
  section: SelfEditSection;
  label: string;
  sensitive: boolean;
  kind: "text" | "date";
}

export const SELF_EDIT_SECTION_LABELS: Record<SelfEditSection, string> = {
  root: "Osobní údaje",
  contact: "Kontakt",
  documents: "Doklady",
  benefits: "Pojištění a banka",
};

export const SELF_EDIT_FIELDS: SelfEditField[] = [
  // Osobní údaje
  { key: "birthSurname", section: "root", label: "Rodné příjmení", sensitive: false, kind: "text" },
  { key: "maritalStatus", section: "root", label: "Rodinný stav", sensitive: false, kind: "text" },
  { key: "education", section: "root", label: "Vzdělání", sensitive: false, kind: "text" },
  { key: "nationality", section: "root", label: "Státní příslušnost", sensitive: false, kind: "text" },
  { key: "placeOfBirth", section: "root", label: "Místo narození", sensitive: false, kind: "text" },
  { key: "birthNumber", section: "root", label: "Rodné číslo", sensitive: true, kind: "text" },
  // Kontakt
  { key: "phone", section: "contact", label: "Telefon", sensitive: false, kind: "text" },
  { key: "email", section: "contact", label: "E-mail", sensitive: false, kind: "text" },
  { key: "permanentAddress", section: "contact", label: "Trvalá adresa", sensitive: false, kind: "text" },
  { key: "contactAddress", section: "contact", label: "Kontaktní adresa", sensitive: false, kind: "text" },
  // Doklady
  { key: "idCardNumber", section: "documents", label: "Číslo OP", sensitive: true, kind: "text" },
  { key: "idCardExpiry", section: "documents", label: "Platnost OP", sensitive: true, kind: "date" },
  { key: "passportNumber", section: "documents", label: "Číslo pasu", sensitive: false, kind: "text" },
  { key: "passportIssueDate", section: "documents", label: "Datum vydání pasu", sensitive: false, kind: "date" },
  { key: "passportExpiry", section: "documents", label: "Platnost pasu", sensitive: false, kind: "date" },
  { key: "passportAuthority", section: "documents", label: "Úřad (pas)", sensitive: false, kind: "text" },
  { key: "visaNumber", section: "documents", label: "Číslo povolení k pobytu", sensitive: false, kind: "text" },
  { key: "visaType", section: "documents", label: "Typ víza", sensitive: false, kind: "text" },
  { key: "visaIssueDate", section: "documents", label: "Datum vydání víza", sensitive: false, kind: "date" },
  { key: "visaExpiry", section: "documents", label: "Platnost povolení k pobytu", sensitive: false, kind: "date" },
  // Pojištění a banka
  { key: "insuranceNumber", section: "benefits", label: "Číslo pojištěnce", sensitive: true, kind: "text" },
  { key: "insuranceCompany", section: "benefits", label: "Pojišťovna", sensitive: false, kind: "text" },
  { key: "bankAccount", section: "benefits", label: "Číslo bankovního účtu", sensitive: true, kind: "text" },
];

export const SELF_EDIT_SECTIONS: SelfEditSection[] = ["root", "contact", "documents", "benefits"];
