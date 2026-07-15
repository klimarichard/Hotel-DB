/**
 * Sample data for the template editor's preview.
 *
 * WHY MOCK VALUES RATHER THAN BLANKS. The point of the preview is to check
 * LAYOUT - tab stops, line wraps, page breaks. A blank `{{fullName}}` collapses to
 * nothing, so the line it sits on would be shorter than it will ever really be and
 * the tab alignment you'd be checking would be a lie. The values below are
 * therefore plausible and roughly realistically LONG: a real Czech name, a real
 * address, a formatted salary. Layout checked against them is layout you can trust.
 *
 * The booleans are NOT fixed: the preview panel exposes one checkbox per
 * conditional the template actually uses, so both branches of every
 * {{#if}}/{{#unless}} can be inspected. A conditional block is exactly the thing
 * you cannot judge from the raw editor, since the {{#if …}} markers themselves take
 * up space in the line.
 */
import {
  VARIABLE_GROUPS,
  isCustomVarKey,
  formatCustomValue,
  evalCondition,
  type CustomVarDefs,
} from "./contractVariables";

/** Realistic stand-ins for every non-boolean permanent variable. */
const MOCK_TEXT: Record<string, string> = {
  // Zaměstnanec
  firstName: "Jana",
  lastName: "Nováková",
  birthDate: "14. 3. 1992",
  address: "Vinohradská 1511/230, 100 00 Praha 10",
  passportNumber: "12345678",
  visaNumber: "ABC123456",
  currentJobTitle: "recepční",
  // Pracovní podmínky
  contractType: "HPP",
  // Salary is the bare number (formatSalaryCZ → dot thousands-separators, no
  // "Kč"); the ",- Kč" suffix lives in the template text, so the sample must
  // match that or the preview misleads (looked like the variable carried "Kč").
  salary: "35.000",
  startDate: "1. 8. 2026",
  endDate: "31. 7. 2027",
  workLocation: "Praha",
  hoursPerWeek: "40",
  probationPeriod: "3 měsíce",
  signingDate: "14. 7. 2026",
  originalSigningDate: "1. 8. 2025",
  agreedWorkScope: "úklid pokojů",
  // Bare number too (resolveVariables emits the raw value); unit goes in text.
  agreedReward: "180",
  // Dodatky
  dodatekEffectiveDate: "1. 9. 2026",
  newSalary: "38.000",
  salaryChangeVerb: "zvyšuje",
  newJobTitle: "vedoucí recepce",
  newWorkScope: "0,5",
  newHoursPerWeek: "20",
  newEndDate: "31. 12. 2027",
  // Společnost
  companyName: "Special Tours Prague s.r.o.",
  companyAddress: "Náměstí Míru 820/9, 120 00 Praha 2",
  ic: "26765432",
  companyFileNo: "C 12345 vedená u Městského soudu v Praze",
  // Multisport
  requestedAt: "14. 7. 2026",
  validFrom: "1. 8. 2026",
  validFromMonth: "srpen 2026",
  // Dokument
  today: "14. 7. 2026",
};

/** Sample values for a custom slot, by its configured type. */
const MOCK_CUSTOM_BY_TYPE: Record<string, string> = {
  text: "ukázkový text",
  date: "1. 8. 2026",
  number: "1 500",
};

/**
 * Raw, typed stand-ins for the comparable variables, used to evaluate a
 * `condition` custom slot in the preview. Mirror the MOCK_TEXT samples above but
 * as ISO dates / plain numbers (what evalCondition compares on).
 */
const MOCK_RAW: Record<string, string | number | null> = {
  startDate: "2026-08-01",
  endDate: "2027-07-31",
  signingDate: "2026-07-14",
  originalSigningDate: "2025-08-01",
  birthDate: "1992-03-14",
  dodatekEffectiveDate: "2026-09-01",
  requestedAt: "2026-07-14",
  validFrom: "2026-08-01",
  today: "2026-07-14",
  salary: 35000,
  agreedReward: 180,
  hoursPerWeek: 40,
};

/** Every permanent variable declared as a conditional ({{#if}} / {{#unless}}). */
export const CONDITIONAL_KEYS: string[] = VARIABLE_GROUPS.flatMap((g) =>
  g.vars.filter((v) => v.kind === "if").map((v) => v.key)
);

/** Human label for a conditional key, for the preview panel's checkboxes. */
export const CONDITIONAL_LABELS: Record<string, string> = Object.fromEntries(
  VARIABLE_GROUPS.flatMap((g) =>
    g.vars
      .filter((v) => v.kind === "if")
      // Strip the "(pro {{#if}} / {{#unless}})" suffix - noise on a checkbox.
      .map((v) => [v.key, v.label.replace(/\s*\(pro .*$/, "")])
  )
);

/** Variable names the html actually references (plain, #if or #unless). */
export function referencedKeys(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(/\{\{(?:#if\s+|#unless\s+)?(\w+)\}\}/g)) out.add(m[1]);
  return out;
}

/**
 * The conditionals this template actually uses - permanent ones plus any custom
 * slot configured as `bool`. Only these get a checkbox; showing all of them would
 * bury the two that matter for the document in front of you.
 */
export function usedConditionals(html: string, defs: CustomVarDefs): string[] {
  const refs = referencedKeys(html);
  const permanent = CONDITIONAL_KEYS.filter((k) => refs.has(k));
  const custom = Object.keys(defs)
    .filter((k) => defs[k]?.type === "bool" && refs.has(k))
    .sort((a, b) => Number(a.replace("var", "")) - Number(b.replace("var", "")));
  return [...permanent, ...custom];
}

/**
 * Build the variable map the preview renders with: realistic text for everything,
 * and the caller's checkbox state for the conditionals ("ano" / "" is the
 * truthiness convention the conditional engine expects).
 */
export function buildPreviewVars(
  html: string,
  defs: CustomVarDefs,
  bools: Record<string, boolean>
): Record<string, string> {
  const vars: Record<string, string> = { ...MOCK_TEXT };

  for (const key of CONDITIONAL_KEYS) vars[key] = bools[key] ? "ano" : "";

  // Custom slots: a bool follows its checkbox. For the rest, prefer the slot's
  // configured DEFAULT (so the preview matches what generation will pre-fill) –
  // a literal, or a built-in variable resolved from the sample values already in
  // `vars`. Only when there's no meaningful default do we fall back to realistic
  // mock text (a blank slot would collapse the line and lie about the layout).
  for (const key of referencedKeys(html)) {
    if (!isCustomVarKey(key)) continue;
    const def = defs[key];
    const type = def?.type ?? "text";
    if (type === "bool") {
      vars[key] = bools[key] ? "ano" : "";
      continue;
    }
    if (type === "condition") {
      // Computed from the comparison against the raw sample values.
      vars[key] = evalCondition(def?.condition, MOCK_RAW) ? "ano" : "";
      continue;
    }
    const d = def?.default;
    let dv = "";
    if (d?.kind === "fixedVar") dv = vars[d.key] ?? "";
    else if (d?.kind === "literal") dv = formatCustomValue(type, d.value);
    vars[key] = dv || MOCK_CUSTOM_BY_TYPE[type] || MOCK_CUSTOM_BY_TYPE.text;
  }

  return vars;
}

/** Conditionals start ON, so the preview opens showing the fuller document. */
export function defaultBools(keys: string[]): Record<string, boolean> {
  return Object.fromEntries(keys.map((k) => [k, true]));
}
