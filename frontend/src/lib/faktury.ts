/**
 * Faktury — client mirror of `functions/src/services/invoiceTypes.ts`.
 *
 * Types + the invoice arithmetic, duplicated on purpose (same deliberate
 * duplication as `lib/hotels.ts` ↔ `services/hotels.ts`): the client needs the
 * maths for the live on-screen preview, the server needs it for the PDF, and
 * neither can import the other. The seed defaults are NOT mirrored — only the
 * server ever writes them.
 *
 * Context: the app does not issue invoices, Protel does. This page reproduces
 * an invoice Protel created but can no longer display, so `invoiceNo` is typed
 * in by the user and nothing here allocates a number.
 */

export type VatBlock = "normal" | "advance";

/**
 * "item" counts toward Total and the VAT recap; "payment" counts toward
 * Received Payments only; "transfer" (the folio→agency "Invoice" line) prints
 * but is excluded from both.
 */
export type LineGroup = "item" | "payment" | "transfer";

export const LINE_GROUP_LABELS: Record<LineGroup, string> = {
  item: "Položka",
  payment: "Platba",
  transfer: "Převod na fakturu",
};

export interface VatRate {
  id: string;
  label: string;
  percent: number;
  block: VatBlock;
  active: boolean;
}

export interface CatalogItem {
  id: string;
  description: string;
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

export interface InvoiceHotel {
  id: string;
  name: string;
  bookNo: number | null;
  depositBookNo: number | null;
  companyId: string | null;
  logoDataUri: string;
  footer: string;
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
  date: string;
  units: number;
  description: string;
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
  deposit: boolean;
  guestName: string;
  roomNo: string;
  arrival: string;
  departure: string;
  reservationNo: string;
  supplierResNo: string;
  issuedAt: string;
  taxDate: string;
  dueDate: string;
  billTo: BillTo;
  lines: InvoiceLine[];
  eurRate: number;
  issuedBy: string;
  eftReceipt: string;
}

/** What `GET /api/faktury` returns per row (no `lines`, no addresses). */
export interface InvoiceSummary {
  id: string;
  invoiceNo: string;
  hotelId: string;
  deposit: boolean;
  guestName: string;
  billToName: string;
  total: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

/* ------------------------------------------------------------------ */
/* Arithmetic — keep in lockstep with services/invoiceTypes.ts         */
/* ------------------------------------------------------------------ */

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function lineTotal(line: InvoiceLine): number {
  return round2(line.units * line.unitPrice);
}

export interface RecapRow {
  rateId: string;
  label: string;
  percent: number;
  block: VatBlock;
  base: number;
  vat: number;
  total: number;
}

export interface InvoiceTotals {
  total: number;
  payments: number;
  open: number;
  recap: RecapRow[];
  recapBase: number;
  recapVat: number;
  recapTotal: number;
}

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
  }

  const recap: RecapRow[] = [];
  for (const rate of vatRates) {
    const gross = byRate.get(rate.id);
    if (gross === undefined || gross === 0) continue;
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
 * The invoice number encodes its hotel: `[26][book no.][sequence]`, so
 * characters 3–4 are the book number. 264505337 → 45 → Ankora (normal),
 * 261401298 → 14 → Superior (deposit). Returns null when undecodable so the
 * UI can fall back to the manual picker instead of guessing.
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

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/** 12 003,75 — Czech grouping, always two decimals. */
export function formatMoney(n: number): string {
  return n.toLocaleString("cs-CZ", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * YYYY-MM-DD → D. M. YYYY, by string surgery. Never parse an ISO date string
 * into a Date for display: `new Date("2026-05-29").toISOString()` yields the
 * previous day in UTC+2.
 */
export function formatDateCZ(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return iso ?? "";
  return `${Number(m[3])}. ${Number(m[2])}. ${m[1]}`;
}

/** Blank-safe address lines for a bill-to party, in print order. */
export function addressLines(p: PartyAddress): string[] {
  const zipCity = [p.zip, p.city].filter(Boolean).join(" ");
  return [p.street1, p.street2, p.street3, zipCity, p.country].filter(Boolean);
}

export function newLineId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function emptyLine(): InvoiceLine {
  return {
    id: newLineId(),
    date: "",
    units: 1,
    description: "",
    detail: "",
    unitPrice: 0,
    vatRateId: null,
    group: "item",
  };
}
