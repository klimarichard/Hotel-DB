export type ContractType =
  | "nastup_hpp"
  | "nastup_ppp"
  | "nastup_dpp"
  | "ukonceni_hpp_ppp"
  | "ukonceni_dpp"
  | "ukonceni_zkusebni"
  | "zmena_smlouvy"
  | "hmotna_odpovednost"
  | "multisport";

export const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  nastup_hpp: "Nástup HPP",
  nastup_ppp: "Nástup PPP",
  nastup_dpp: "Nástup DPP",
  ukonceni_hpp_ppp: "Ukončení HPP/PPP",
  ukonceni_dpp: "Ukončení DPP",
  ukonceni_zkusebni: "Ukončení ve zkušební době",
  zmena_smlouvy: "Změna smlouvy (dodatek)",
  hmotna_odpovednost: "Hmotná odpovědnost",
  multisport: "Multisport",
};

/** Contract types that are triggered by a history row */
export const HISTORY_TIED_TYPES: ContractType[] = [
  "nastup_hpp",
  "nastup_ppp",
  "nastup_dpp",
  "ukonceni_hpp_ppp",
  "ukonceni_dpp",
  "ukonceni_zkusebni",
  "zmena_smlouvy",
];

/** Contract types generated independently of a history row */
export const STANDALONE_TYPES: ContractType[] = [
  "hmotna_odpovednost",
  "multisport",
];

/** Which history changeType maps to which contract type(s) */
export const CHANGE_TYPE_TO_CONTRACTS: Record<string, ContractType[]> = {
  nástup: ["nastup_hpp", "nastup_ppp", "nastup_dpp"],
  ukončení: ["ukonceni_hpp_ppp", "ukonceni_dpp", "ukonceni_zkusebni"],
  "změna smlouvy": ["zmena_smlouvy"],
};

/** All available template variables with human-readable labels grouped by source */
export const VARIABLE_GROUPS: { group: string; vars: { key: string; label: string }[] }[] = [
  {
    group: "Zaměstnanec",
    vars: [
      { key: "firstName", label: "Jméno" },
      { key: "lastName", label: "Příjmení" },
      { key: "fullName", label: "Celé jméno" },
      { key: "birthDate", label: "Datum narození" },
      { key: "birthNumber", label: "Rodné číslo" },
      { key: "idCardNumber", label: "Číslo OP" },
      { key: "passportNumber", label: "Číslo pasu" },
      { key: "visaNumber", label: "Číslo povolení k pobytu" },
      { key: "currentJobTitle", label: "Pracovní pozice" },
      { key: "currentDepartment", label: "Oddělení" },
    ],
  },
  {
    group: "Adresa",
    vars: [
      { key: "address", label: "Ulice a číslo" },
      { key: "city", label: "Město" },
      { key: "zip", label: "PSČ" },
    ],
  },
  {
    group: "Pracovní podmínky",
    vars: [
      { key: "contractType", label: "Typ smlouvy" },
      { key: "salary", label: "Plat" },
      { key: "startDate", label: "Datum nástupu" },
      { key: "endDate", label: "Datum ukončení" },
    ],
  },
  {
    group: "Společnost",
    vars: [
      { key: "companyName", label: "Název firmy" },
      { key: "companyAddress", label: "Adresa firmy" },
      { key: "ic", label: "IČO" },
      { key: "dic", label: "DIČ" },
      { key: "companyFileNo", label: "Spisová značka" },
    ],
  },
  {
    group: "Podepisující",
    vars: [
      { key: "signatoryName", label: "Jméno podepisujícího" },
      { key: "signatoryTitle", label: "Funkce podepisujícího" },
    ],
  },
  {
    group: "Dokument",
    vars: [
      { key: "today", label: "Dnešní datum" },
      { key: "contractNumber", label: "Číslo smlouvy" },
    ],
  },
];

/** Format a JS Date to Czech format: "dd. MM. yyyy" */
function formatCzechDate(date: Date): string {
  const d = date.getDate().toString().padStart(2, "0");
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const y = date.getFullYear();
  return `${d}. ${m}. ${y}`;
}

export interface EmployeeData {
  id: string;
  firstName?: string;
  lastName?: string;
  currentJobTitle?: string;
  currentDepartment?: string;
  currentCompanyId?: string;
  // contact sub-doc fields (merged in by caller)
  address?: string;
  city?: string;
  zip?: string;
  // personal fields
  birthDate?: string; // pre-formatted Czech date (DD. MM. YYYY)
  // document sub-doc fields (decrypted, merged in by caller)
  birthNumber?: string;
  idCardNumber?: string;
  passportNumber?: string;
  visaNumber?: string;
  // employment row (merged in by caller)
  contractType?: string;
  salary?: string | number;
  startDate?: string;
  endDate?: string;
}

export interface CompanyData {
  name?: string;
  address?: string;
  ic?: string;
  dic?: string;
  fileNo?: string;
}

export interface SignatoryData {
  displayName?: string;
  title?: string;
}

/**
 * Resolve all template variables from employee, company, and signatory data.
 * `overrides` can patch any key (e.g. employment row values from history modal).
 */
export function resolveVariables(
  employee: EmployeeData,
  company: CompanyData,
  signatory: SignatoryData,
  overrides: Record<string, string> = {}
): Record<string, string> {
  const str = (v: unknown) => (v !== undefined && v !== null ? String(v) : "");

  const vars: Record<string, string> = {
    firstName: str(employee.firstName),
    lastName: str(employee.lastName),
    fullName: [employee.firstName, employee.lastName].filter(Boolean).join(" "),
    birthDate: str(employee.birthDate),
    birthNumber: str(employee.birthNumber),
    idCardNumber: str(employee.idCardNumber),
    passportNumber: str(employee.passportNumber),
    visaNumber: str(employee.visaNumber),
    currentJobTitle: str(employee.currentJobTitle),
    currentDepartment: str(employee.currentDepartment),
    address: str(employee.address),
    city: str(employee.city),
    zip: str(employee.zip),
    contractType: str(employee.contractType),
    salary: str(employee.salary),
    startDate: str(employee.startDate),
    endDate: str(employee.endDate),
    companyName: str(company.name),
    companyAddress: str(company.address),
    ic: str(company.ic),
    dic: str(company.dic),
    companyFileNo: str(company.fileNo),
    signatoryName: str(signatory.displayName),
    signatoryTitle: str(signatory.title),
    today: formatCzechDate(new Date()),
    contractNumber: "",
    ...overrides,
  };

  return vars;
}

/**
 * Replace all `{{key}}` placeholders in the HTML with their resolved values.
 */
export function fillTemplate(html: string, vars: Record<string, string>): string {
  return html.replace(/\{\{(\w+)\}\}/g, (_match, key) => vars[key] ?? `{{${key}}}`);
}

/**
 * Return the list of `{{key}}` placeholders in the HTML that have no value
 * (value is empty string) after resolution — signals missing data to the user.
 */
export function getMissingVariables(html: string, vars: Record<string, string>): string[] {
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/\{\{(\w+)\}\}/g)) {
    const key = match[1];
    if (!seen.has(key) && !vars[key]) {
      missing.push(key);
      seen.add(key);
    }
  }
  return missing;
}
