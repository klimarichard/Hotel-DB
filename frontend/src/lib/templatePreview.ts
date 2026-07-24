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
  isFixedVarPassthrough,
  isComputedVarType,
  isImageDataUri,
  findImageOption,
  usedCustomVars,
  requiredCustomVars,
  resolveComputedVars,
  type CustomVarDef,
  type CustomVarDefs,
  type CustomVarType,
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
  // Bare number too (formatSalaryCZ, same as salary); the unit goes in the text.
  // Auto-compute rounds the total DPP reward up to a whole multiple of 10.000,
  // so a realistic sample always shows the thousands separator.
  agreedReward: "120.000",
  // Dodatky
  dodatekEffectiveDate: "1. 9. 2026",
  newSalary: "38.000",
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

/**
 * Sample values for a custom slot, by its configured type — in the slot's RAW
 * form (what the generate dialog's field would hold), not its printed form. The
 * printed form is derived from these with `formatCustomValue`, i.e. through
 * exactly the path a real generation takes, so the preview can't drift from what
 * the document will actually say.
 *
 * `longtext` is deliberately three real paragraphs. The preview exists to check
 * LAYOUT (see the file header), and a one-line stand-in for a slot that will
 * carry half a page of prose would misrepresent the vertical space it consumes —
 * exactly the thing you opened the preview to look at.
 */
const MOCK_CUSTOM_RAW_BY_TYPE: Partial<Record<CustomVarType, string>> = {
  text: "ukázkový text",
  longtext:
    "Zaměstnanec bere na vědomí, že veškeré informace, se kterými se v souvislosti " +
    "s výkonem práce seznámí, zejména údaje o hostech, obchodních partnerech " +
    "a vnitřních postupech zaměstnavatele, jsou důvěrné a tvoří obchodní tajemství " +
    "zaměstnavatele.\n\n" +
    "Zaměstnanec se zavazuje tyto informace nesdělovat třetím osobám ani je " +
    "nevyužívat pro svou vlastní potřebu nebo pro potřebu jiné osoby, a to po celou " +
    "dobu trvání pracovního poměru i po jeho skončení.\n\n" +
    "Porušení této povinnosti se považuje za závažné porušení povinností " +
    "vyplývajících z právních předpisů vztahujících se k zaměstnancem vykonávané " +
    "práci.",
  date: "2026-08-01",
  number: "1500",
};

/**
 * Raw, typed stand-ins for the comparable variables, used to evaluate a
 * `condition` custom slot in the preview. Mirror the MOCK_TEXT samples above but
 * as ISO dates / plain numbers (what evalCondition compares on). Exported so the
 * preview panel can seed its editable operand fields from the same values.
 */
export const PREVIEW_RAW_DEFAULTS: Record<string, string | number> = {
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
  agreedReward: 120000,
  hoursPerWeek: 40,
  newEndDate: "2027-12-31",
  newSalary: 38000,
  newHoursPerWeek: 20,
  oldSalary: 35000,
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
  // usedCustomVars rather than referencedKeys for the custom half: it also sees a
  // slot that only appears as the subject of a {{#case}}, which still needs a
  // checkbox for the switch to have anything to match on.
  const used = new Set(usedCustomVars(html));
  const custom = Object.keys(defs)
    .filter((k) => defs[k]?.type === "bool" && used.has(k))
    // Numeric, not lexicographic: with slots running to var25, a string sort
    // would put var10 before var2. (Number("var25".replace("var","")) === 25.)
    .sort((a, b) => Number(a.replace("var", "")) - Number(b.replace("var", "")));
  return [...permanent, ...custom];
}

/**
 * The RAW sample value an INPUT slot gets in the preview — the string its
 * generate-dialog field would hold. Preference order matches generation: the
 * slot's configured default first (so the preview shows what will be pre-filled),
 * then a value the slot can actually take, then realistic mock text. A blank
 * would collapse the line and lie about the layout, so it is always the last
 * resort.
 *
 * `fixedVars` is the already-FORMATTED sample map: a fixed-variable default
 * resolves to a printed string ("1. 8. 2026"), which is exactly what
 * isFixedVarPassthrough exists to carry through unformatted.
 */
function previewRawFor(
  key: string,
  def: CustomVarDef | undefined,
  bools: Record<string, boolean>,
  fixedVars: Record<string, string>
): string {
  const type = def?.type ?? "text";
  if (type === "bool") return bools[key] ? "true" : "";
  const d = def?.default;
  // An image slot previews with a REAL picture: the whole reason the preview
  // exists is to judge layout, and a picture is the single largest thing a slot
  // can put on the page. Its configured default first (that is what the generate
  // dialog will pre-select), otherwise the first choice that can actually
  // render — a choice with no picture would preview as nothing while a later,
  // complete one would have shown the true height.
  //
  // With NOTHING configured the preview stays blank on purpose, unlike every
  // other type: there is no mock picture to stand in with, and inventing one
  // would show a layout the document can never produce. Blank is what the
  // document will genuinely print, and the editor already warns about the slot.
  if (type === "image") {
    const configuredDefault =
      d?.kind === "literal" ? findImageOption(def, d.value) : undefined;
    const chosen =
      configuredDefault ??
      (def?.images ?? []).find((o) => o.label.trim() && isImageDataUri(o.src));
    return chosen?.label ?? "";
  }
  if (d?.kind === "fixedVar" && (fixedVars[d.key] ?? "")) return fixedVars[d.key];
  if (d?.kind === "literal" && d.value.trim()) return d.value;
  // A list slot previews with one of its own choices; generic mock text would
  // misrepresent the line width for a slot whose values are known and often short.
  if (type === "list") {
    return def?.options?.find((o) => o.trim()) ?? MOCK_CUSTOM_RAW_BY_TYPE.text!;
  }
  return MOCK_CUSTOM_RAW_BY_TYPE[type] ?? MOCK_CUSTOM_RAW_BY_TYPE.text!;
}

/** What the preview needs to render one template: see `buildPreview`. */
export interface PreviewData {
  /** Printed values — `fillTemplate`'s second argument. */
  vars: Record<string, string>;
  /**
   * `fillTemplate`'s THIRD argument, driving `{{#case}}` matching. Typed values
   * (ISO dates, real numbers) layered OVER the printed ones, deliberately: a
   * switch on a key with no raw form (say `{{#case firstName = Jana}}`) then
   * still matches on its display string, exactly as it did when fillTemplate was
   * called with no raw map at all. Handing it the pure raw map would silently
   * stop such a switch from ever matching.
   */
  raw: Record<string, string | number | null>;
}

/**
 * Build everything the preview renders with: realistic text for every permanent
 * variable, the caller's checkbox state for the conditionals ("ano" / "" is the
 * truthiness convention the conditional engine expects), and — for the custom
 * slots — the same resolution path a real generation takes.
 *
 * The computed slots (`condition`, `math`) are genuinely COMPUTED here rather
 * than stood in for with mock text: a total is the one value an author cannot
 * eyeball, and a preview that printed "ukázkový text" where the document will
 * print a number would be worse than no preview at all.
 */
export function buildPreview(
  html: string,
  defs: CustomVarDefs,
  bools: Record<string, boolean>,
  // Editable operand values from the preview panel, layered over the defaults so
  // the user can drive a condition's comparison and watch it flip.
  rawOverrides: Record<string, string | number> = {}
): PreviewData {
  const vars: Record<string, string> = { ...MOCK_TEXT };
  const fixedRaw = { ...PREVIEW_RAW_DEFAULTS, ...rawOverrides };

  for (const key of CONDITIONAL_KEYS) vars[key] = bools[key] ? "ano" : "";

  // requiredCustomVars, not the slots the text mentions: a math slot's operands
  // may appear nowhere in the document, and without sample values for them the
  // total would preview blank while the real one prints fine.
  const keys = requiredCustomVars(html, defs);

  const inputRaw: Record<string, string> = {};
  for (const key of keys) {
    const def = defs[key];
    if (isComputedVarType(def?.type ?? "text")) continue;
    inputRaw[key] = previewRawFor(key, def, bools, vars);
  }

  // One call resolves the math fixpoint AND the conditions, with the permanent
  // sample values as `fixedRaw` so a condition over a built-in (Datum podpisu <
  // Datum nástupu) evaluates against the panel's editable fields, and `defs` so
  // a condition over another custom slot resolves too.
  const { formatted, raw } = resolveComputedVars(keys, defs, inputRaw, fixedRaw);

  for (const key of keys) {
    const def = defs[key];
    const type = def?.type ?? "text";
    if (isComputedVarType(type)) {
      vars[key] = formatted[key] ?? "";
      continue;
    }
    // A fixed-variable default is already a printed string; re-formatting it
    // would corrupt it (a date would stop parsing) – same rule as generation.
    // `def` as the third argument, not for show: an image slot's raw value is a
    // choice's name, and turning that back into an <img> needs the slot's own
    // picture list. Without it the preview would render nothing for exactly the
    // type whose layout you opened the preview to check.
    vars[key] = isFixedVarPassthrough(def)
      ? inputRaw[key] ?? ""
      : formatCustomValue(type, inputRaw[key] ?? "", def);
  }

  return { vars, raw: { ...vars, ...raw } };
}

/**
 * Comparable-variable keys that the template's `condition` slots compare on
 * (left operand + any variable right operand), in slot order. These are the
 * operands the preview panel offers as editable fields so the user can drive a
 * condition and watch which branch it keeps.
 */
export function usedConditionOperands(html: string, defs: CustomVarDefs): string[] {
  const keys = new Set<string>();
  for (const key of requiredCustomVars(html, defs)) {
    const def = defs[key];
    if (def?.type !== "condition" || !def.condition) continue;
    keys.add(def.condition.leftKey);
    if (def.condition.right.kind === "var") keys.add(def.condition.right.key);
  }
  // A condition may now also compare CUSTOM slots against each other. Those are
  // not editable operands in the preview bar – their sample value comes from the
  // slot's own default/mock, the same way the slot itself previews – so they are
  // dropped here rather than surfacing as a field with nothing behind it.
  return [...keys].filter((k) => !isCustomVarKey(k));
}

/** Conditionals start ON, so the preview opens showing the fuller document. */
export function defaultBools(keys: string[]): Record<string, boolean> {
  return Object.fromEntries(keys.map((k) => [k, true]));
}
