import type { ContractType } from "./contractVariables";
import { UVAZEK_KIND, LEGACY_UVAZEK_KIND, LEGACY_HOURS_KIND } from "./changeKinds";

/**
 * Subset of an employment row that the naming function needs. Kept
 * separate from EmploymentRow (defined in EmployeeDetailPage) to
 * avoid a circular import – naming logic lives in lib/, EmploymentRow
 * is a UI-side type.
 */
export interface ContractNameRow {
  contractType?: string; // "HPP" / "PPP" / "DPP" (the row's classification)
  startDate?: string; // ISO YYYY-MM-DD
  changes?: Array<{ changeKind: string; value: string }>;
}

/**
 * Map a ChangeRow.changeKind (and value, when relevant) to the human
 * label used in dodatek filenames.
 */
function changeLabel(change: { changeKind: string; value: string }): string {
  switch (change.changeKind) {
    case "mzda":
      return "navýšení";
    case "pracovní pozice":
      return "změna pozice";
    case UVAZEK_KIND:
    case LEGACY_UVAZEK_KIND:
      return "změna úvazku";
    case "délka smlouvy":
      // The value is an ISO end date, never a label, so it must NOT be used
      // directly – that put a raw "2027-12-31" in the filename. A date means the
      // dodatek sets a fixed end (doba určitá); an empty value means it drops the
      // end date (doba neurčitá), the convention the edit form states outright
      // ("Prázdné datum = změna na dobu neurčitou").
      return change.value ? "doba určitá" : "doba neurčitá";
    case LEGACY_HOURS_KIND:
      return "změna úvazku";
    default:
      return change.changeKind || "změna";
  }
}

function yearOf(iso: string | undefined): string {
  if (!iso) return "";
  const parts = iso.split("-");
  return parts.length >= 1 ? parts[0] : "";
}

/**
 * Build the human-readable display name for a generated contract. The
 * name is stored on the contract doc at generation time and surfaces
 * through the download endpoint's Content-Disposition header – what
 * the user sees in their browser's "Save as…" dialog.
 *
 * Examples:
 *   nastup_hpp + row(2026-01-01) + "Klíma Richard"
 *     → "HPP 2026 Klíma Richard"
 *   ukonceni_hpp_ppp + row(contractType=HPP) + "Klíma Richard"
 *     → "Ukončení HPP Klíma Richard"
 *   zmena_smlouvy + row(changes=[{kind:"mzda"},{kind:"pracovní pozice"}], 2026-04-01) + "Klíma Richard"
 *     → "DODATEK2026 navýšení, změna pozice Klíma Richard"
 *   multisport + "Klíma Richard"
 *     → "Multisport Klíma Richard"
 *
 * Dodatek names list EVERY change's label (joined by ", ") after the
 * year-suffixed "DODATEK<YEAR>" prefix.
 */
export function buildContractName(
  type: ContractType,
  row: ContractNameRow | undefined,
  fullName: string,
  fallbackLabel?: string
): string {
  const name = fullName.trim() || "neznámý zaměstnanec";

  switch (type) {
    case "nastup_hpp": {
      // HPP *and* PPP nástup rows both generate from this one template now, so
      // the prefix must come from the ROW, not from the template id — otherwise
      // a PPP dohoda o pracovní činnosti is filed as "HPP 2026 …", which is
      // legally misleading and gets persisted as the contract's displayName.
      // Same pattern as ukonceni_hpp_ppp below.
      const subtype = row?.contractType || "HPP";
      return `${subtype} ${yearOf(row?.startDate)} ${name}`.replace(/\s+/g, " ").trim();
    }
    // Legacy only: rows generated before the two nástup templates were merged
    // stored type "nastup_ppp". Kept so regenerating/renaming one of those still
    // produces the same name it already has on file.
    case "nastup_ppp":
      return `PPP ${yearOf(row?.startDate)} ${name}`.replace(/\s+/g, " ").trim();
    case "nastup_dpp":
      return `DPP ${yearOf(row?.startDate)} ${name}`.replace(/\s+/g, " ").trim();

    case "ukonceni_hpp_ppp":
    case "ukonceni_zkusebni": {
      const subtype = row?.contractType || "HPP";
      return `Ukončení ${subtype} ${name}`;
    }
    case "ukonceni_dpp":
      return `Ukončení DPP ${name}`;

    case "zmena_smlouvy": {
      const year = yearOf(row?.startDate);
      const labels = (row?.changes ?? []).map(changeLabel).filter(Boolean).join(", ");
      return `DODATEK${year} ${labels} ${name}`.replace(/\s+/g, " ").trim();
    }

    case "hmotna_odpovednost":
      return `Hmotná odpovědnost ${name}`;
    case "multisport":
      return `Multisport ${name}`;

    default:
      // Custom standalone template – fall back to the user-supplied label
      // (the template's `name` field) or the slug id if none was passed.
      return `${fallbackLabel || type} ${name}`.replace(/\s+/g, " ").trim();
  }
}
