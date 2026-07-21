/**
 * Faktury — printable A4 HTML for a guest invoice.
 *
 * Pure: no Firestore, no I/O, no async, no clock, no randomness. The same
 * draft always yields the same bytes. `services/pdfRenderer.ts` feeds the
 * result to a real Chromium via `renderPdf(html, INVOICE_MARGINS,
 * { extraCss: INVOICE_CSS, logoOffset: false })`.
 *
 * The layout reproduces the customer's workbook (`excels/invoice.xlsx`,
 * sheet INVOICE) — bilingual EN / CZ labels, wording taken verbatim from
 * the sheet. A normal invoice and a deposit invoice differ ONLY in the
 * header title, exactly as the workbook does.
 *
 * Everything is laid out with tables and explicit column widths rather
 * than flexbox: print pagination across a page break is far more
 * predictable that way, and the line table is the one region that can
 * legitimately overflow onto a second page.
 */

import { RenderMargins } from "./pdfRenderer";
import {
  InvoiceDraft,
  FakturyConfig,
  InvoiceLine,
  PartyAddress,
  RecapRow,
  computeTotals,
  lineTotal,
} from "./invoiceTypes";

/** The issuing legal entity, printed as the last footer line. */
export interface CompanyInfo {
  name: string;
  address: string;
  ic: string;
  dic: string;
  fileNo: string;
}

export const INVOICE_MARGINS: RenderMargins = {
  top: 12,
  bottom: 12,
  left: 14,
  right: 14,
};

/**
 * Appended AFTER the renderer's shared RENDER_CSS, so it must undo what
 * that stylesheet assumes about contracts: a 1px border on every single
 * `td`/`th` and a 0.5 cm margin on every table. An invoice wants borders
 * only where it asks for them.
 */
export const INVOICE_CSS = `
  body { font-size: 9.5pt; line-height: 1.35; }
  table { margin: 0; }
  table td, table th {
    border: none;
    padding: 0;
    min-width: 0;
    vertical-align: top;
  }
  .inv-title { text-align: right; }
  .inv-title-main {
    font-size: 20pt;
    font-weight: 700;
    letter-spacing: 2px;
    line-height: 1.1;
  }
  .inv-title-sub { font-size: 9pt; }
  .inv-logo { max-height: 22mm; width: auto; display: block; }
  .inv-block { margin-top: 4mm; }
  .inv-label { font-weight: 600; padding-right: 4mm; white-space: nowrap; }
  .inv-heading {
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-size: 8.5pt;
    border-bottom: 1px solid #000;
    padding-bottom: 1mm;
    margin-bottom: 1.5mm;
  }
  /* Lower payer band — the workbook repeats the payer under the guest
     details, spread across three columns. */
  .inv-billed { margin-top: 0; }
  .inv-billed td { vertical-align: top; padding-right: 4mm; }
  .inv-block + .inv-heading { margin-top: 4mm; }
  .inv-no {
    margin-top: 4mm;
    font-size: 13pt;
    font-weight: 700;
    border: 1px solid #000;
    padding: 2mm 3mm;
  }
  .inv-lines { margin-top: 4mm; font-size: 9pt; }
  .inv-lines th {
    border-bottom: 1.5px solid #000;
    border-top: 1.5px solid #000;
    padding: 1.5mm 2mm;
    font-weight: 700;
    text-align: left;
  }
  .inv-lines td {
    border-bottom: 0.5px solid #999;
    padding: 1.2mm 2mm;
  }
  .inv-lines thead { display: table-header-group; }
  .inv-lines tr { break-inside: avoid; }
  .num { text-align: right; white-space: nowrap; }
  .ctr { text-align: center; }
  .inv-tail { break-inside: avoid; margin-top: 5mm; }
  .inv-totals td { padding: 1mm 2mm; }
  .inv-totals .inv-totals-label { font-weight: 700; }
  .inv-totals tr.inv-open td { border-top: 1px solid #000; font-weight: 700; }
  .inv-rate { font-size: 8pt; padding-top: 1mm; }
  .inv-recap { margin-top: 4mm; font-size: 8.5pt; }
  .inv-recap th {
    border-top: 1px solid #000;
    border-bottom: 1px solid #000;
    padding: 1.2mm 2mm;
    font-weight: 700;
    text-align: left;
  }
  .inv-recap td { padding: 1mm 2mm; }
  .inv-recap tr.inv-recap-total td {
    border-top: 1px solid #000;
    font-weight: 700;
  }
  .inv-recap td.inv-recap-sub {
    font-weight: 700;
    font-size: 8pt;
    padding-top: 2.5mm;
  }
  .inv-footer { margin-top: 5mm; font-size: 8.5pt; }
  .inv-bank { margin-top: 4mm; font-size: 8.5pt; }
  .inv-bank .inv-bank-head {
    font-weight: 700;
    border-bottom: 1px solid #000;
    padding-bottom: 1mm;
  }
  .inv-bank .inv-bank-cell { padding-right: 6mm; }
  .inv-hotel-footer {
    margin-top: 4mm;
    font-size: 8pt;
    text-align: center;
    line-height: 1.4;
  }
  .inv-company {
    margin-top: 2mm;
    font-size: 7.5pt;
    text-align: center;
    border-top: 1px solid #000;
    padding-top: 1.5mm;
  }
`;

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

/**
 * Every interpolated value goes through this. The rendered HTML is handed
 * to a real browser, so an unescaped guest name is script execution.
 */
function esc(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** `esc()` plus newline → `<br>`, for the multi-line hotel footer. */
function escMultiline(value: string): string {
  return esc(value).replace(/\r?\n/g, "<br>");
}

/**
 * Czech money formatting — `12 003,75`. Hand-rolled on purpose: the
 * Functions runtime may ship a trimmed ICU, in which case
 * `toLocaleString("cs-CZ")` silently degrades to the C locale.
 */
function fmt(value: number): string {
  if (!isFinite(value)) return "–";
  const negative = value < 0;
  const fixed = Math.abs(value).toFixed(2);
  const dot = fixed.indexOf(".");
  const whole = fixed.slice(0, dot);
  const decimals = fixed.slice(dot + 1);
  let grouped = "";
  for (let i = 0; i < whole.length; i++) {
    if (i > 0 && (whole.length - i) % 3 === 0) grouped += " ";
    grouped += whole[i];
  }
  return `${negative ? "-" : ""}${grouped},${decimals}`;
}

/** CZK → EUR, or an en dash when no usable rate was supplied. */
function fmtEur(czk: number, rate: number): string {
  if (!rate || !isFinite(rate) || rate <= 0) return "–";
  return fmt(czk / rate);
}

/** Units column: integers print bare, fractions keep two decimals. */
function fmtUnits(units: number): string {
  if (!isFinite(units)) return "";
  return Number.isInteger(units) ? String(units) : fmt(units);
}

/**
 * `YYYY-MM-DD` → `D. M. YYYY` by string surgery ONLY. Never parse with
 * `new Date(iso)`: in UTC+2 that lands on the previous day, a bug this
 * repo has already been bitten by. Anything that is not an ISO date is
 * returned untouched.
 */
function fmtDate(value: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!iso) return value ?? "";
  const [, y, m, d] = iso;
  return `${Number(d)}. ${Number(m)}. ${y}`;
}

/** Logo passthrough. The renderer's SSRF guard allows only `data:` URIs. */
const DATA_URI_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

function logoImg(dataUri: string): string {
  if (!dataUri || !DATA_URI_RE.test(dataUri)) return "";
  return `<img class="inv-logo" src="${dataUri}" alt="">`;
}

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

interface LabelledValue {
  label: string;
  value: string;
}

function labelRows(rows: LabelledValue[]): string {
  return rows
    .map(
      (r) =>
        `<tr><td class="inv-label">${esc(r.label)}</td><td>${esc(
          r.value
        )}</td></tr>`
    )
    .join("");
}

/** Address lines, blanks collapsed so no empty rows are left behind. */
function addressLines(party: PartyAddress): string[] {
  const cityLine = [party.zip, party.city].filter((s) => !!s && !!s.trim()).join(" ");
  return [party.street1, party.street2, party.street3, cityLine, party.country]
    .map((s) => (s ?? "").trim())
    .filter((s) => s.length > 0);
}

interface ResolvedParty {
  name: string;
  lines: string[];
  ic: string;
  dic: string;
}

/**
 * `billTo` is either a pointer into the agency address book or an inline
 * person. An agency id that no longer resolves degrades to a nameless
 * block rather than throwing — the PDF must still render.
 */
function resolveBillTo(draft: InvoiceDraft, config: FakturyConfig): ResolvedParty {
  const billTo = draft.billTo;
  if (billTo.kind === "agency") {
    const agency = config.agencies.find((a) => a.id === billTo.agencyId);
    if (!agency) return { name: "", lines: [], ic: "", dic: "" };
    return {
      name: agency.name,
      lines: addressLines(agency),
      ic: agency.ic,
      dic: agency.dic,
    };
  }
  const person = billTo;
  return {
    name: person.name,
    lines: addressLines(person),
    ic: person.ic,
    dic: person.dic,
  };
}

/**
 * Top-right correspondence block, opposite the guest details. The source
 * workbook prints the payer in TWO places (print area is A1:T104, so the
 * O/P "Correspondence Address" column block is on the page, not just an
 * input helper) — this is the one carrying IC/DIC.
 */
function correspondenceBlock(party: ResolvedParty): string {
  const lines = party.lines.map((l) => `<div>${esc(l)}</div>`).join("");
  const ids: string[] = [];
  if (party.ic && party.ic.trim()) ids.push(`IC: ${party.ic}`);
  if (party.dic && party.dic.trim()) ids.push(`DIC: ${party.dic}`);
  const idHtml = ids.map((s) => `<div>${esc(s)}</div>`).join("");
  return `<div class="inv-heading">Correspondence Address</div>
    ${party.name ? `<div><strong>${esc(party.name)}</strong></div>` : ""}
    ${lines}${idHtml}`;
}

/**
 * The second, lower payer band (workbook rows 12–14): a "Billed To:" heading
 * over the same name and address spread across three columns. Deliberately
 * duplicates `correspondenceBlock` above — the original document repeats it,
 * and the point of this tool is to look like the original.
 */
function billedToBand(party: ResolvedParty): string {
  const cells = [
    [party.name, party.lines[0] ?? ""],
    [party.lines[1] ?? "", party.lines[2] ?? ""],
    [party.lines[3] ?? "", party.lines[4] ?? ""],
  ];
  const col = (pair: string[]): string =>
    pair
      .filter((s) => !!s && s.trim().length > 0)
      .map((s) => `<div>${esc(s)}</div>`)
      .join("");
  return `<div class="inv-heading">Billed To:</div>
    <table class="inv-billed"><colgroup>
      <col style="width:40%"><col style="width:32%"><col style="width:28%">
    </colgroup><tbody><tr>
      <td>${col(cells[0])}</td><td>${col(cells[1])}</td><td>${col(cells[2])}</td>
    </tr></tbody></table>`;
}

function lineRow(line: InvoiceLine): string {
  return `<tr>
    <td>${esc(fmtDate(line.date))}</td>
    <td class="ctr">${esc(fmtUnits(line.units))}</td>
    <td>${esc(line.description)}</td>
    <td>${esc(fmtDate(line.detail))}</td>
    <td class="num">${esc(fmt(line.unitPrice))}</td>
    <td class="num">${esc(fmt(lineTotal(line)))}</td>
  </tr>`;
}

function recapRow(row: RecapRow): string {
  return `<tr>
    <td>${esc(row.label)}</td>
    <td class="num">${esc(fmt(row.base))}</td>
    <td class="num">${esc(fmt(row.vat))}</td>
    <td class="num">${esc(fmt(row.total))}</td>
  </tr>`;
}

function bankBlock(
  heading: string,
  bankName: string,
  suffix: string,
  bank: { account: string; swift: string; iban: string }
): string {
  return `<div class="inv-bank-head">${esc(heading)}</div>
    <div>${esc(bankName)}</div>
    <table><tbody>
      ${labelRows([
        { label: `A/C No. ${suffix}:`, value: bank.account },
        { label: `SWIFT ${suffix}:`, value: bank.swift },
        { label: `IBAN ${suffix}:`, value: bank.iban },
      ])}
    </tbody></table>`;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export function buildInvoiceHtml(
  draft: InvoiceDraft,
  config: FakturyConfig,
  company: CompanyInfo | null
): string {
  const hotel = config.hotels.find((h) => h.id === draft.hotelId) ?? null;
  const totals = computeTotals(draft.lines, config.vatRates);
  const rate = draft.eurRate;
  const party = resolveBillTo(draft, config);

  /* 1 — header band: logo left, the one title that distinguishes the two
     document kinds right. */
  const header = `<table class="inv-header"><colgroup>
      <col style="width:50%"><col style="width:50%">
    </colgroup><tbody><tr>
      <td>${hotel ? logoImg(hotel.logoDataUri) : ""}</td>
      <td class="inv-title">
        <div class="inv-title-main">${draft.deposit ? "DEPOSIT INVOICE" : "INVOICE"}</div>
        <div class="inv-title-sub">${
          draft.deposit ? "Zálohová faktura" : "Faktura – daňový doklad"
        }</div>
      </td>
    </tr></tbody></table>`;

  /* 2 + 3 — guest block left, billed-to block right. */
  const guest = labelRows([
    { label: "Guest Name / Jmeno Hosta:", value: draft.guestName },
    { label: "Room Number / Cislo Pokoje:", value: draft.roomNo },
    { label: "Arrival / Prijezd:", value: fmtDate(draft.arrival) },
    { label: "Departure / Odjezd:", value: fmtDate(draft.departure) },
    { label: "Reservation No. / Cislo Rezervace:", value: draft.reservationNo },
    { label: "Supplier Reservation Number:", value: draft.supplierResNo },
    { label: "Issued / Vystaveno:", value: fmtDate(draft.issuedAt) },
    { label: "Tax Charged / Datum zdanit. plneni:", value: fmtDate(draft.taxDate) },
    { label: "Payable On / Datum Splatnosti:", value: fmtDate(draft.dueDate) },
  ]);

  const parties = `<table class="inv-block"><colgroup>
      <col style="width:58%"><col style="width:42%">
    </colgroup><tbody><tr>
      <td><table><tbody>${guest}</tbody></table></td>
      <td>${correspondenceBlock(party)}</td>
    </tr></tbody></table>
    ${billedToBand(party)}`;

  /* 4 — invoice number. */
  const invoiceNo = `<div class="inv-no">Invoice No. / Faktura Cislo: ${esc(
    draft.invoiceNo
  )}</div>`;

  /* 5 — line table. Payment and transfer rows already carry their sign. */
  const lines = `<table class="inv-lines"><colgroup>
      <col style="width:13%"><col style="width:7%"><col style="width:29%">
      <col style="width:21%"><col style="width:15%"><col style="width:15%">
    </colgroup>
    <thead><tr>
      <th>Date</th><th class="ctr">Units</th><th>Description</th><th></th>
      <th class="num">Price per Unit CZK</th><th class="num">Total Price CZK</th>
    </tr></thead>
    <tbody>${draft.lines.map(lineRow).join("")}</tbody></table>`;

  /* 6 — totals, always dual currency. */
  const totalsRow = (
    label: string,
    czk: number,
    cls = ""
  ): string => `<tr${cls ? ` class="${cls}"` : ""}>
      <td class="inv-totals-label">${esc(label)}</td>
      <td class="num">${esc(fmt(czk))}</td>
      <td class="ctr">CZK</td>
      <td class="num">${esc(fmtEur(czk, rate))}</td>
      <td class="ctr">EUR</td>
    </tr>`;

  const totalsBlock = `<table class="inv-totals"><colgroup>
      <col style="width:44%"><col style="width:19%"><col style="width:6%">
      <col style="width:19%"><col style="width:6%">
    </colgroup><tbody>
      ${totalsRow("Total / Celkem:", totals.total)}
      ${totalsRow("Received Payments / Uhrazeno:", totals.payments)}
      ${totalsRow("Open (Payable) / K uhrade:", totals.open, "inv-open")}
    </tbody></table>
    <div class="inv-rate">${
      rate && isFinite(rate) && rate > 0
        ? `Kurz: ${esc(fmt(rate))} CZK/EUR`
        : "Kurz: – (nezadán, částky v EUR nelze přepočítat)"
    }</div>`;

  /* 7 — VAT recap. Advance buckets are their own stacked block, matching
     the workbook; with no advance rows the sub-heading is omitted entirely
     rather than rendered empty. */
  const normalRecap = totals.recap.filter((r) => r.block === "normal");
  const advanceRecap = totals.recap.filter((r) => r.block === "advance");
  const advanceSection = advanceRecap.length
    ? `<tr><td class="inv-recap-sub" colspan="4">Zálohy / Advances</td></tr>` +
      advanceRecap.map(recapRow).join("")
    : "";

  const recapBlock = `<table class="inv-recap"><colgroup>
      <col style="width:40%"><col style="width:20%">
      <col style="width:20%"><col style="width:20%">
    </colgroup>
    <thead><tr>
      <th>VAT Rate / Sazba DPH</th>
      <th class="num">Tax Base / Zaklad dane CZK</th>
      <th class="num">VAT / Castka DPH CZK</th>
      <th class="num">Total inc. VAT / Celkem s DPH CZK</th>
    </tr></thead>
    <tbody>
      ${normalRecap.map(recapRow).join("")}
      ${advanceSection}
      <tr class="inv-recap-total">
        <td>Total / Celkem:</td>
        <td class="num">${esc(fmt(totals.recapBase))}</td>
        <td class="num">${esc(fmt(totals.recapVat))}</td>
        <td class="num">${esc(fmt(totals.recapTotal))}</td>
      </tr>
    </tbody></table>`;

  /* 8 — footer: EFT / issued by, the two bank blocks, hotel footer, issuer. */
  const meta = `<table class="inv-footer"><colgroup>
      <col style="width:50%"><col style="width:50%">
    </colgroup><tbody><tr>
      <td><span class="inv-label">EFT Receipt:</span> ${esc(draft.eftReceipt)}</td>
      <td><span class="inv-label">Issued By:</span> ${esc(draft.issuedBy)}</td>
    </tr></tbody></table>`;

  const banks = hotel
    ? `<table class="inv-bank"><colgroup>
        <col style="width:50%"><col style="width:50%">
      </colgroup><tbody><tr>
        <td class="inv-bank-cell">${bankBlock(
          "EUR Account Number / EUR bankovni ucet Czech Republic",
          hotel.bankName,
          "EUR",
          hotel.bankEur
        )}</td>
        <td class="inv-bank-cell">${bankBlock(
          "CZK Account Number / CZK bankovni ucet Czech Republic",
          hotel.bankName,
          "CZK",
          hotel.bankCzk
        )}</td>
      </tr></tbody></table>`
    : "";

  const hotelFooter =
    hotel && hotel.footer && hotel.footer.trim()
      ? `<div class="inv-hotel-footer">${escMultiline(hotel.footer)}</div>`
      : "";

  const companyLine = company
    ? `<div class="inv-company">${esc(
        [
          company.name,
          company.address,
          company.ic ? `ICO: ${company.ic}` : "",
          company.dic ? `DIC: ${company.dic}` : "",
          company.fileNo,
        ]
          .filter((s) => !!s && !!s.trim())
          .join(", ")
      )}</div>`
    : "";

  return `${header}${parties}${invoiceNo}${lines}
    <div class="inv-tail">${totalsBlock}${recapBlock}${meta}${banks}${hotelFooter}${companyLine}</div>`;
}
