/**
 * Normalize the connector in compound Czech place names inside a free-text
 * address, per ÚJČ (prirucka.ujc.cas.cz id=164 spojovník / id=165 pomlčka):
 *   - both joined parts single-word        → spojovník "-" (U+002D), no spaces
 *       e.g. Frýdek-Místek, Praha-Kunratice
 *   - a multi-word part (incl. "Praha 4")  → pomlčka en-dash "–" (U+2013), spaces
 *       e.g. Praha 4 – Modřany, Brandýs nad Labem – Stará Boleslav
 *   - em-dash "—" and other dash variants are normalized to one of the two above
 *
 * Conservative: only a connector with a letter on at least one side is rewritten,
 * so house ranges ("12-14") and dash-free text are untouched. Operates per
 * comma-separated segment so a connector in one part doesn't affect the others.
 */
const SPOJOVNIK = "-";          // hyphen-minus, tight
const POMLCKA = " – ";     // en dash with spaces
const DASH_CLASS = "\\u002D\\u2010\\u2011\\u2012\\u2013\\u2014\\u2015\\u2212";
const anyDash = new RegExp(`[${DASH_CLASS}]`);
const joinRe = new RegExp(`([^\\s])[ \\t]*[${DASH_CLASS}][ \\t]*([^\\s])`, "gu");
const MARK = "@@JOIN@@";        // transient join marker (never present in real input)

function fixSegment(seg: string): string {
  let join = false;
  const marked = seg.replace(joinRe, (m, l: string, r: string) => {
    if (!/\p{L}/u.test(l) && !/\p{L}/u.test(r)) return m; // pure numeric/symbol — not a name join
    join = true;
    return l + MARK + r;                                  // mark join, drop surrounding spaces
  });
  if (!join) return seg;
  const multiWord = /\s/.test(marked.split(MARK).join("").trim());
  return marked.split(MARK).join(multiWord ? POMLCKA : SPOJOVNIK);
}

/** Normalize place-name connectors in a single free-text address string. */
export function normalizeCzechAddressConnector(value: string): string {
  if (!anyDash.test(value)) return value;
  return value.split(",").map(fixSegment).join(",");
}

/**
 * Return a shallow copy of a contact payload with `permanentAddress` and
 * `contactAddress` connectors normalized (other fields untouched).
 */
export function normalizeContactAddresses<T extends Record<string, unknown>>(data: T): T {
  const out: Record<string, unknown> = { ...data };
  for (const field of ["permanentAddress", "contactAddress"]) {
    if (typeof out[field] === "string") {
      out[field] = normalizeCzechAddressConnector(out[field] as string);
    }
  }
  return out as T;
}
