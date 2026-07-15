import { formatDateCZ } from "./dateFormat";
import * as clock from "./clock";

/**
 * Format a salary number with Czech thousands-separator dots, intended to
 * pair with the templates' fixed `",- Kč"` suffix. 39000 → "39.000". Used
 * for the `{{salary}}` and `{{newSalary}}` template variables; the literal
 * ",- Kč" stays in the template HTML so this helper emits the integer
 * portion only. Non-numeric input is returned as-is so editors typing free
 * text into the form don't lose their work.
 */
export function formatSalaryCZ(value: number | string | null | undefined): string {
  if (value === undefined || value === null || value === "") return "";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  return Math.trunc(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * `ContractType` was originally a closed union over the 9 built-in template
 * ids. As of 2026-04-30 admin/director users can create their own
 * standalone templates with arbitrary slug ids, so the type is widened to
 * `string`. The labels map and the *_TYPES arrays still enumerate only the
 * built-ins; custom templates surface via runtime fetches.
 */
export type ContractType = string;

export const BUILTIN_CONTRACT_TYPES = [
  "nastup_hpp",
  "nastup_ppp",
  "nastup_dpp",
  "ukonceni_hpp_ppp",
  "ukonceni_dpp",
  "ukonceni_zkusebni",
  "zmena_smlouvy",
  "hmotna_odpovednost",
  "multisport",
] as const;

export const CONTRACT_TYPE_LABELS: Record<string, string> = {
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

/** Contract types that are triggered by a history row (built-in only – custom templates are always standalone) */
export const HISTORY_TIED_TYPES: ContractType[] = [
  "nastup_hpp",
  "nastup_ppp",
  "nastup_dpp",
  "ukonceni_hpp_ppp",
  "ukonceni_dpp",
  "ukonceni_zkusebni",
  "zmena_smlouvy",
];

/** Built-in contract types generated independently of a history row */
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

// ─── Custom (per-template) variables ─────────────────────────────────────────
//
// Ten free slots, {{var1}}…{{var10}}, that a template may use for values the
// employee record simply doesn't hold (a penalty amount, a deadline, …). Each
// template configures the slots it uses ITSELF — label + type live on the
// template document, so the same {{var1}} means "Výše pokuty" in one template
// and "Datum školení" in another. Values are typed in when a document is
// generated and are never persisted.
//
// The placeholder is a plain word, NOT "#var1": the engine only matches
// `{{\w+}}`, and a leading `#` is what marks a conditional block ({{#if x}}), so
// a "{{#var1}}" would be ignored by every regex here and printed raw into the
// PDF.

export const CUSTOM_VAR_COUNT = 10;

/** {{var1}} … {{var10}} — the fixed slot keys, in order. */
export const CUSTOM_VAR_KEYS: string[] = Array.from(
  { length: CUSTOM_VAR_COUNT },
  (_, i) => `var${i + 1}`
);

const CUSTOM_VAR_KEY_SET = new Set(CUSTOM_VAR_KEYS);

export type CustomVarType = "text" | "date" | "number" | "bool";

export const CUSTOM_VAR_TYPE_LABELS: Record<CustomVarType, string> = {
  text: "Text",
  date: "Datum",
  number: "Číslo",
  bool: "Ano/Ne",
};

/**
 * A default value for a custom slot, pre-filled (editable) in the generate
 * dialog. Either a fixed LITERAL (stored in the slot's raw form: text/number as
 * typed, date as ISO, bool as "true"/"") or a reference to a built-in FIXED
 * variable (e.g. firstName), resolved from the employee/company data at
 * generation time. Absent = no default.
 */
export type CustomVarDefault =
  | { kind: "literal"; value: string }
  | { kind: "fixedVar"; key: string };

/** A template's configuration of one slot. */
export interface CustomVarDef {
  label: string;
  type: CustomVarType;
  default?: CustomVarDefault;
}

/** Slot key → its configuration on a given template. Stored on contractTemplates/{id}. */
export type CustomVarDefs = Record<string, CustomVarDef>;

export function isCustomVarKey(key: string): boolean {
  return CUSTOM_VAR_KEY_SET.has(key);
}

/**
 * Which custom slots a template's HTML actually uses — as a plain `{{var1}}`
 * placeholder or as a `{{#if var1}}` / `{{#unless var1}}` condition. Returned in
 * slot order (var1, var2, …), not order of appearance, so the config UI and the
 * generate form list them predictably.
 */
export function usedCustomVars(html: string): string[] {
  const used = new Set<string>();
  for (const m of html.matchAll(/\{\{(?:#if\s+|#unless\s+)?(\w+)\}\}/g)) {
    if (isCustomVarKey(m[1])) used.add(m[1]);
  }
  return CUSTOM_VAR_KEYS.filter((k) => used.has(k));
}

/**
 * Turn the raw form input for a slot into the string that lands in the PDF.
 *
 * `bool` resolves to "ano" / "" rather than "ano" / "ne" — deliberately, and
 * consistently with the built-in `kind: "if"` variables: an empty string is what
 * makes `{{#if var1}}` strip its block. A plain `{{var1}}` of an unchecked bool
 * therefore prints nothing, which is the sane reading of "no".
 */
export function formatCustomValue(type: CustomVarType, raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  switch (type) {
    case "date":
      // raw is an <input type="date"> ISO string; formatDateCZ splits the string
      // rather than parsing a Date, so there is no timezone off-by-one here.
      return formatDateCZ(value);
    case "number": {
      const n = Number(value.replace(",", "."));
      if (!Number.isFinite(n)) return value;
      return new Intl.NumberFormat("cs-CZ").format(n);
    }
    case "bool":
      return value === "true" ? "ano" : "";
    case "text":
    default:
      return value;
  }
}

/**
 * Whether a slot's value should pass through UNFORMATTED at fill time. True only
 * for a non-bool slot whose default references a fixed variable: the resolved
 * fixed value is already a final formatted string (a date reads "1. 1. 2024",
 * not ISO), so re-running formatCustomValue over it would corrupt it. Everything
 * else (literals, bool) is formatted normally.
 */
export function isFixedVarPassthrough(def: CustomVarDef | undefined): boolean {
  return def?.default?.kind === "fixedVar" && (def?.type ?? "text") !== "bool";
}

/**
 * The raw value to pre-fill a custom slot's generate-dialog input from its
 * configured default, given the resolved fixed-variable values. Returns null
 * when the slot has no default.
 *  - literal → the stored raw value (ISO date / digits / text / "true"|"").
 *  - fixedVar (bool slot) → the resolved value mapped back to the checkbox raw
 *    form ("true"/"") so the checkbox reflects it.
 *  - fixedVar (other slot) → the resolved built-in value as-is (passthrough; see
 *    isFixedVarPassthrough).
 */
export function customDefaultRaw(
  def: CustomVarDef | undefined,
  fixedValues: Record<string, string>
): string | null {
  const d = def?.default;
  if (!d) return null;
  if (d.kind === "literal") return d.value;
  const resolved = fixedValues[d.key] ?? "";
  if ((def?.type ?? "text") === "bool") return resolved ? "true" : "";
  return resolved;
}

/**
 * Custom slots whose value the user still has to supply before a document may be
 * generated. `bool` is never "missing": unchecked is a legitimate answer, not an
 * omission — treating it as missing would make an unticked box block generation
 * forever.
 */
export function missingCustomVars(
  html: string,
  defs: CustomVarDefs,
  rawValues: Record<string, string>
): string[] {
  return usedCustomVars(html).filter((key) => {
    const type = defs[key]?.type ?? "text";
    if (type === "bool") return false;
    return !(rawValues[key] ?? "").trim();
  });
}

/** All available template variables with human-readable labels grouped by source */
export type VariableDef = { key: string; label: string; kind?: "if" };
export const VARIABLE_GROUPS: { group: string; vars: VariableDef[] }[] = [
  {
    group: "Zaměstnanec",
    vars: [
      { key: "firstName", label: "Jméno" },
      { key: "lastName", label: "Příjmení" },
      { key: "birthDate", label: "Datum narození" },
      { key: "address", label: "Adresa" },
      { key: "passportNumber", label: "Číslo pasu" },
      { key: "visaNumber", label: "Číslo povolení k pobytu" },
      { key: "currentJobTitle", label: "Pracovní pozice" },
      // Every boolean below is stored as a SINGLE positive key. The negative case
      // is expressed with {{#unless X}}, so no "noX" twin is needed - keeping both
      // halves meant two keys that could silently disagree, and twice the surface
      // to get wrong. Negatives (isForeigner / noPermanentResidence / noProbation /
      // noEndDate) were removed in v4.7.0 and the prod templates migrated.
      { key: "isCzech", label: "Je Čech (pro {{#if}} / {{#unless}})", kind: "if" },
      { key: "isMale", label: "Je muž (pro {{#if}} / {{#unless}})", kind: "if" },
      { key: "hasPermanentResidence", label: "Má trvalý pobyt (pro {{#if}} / {{#unless}})", kind: "if" },
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
      { key: "hoursPerWeek", label: "Počet hodin týdně (PPP)" },
      { key: "is20Hours", label: "Je poloviční úvazek – 20 h/týdně (pro {{#if}} / {{#unless}})", kind: "if" },
      { key: "probationPeriod", label: "Zkušební doba" },
      { key: "signingDate", label: "Datum podpisu" },
      { key: "originalSigningDate", label: "Datum podpisu původní smlouvy" },
      { key: "hasProbation", label: "Má zkušební dobu (pro {{#if}} / {{#unless}})", kind: "if" },
      { key: "hasEndDate", label: "Má datum ukončení (pro {{#if}} / {{#unless}})", kind: "if" },
      { key: "agreedWorkScope", label: "Rozsah práce DPP" },
      { key: "agreedReward", label: "Odměna DPP" },
    ],
  },
  {
    group: "Dodatky",
    vars: [
      { key: "dodatekEffectiveDate", label: "Platnost dodatku" },
      { key: "newSalary", label: "Nová mzda" },
      { key: "salaryChangeVerb", label: "Sloveso změny mzdy (zvyšuje/mění)" },
      { key: "isDodatekMzda", label: "Je dodatek o mzdě (pro {{#if}})", kind: "if" },
      { key: "newJobTitle", label: "Nová pozice" },
      { key: "isDodatekPozice", label: "Je dodatek o pozici (pro {{#if}})", kind: "if" },
      { key: "newWorkScope", label: "Nový úvazek" },
      { key: "isDodatekUvazek", label: "Je dodatek o úvazku (pro {{#if}})", kind: "if" },
      { key: "newHoursPerWeek", label: "Nový počet hodin týdně" },
      { key: "isDodatekHodiny", label: "Je dodatek o počtu hodin (pro {{#if}})", kind: "if" },
      { key: "newEndDate", label: "Nový konec smlouvy" },
      { key: "isDodatekZmenaKonce", label: "Je dodatek o změně konce poměru (pro {{#if}})", kind: "if" },
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
    group: "Multisport",
    vars: [
      { key: "requestedAt", label: "Datum žádosti" },
      { key: "validFrom", label: "Platnost od" },
      { key: "validFromMonth", label: "Měsíc začátku platnosti (např. leden 2026)" },
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
  gender?: string; // "m" | "f" (or empty) – drives the isMale conditional
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
  // Signing date of the most recent prior "nástup" row – the contract this
  // dodatek/ukončení references. Raw ISO; resolveVariables formats it.
  originalSigningDate?: string;
  // DPP fields
  agreedWorkScope?: string;
  agreedReward?: string | number;
  // Part-time weekly hours (PPP). Rendered on the PPP contract template.
  hoursPerWeek?: string | number;
  // Dodatek fields – populated when generating "změna smlouvy" contracts.
  // dodatekEffectiveDate is raw ISO; resolveVariables formats it.
  dodatekEffectiveDate?: string;
  dodatekChanges?: { changeKind: string; value: string }[];
  // Salary in force immediately before this dodatek – used to compute
  // salaryChangeVerb ("zvyšuje" if newSalary > oldSalary, else "mění").
  oldSalary?: string | number;
  // Multisport-specific dates – collected by the standalone-contract
  // signing-date prompt. Raw ISO; resolveVariables formats them.
  requestedAt?: string;
  validFrom?: string;
}

/**
 * Whether a nationality code should be treated as Czech. Compared
 * exactly against the canonical "CZE" code; the nationality field will
 * become a fixed dropdown of country codes, so no fuzzy matching is
 * needed. Empty / unknown is treated as foreign – safer default since
 * the foreign branch typically adds legally required fields.
 */
export function isCzechNationality(nat: string): boolean {
  return nat.trim() === "CZE";
}

const CZECH_MONTHS = [
  "leden", "únor", "březen", "duben", "květen", "červen",
  "červenec", "srpen", "září", "říjen", "listopad", "prosinec",
];

/**
 * Czech month + year (e.g. "leden 2026") parsed from a raw ISO date
 * string. Empty string when the input isn't a usable YYYY-MM-DD prefix.
 */
function czechMonthYear(iso: string | undefined): string {
  if (!iso) return "";
  const [yearStr, monthStr] = iso.split("-");
  const monthIdx = Number(monthStr) - 1;
  if (!yearStr || monthIdx < 0 || monthIdx >= 12) return "";
  return `${CZECH_MONTHS[monthIdx]} ${yearStr}`;
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
  // "0 měsíců", and "" all collapse to hasProbation = false (use {{#unless}}).
  const probationStr = str(employee.probationPeriod).trim();
  const hasProbation = /[1-9]/.test(probationStr);
  const hasEndDate = str(employee.endDate).trim() !== "";
  // Visa type: matches the canonical string "trvalý pobyt" exactly
  // (case-insensitive, trimmed) – anything else, including empty,
  // counts as no permanent residence.
  const hasPermanentResidence =
    str(employee.visaType).trim().toLowerCase() === "trvalý pobyt";

  const vars: Record<string, string> = {
    firstName: str(employee.firstName),
    lastName: str(employee.lastName),
    birthDate: formatDateCZ(employee.birthDate),
    passportNumber: str(employee.passportNumber),
    visaNumber: str(employee.visaNumber),
    currentJobTitle: str(employee.currentJobTitle),
    // Booleans are single-key + {{#unless}} for the negative case (see
    // VARIABLE_GROUPS). "ano" / "" is the truthiness convention the conditional
    // engine expects.
    isCzech: czech ? "ano" : "",
    isMale: str(employee.gender).trim().toLowerCase() === "m" ? "ano" : "",
    hasPermanentResidence: hasPermanentResidence ? "ano" : "",
    address: str(employee.address),
    contractType: str(employee.contractType),
    salary: formatSalaryCZ(employee.salary),
    startDate: formatDateCZ(employee.startDate),
    endDate: formatDateCZ(employee.endDate),
    workLocation: str(employee.workLocation),
    probationPeriod: probationStr,
    signingDate: formatDateCZ(employee.signingDate),
    originalSigningDate: formatDateCZ(employee.originalSigningDate),
    hasProbation: hasProbation ? "ano" : "",
    hasEndDate: hasEndDate ? "ano" : "",
    agreedWorkScope: str(employee.agreedWorkScope),
    agreedReward: str(employee.agreedReward),
    hoursPerWeek: str(employee.hoursPerWeek),
    // True only for a standard half-time PPP (exactly 20 h/week). Lets the PPP
    // template say "poloviční pracovní úvazek" for 20 h and "zkrácený poloviční
    // úvazek" for any other part-time amount, via {{#if}} / {{#unless}}.
    is20Hours: Number(employee.hoursPerWeek) === 20 ? "ano" : "",
    ...(() => {
      const changes = employee.dodatekChanges ?? [];
      const findValue = (kind: string) =>
        changes.find((c) => c.changeKind === kind)?.value ?? "";
      const has = (kind: string) => changes.some((c) => c.changeKind === kind);
      const newSalaryStr = findValue("mzda");
      const newSalaryNum = Number(newSalaryStr);
      const oldSalaryNum = Number(employee.oldSalary);
      const salaryChangeVerb =
        Number.isFinite(newSalaryNum) && Number.isFinite(oldSalaryNum)
          ? newSalaryNum > oldSalaryNum
            ? "zvyšuje"
            : "mění"
          : "";
      return {
        dodatekEffectiveDate: formatDateCZ(employee.dodatekEffectiveDate),
        newSalary: formatSalaryCZ(newSalaryStr),
        newJobTitle: str(findValue("pracovní pozice")),
        newWorkScope: str(findValue("úvazek")),
        newHoursPerWeek: str(findValue("počet hodin")),
        newEndDate: formatDateCZ(findValue("délka smlouvy")),
        salaryChangeVerb,
        isDodatekMzda: has("mzda") ? "ano" : "",
        isDodatekPozice: has("pracovní pozice") ? "ano" : "",
        isDodatekUvazek: has("úvazek") ? "ano" : "",
        isDodatekHodiny: has("počet hodin") ? "ano" : "",
        isDodatekZmenaKonce: has("délka smlouvy") ? "ano" : "",
      };
    })(),
    companyName: str(company.name),
    companyAddress: str(company.address),
    ic: str(company.ic),
    companyFileNo: str(company.fileNo),
    today: formatDateCZ(clock.now()),
    requestedAt: formatDateCZ(employee.requestedAt),
    validFrom: formatDateCZ(employee.validFrom),
    validFromMonth: czechMonthYear(employee.validFrom),
    ...overrides,
  };

  return vars;
}

// One token: an opener ({{#if x}} / {{#unless x}}) or a closer ({{/if}} / {{/unless}}).
const BLOCK_TAG_RE = /\{\{(#if|#unless)\s+(\w+)\}\}|\{\{\/(if|unless)\}\}/g;
// Sentinel that marks where a conditional block was stripped. Used so we
// can later remove only the empty <p></p> wrappers that are adjacent to
// the strip point, while preserving intentional blank lines elsewhere.
const STRIP_MARKER = "HPM_STRIPPED";
// Drop any <p>…marker…</p> whose only contents reduce to the marker –
// the wrapping paragraph existed solely to hold the conditional. Then
// strip any leftover bare markers (e.g. when the conditional sat
// between paragraphs at block level). Empty <p></p> elsewhere are
// preserved as intentional blank lines.
const P_AROUND_MARKER_RE = new RegExp(
  `<p[^>]*>\\s*${STRIP_MARKER}\\s*<\\/p>`,
  "g"
);
const BARE_MARKER_RE = new RegExp(STRIP_MARKER, "g");

/** Parsed template body: literal text, or a conditional block with children. */
type BlockNode =
  | { type: "text"; value: string }
  | { type: "block"; kind: "if" | "unless"; key: string; children: BlockNode[] };

/**
 * Parse the conditional blocks into a tree.
 *
 * This replaced a pair of non-greedy regexes (one for `if`, one for `unless`).
 * Those could not NEST: an inner `{{/if}}` closed the outer block, and the
 * remainder was emitted as literal `{{/if}}` text into the contract — silently,
 * and visibly, on a signed document. A real AND condition (e.g. "a foreigner who
 * does NOT have permanent residence") was therefore impossible to express.
 *
 * Malformed input degrades rather than eating content: a closer with no matching
 * opener, or a mismatched kind, is emitted as literal text (exactly what the old
 * regexes did with it), and an unclosed opener has its literal tag and its
 * children flushed back out.
 */
function parseBlocks(html: string): BlockNode[] {
  const root: BlockNode[] = [];
  const stack: { kind: "if" | "unless"; key: string; children: BlockNode[] }[] = [];
  const current = () => (stack.length ? stack[stack.length - 1].children : root);

  const re = new RegExp(BLOCK_TAG_RE.source, "g");
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html)) !== null) {
    if (m.index > last) current().push({ type: "text", value: html.slice(last, m.index) });
    last = re.lastIndex;

    if (m[1]) {
      stack.push({ kind: m[1] === "#if" ? "if" : "unless", key: m[2], children: [] });
      continue;
    }

    const closing = m[3] as "if" | "unless";
    const top = stack[stack.length - 1];
    if (!top || top.kind !== closing) {
      // Stray or mismatched closer – keep it as text rather than guessing.
      current().push({ type: "text", value: m[0] });
      continue;
    }
    stack.pop();
    current().push({ type: "block", kind: top.kind, key: top.key, children: top.children });
  }

  if (last < html.length) current().push({ type: "text", value: html.slice(last) });

  // Unclosed openers: flush the opener tag literally, then its content.
  while (stack.length > 0) {
    const top = stack.pop()!;
    const parent = stack.length ? stack[stack.length - 1].children : root;
    parent.push({ type: "text", value: `{{#${top.kind} ${top.key}}}` }, ...top.children);
  }

  return root;
}

/** Render the tree: a kept block recurses (so nesting resolves), a dropped one
 *  collapses to the strip marker exactly as before. */
function renderBlocks(nodes: BlockNode[], vars: Record<string, string>): string {
  let out = "";
  for (const n of nodes) {
    if (n.type === "text") {
      out += n.value;
      continue;
    }
    const truthy = !!vars[n.key];
    const keep = n.kind === "if" ? truthy : !truthy;
    out += keep ? renderBlocks(n.children, vars) : STRIP_MARKER;
  }
  return out;
}

/**
 * Resolve {{#if X}}…{{/if}} and {{#unless X}}…{{/unless}} blocks against
 * vars. `if` keeps the inner content when vars[X] is a truthy non-empty
 * string; `unless` is the inverse. After stripping a block, any empty
 * <p></p> wrappers immediately adjacent to the strip point are removed
 * so a deleted line doesn't leave a blank paragraph behind. Empty
 * paragraphs that are *not* adjacent to a stripped block are preserved
 * – they're intentional blank lines authored in the template.
 *
 * Blocks MAY NEST to any depth, which is how an AND is expressed:
 *   {{#unless isCzech}}{{#unless hasPermanentResidence}}…{{/unless}}{{/unless}}
 * A dropped outer block discards its whole subtree without evaluating it.
 */
function processConditionals(html: string, vars: Record<string, string>): string {
  let out = renderBlocks(parseBlocks(html), vars);
  out = out.replace(P_AROUND_MARKER_RE, "");
  out = out.replace(BARE_MARKER_RE, "");
  return out;
}

// Strip a trailing run of truly-empty <p></p> at the document end –
// TipTap's editor often leaves a dangling empty paragraph after the
// last block that, when re-rendered with margin-bottom, can overflow
// onto a blank second page in the generated PDF.
const TRAILING_EMPTY_PS_RE = /(?:<p[^>]*>\s*<\/p>\s*)+$/;
// Strip empty <p></p> runs that immediately precede a <table>. The
// table has its own margin-top (0.5cm in RENDER_CSS), so the author's
// blank paragraphs above the table – added for visual spacing in the
// editor – would otherwise stack with the table margin and push the
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
 * (value is empty string) after resolution – signals missing data to the
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
