/**
 * Faktury — shared types, seed defaults and the pure invoice arithmetic.
 *
 * The app does NOT issue invoices: Protel does. This module backs a *visual
 * reproduction* tool used when Protel has created an invoice it can no longer
 * display. Everything here is therefore reconstruction, never allocation —
 * most importantly `invoiceNo` is an INPUT typed by the user, and there is no
 * sequential counter anywhere in this feature.
 *
 * Mirrored on the client by `frontend/src/lib/faktury.ts`. The two files must
 * stay in lockstep (same deliberate duplication as `services/hotels.ts` ↔
 * `lib/hotels.ts` — the client needs the arithmetic to render a live preview,
 * the server needs it to render the PDF).
 */

/**
 * Czech VAT law taxes a *received advance* on its own recap line, separate
 * from the supply it will later settle. The source workbook encodes this as
 * two parallel blocks of rate rows (normal 10/12/15/21, then advance
 * 10/12/15/21) — which is why a bucket is a (percent, block) pair and not
 * just a number.
 */
export type VatBlock = "normal" | "advance";

/**
 * A line is one of three things, and the distinction drives the totals:
 *  - "item"     a charge. Counts toward Total and toward the VAT recap.
 *  - "payment"  money already received (stored negative). Counts toward
 *               Received Payments only — never toward the VAT recap.
 *  - "transfer" the folio-to-agency transfer line ("Invoice", negative).
 *               Printed, but excluded from BOTH totals and the recap: it
 *               documents that the guest folio was zeroed, it is not itself
 *               a supply or a payment.
 */
export type LineGroup = "item" | "payment" | "transfer";

export interface VatRate {
  id: string;
  /** Printed verbatim in the recap's left column. */
  label: string;
  /** 0 for the exempt / out-of-scope buckets. */
  percent: number;
  block: VatBlock;
  active: boolean;
}

/** One entry of the admin-maintained posting catalogue (the workbook's TAA sheet). */
export interface CatalogItem {
  id: string;
  description: string;
  /** null only for payment/transfer entries, which carry no VAT bucket. */
  vatRateId: string | null;
  group: LineGroup;
  active: boolean;
}

export interface PartyAddress {
  street1: string;
  street2: string;
  street3: string;
  zip: string;
  city: string;
  country: string;
  ic: string;
  dic: string;
}

/** A contracted B2B partner from the address book (the workbook's Invoice Details sheet). */
export interface Agency extends PartyAddress {
  id: string;
  name: string;
  active: boolean;
}

export interface BankBlock {
  account: string;
  swift: string;
  iban: string;
}

/**
 * An invoicing entity. NOTE this is five entries, not the app's four Recepce
 * hotels: Amigo and Alqush share a bank account but have distinct book
 * numbers and distinct footers, so they are separate invoice hotels even
 * though `lib/hotels.ts` merges them into one `amigo-alqush` slug. This
 * registry is independent of the Recepce one on purpose.
 */
export interface InvoiceHotel {
  id: string;
  name: string;
  /** Digits 3–4 of a normal invoice number. null = not decodable. */
  bookNo: number | null;
  /** Digits 3–4 of a deposit invoice number. */
  depositBookNo: number | null;
  /** Points at a `companies/{id}` doc — supplies the issuer footer line. */
  companyId: string | null;
  /** Header logo, inlined as a data: URI (the renderer blocks remote fetches). */
  logoDataUri: string;
  /** Property footer block printed under the invoice. */
  footer: string;
  /** Bank branch line printed above both account blocks. */
  bankName: string;
  bankEur: BankBlock;
  bankCzk: BankBlock;
  active: boolean;
}

export interface FakturyConfig {
  vatRates: VatRate[];
  items: CatalogItem[];
  agencies: Agency[];
  hotels: InvoiceHotel[];
}

export interface InvoiceLine {
  id: string;
  /** YYYY-MM-DD. */
  date: string;
  units: number;
  description: string;
  /** Free middle column: night date, masked card number, "Reservation from …". */
  detail: string;
  unitPrice: number;
  vatRateId: string | null;
  group: LineGroup;
}

export type BillTo =
  | { kind: "agency"; agencyId: string }
  | ({ kind: "person"; name: string } & PartyAddress);

export interface InvoiceDraft {
  invoiceNo: string;
  hotelId: string;
  /** Deposit invoices differ ONLY in the header title. */
  deposit: boolean;
  guestName: string;
  roomNo: string;
  /** YYYY-MM-DD. */
  arrival: string;
  departure: string;
  /** The Protel reservation number. Printed as plain "Reservation No.". */
  reservationNo: string;
  /** Optional AvailPro reference — the left half of the supplier line. */
  availProNo: string;
  /** The partner's own reservation number — the right half. */
  partnerResNo: string;
  /** YYYY-MM-DDTHH:MM — the issue moment, date AND time. */
  issuedAt: string;
  billTo: BillTo;
  lines: InvoiceLine[];
  /** CZK per 1 EUR. The invoice is always dual-currency. */
  eurRate: number;
  issuedBy: string;
  /** Free note, printed in italics under the invoice number. */
  note: string;
}

/*
 * `taxDate` and `dueDate` are NOT stored. Both are strictly determined by
 * `issuedAt` — the tax point is the issue date, and the invoice is payable
 * seven days later — so deriving them makes the rule structurally true
 * instead of merely enforced. A stored copy could drift out of step with the
 * issue date it is supposed to follow; a derived one cannot.
 */

/** Date part of an ISO datetime, i.e. the tax point. */
export function taxDateFrom(issuedAt: string): string {
  return (issuedAt ?? "").slice(0, 10);
}

/**
 * Issue date + 7 days. Built from local date PARTS: `new Date("2026-06-12")`
 * parses as UTC and, rendered in UTC+2, comes back as the previous day.
 */
export function dueDateFrom(issuedAt: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(issuedAt ?? "");
  if (!m) return "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 7);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The supplier reference line, "availPro / partner".
 *
 * The separator follows the partner number, not the AvailPro one: with no
 * partner number there is nothing to separate, so the slash goes. With no
 * AvailPro number the slash STAYS, because a leading "/ ABC123" still reads
 * as "no AvailPro reference, partner reference ABC123" — dropping it would
 * make the remaining number ambiguous about which system it came from.
 */
export function supplierRefLine(availProNo: string, partnerResNo: string): string {
  const left = (availProNo ?? "").trim();
  const right = (partnerResNo ?? "").trim();
  // The slash is dropped in exactly ONE case: a partner number is missing
  // while an AvailPro number is present, so there is nothing left to
  // separate. If the AvailPro number is missing the slash stays, even when
  // both are empty - it is part of the field's printed form.
  if (!right && left) return left;
  return `${left} / ${right}`.trim();
}

/* ------------------------------------------------------------------ */
/* Arithmetic                                                          */
/* ------------------------------------------------------------------ */

export function lineTotal(line: InvoiceLine): number {
  return round2(line.units * line.unitPrice);
}

export interface RecapRow {
  rateId: string;
  label: string;
  percent: number;
  block: VatBlock;
  /** Tax base — the total with VAT stripped out. */
  base: number;
  vat: number;
  /** Total including VAT — this is what the lines actually summed to. */
  total: number;
}

export interface InvoiceTotals {
  /** Sum of charge lines. */
  total: number;
  /** Sum of payment lines (already negative). */
  payments: number;
  /** total + payments. What the customer still owes. */
  open: number;
  /** One row per VAT bucket that actually carries money, in config order. */
  recap: RecapRow[];
  recapBase: number;
  recapVat: number;
  recapTotal: number;
}

/**
 * Base is derived by stripping VAT out of the gross line total
 * (`gross / (1 + rate)`), matching the source workbook — prices are entered
 * VAT-inclusive, exactly as Protel posts them.
 */
export function computeTotals(
  lines: InvoiceLine[],
  vatRates: VatRate[]
): InvoiceTotals {
  let total = 0;
  let payments = 0;
  const byRate = new Map<string, number>();

  for (const line of lines) {
    const amount = lineTotal(line);
    if (line.group === "item") {
      total = round2(total + amount);
      const key = line.vatRateId;
      if (key) byRate.set(key, round2((byRate.get(key) ?? 0) + amount));
    } else if (line.group === "payment") {
      payments = round2(payments + amount);
    }
    // "transfer" deliberately contributes to neither.
  }

  const recap: RecapRow[] = [];
  for (const rate of vatRates) {
    const gross = byRate.get(rate.id) ?? 0;
    // The printed document lists EVERY active bucket, zeros included — see
    // excels/excel_invoice.pdf, where 10 %, 15 % and all four Deposit rows
    // show 0,00. A deactivated rate is skipped unless an existing draft
    // still posts to it, so retiring a rate never silently drops money off
    // an invoice that already used it.
    if (!rate.active && gross === 0) continue;
    const base = round2(gross / (1 + rate.percent / 100));
    recap.push({
      rateId: rate.id,
      label: rate.label,
      percent: rate.percent,
      block: rate.block,
      base,
      vat: round2(gross - base),
      total: gross,
    });
  }

  return {
    total,
    payments,
    open: round2(total + payments),
    recap,
    recapBase: round2(recap.reduce((s, r) => s + r.base, 0)),
    recapVat: round2(recap.reduce((s, r) => s + r.vat, 0)),
    recapTotal: round2(recap.reduce((s, r) => s + r.total, 0)),
  };
}

/**
 * The invoice number encodes its own hotel: `[26][book no.][sequence]`, so
 * characters 3–4 are the book number. 264505337 → 45 → Ankora (normal book);
 * 261401298 → 14 → Superior (deposit book). Returns null when the number is
 * too short or the digits aren't numeric — the UI then falls back to the
 * manual hotel picker rather than guessing.
 */
export function decodeBookNo(invoiceNo: string): number | null {
  const digits = invoiceNo.replace(/\s/g, "").slice(2, 4);
  if (!/^\d{2}$/.test(digits)) return null;
  return Number(digits);
}

export interface BookMatch {
  hotel: InvoiceHotel;
  deposit: boolean;
}

/** Resolve an invoice number to its hotel + whether it is a deposit invoice. */
export function matchHotelByInvoiceNo(
  invoiceNo: string,
  hotels: InvoiceHotel[]
): BookMatch | null {
  const book = decodeBookNo(invoiceNo);
  if (book === null) return null;
  const normal = hotels.find((h) => h.bookNo === book);
  if (normal) return { hotel: normal, deposit: false };
  const advance = hotels.find((h) => h.depositBookNo === book);
  if (advance) return { hotel: advance, deposit: true };
  return null;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* Seed defaults                                                       */
/* ------------------------------------------------------------------ */

/**
 * Shipped as the initial `settings/fakturyConfig` when the doc is absent.
 * 10 % and 15 % are seeded INACTIVE: both are historical Czech rates that
 * could return, and the whole list is admin-editable, so they sit dormant
 * rather than being deleted.
 */
/*
 * Order and wording match the printed export (`excels/excel_invoice.pdf`)
 * exactly: the recap lists normal rates ascending, then the three
 * out-of-scope buckets, then the advance rates as "Deposit N %". The label
 * is printed VERBATIM, so it carries its own "%" and its own "Deposit "
 * prefix rather than the renderer deriving them — that keeps a label the
 * admin edits actually visible on the document.
 *
 * The document is written without diacritics throughout (a legacy of the
 * workbook), and these labels follow suit so a reproduced invoice reads
 * identically to a real one.
 */
export const DEFAULT_VAT_RATES: VatRate[] = [
  { id: "p10", label: "10.00 %", percent: 10, block: "normal", active: false },
  { id: "p12", label: "12.00 %", percent: 12, block: "normal", active: true },
  { id: "p15", label: "15.00 %", percent: 15, block: "normal", active: false },
  { id: "p21", label: "21.00 %", percent: 21, block: "normal", active: true },
  {
    id: "npd",
    label: "Neni predmetem dane - financni plneni",
    percent: 0,
    block: "normal",
    active: true,
  },
  {
    id: "nppdz",
    label: "Neni predmetem plneni dle §36(13) zakona o DPH",
    percent: 0,
    block: "normal",
    active: true,
  },
  {
    id: "op",
    label: "Osvobozene plneni - 0 %",
    percent: 0,
    block: "normal",
    active: true,
  },
  { id: "a10", label: "Deposit 10.00 %", percent: 10, block: "advance", active: false },
  { id: "a12", label: "Deposit 12.00 %", percent: 12, block: "advance", active: true },
  { id: "a15", label: "Deposit 15.00 %", percent: 15, block: "advance", active: false },
  { id: "a21", label: "Deposit 21.00 %", percent: 21, block: "advance", active: true },
];

const item = (description: string, vatRateId: string): CatalogItem => ({
  id: slugId(description),
  description,
  vatRateId,
  group: "item",
  active: true,
});

const payment = (description: string): CatalogItem => ({
  id: slugId(description),
  description,
  vatRateId: null,
  group: "payment",
  active: true,
});

function slugId(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

/**
 * Seeded from the workbook's TAA sheet. Only the Czech/English names that
 * Protel actually posts are carried over; the German and French synonyms in
 * the source existed to make an exact-match VLOOKUP work across locales and
 * are unnecessary now that the mapping is explicit data the admin edits.
 */
export const DEFAULT_CATALOG_ITEMS: CatalogItem[] = [
  item("Accommodation", "p12"),
  item("Ubytování", "p12"),
  item("Breakfast", "p12"),
  item("Snídaně", "p12"),
  item("Extra bed", "p12"),
  item("Přistýlka", "p12"),
  item("Early C/I", "p12"),
  item("Late C/O", "p12"),
  item("Day Use", "p12"),
  item("Upselling", "p12"),
  item("Restaurant HB 12 %", "p12"),
  item("Sauna", "p12"),
  item("Whirlpool", "p12"),
  item("Parking", "p21"),
  item("Garage", "p21"),
  item("Pet", "p21"),
  item("Misc. 21%", "p21"),
  item("Porterage", "p21"),
  item("Limousine service", "p21"),
  item("Minibar", "p21"),
  item("City tax", "nppdz"),
  item("Městský poplatek", "nppdz"),
  item("No show accommodation", "nppdz"),
  item("Cancellation Charge", "nppdz"),
  item("Storno poplatek", "nppdz"),
  item("Damages", "op"),
  item("Škody", "op"),
  item("Cleaning Penalty", "op"),
  item("Post", "op"),
  item("Deposit 12%", "a12"),
  item("Deposit EFT 12%", "a12"),
  payment("CZK Hotovost"),
  payment("CZK Cash"),
  payment("EUR Hotovost"),
  payment("EUR Cash"),
  payment("EFT Visa"),
  payment("EFT Eurocard/Mastercard"),
  payment("EFT AMEX"),
  payment("EFT Maestro"),
  payment("EFT V Pay"),
  payment("Bank Transfer"),
  payment("Zaokrouhlení"),
  payment("Exchange Diff"),
  { id: "invoice", description: "Invoice", vatRateId: null, group: "transfer", active: true },
];

/**
 * Seeded from the workbook's Hotel Details sheet. Logos start empty — the
 * admin uploads one per hotel on the page.
 */
export const DEFAULT_INVOICE_HOTELS: InvoiceHotel[] = [
  {
    id: "ambiance",
    name: "Ambiance",
    bookNo: 81,
    depositBookNo: 84,
    companyId: null,
    logoDataUri: "",
    footer:
      "Hotel Ambiance, Tyrsova 8, 120 00 Prague 2, Czech Republic, VAT Reg No. CZ06947697\ne-mail: reception@ambiancehotel.cz, Tel.:+420 227 022 022, Web: www.ambiancehotel.cz",
    bankName: "ČSOB a.s. Na Poříčí 24, 115 20, Praha 1, CZ",
    bankEur: {
      account: "1017788783/0300",
      swift: "CEKOCZPP",
      iban: "CZ11 0300 0000 0010 1778 8783",
    },
    bankCzk: {
      account: "317456313/0300",
      swift: "CEKOCZPP",
      iban: "CZ13 0300 0000 0003 1745 6313",
    },
    active: true,
  },
  {
    id: "superior",
    name: "Superior",
    bookNo: 11,
    depositBookNo: 14,
    companyId: null,
    logoDataUri: "",
    footer:
      "Hotel Superior, Legerova 32, 120 00 Prague 2, Czech Republic, VAT Reg No. CZ06947697\ne-mail: reception@hotelsuperior.cz, Tel.: +420 224 262 104, Web: www.hotelsuperior.cz",
    bankName: "ČSOB a.s. Na Poříčí 24, 115 20, Praha 1, CZ",
    bankEur: {
      account: "1017497273/0300",
      swift: "CEKOCZPP",
      iban: "CZ07 0300 0000 0010 1749 7273",
    },
    bankCzk: {
      account: "117942413/0300",
      swift: "CEKOCZPP",
      iban: "CZ04 0300 0000 0001 1794 2413",
    },
    active: true,
  },
  {
    id: "amigo",
    name: "Amigo",
    bookNo: 31,
    depositBookNo: 34,
    companyId: null,
    logoDataUri: "",
    footer:
      "Amigo City Centre Hotel, Legerova 13, 120 00 Prague 2, Czech Republic, VAT Reg No. CZ06947697\ne-mail: reception@amigo-hotel.cz, Tel.:+ 420 226 538 911, Web: www.amigo-hotel.cz",
    bankName: "ČSOB a.s. Na Poříčí 24, 115 20, Praha 1, CZ",
    bankEur: {
      account: "1017637133/0300",
      swift: "CEKOCZPP",
      iban: "CZ94 0300 0000 0010 1763 7133",
    },
    bankCzk: {
      account: "317110953/0300",
      swift: "CEKOCZPP",
      iban: "CZ26 0300 0000 0003 1711 0953",
    },
    active: true,
  },
  {
    id: "alqush",
    name: "Alqush",
    bookNo: 21,
    depositBookNo: 24,
    companyId: null,
    logoDataUri: "",
    footer:
      "Alqush Downtown Hotel, Legerova 15, 120 00 Prague 2, Czech Republic, VAT Reg No. CZ06947697\ne-mail: reception@alqush-hotel.cz, Tel.:+ 420 226 538 911, Web: www.alqush-hotel.cz",
    bankName: "ČSOB a.s. Na Poříčí 24, 115 20, Praha 1, CZ",
    bankEur: {
      account: "1017637133/0300",
      swift: "CEKOCZPP",
      iban: "CZ94 0300 0000 0010 1763 7133",
    },
    bankCzk: {
      account: "317110953/0300",
      swift: "CEKOCZPP",
      iban: "CZ26 0300 0000 0003 1711 0953",
    },
    active: true,
  },
  {
    id: "ankora",
    name: "Ankora",
    bookNo: 45,
    depositBookNo: 49,
    companyId: null,
    logoDataUri: "",
    footer:
      "Hotel Ankora, Katerinska 42, 120 00 Prague 2, Czech Republic, VAT Reg No. CZ06947697\ne-mail: reception@hotelankora.cz, Tel.: +420 224 242 863, Web: www.hotelankora.cz",
    bankName: "ČSOB a.s. Na Poříčí 24, 115 20, Praha 1, CZ",
    bankEur: {
      account: "1017707613/0300",
      swift: "CEKOCZPP",
      iban: "CZ80 0300 0000 0010 1770 7613",
    },
    bankCzk: {
      account: "317326463/0300",
      swift: "CEKOCZPP",
      iban: "CZ92 0300 0000 0003 1732 6463",
    },
    active: true,
  },
];

const agency = (
  name: string,
  a: Partial<PartyAddress>
): Agency => ({
  id: slugId(name),
  name,
  street1: "",
  street2: "",
  street3: "",
  zip: "",
  city: "",
  country: "",
  ic: "",
  dic: "",
  active: true,
  ...a,
});

/** Seeded from the workbook's Invoice Details sheet. */
export const DEFAULT_AGENCIES: Agency[] = [
  agency("British Airways Holidays", {
    street1: "Eighth Floor",
    street2: "The Create Building",
    street3: "The Boulevard",
    zip: "RH10 1DT",
    city: "Crawley, West Sussex",
    country: "GREAT BRITAIN",
    dic: "GB899099733",
  }),
  agency("de Jong Intra Vakanties", {
    street1: "c / o Servicecenter de Jong Intra Vakanties",
    street2: "Havenkade 1",
    zip: "2984AA",
    city: "Ridderkerk",
    country: "NETHERLANDS",
    dic: "NL004800400B01",
  }),
  agency("EasyJet Airline Company Limited", {
    street1: "Hangar 89",
    street2: "London Luton Airport",
    street3: "Bedforshire",
    zip: "LU29PF",
    city: "Luton",
    country: "GREAT BRITAIN",
    dic: "GB328848168",
  }),
  agency("Jet2holidays Limited", {
    street1: "Low Fare Finder House",
    zip: "LS197TU",
    city: "Leeds/ Brandford Airport",
    country: "GREAT BRITAIN",
    dic: "GB911468335",
  }),
  agency("Miki Travel Limited", {
    street1: "Vintners Place, 68 Upper Thames Street",
    zip: "EC4V 3BJ",
    city: "London",
    country: "GREAT BRITAIN",
    dic: "GB243744755",
  }),
  agency("Travco", {
    street1: "Travco House",
    street2: "92-94 Paul Street",
    zip: "EC2A 4UX",
    city: "London",
    country: "GREAT BRITAIN",
    dic: "GB948652087",
  }),
];

export const DEFAULT_FAKTURY_CONFIG: FakturyConfig = {
  vatRates: DEFAULT_VAT_RATES,
  items: DEFAULT_CATALOG_ITEMS,
  agencies: DEFAULT_AGENCIES,
  hotels: DEFAULT_INVOICE_HOTELS,
};
