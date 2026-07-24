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
// Free slots, {{var1}}…{{var25}}, that a template may use for values the
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
//
// ── Two different counts, deliberately ──────────────────────────────────────
// CUSTOM_VAR_MAX is the ENGINE's ceiling: how far `isCustomVarKey` /
// `usedCustomVars` will recognise a slot at all. The *_VAR_COUNT constants are
// how many slots each PAGE offers in its picker and accepts server-side.
// They were one number until v5.2.0, when Dokumenty needed 25 while Šablony
// smluv stayed at 10 — a contract template is a signed legal document and
// widening its slot space buys nothing there.
//
// Recognition is deliberately shared at the higher ceiling rather than
// per-page: a stray "{{var15}}" in a contract can then be *seen* by the editor
// (it surfaces as an unnamed slot and gets warned about) instead of being
// silently printed as literal braces into a signed PDF. The contracts server
// validator still refuses to store a def for it, so the gate holds where it
// matters.

export const CUSTOM_VAR_MAX = 25;

/** Slots offered by the Dokumenty editor. */
export const DOCUMENT_VAR_COUNT = 25;
/** Slots offered by the Šablony smluv editor. */
export const CONTRACT_VAR_COUNT = 10;

/** {{var1}} … {{var25}} — every slot key the engine recognises, in order. */
export const CUSTOM_VAR_KEYS: string[] = Array.from(
  { length: CUSTOM_VAR_MAX },
  (_, i) => `var${i + 1}`
);

/** The first `count` slot keys — what a page's picker panel lists. */
export function customVarKeys(count: number): string[] {
  return CUSTOM_VAR_KEYS.slice(0, count);
}

const CUSTOM_VAR_KEY_SET = new Set(CUSTOM_VAR_KEYS);

export type CustomVarType =
  | "text"
  | "longtext"
  | "date"
  | "number"
  | "bool"
  | "list"
  | "condition"
  | "math";

export const CUSTOM_VAR_TYPE_LABELS: Record<CustomVarType, string> = {
  text: "Text",
  longtext: "Dlouhý text",
  date: "Datum",
  number: "Číslo",
  bool: "Ano/Ne",
  list: "Seznam",
  condition: "Podmínka",
  math: "Výpočet",
};

/**
 * Slot types the user TYPES IN when generating. The rest (`condition`, `math`)
 * are computed from other slots and never get a form field — which is also why
 * they can never be "missing" and why "Nepovinná" is meaningless for them.
 */
export const COMPUTED_VAR_TYPES: CustomVarType[] = ["condition", "math"];
export function isComputedVarType(type: CustomVarType | undefined): boolean {
  return type === "condition" || type === "math";
}

/**
 * Upper bound on the choices a "list" slot may offer. Not a technical limit —
 * a dropdown longer than this stops being easier than typing the value, and the
 * cap keeps a runaway paste out of the template document.
 */
export const CUSTOM_VAR_MAX_OPTIONS = 30;

// ── Derived conditions (a "condition" custom slot) ───────────────────────────
// A condition slot has no typed value; it is COMPUTED from a comparison of two
// operands and resolves to "ano" / "" like a bool, so it drives {{#if key}} /
// {{#unless key}}. Operands are a comparable built-in variable, or a literal of
// the same type. Comparison is on RAW typed values (ISO dates chronologically,
// numbers numerically) – never the formatted display strings.
export type CompareOp = "lt" | "lte" | "gt" | "gte" | "eq" | "neq" | "empty" | "notEmpty";
export const COMPARE_OP_LABELS: Record<CompareOp, string> = {
  lt: "<",
  lte: "≤",
  gt: ">",
  gte: "≥",
  eq: "=",
  neq: "≠",
  empty: "je prázdné",
  notEmpty: "není prázdné",
};
/** Operators that test the left operand alone (no right operand needed). */
export const UNARY_OPS: CompareOp[] = ["empty", "notEmpty"];

export type ComparableType = "date" | "number" | "text";

/**
 * Which operators make sense for a left operand of each raw type. Dates and
 * numbers order; text does not (a locale-aware `<` on free text is a question
 * nobody filling in a document is actually asking), so text is restricted to
 * equality and emptiness. The editor uses this to narrow its operator dropdown
 * rather than offering a comparison that would silently always be false.
 */
export const OPS_FOR_COMPARABLE: Record<ComparableType, CompareOp[]> = {
  number: ["lt", "lte", "gt", "gte", "eq", "neq", "empty", "notEmpty"],
  date: ["lt", "lte", "gt", "gte", "eq", "neq", "empty", "notEmpty"],
  text: ["eq", "neq", "empty", "notEmpty"],
};

/**
 * The raw comparable type a CUSTOM slot contributes when it is used as a
 * condition operand. `math` compares as a number (that is what it produces),
 * `bool` as text ("ano" / "") so `= ano` reads the way an author expects, and
 * `list` / `longtext` as text. Returns null for a slot that cannot be compared.
 */
export function comparableTypeOfCustom(type: CustomVarType | undefined): ComparableType | null {
  switch (type) {
    case "number":
    case "math":
      return "number";
    case "date":
      return "date";
    case "text":
    case "longtext":
    case "list":
    case "bool":
      return "text";
    // A condition compared against another condition is a cycle waiting to
    // happen and expresses nothing {{#if}} nesting can't already say.
    default:
      return null;
  }
}

/** Built-in variables that may take part in a comparison, with their raw type. */
export const COMPARABLE_VARS: { key: string; label: string; type: ComparableType }[] = [
  { key: "startDate", label: "Datum nástupu", type: "date" },
  { key: "endDate", label: "Datum ukončení", type: "date" },
  { key: "signingDate", label: "Datum podpisu", type: "date" },
  { key: "originalSigningDate", label: "Datum podpisu původní smlouvy", type: "date" },
  { key: "birthDate", label: "Datum narození", type: "date" },
  { key: "dodatekEffectiveDate", label: "Platnost dodatku", type: "date" },
  { key: "requestedAt", label: "Datum žádosti", type: "date" },
  { key: "validFrom", label: "Platnost od", type: "date" },
  { key: "today", label: "Dnešní datum", type: "date" },
  { key: "salary", label: "Plat", type: "number" },
  { key: "agreedReward", label: "Odměna DPP", type: "number" },
  { key: "hoursPerWeek", label: "Počet hodin týdně", type: "number" },
  // Dodatek-derived (populated on "změna smlouvy" contracts).
  { key: "newEndDate", label: "Nový konec smlouvy", type: "date" },
  { key: "newSalary", label: "Nová mzda", type: "number" },
  { key: "newHoursPerWeek", label: "Nový počet hodin týdně", type: "number" },
  { key: "oldSalary", label: "Předchozí mzda", type: "number" },
];
const COMPARABLE_BY_KEY = new Map(COMPARABLE_VARS.map((v) => [v.key, v]));

/** A comparison definition on a "condition" slot. */
export type CustomVarCondition = {
  leftKey: string;
  op: CompareOp;
  right: { kind: "var"; key: string } | { kind: "literal"; value: string };
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
  /** Only for type "condition": the comparison that computes this slot. */
  condition?: CustomVarCondition;
  /**
   * Only for type "list": the values offered in the generate-time dropdown, in
   * the order the author entered them. The chosen value is substituted verbatim,
   * so these are the display strings themselves — there is no code/label split,
   * which would be a second thing to keep in sync for no gain here.
   */
  options?: string[];
  /**
   * "Nepovinná" — the slot may be left blank at generation instead of blocking
   * it, for templates where only some of several offered fields apply.
   * An unfilled optional slot renders as an empty string. Absent = required
   * (the previous behaviour, so existing templates are unaffected).
   *
   * Meaningless for "bool" / "condition", which never block generation anyway;
   * the editor hides the checkbox for those rather than storing a no-op flag.
   */
  optional?: boolean;
  /**
   * Only for type "math": an arithmetic expression over other slots and number
   * literals, e.g. "var1 * var2" or "(var1 - var2) / 3". Evaluated by
   * `evalMathFormula` — a hand-written parser, never `eval`/`new Function`,
   * which the app's CSP posture rules out and which would execute whatever an
   * editor typed with the page's full privileges.
   */
  formula?: string;
  /**
   * Only for type "math": decimal places in the printed result (0–4, default 0).
   * Money is the common case and wants 0 or 2; a rate wants 3. Without this a
   * division would print 15 digits of float noise into a document.
   */
  decimals?: number;
}

/** Upper bounds on a math slot's configuration, shared with the server validators. */
export const CUSTOM_VAR_FORMULA_MAX = 200;
export const CUSTOM_VAR_DECIMALS_MAX = 4;

/** Slot key → its configuration on a given template. Stored on contractTemplates/{id}. */
export type CustomVarDefs = Record<string, CustomVarDef>;

export function isCustomVarKey(key: string): boolean {
  return CUSTOM_VAR_KEY_SET.has(key);
}

/** Every `{{…}}` form that REFERENCES a variable by name, in one pattern. */
const VAR_REFERENCE_RE =
  /\{\{(?:#if\s+|#unless\s+)?(\w+)\}\}|\{\{#case\s+(\w+)\s*(?:!=|=)/g;

/**
 * Which custom slots a template's HTML actually uses — as a plain `{{var1}}`
 * placeholder, as a `{{#if var1}}` / `{{#unless var1}}` condition, or as the
 * subject of a `{{#case var1 = …}}` switch. Returned in slot order (var1, var2,
 * …), not order of appearance, so the config UI and the generate form list them
 * predictably.
 *
 * A slot referenced ONLY by a `{{#case}}` still counts: it has to be filled in
 * for the switch to pick a branch, so it needs a form field and a label. Missing
 * that was the whole reason this became one shared regex rather than two.
 */
export function usedCustomVars(html: string): string[] {
  const used = new Set<string>();
  for (const m of html.matchAll(VAR_REFERENCE_RE)) {
    const key = m[1] ?? m[2];
    if (key && isCustomVarKey(key)) used.add(key);
  }
  // A math slot's formula and a condition's operands pull in slots that the
  // TEXT may never mention — {{var3}} = var1 * var2 needs var1 and var2 filled
  // even though neither appears in the document. Walk those in transitively.
  return CUSTOM_VAR_KEYS.filter((k) => used.has(k));
}

/**
 * `usedCustomVars` plus every slot reachable through a used slot's formula or
 * condition operands, transitively. This — not `usedCustomVars` — is the set the
 * generate form must ask for: a math slot in the text is useless if its inputs
 * never get a field.
 */
export function requiredCustomVars(html: string, defs: CustomVarDefs): string[] {
  const seen = new Set<string>(usedCustomVars(html));
  const queue = [...seen];
  while (queue.length > 0) {
    const def = defs[queue.pop()!];
    if (!def) continue;
    const deps: string[] = [];
    if (def.type === "math") deps.push(...formulaDependencies(def.formula ?? ""));
    if (def.type === "condition" && def.condition) {
      deps.push(def.condition.leftKey);
      if (def.condition.right.kind === "var") deps.push(def.condition.right.key);
    }
    for (const d of deps) {
      if (isCustomVarKey(d) && !seen.has(d)) {
        seen.add(d);
        queue.push(d);
      }
    }
  }
  return CUSTOM_VAR_KEYS.filter((k) => seen.has(k));
}

// ── Math slots ───────────────────────────────────────────────────────────────
//
// A "math" slot carries a formula over other slots: "var1 + var2", "(var1 -
// var2) * 0,21". Evaluated by the small recursive-descent parser below rather
// than `eval` / `new Function`: those would execute arbitrary JavaScript typed
// by whoever can edit a template, with the page's full privileges and the
// signed-in user's token — a template editor is not a trust boundary we want to
// put a script engine behind. The grammar is exactly four operators and
// parentheses, which is what was asked for and nothing more.
//
//   expr    := term (("+" | "-") term)*
//   term    := factor (("*" | "/") factor)*
//   factor  := ("-" | "+")? primary
//   primary := number | varN | "(" expr ")"

type MathToken =
  | { t: "num"; v: number }
  | { t: "var"; v: string }
  | { t: "op"; v: "+" | "-" | "*" | "/" }
  | { t: "("; }
  | { t: ")"; };

/** Split a formula into tokens. Returns null on any character it doesn't know. */
function tokenizeFormula(src: string): MathToken[] | null {
  const out: MathToken[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "(" ) { out.push({ t: "(" }); i++; continue; }
    if (c === ")") { out.push({ t: ")" }); i++; continue; }
    if (c === "+" || c === "-" || c === "*" || c === "/") {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }
    // A number, accepting the Czech decimal comma as well as the dot — the
    // author writes "0,21" on a Czech keyboard and it must not be a syntax error.
    const num = /^\d+(?:[.,]\d+)?/.exec(src.slice(i));
    if (num) {
      out.push({ t: "num", v: Number(num[0].replace(",", ".")) });
      i += num[0].length;
      continue;
    }
    const ident = /^[A-Za-z_]\w*/.exec(src.slice(i));
    if (ident) {
      out.push({ t: "var", v: ident[0] });
      i += ident[0].length;
      continue;
    }
    return null;
  }
  return out;
}

/**
 * Slot keys a formula references, in first-appearance order. Used to decide
 * which slots a math slot depends on (resolution order, and which fields the
 * generate form must ask for).
 */
export function formulaDependencies(formula: string): string[] {
  const tokens = tokenizeFormula(formula) ?? [];
  const out: string[] = [];
  for (const t of tokens) {
    if (t.t === "var" && isCustomVarKey(t.v) && !out.includes(t.v)) out.push(t.v);
  }
  return out;
}

/**
 * Evaluate a math formula against numeric slot values. Returns null — never a
 * partial or invented number — when the formula is malformed, references a slot
 * with no usable numeric value, or divides by zero. A document prints an empty
 * string for that slot rather than "NaN" or a silently wrong total.
 */
export function evalMathFormula(
  formula: string | undefined,
  values: Record<string, number | null>
): number | null {
  if (!formula || !formula.trim()) return null;
  const tokens = tokenizeFormula(formula);
  if (!tokens || tokens.length === 0) return null;

  let pos = 0;
  let failed = false;
  const peek = () => tokens[pos];

  function parseExpr(): number | null {
    let left = parseTerm();
    while (!failed) {
      const t = peek();
      if (!t || t.t !== "op" || (t.v !== "+" && t.v !== "-")) break;
      pos++;
      const right = parseTerm();
      if (left === null || right === null) { left = null; continue; }
      left = t.v === "+" ? left + right : left - right;
    }
    return left;
  }

  function parseTerm(): number | null {
    let left = parseFactor();
    while (!failed) {
      const t = peek();
      if (!t || t.t !== "op" || (t.v !== "*" && t.v !== "/")) break;
      pos++;
      const right = parseFactor();
      if (left === null || right === null) { left = null; continue; }
      // Division by zero yields null, not Infinity: printing "∞" into a
      // document, or a number derived from it, is worse than printing nothing.
      if (t.v === "/" && right === 0) { left = null; continue; }
      left = t.v === "*" ? left * right : left / right;
    }
    return left;
  }

  function parseFactor(): number | null {
    const t = peek();
    if (t && t.t === "op" && (t.v === "-" || t.v === "+")) {
      pos++;
      const v = parseFactor();
      if (v === null) return null;
      return t.v === "-" ? -v : v;
    }
    return parsePrimary();
  }

  function parsePrimary(): number | null {
    const t = peek();
    if (!t) { failed = true; return null; }
    if (t.t === "num") { pos++; return t.v; }
    if (t.t === "var") {
      pos++;
      const v = values[t.v];
      return v === undefined || v === null || !Number.isFinite(v) ? null : v;
    }
    if (t.t === "(") {
      pos++;
      const v = parseExpr();
      const close = peek();
      if (!close || close.t !== ")") { failed = true; return null; }
      pos++;
      return v;
    }
    failed = true;
    return null;
  }

  const result = parseExpr();
  // Trailing junk ("var1 var2") is a malformed formula, not a value.
  if (failed || pos !== tokens.length) return null;
  return result === null || !Number.isFinite(result) ? null : result;
}

/** A math result formatted for print: cs-CZ separators at the slot's precision. */
export function formatMathResult(value: number | null, decimals: number | undefined): string {
  if (value === null) return "";
  const d = Math.min(Math.max(Math.trunc(decimals ?? 0), 0), CUSTOM_VAR_DECIMALS_MAX);
  return new Intl.NumberFormat("cs-CZ", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(value);
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
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
    case "longtext":
      // The substitution target is HTML, so a raw "\n" would collapse to a
      // space and the author's paragraphs would print as one run-on block.
      // Every newline becomes a <br>, which keeps the result valid INSIDE the
      // <p> the placeholder sits in — emitting real </p><p> would nest block
      // elements and leave the surrounding paragraph's styling behind.
      // A blank line therefore yields two <br>, i.e. a visible paragraph gap.
      //
      // This is also the one slot type whose value is HTML-ESCAPED. A long free
      // text is prose, where "<" and "&" are ordinary characters an author will
      // eventually type; the short `text` type is deliberately left unescaped
      // because templates in production already rely on passing small HTML
      // fragments through it, and silently escaping those would change what
      // signed contracts render.
      return escapeHtml(value).replace(/\r\n|\r|\n/g, "<br>");
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
    case "list":
      // The picked value IS the display string (see CustomVarDef.options), so it
      // goes in verbatim — no lookup, no formatting.
      return value;
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
 * forever. A slot marked `optional` ("Nepovinná") is likewise never
 * missing: blank is an allowed answer there by the template's own configuration.
 */
export function missingCustomVars(
  html: string,
  defs: CustomVarDefs,
  rawValues: Record<string, string>
): string[] {
  // requiredCustomVars, not usedCustomVars: a slot that only feeds a formula or
  // a condition still has to be filled in, and blocking on it here is the whole
  // point — otherwise a computed total silently prints blank.
  return requiredCustomVars(html, defs).filter((key) => {
    const def = defs[key];
    const type = def?.type ?? "text";
    // bool + the computed types are never "missing": a checkbox's unticked
    // state is an answer, and a condition/math slot is derived rather than
    // typed in at generation.
    if (type === "bool" || isComputedVarType(type)) return false;
    // Explicitly allowed to stay blank – see CustomVarDef.optional.
    if (def?.optional) return false;
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
  // Salary in force immediately before this dodatek – exposed as the comparable
  // "Předchozí mzda" (oldSalary) so a derived condition can pick the change verb
  // itself, e.g. {{#if newSalary > oldSalary}}zvyšuje{{/if}}.
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
    agreedReward: formatSalaryCZ(employee.agreedReward),
    hoursPerWeek: str(employee.hoursPerWeek),
    ...(() => {
      const changes = employee.dodatekChanges ?? [];
      const findValue = (kind: string) =>
        changes.find((c) => c.changeKind === kind)?.value ?? "";
      const has = (kind: string) => changes.some((c) => c.changeKind === kind);
      const newSalaryStr = findValue("mzda");
      return {
        dodatekEffectiveDate: formatDateCZ(employee.dodatekEffectiveDate),
        newSalary: formatSalaryCZ(newSalaryStr),
        newJobTitle: str(findValue("pracovní pozice")),
        newWorkScope: str(findValue("úvazek")),
        newHoursPerWeek: str(findValue("počet hodin")),
        newEndDate: formatDateCZ(findValue("délka smlouvy")),
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

/** Coerce a value to an ISO YYYY-MM-DD string, or null if it isn't one. */
function toIsoDate(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}
/** Coerce a value to a finite number, or null. */
function toNumber(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Raw, typed values for the comparable built-in variables (COMPARABLE_VARS),
 * used to evaluate derived conditions. Dates stay ISO YYYY-MM-DD, numbers stay
 * numbers, missing values are null. Kept parallel to resolveVariables but
 * UNFORMATTED — comparing the formatted display strings would be meaningless.
 */
export function resolveComparableRaw(
  employee: EmployeeData
): Record<string, string | number | null> {
  const d = clock.now();
  const p = (x: number) => String(x).padStart(2, "0");
  const todayIso = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  // Dodatek "changes[]" carry the new values on a "změna smlouvy" contract;
  // resolve them the same way resolveVariables does, but keep them raw/typed.
  const changes = employee.dodatekChanges ?? [];
  const changeVal = (kind: string) => changes.find((c) => c.changeKind === kind)?.value ?? "";
  return {
    startDate: toIsoDate(employee.startDate),
    endDate: toIsoDate(employee.endDate),
    signingDate: toIsoDate(employee.signingDate),
    originalSigningDate: toIsoDate(employee.originalSigningDate),
    birthDate: toIsoDate(employee.birthDate),
    dodatekEffectiveDate: toIsoDate(employee.dodatekEffectiveDate),
    requestedAt: toIsoDate(employee.requestedAt),
    validFrom: toIsoDate(employee.validFrom),
    today: todayIso,
    salary: toNumber(employee.salary),
    agreedReward: toNumber(employee.agreedReward),
    hoursPerWeek: toNumber(employee.hoursPerWeek),
    newEndDate: toIsoDate(changeVal("délka smlouvy")),
    newSalary: toNumber(changeVal("mzda")),
    newHoursPerWeek: toNumber(changeVal("počet hodin")),
    oldSalary: toNumber(employee.oldSalary),
  };
}

/**
 * Evaluate a derived condition against raw comparable values. Returns false
 * (block hidden) when the definition is incomplete or either operand is missing
 * / unparseable — a safe default that never invents a value on a contract. Dates
 * compare chronologically (ISO strings), numbers numerically. The unary
 * `empty` / `notEmpty` operators test only whether the left operand has a value
 * (null / undefined / "" = empty; a real 0 is NOT empty).
 */
export function evalCondition(
  cond: CustomVarCondition | undefined,
  raw: Record<string, string | number | null>,
  // Slot configs, so a condition may also compare CUSTOM slots (var1 > var2) —
  // the only operands Dokumenty has, since it binds no employee record. Absent
  // for a contract template that compares built-ins only, which is why this is
  // an optional third parameter rather than a signature change: every existing
  // call site keeps compiling and keeps behaving identically.
  defs: CustomVarDefs = {}
): boolean {
  if (!cond) return false;
  const leftType: ComparableType | null =
    COMPARABLE_BY_KEY.get(cond.leftKey)?.type ??
    (isCustomVarKey(cond.leftKey) ? comparableTypeOfCustom(defs[cond.leftKey]?.type) : null);
  if (!leftType) return false;

  if (cond.op === "empty" || cond.op === "notEmpty") {
    const v = raw[cond.leftKey];
    const isEmpty = v === null || v === undefined || String(v).trim() === "";
    return cond.op === "empty" ? isEmpty : !isEmpty;
  }

  // Text operands compare as trimmed, case-insensitive strings and support only
  // equality — see OPS_FOR_COMPARABLE. Ordering free text would answer a
  // question nobody asked and would depend on locale collation.
  if (leftType === "text") {
    const norm = (v: unknown) =>
      v === null || v === undefined ? "" : String(v).trim().toLocaleLowerCase("cs");
    const left = norm(raw[cond.leftKey]);
    const right = norm(cond.right.kind === "var" ? raw[cond.right.key] : cond.right.value);
    if (cond.op === "eq") return left === right;
    if (cond.op === "neq") return left !== right;
    return false;
  }

  const coerce = (v: unknown) => (leftType === "number" ? toNumber(v) : toIsoDate(v));
  const left = coerce(raw[cond.leftKey]);
  const right = coerce(cond.right.kind === "var" ? raw[cond.right.key] : cond.right.value);
  if (left === null || right === null) return false;
  const cmp = left < right ? -1 : left > right ? 1 : 0;
  switch (cond.op) {
    case "lt": return cmp < 0;
    case "lte": return cmp <= 0;
    case "gt": return cmp > 0;
    case "gte": return cmp >= 0;
    case "eq": return cmp === 0;
    case "neq": return cmp !== 0;
    default: return false;
  }
}

/**
 * The raw, typed value an INPUT slot contributes to comparisons and `{{#case}}`
 * matching — as opposed to its printed form. A date stays ISO so it orders
 * chronologically, a number stays a number, and a bool becomes "ano" / "" so it
 * reads the same way the built-in booleans do.
 */
function rawSlotValue(type: CustomVarType, raw: string): string | number | null {
  const value = (raw ?? "").trim();
  switch (type) {
    case "number":
      return toNumber(value);
    case "date":
      return toIsoDate(value);
    case "bool":
      return value === "true" ? "ano" : "";
    default:
      return value;
  }
}

/** The numeric reading of a slot for use inside a formula, or null. */
function numericSlotValue(v: string | number | null | undefined): number | null {
  if (v === "ano") return 1;
  return toNumber(v);
}

export interface ResolvedCustomVars {
  /** Printed values for the COMPUTED slots only, ready for {{varN}} substitution. */
  formatted: Record<string, string>;
  /** Raw/typed values for every slot in play — drives {{#case}} and conditions. */
  raw: Record<string, string | number | null>;
}

/**
 * Resolve the derived slots — `math` and `condition` — from the values the user
 * typed for the input slots.
 *
 * Order matters and is not knowable up front, because a formula may reference
 * another math slot ({{var3}} = var1 + var2, {{var4}} = var3 * 2). Rather than
 * demanding the author declare them in dependency order, this runs a fixpoint:
 * each pass computes every math slot whose inputs are now known, and stops as
 * soon as a pass makes no progress. That termination condition doubles as the
 * CYCLE GUARD — var1 = var2 + 1 alongside var2 = var1 + 1 simply makes no
 * progress on the first pass and both resolve to empty, instead of hanging the
 * browser or overflowing the stack.
 *
 * Conditions are evaluated last, once every math result is available, and may
 * therefore test a computed total. A condition can never be an operand of
 * another condition (`comparableTypeOfCustom` refuses the type), so conditions
 * need no fixpoint of their own.
 *
 * `fixedRaw` carries the employee/contract comparables on the contracts side and
 * is simply empty for Dokumenty. Passing it here is what lets a contract's math
 * slot reference a built-in like `salary` for free.
 */
export function resolveComputedVars(
  keys: string[],
  defs: CustomVarDefs,
  inputRaw: Record<string, string>,
  fixedRaw: Record<string, string | number | null> = {}
): ResolvedCustomVars {
  const raw: Record<string, string | number | null> = { ...fixedRaw };
  const formatted: Record<string, string> = {};

  for (const key of keys) {
    const type = defs[key]?.type ?? "text";
    if (isComputedVarType(type)) continue;
    raw[key] = rawSlotValue(type, inputRaw[key] ?? "");
  }

  const mathKeys = keys.filter((k) => defs[k]?.type === "math");
  const pending = new Set(mathKeys);
  while (pending.size > 0) {
    let progressed = false;
    for (const key of [...pending]) {
      const def = defs[key];
      const deps = formulaDependencies(def?.formula ?? "");
      // Wait for any dependency that is itself an unresolved math slot; every
      // other dependency is either already raw or genuinely unavailable.
      if (deps.some((d) => pending.has(d))) continue;
      const values: Record<string, number | null> = {};
      for (const d of deps) values[d] = numericSlotValue(raw[d]);
      const result = evalMathFormula(def?.formula, values);
      raw[key] = result;
      formatted[key] = formatMathResult(result, def?.decimals);
      pending.delete(key);
      progressed = true;
    }
    if (!progressed) break;
  }
  // Whatever is left is part of a dependency cycle (or depends on one): resolve
  // it to empty rather than leaving the placeholder unsubstituted in the PDF.
  for (const key of pending) {
    raw[key] = null;
    formatted[key] = "";
  }

  for (const key of keys) {
    const def = defs[key];
    if (def?.type !== "condition") continue;
    const hit = evalCondition(def.condition, raw, defs);
    raw[key] = hit ? "ano" : "";
    formatted[key] = hit ? "ano" : "";
  }

  return { formatted, raw };
}

// One token: an opener ({{#if x}} / {{#unless x}} / {{#case x = v}}) or a closer
// ({{/if}} / {{/unless}} / {{/case}}).
//
// The `#case` value is everything up to the closing braces, so it may contain
// spaces ("{{#case var1 = Amigo & Alqush}}") — a switch matches list choices,
// and list choices are human labels. It may NOT contain "}", which is the only
// way to know where the tag ends without a real lexer; a choice containing a
// brace is the one thing a switch can't match, and the editor says so.
const BLOCK_TAG_RE =
  /\{\{(#if|#unless)\s+(\w+)\}\}|\{\{#case\s+(\w+)\s*(!=|=)\s*([^}]*?)\s*\}\}|\{\{\/(if|unless|case)\}\}/g;

// TipTap stores the document as HTML, so by the time a tag reaches this parser
// its literal text has been entity-encoded and its spaces may have become
// non-breaking ones. A value typed as "Amigo & Alqush" arrives as
// "Amigo &amp; Alqush" and would never match the stored choice "Amigo & Alqush"
// without decoding first.
const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/**
 * Normalise a value for `{{#case}}` matching: decode entities, fold non-breaking
 * spaces and runs of whitespace, trim, lowercase. Case- and spacing-insensitive
 * on purpose — the author retypes the choice by hand in the tag, and a switch
 * that silently fails because they wrote "praha" instead of "Praha" is a bug
 * report, not a feature.
 */
function normaliseCaseValue(s: string): string {
  return s
    .replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&apos;|&nbsp;/g, (e) => HTML_ENTITIES[e])
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("cs");
}
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
  | { type: "block"; kind: "if" | "unless"; key: string; children: BlockNode[] }
  | { type: "case"; key: string; op: "=" | "!="; value: string; children: BlockNode[] };

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
type OpenFrame = {
  tag: "if" | "unless" | "case";
  key: string;
  op?: "=" | "!=";
  value?: string;
  children: BlockNode[];
};

function parseBlocks(html: string): BlockNode[] {
  const root: BlockNode[] = [];
  const stack: OpenFrame[] = [];
  const current = () => (stack.length ? stack[stack.length - 1].children : root);
  const openerText = (f: OpenFrame) =>
    f.tag === "case" ? `{{#case ${f.key} ${f.op} ${f.value}}}` : `{{#${f.tag} ${f.key}}}`;

  const re = new RegExp(BLOCK_TAG_RE.source, "g");
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html)) !== null) {
    if (m.index > last) current().push({ type: "text", value: html.slice(last, m.index) });
    last = re.lastIndex;

    if (m[1]) {
      stack.push({ tag: m[1] === "#if" ? "if" : "unless", key: m[2], children: [] });
      continue;
    }
    if (m[3]) {
      stack.push({ tag: "case", key: m[3], op: m[4] as "=" | "!=", value: m[5], children: [] });
      continue;
    }

    const closing = m[6] as "if" | "unless" | "case";
    const top = stack[stack.length - 1];
    if (!top || top.tag !== closing) {
      // Stray or mismatched closer – keep it as text rather than guessing.
      current().push({ type: "text", value: m[0] });
      continue;
    }
    stack.pop();
    current().push(
      top.tag === "case"
        ? { type: "case", key: top.key, op: top.op ?? "=", value: top.value ?? "", children: top.children }
        : { type: "block", kind: top.tag, key: top.key, children: top.children }
    );
  }

  if (last < html.length) current().push({ type: "text", value: html.slice(last) });

  // Unclosed openers: flush the opener tag literally, then its content.
  while (stack.length > 0) {
    const top = stack.pop()!;
    const parent = stack.length ? stack[stack.length - 1].children : root;
    parent.push({ type: "text", value: openerText(top) }, ...top.children);
  }

  return root;
}

/** Render the tree: a kept block recurses (so nesting resolves), a dropped one
 *  collapses to the strip marker exactly as before. */
function renderBlocks(
  nodes: BlockNode[],
  vars: Record<string, string>,
  // Raw/typed values, used ONLY for {{#case}} equality. A number's printed form
  // carries thousands separators ("1 500") that its raw form does not ("1500"),
  // so matching against `vars` would make a numeric switch fail for reasons
  // invisible in the editor. Defaults to `vars` for callers with no raw map.
  rawVars: Record<string, string | number | null>
): string {
  let out = "";
  for (const n of nodes) {
    if (n.type === "text") {
      out += n.value;
      continue;
    }
    if (n.type === "case") {
      const actual = normaliseCaseValue(String(rawVars[n.key] ?? ""));
      const expected = normaliseCaseValue(n.value);
      const hit = actual === expected;
      const keep = n.op === "=" ? hit : !hit;
      out += keep ? renderBlocks(n.children, vars, rawVars) : STRIP_MARKER;
      continue;
    }
    const truthy = !!vars[n.key];
    const keep = n.kind === "if" ? truthy : !truthy;
    out += keep ? renderBlocks(n.children, vars, rawVars) : STRIP_MARKER;
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
function processConditionals(
  html: string,
  vars: Record<string, string>,
  rawVars: Record<string, string | number | null> = vars
): string {
  let out = renderBlocks(parseBlocks(html), vars, rawVars);
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
export function fillTemplate(
  html: string,
  vars: Record<string, string>,
  rawVars?: Record<string, string | number | null>
): string {
  const processed = processConditionals(html, vars, rawVars ?? vars);
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
