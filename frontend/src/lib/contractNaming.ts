import type { ContractType } from "./contractVariables";

/**
 * Subset of an employment row that the naming function needs. Kept
 * separate from EmploymentRow (defined in EmployeeDetailPage) to
 * avoid a circular import — naming logic lives in lib/, EmploymentRow
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
    case "úvazek":
      return "změna úvazku";
    case "délka smlouvy":
      // Value is "doba určitá" or "doba neurčitá" — use it directly.
      return change.value || "změna délky smlouvy";
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
 * through the download endpoint's Content-Disposition header — what
 * the user sees in their browser's "Save as…" dialog.
 *
 * Examples:
 *   nastup_hpp + row(2026-01-01) + "Klíma Richard"
 *     → "HPP 2026 Klíma Richard"
 *   ukonceni_hpp_ppp + row(contractType=HPP) + "Klíma Richard"
 *     → "Ukončení HPP Klíma Richard"
 *   zmena_smlouvy + row(changes=[{kind:"mzda"}], 2026-04-01) + "Klíma Richard"
 *     → "Dodatek navýšení 2026 Klíma Richard"
 *   multisport + "Klíma Richard"
 *     → "Multisport Klíma Richard"
 *
 * For "change-of-many" dodatek rows (multiple entries in row.changes)
 * the first change drives the label — keeping filenames short.
 */
export function buildContractName(
  type: ContractType,
  row: ContractNameRow | undefined,
  fullName: string
): string {
  const name = fullName.trim() || "neznámý zaměstnanec";

  switch (type) {
    case "nastup_hpp":
      return `HPP ${yearOf(row?.startDate)} ${name}`.replace(/\s+/g, " ").trim();
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
      const change = row?.changes?.[0];
      const label = change ? changeLabel(change) : "";
      const year = yearOf(row?.startDate);
      return `Dodatek ${label} ${year} ${name}`.replace(/\s+/g, " ").trim();
    }

    case "hmotna_odpovednost":
      return `Hmotná odpovědnost ${name}`;
    case "multisport":
      return `Multisport ${name}`;
  }
}
