/**
 * Objednávky (Tabulky → Objednávky) — types + seed defaults.
 *
 * The feature builds an ORDER E-MAIL and nothing else. No order is ever
 * persisted: the page assembles text, you copy it, you send it from Outlook.
 * The only stored state is this configuration (`settings/objednavkyConfig`),
 * which is the číselník behind the two pickers.
 *
 * Mirrored client-side by `frontend/src/lib/objednavky.ts`, which also owns the
 * e-mail rendering — the server never renders the message, so there is no
 * arithmetic or layout to keep in step across the two files, only these types.
 *
 * ⚠️ These hotels are a FOURTH hotel registry, independent of `lib/hotels.ts`
 * (four Recepce desks, Amigo+Alqush merged) and of `invoiceTypes.ts`
 * (five invoicing entities). That is deliberate, and the same reasoning
 * invoiceTypes.ts already spells out applies here: an invoice `footer` is a
 * printed contact block carrying a VAT number, an e-mail and a web address,
 * NOT a delivery address, and the two would never want to change together.
 * Reusing it would put the phone number inside the sentence "s doručením na
 * adresu …", and would mean an invoice-formatting edit silently rewrites an
 * order e-mail. Do not attempt to reconcile the three registries.
 */

/**
 * How the supplier sells the item. Stored and PRINTED VERBATIM — the value is
 * the word that appears in the e-mail ("3 balení"), so there is no label map
 * to fall out of step with it. Both forms are invariant in Czech across every
 * quantity (1 balení / 2 balení / 5 balení), so no pluralisation is needed.
 */
export type OrderUnit = "ks" | "balení";

export const ORDER_UNITS: readonly OrderUnit[] = ["ks", "balení"];

export interface OrderItem {
  id: string;
  name: string;
  /**
   * The supplier's article code. Kept SEPARATE from the name (it is rendered
   * back as "name (code)") so the search box can match on it and so a code can
   * be corrected without retyping the name. Empty string = the item has none,
   * which is a normal state — "Prachovka" ships without one — and it then
   * renders with no parentheses at all rather than an empty pair.
   */
  code: string;
  unit: OrderUnit;
  active: boolean;
}

export interface OrderHotel {
  id: string;
  name: string;
  /** Free text, dropped into "s doručením na adresu …". */
  deliveryAddress: string;
  /**
   * Points at a `companies/{id}` doc (Nastavení → Společnosti). The billing
   * block printed after "a fakturačními údaji …" is composed from that document
   * at READ time — `{name}, IČO: {ic}, {address}`, with DIČ deliberately NOT
   * printed — and never stored here, so a correction in Nastavení fixes every
   * future order e-mail at once. The format lives in
   * `frontend/src/lib/objednavky.ts` → `companyInvoiceDetails()`.
   *
   * ⚠️ The company's `abbreviation` must never reach the e-mail. It is an
   * internal handle (HPM, STP), not part of the legal identity.
   */
  companyId: string | null;
  active: boolean;
}

export interface ObjednavkyConfig {
  items: OrderItem[];
  hotels: OrderHotel[];
}

/* ------------------------------------------------------------------ */
/* Seed defaults                                                       */
/* ------------------------------------------------------------------ */

/**
 * Written as `settings/objednavkyConfig` the first time an admin saves the
 * číselník; until then it is served as-is by a GET that deliberately does not
 * write (same lazy-seed contract as `settings/fakturyConfig`).
 *
 * Note `CLEAMEN 220 (nerez)`: its name legitimately contains parentheses that
 * are NOT the article code. That is precisely the case a single combined
 * name field would have made impossible to parse back apart.
 */
export const DEFAULT_ORDER_ITEMS: OrderItem[] = [
  { id: "ajax-univerzal-1l", name: "AJAX univerzál 1L", code: "2144", unit: "balení", active: true },
  { id: "alfa-ariel-15kg", name: "ALFA-ARIEL profesionál 15kg", code: "70405", unit: "ks", active: true },
  { id: "argonit-vanilla-1l", name: "ARGONIT Vanilla 1L", code: "2152", unit: "ks", active: true },
  { id: "cif-tekuty-pisek", name: "CIF - jemný tekutý písek Citron", code: "1401c", unit: "balení", active: true },
  { id: "cleamen-220", name: "CLEAMEN 220 (nerez)", code: "892295", unit: "ks", active: true },
  { id: "domestos", name: "Domestos různé druhy - moře,citron,red,pink", code: "1408", unit: "balení", active: true },
  { id: "houba-big-max", name: "Houba BIG MAX 8x17cm na nádobí", code: "70030", unit: "ks", active: true },
  { id: "houba-mala-10ks", name: "Houba na nádobí malá balená po 10 ks", code: "903m", unit: "balení", active: true },
  { id: "hygienicke-sacky", name: "Hygienické sáčky Hermoplastic", code: "7153", unit: "balení", active: true },
  { id: "jar-450ml", name: "JAR 450ml", code: "35000", unit: "ks", active: true },
  { id: "lanza-color", name: "Lanza color 84PD 6.3kg", code: "97050074", unit: "ks", active: true },
  { id: "mikrouterka-spontex", name: "Mikroutěrka Spontex 8+2 Microfibre Multi", code: "19700237", unit: "ks", active: true },
  { id: "papirove-kapesniky", name: "Papírové kapesníky v bílé krabičce", code: "500", unit: "balení", active: true },
  { id: "prachovka", name: "Prachovka", code: "", unit: "ks", active: true },
  { id: "pulirapid", name: "Pulirapid", code: "15017", unit: "balení", active: true },
  { id: "pulirapid-vetri", name: "PULIRAPID Vetri čistič oken s rozprašovačem", code: "15043", unit: "balení", active: true },
  { id: "rukavice-l", name: "Rukavice nitrilové Černé L/100ks", code: "91B", unit: "balení", active: true },
  { id: "rukavice-m", name: "Rukavice nitrilové Černé M/100ks", code: "91Q", unit: "balení", active: true },
  { id: "rukavice-s", name: "Rukavice nitrilové Černé S/100ks", code: "91SD", unit: "balení", active: true },
  { id: "savo-4l", name: "Savo 4L", code: "14251", unit: "ks", active: true },
  { id: "savo-glanz-koupelny", name: "SAVO Glanz na koupelny", code: "85084", unit: "balení", active: true },
  { id: "savo-glanc-kuchyne", name: "Savo GLANC na kuchyně 500ml", code: "41437", unit: "balení", active: true },
  { id: "savo-plisen", name: "SAVO proti plísni / rozprašovač", code: "80225", unit: "balení", active: true },
  { id: "smetak-zluty", name: "Smeták žlutý s násadou", code: "6751", unit: "ks", active: true },
];

/**
 * The four hotels ship with an EMPTY address and no company on purpose: neither
 * is in the repo nor derivable from any other collection, so seeding a guess
 * would put a wrong address into a real supplier e-mail. The tab tells the user
 * which hotels are still missing them and refuses to build an e-mail for one,
 * which is a loud, one-time prompt to fill them in.
 *
 * `name` carries the lowercase "hotel " prefix because it is substituted
 * mid-sentence ("prosím o objednání na hotel Ambiance …"), not used as a title.
 */
export const DEFAULT_ORDER_HOTELS: OrderHotel[] = [
  { id: "ambiance", name: "hotel Ambiance", deliveryAddress: "", companyId: null, active: true },
  { id: "superior", name: "hotel Superior", deliveryAddress: "", companyId: null, active: true },
  { id: "amigo", name: "hotel Amigo", deliveryAddress: "", companyId: null, active: true },
  { id: "ankora", name: "hotel Ankora", deliveryAddress: "", companyId: null, active: true },
];

export const DEFAULT_OBJEDNAVKY_CONFIG: ObjednavkyConfig = {
  items: DEFAULT_ORDER_ITEMS,
  hotels: DEFAULT_ORDER_HOTELS,
};
