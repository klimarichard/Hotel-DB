import { formatDateCZ } from "./dateFormat";

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
export type VariableDef = { key: string; label: string; kind?: "if" };
export const VARIABLE_GROUPS: { group: string; vars: VariableDef[] }[] = [
  {
    group: "Zaměstnanec",
    vars: [
      { key: "firstName", label: "Jméno" },
      { key: "lastName", label: "Příjmení" },
      { key: "fullName", label: "Celé jméno" },
      { key: "birthDate", label: "Datum narození" },
      { key: "address", label: "Adresa" },
      { key: "passportNumber", label: "Číslo pasu" },
      { key: "visaNumber", label: "Číslo povolení k pobytu" },
      { key: "currentJobTitle", label: "Pracovní pozice" },
      { key: "isCzech", label: "Je Čech (pro {{#if}})", kind: "if" },
      { key: "isForeigner", label: "Je cizinec (pro {{#if}})", kind: "if" },
      { key: "hasPermanentResidence", label: "Má trvalý pobyt (pro {{#if}})", kind: "if" },
      { key: "noPermanentResidence", label: "Nemá trvalý pobyt (pro {{#if}})", kind: "if" },
    ],
  },
  {
    group: "Pracovní podmínky",
    vars: [
      { key: "contractType", label: "Typ smlouvy" },
      { key: "salary", label: "Plat" },
      { key: "startDate", label: "Datum nástupu" },
      { key: "endDate", label: "Datum ukončení" },
      { key: "workLocation", label: "Místo výkonu práce" },
      { key: "probationPeriod", label: "Zkušební doba" },
      { key: "signingDate", label: "Datum podpisu" },
      { key: "hasProbation", label: "Má zkušební dobu (pro {{#if}})", kind: "if" },
      { key: "noProbation", label: "Nemá zkušební dobu (pro {{#if}})", kind: "if" },
      { key: "hasEndDate", label: "Má datum ukončení (pro {{#if}})", kind: "if" },
      { key: "noEndDate", label: "Nemá datum ukončení (pro {{#if}})", kind: "if" },
      { key: "agreedWorkScope", label: "Rozsah práce DPP" },
      { key: "agreedReward", label: "Odměna DPP" },
    ],
  },
  {
    group: "Společnost",
    vars: [
      { key: "companyName", label: "Název firmy" },
      { key: "companyAddress", label: "Adresa firmy" },
      { key: "ic", label: "IČO" },
      { key: "companyFileNo", label: "Spisová značka" },
    ],
  },
  {
    group: "Dokument",
    vars: [
      { key: "today", label: "Dnešní datum" },
    ],
  },
];


export interface EmployeeData {
  id: string;
  firstName?: string;
  lastName?: string;
  currentJobTitle?: string;
  currentCompanyId?: string;
  // contact sub-doc fields (merged in by caller)
  address?: string;
  // personal fields
  birthDate?: string; // raw ISO date (YYYY-MM-DD); resolveVariables formats it
  nationality?: string; // free-form string from employee.nationality
  // document sub-doc fields (merged in by caller)
  passportNumber?: string;
  visaNumber?: string;
  visaType?: string; // free-form string from documents.visaType
  // employment row (merged in by caller)
  contractType?: string;
  salary?: string | number;
  startDate?: string;
  endDate?: string;
  workLocation?: string;
  probationPeriod?: string;
  signingDate?: string; // raw ISO date (YYYY-MM-DD); resolveVariables formats it
  // DPP fields
  agreedWorkScope?: string;
  agreedReward?: string | number;
}

/**
 * Whether a nationality code should be treated as Czech. Compared
 * exactly against the canonical "CZE" code; the nationality field will
 * become a fixed dropdown of country codes, so no fuzzy matching is
 * needed. Empty / unknown is treated as foreign — safer default since
 * the foreign branch typically adds legally required fields.
 */
function isCzechNationality(nat: string): boolean {
  return nat.trim() === "CZE";
}

export interface CompanyData {
  name?: string;
  address?: string;
  ic?: string;
  fileNo?: string;
}

/**
 * Resolve all template variables from employee and company data.
 * `overrides` can patch any key (e.g. employment row values from history modal).
 */
export function resolveVariables(
  employee: EmployeeData,
  company: CompanyData,
  overrides: Record<string, string> = {}
): Record<string, string> {
  const str = (v: unknown) => (v !== undefined && v !== null ? String(v) : "");

  const nationality = str(employee.nationality);
  const czech = isCzechNationality(nationality);

  // Probation: free-form string (e.g. "2 měsíce", "0", ""). Treat as
  // "has probation" only when it contains a non-zero digit, so "0",
  // "0 měsíců", and "" all collapse to noProbation = true.
  const probationStr = str(employee.probationPeriod).trim();
  const hasProbation = /[1-9]/.test(probationStr);
  const hasEndDate = str(employee.endDate).trim() !== "";
  // Visa type: matches the canonical string "trvalý pobyt" exactly
  // (case-insensitive, trimmed) — anything else, including empty,
  // counts as no permanent residence.
  const hasPermanentResidence =
    str(employee.visaType).trim().toLowerCase() === "trvalý pobyt";

  const vars: Record<string, string> = {
    firstName: str(employee.firstName),
    lastName: str(employee.lastName),
    fullName: [employee.firstName, employee.lastName].filter(Boolean).join(" "),
    birthDate: formatDateCZ(employee.birthDate),
    passportNumber: str(employee.passportNumber),
    visaNumber: str(employee.visaNumber),
    currentJobTitle: str(employee.currentJobTitle),
    isCzech: czech ? "ano" : "",
    isForeigner: czech ? "" : "ano",
    hasPermanentResidence: hasPermanentResidence ? "ano" : "",
    noPermanentResidence: hasPermanentResidence ? "" : "ano",
    address: str(employee.address),
    contractType: str(employee.contractType),
    salary: str(employee.salary),
    startDate: formatDateCZ(employee.startDate),
    endDate: formatDateCZ(employee.endDate),
    workLocation: str(employee.workLocation),
    probationPeriod: probationStr,
    signingDate: formatDateCZ(employee.signingDate),
    hasProbation: hasProbation ? "ano" : "",
    noProbation: hasProbation ? "" : "ano",
    hasEndDate: hasEndDate ? "ano" : "",
    noEndDate: hasEndDate ? "" : "ano",
    agreedWorkScope: str(employee.agreedWorkScope),
    agreedReward: str(employee.agreedReward),
    companyName: str(company.name),
    companyAddress: str(company.address),
    ic: str(company.ic),
    companyFileNo: str(company.fileNo),
    today: formatDateCZ(new Date()),
    ...overrides,
  };

  return vars;
}

const IF_RE = /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g;
const UNLESS_RE = /\{\{#unless\s+(\w+)\}\}([\s\S]*?)\{\{\/unless\}\}/g;
// Sentinel that marks where a conditional block was stripped. Used so we
// can later remove only the empty <p></p> wrappers that are adjacent to
// the strip point, while preserving intentional blank lines elsewhere.
const STRIP_MARKER = "HPM_STRIPPED";
// Drop any <p>…marker…</p> whose only contents reduce to the marker —
// the wrapping paragraph existed solely to hold the conditional. Then
// strip any leftover bare markers (e.g. when the conditional sat
// between paragraphs at block level). Empty <p></p> elsewhere are
// preserved as intentional blank lines.
const P_AROUND_MARKER_RE = new RegExp(
  `<p[^>]*>\\s*${STRIP_MARKER}\\s*<\\/p>`,
  "g"
);
const BARE_MARKER_RE = new RegExp(STRIP_MARKER, "g");

/**
 * Resolve {{#if X}}…{{/if}} and {{#unless X}}…{{/unless}} blocks against
 * vars. `if` keeps the inner content when vars[X] is a truthy non-empty
 * string; `unless` is the inverse. After stripping a block, any empty
 * <p></p> wrappers immediately adjacent to the strip point are removed
 * so a deleted line doesn't leave a blank paragraph behind. Empty
 * paragraphs that are *not* adjacent to a stripped block are preserved
 * — they're intentional blank lines authored in the template.
 *
 * Nesting is not supported: blocks are matched non-greedily and a nested
 * inner {{#if}} would close its own outer block prematurely.
 */
function processConditionals(html: string, vars: Record<string, string>): string {
  let out = html;
  out = out.replace(IF_RE, (_m, key, inner) => (vars[key] ? inner : STRIP_MARKER));
  out = out.replace(UNLESS_RE, (_m, key, inner) => (vars[key] ? STRIP_MARKER : inner));
  out = out.replace(P_AROUND_MARKER_RE, "");
  out = out.replace(BARE_MARKER_RE, "");
  return out;
}

// Strip a trailing run of truly-empty <p></p> at the document end —
// TipTap's editor often leaves a dangling empty paragraph after the
// last block that, when re-rendered with margin-bottom, can overflow
// onto a blank second page in the generated PDF.
const TRAILING_EMPTY_PS_RE = /(?:<p[^>]*>\s*<\/p>\s*)+$/;
// Strip empty <p></p> runs that immediately precede a <table>. The
// table has its own margin-top (0.5cm in RENDER_CSS), so the author's
// blank paragraphs above the table — added for visual spacing in the
// editor — would otherwise stack with the table margin and push the
// row past the page boundary. Single-row tables can never break
// (Chromium implicit break-inside: avoid on <tr>), so even a small
// overshoot moves the whole table to the next page.
const EMPTY_PS_BEFORE_TABLE_RE = /(?:<p[^>]*>\s*<\/p>\s*)+(?=<table\b)/g;
// Normalise a truly-empty <p></p> (kept as an intentional blank line by
// the author) to <p><br></p>. Bare empty <p> elements collapse to zero
// height in Chromium when re-rendered outside the editor's
// contenteditable surface, so the blank line wouldn't show in the PDF;
// inserting a <br> forces the browser to render the paragraph at one
// line of height, matching what the editor preview shows.
const EMPTY_P_RE = /<p([^>]*)>\s*<\/p>/g;

function normaliseEmptyParagraphs(html: string): string {
  let out = html;
  out = out.replace(TRAILING_EMPTY_PS_RE, "");
  out = out.replace(EMPTY_PS_BEFORE_TABLE_RE, "");
  out = out.replace(EMPTY_P_RE, "<p$1><br></p>");
  return out;
}

/**
 * Replace all `{{key}}` placeholders in the HTML with their resolved values.
 * Conditional blocks ({{#if X}}…{{/if}} and {{#unless X}}…{{/unless}}) are
 * resolved first so their content is either kept or stripped before
 * variable substitution runs. Empty paragraphs are normalised so they
 * render as visible blank lines in the generated PDF.
 */
export function fillTemplate(html: string, vars: Record<string, string>): string {
  const processed = processConditionals(html, vars);
  const substituted = processed.replace(
    /\{\{(\w+)\}\}/g,
    (_match, key) => vars[key] ?? `{{${key}}}`
  );
  return normaliseEmptyParagraphs(substituted);
}

/**
 * Return the list of `{{key}}` placeholders in the HTML that have no value
 * (value is empty string) after resolution — signals missing data to the
 * user. Variables that only appear inside a conditional block whose
 * condition is false are not considered missing because they won't render.
 */
export function getMissingVariables(html: string, vars: Record<string, string>): string[] {
  const processed = processConditionals(html, vars);
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const match of processed.matchAll(/\{\{(\w+)\}\}/g)) {
    const key = match[1];
    if (!seen.has(key) && !vars[key]) {
      missing.push(key);
      seen.add(key);
    }
  }
  return missing;
}
