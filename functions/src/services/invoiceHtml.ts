/**
 * Faktury — printable A4 HTML for a guest invoice.
 *
 * Pure: no Firestore, no I/O, no async, no clock, no randomness. The same
 * draft always yields the same bytes. `services/pdfRenderer.ts` feeds the
 * result to a real Chromium via `renderPdf(html, INVOICE_MARGINS,
 * { extraCss: INVOICE_CSS, logoOffset: false })`.
 *
 * The layout reproduces the customer's REAL printed export
 * (`excels/excel_invoice.pdf`, produced from `excels/invoice.xlsx`), not
 * merely the spreadsheet grid. Things that come from the export and are not
 * derivable from the sheet:
 *
 *  - It is rule-based, not box-based: no cell borders anywhere, only a few
 *    full-width horizontal rules. Everything else is alignment.
 *  - Labels are NOT bold. Only the title, "Billed To:", "Invoice No. /
 *    Faktura Cislo", the payer name and the Total row are.
 *  - The document is written WITHOUT diacritics throughout ("Danovy Doklad",
 *    "Vystaveno"). Reproduced verbatim so a copy reads like the original, and
 *    since v5.4.0 that extends to the user-entered guest name and payer block,
 *    which `deaccent()` folds AT PRINT TIME — the stored draft keeps the real
 *    spelling and the editor still shows it.
 *  - Dates are DD/MM/YY in the line table and in Arrival/Departure, but
 *    DD/MM/YYYY in Issued / Tax Charged / Payable On.
 *  - Amounts carry a " CZK" suffix in the line table and totals, but NOT in
 *    the VAT recap.
 *  - The hotel footer is a PAGE footer pinned to the bottom of the sheet,
 *    far below the content — it is the Excel print footer.
 *
 * Everything is laid out with tables and explicit column widths rather than
 * flexbox: print pagination across a page break is far more predictable that
 * way, and the line table is the one region that can legitimately overflow
 * onto a second page.
 */

import { RenderMargins } from "./pdfRenderer";
import {
  InvoiceDraft,
  FakturyConfig,
  InvoiceLine,
  PartyAddress,
  RecapRow,
  computeTotals,
  eftColumnWidths,
  eftGrid,
  lineTotal,
  taxDateFrom,
  dueDateFrom,
  supplierRefLine,
} from "./invoiceTypes";

/** The issuing legal entity, printed above the page footer. */
export interface CompanyInfo {
  name: string;
  address: string;
  ic: string;
  dic: string;
  fileNo: string;
}

/**
 * Bottom margin is deliberately generous: the hotel footer is a fixed-position
 * page footer and needs room that the flowing content never claims.
 */
export const INVOICE_MARGINS: RenderMargins = {
  top: 8,
  bottom: 12,
  left: 6,
  right: 6,
};

/**
 * Appended AFTER the renderer's shared RENDER_CSS, so it must undo what that
 * stylesheet assumes about contracts: a 1px border on every single `td`/`th`
 * and a 0.5 cm margin on every table. This document draws borders only where
 * it asks for them.
 */
export const INVOICE_CSS = `
  body { font-size: 8.5pt; line-height: 1.18; }
  table { margin: 0; }
  table td, table th {
    border: none;
    padding: 0;
    min-width: 0;
    vertical-align: top;
    font-weight: normal;
    text-align: left;
  }
  .num { text-align: right; white-space: nowrap; }
  .ctr { text-align: center; }
  .bold { font-weight: 700; }
  .ital { font-style: italic; }
  /* Reserves space so flowing content cannot run under the fixed page
     footer on the final page. Kept tight: the reference invoice fits on one
     page and a generous reserve is what pushes it onto a second. */
  .inv-content { padding-bottom: 4mm; }

  /* Header band: logo left, the title block right. */
  .inv-title { text-align: right; font-weight: 700; font-size: 11pt; }
  .inv-logo { max-height: 20mm; width: auto; display: block; }

  /* Guest details and correspondence address share ONE ten-row grid, which
     is what puts IC / DIC on the same baselines as Tax Charged / Payable On
     in the original. The row COUNT comes from the left column's ten fixed
     labels, so the address on the right is free to be shorter - it is
     compacted, and its unused tail simply leaves empty cells. */
  .inv-meta { margin-top: 4mm; }
  .inv-meta td { padding: 0; }
  .inv-meta .sp { height: 2.2mm; }

  .inv-billed td { padding-right: 4mm; }
  .inv-no { margin-top: 1.5mm; font-weight: 700; }
  .inv-no .val { padding-left: 8mm; }
  .inv-note { font-style: italic; margin-top: 0.8mm; }

  /* Rules. The document has exactly four kinds and nothing else. */
  .rule { border-top: 0.8pt solid #000; }
  .rule-strong { border-top: 1.1pt solid #000; }

  /* table-layout: fixed so the colgroup widths are BINDING. Under the default
     auto layout a long description simply widens its column and drags every
     later column out of place — and no amount of clipping can help while the
     column is still free to grow. */
  .inv-lines { margin-top: 3mm; table-layout: fixed; width: 100%; }
  .inv-lines th {
    border-top: 0.8pt solid #000;
    border-bottom: 0.8pt solid #000;
    padding: 1mm 0;
    font-weight: 700;
    font-size: 8pt;
  }
  .inv-lines td { padding: 0.5mm 0; }
  .inv-lines thead { display: table-header-group; }
  .inv-lines tr { break-inside: avoid; }
  .inv-lines .pad { padding-right: 3mm; }
  /* Over-long cell content is CUT at the column edge, never wrapped: a wrapped
     row is taller than its neighbours and breaks the one-line-per-posting read
     of the document. "overflow: hidden" is unreliable on a table cell itself
     (no backticks in here - this whole stylesheet is a template literal),
     so every cell wraps its content in this block instead. */
  .inv-lines .clip {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: clip;
  }

  .inv-totals { margin-top: 1.5mm; }
  .inv-totals td { padding: 0.6mm 0; }
  /* The CZK column sits under the line table's Price per Unit, which carries a
     3 mm gutter (.pad) between itself and Total Price. Equal column WIDTHS are
     not enough to line the figures up - right-aligned text ends at the content
     edge, so the gutter has to be repeated here or the CZK figures hang 3 mm
     further right than the prices above them. The EUR column matches Total
     Price, which has no gutter. */
  .inv-totals .pad { padding-right: 3mm; }

  .inv-recap { margin-top: 3mm; font-size: 8pt; }
  /* Column HEADINGS are long enough to overrun their column and collide
     with the next one, so they drop the nowrap that .num gives the
     figures and are set a shade smaller. */
  .inv-recap th {
    padding-bottom: 1.5mm;
    font-size: 7.5pt;
    white-space: normal;
  }
  .inv-recap td { padding: 0.35mm 0; }
  .inv-recap tr.total td { padding-top: 2mm; }

  /* Monospace, matching the original export. The heading prints whether or not
     the invoice carries a slip - it is part of the document, and most of these
     invoices have no EFT receipt at all. */
  .inv-eft { margin-top: 2.5mm; font-family: "Courier New", Courier, monospace; }
  /* The pasted terminal slip. "white-space: pre" is what makes this a COLUMN
     layout: buildEft() pads every cell to its column width, and in a monospace
     face equal character counts are equal widths, so the columns line up
     without a table. Deliberately not a table - a nested table straddling a
     page break renders its rows on both pages in Chrome (see .inv-bank).
     font-size is set per document by buildEft(), sized so the widest row fits
     the page; there is no useful default here. */
  .inv-eft-slip {
    margin-top: 1mm;
    font-family: "Courier New", Courier, monospace;
    white-space: pre;
    line-height: 1.15;
    break-inside: avoid;
  }
  .inv-issued { margin-top: 2mm; text-align: right; }
  /* break-inside on the OUTER table: its cells hold nested tables, and a
     nested table straddling a page break renders its rows on BOTH pages in
     Chrome - the bank rows printed twice before this was pinned down. */
  .inv-bank { margin-top: 2.5mm; font-size: 8pt; break-inside: avoid; }
  .inv-bank td { padding: 0.35mm 0; }
  .inv-bank .cell { padding-right: 6mm; }
  .inv-bank .lbl { width: 34%; }
  /* The bank branch line ("CSOB a.s. …") is part of the ACCOUNT DETAILS, not of
     the heading above it, so the gap goes under the heading — not between the
     branch line and the numbers it belongs with. */
  .inv-bank .bhead { margin-bottom: 1.8mm; }
  .inv-company {
    margin-top: 2.5mm;
    font-size: 7pt;
    /* Must stay on ONE row - it is a single legal identification line. */
    white-space: nowrap;
    text-align: center;
  }

  /* The Excel print footer: pinned to the bottom of every sheet, which is
     why it sits far below the last line of content in the original. */
  .inv-page-footer {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    text-align: center;
    font-size: 8pt;
    line-height: 1.4;
  }
`;

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

/**
 * Every interpolated value goes through this. The rendered HTML is handed to
 * a real browser, so an unescaped guest name is script execution.
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
 * The characters NFD cannot fold, in two groups.
 *
 * FIRST, Latin letters that carry their mark INSIDE the code point and so
 * decompose to nothing. Everything with a combining form — the whole Czech set,
 * German umlauts, French accents, Polish ogoneks — is handled by the
 * normalisation in `deaccent()` and must NOT be listed here.
 *
 * SECOND, typographic punctuation. These are not accents, but they are exactly
 * as non-ASCII as `ř` is and reach the document by the same route: an address
 * pasted out of a booking system arrives full of en dashes, curly quotes and
 * non-breaking spaces. Leaving them would defeat the point — a payer block
 * reading "Praha – Vinohrady" is no closer to the ASCII original than one
 * reading "Praha - Vinohradý".
 *
 * The non-breaking space matters most in practice: Czech postcodes are
 * routinely written "120 00" with U+00A0, which is invisible in the editor and
 * indistinguishable from a normal space in the PDF — until something downstream
 * treats it as a different character.
 */
const DEACCENT_EXTRA: Record<string, string> = {
  // Letters with no decomposition.
  ł: "l", Ł: "L",
  đ: "d", Đ: "D",
  ø: "o", Ø: "O",
  æ: "ae", Æ: "AE",
  œ: "oe", Œ: "OE",
  ß: "ss",
  þ: "th", Þ: "Th",
  ð: "d", Ð: "D",
  ı: "i", ŉ: "n",
  // Punctuation. Dashes and hyphens of every width collapse to "-".
  " ": " ", " ": " ", " ": " ", " ": " ",
  "‐": "-", "‑": "-", "‒": "-", "–": "-",
  "—": "-", "―": "-", "−": "-",
  "‘": "'", "’": "'", "‚": "'", "‛": "'",
  "“": '"', "”": '"', "„": '"', "‟": '"',
  "…": "...", "•": "-", "·": ".",
};

/**
 * Fold accented Latin letters to their base form — `í`→`i`, `ř`→`r`, `ö`→`o`.
 *
 * The rest of this document is already diacritic-free by design ("Jmeno Hosta",
 * "Datum zdanit. plneni", "Zaklad dane"): Protel prints ASCII and this page
 * reproduces Protel. Only the user-entered payer and guest fields still carried
 * accents, which is the gap this closes.
 *
 * PRINT-TIME ONLY. The draft keeps whatever was typed — the editor shows the
 * real spelling, and a saved invoice reopened later is unchanged. Folding on
 * save would quietly destroy the payer's actual name in Firestore, and there is
 * no reason to: the ASCII form is a property of this printed document, not of
 * the data.
 *
 * NFD splits an accented letter into base + combining mark, so stripping the
 * combining range does the work generically; `DEACCENT_EXTRA` then covers the
 * letters that have no decomposition. Anything still non-ASCII after that — a
 * name in Cyrillic or Greek, say — is passed through UNCHANGED rather than
 * deleted: a mangled name is recoverable by eye, a blank one is not.
 */
function deaccent(value: string): string {
  if (!value) return "";
  let out = "";
  // Iterated by code POINT (for...of on a string), not by UTF-16 unit, so an
  // astral character is never split into a lone surrogate pair half.
  for (const ch of value.normalize("NFD")) {
    const cp = ch.codePointAt(0) as number;
    // U+0300-U+036F, Combining Diacritical Marks: precisely what NFD split off
    // a moment ago. Dropping them IS the fold.
    if (cp >= 0x0300 && cp <= 0x036f) continue;
    // Plain ASCII, the overwhelmingly common case.
    if (cp < 0x80) {
      out += ch;
      continue;
    }
    out += DEACCENT_EXTRA[ch] ?? ch;
  }
  return out;
}

/**
 * Czech money formatting — `12 003,75`. Hand-rolled on purpose: the Functions
 * runtime may ship a trimmed ICU, in which case `toLocaleString("cs-CZ")`
 * silently degrades to the C locale.
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
    if (i > 0 && (whole.length - i) % 3 === 0) grouped += " ";
    grouped += whole[i];
  }
  return `${negative ? "-" : ""}${grouped},${decimals}`;
}

/** Line table and totals print the currency inline; the recap does not. */
function fmtCzk(value: number): string {
  return `${fmt(value)} CZK`;
}

/** CZK → EUR with the suffix, or an en dash when no usable rate was given. */
function fmtEur(czk: number, rate: number): string {
  if (!rate || !isFinite(rate) || rate <= 0) return "–";
  return `${fmt(czk / rate)} EUR`;
}

/** Units column: integers print bare, fractions keep two decimals. */
function fmtUnits(units: number): string {
  if (!isFinite(units)) return "";
  return Number.isInteger(units) ? String(units) : fmt(units);
}

/**
 * Splits `YYYY-MM-DD[THH:MM]`. String surgery ONLY — never parse with
 * `new Date(iso)`: in UTC+2 that lands on the previous day, a bug this repo
 * has already been bitten by.
 */
function parts(value: string): { d: string; m: string; y: string; time: string } | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value ?? "");
  if (!iso) return null;
  return { y: iso[1], m: iso[2], d: iso[3], time: iso[4] ? `${iso[4]}:${iso[5]}` : "" };
}

/** `DD/MM/YY` — the line table, Arrival and Departure. */
function fmtShort(value: string): string {
  const p = parts(value);
  if (!p) return value ?? "";
  return `${p.d}/${p.m}/${p.y.slice(2)}`;
}

/** `DD/MM/YYYY`, with `, HH:MM` appended when the value carries a time. */
function fmtLong(value: string): string {
  const p = parts(value);
  if (!p) return value ?? "";
  return `${p.d}/${p.m}/${p.y}${p.time ? `, ${p.time}` : ""}`;
}

/**
 * The header logo is the ONE value not passed through `esc()`, so it is
 * validated instead. Anything that is not an inline image data URI is
 * dropped: the renderer blocks remote fetches, and an attacker-supplied
 * `src` has no business in this document.
 */
function logoImg(dataUri: string): string {
  const ok = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUri ?? "");
  return ok ? `<img class="inv-logo" src="${dataUri}" alt="">` : "";
}

/* ------------------------------------------------------------------ */
/* Party resolution                                                    */
/* ------------------------------------------------------------------ */

interface ResolvedParty {
  name: string;
  /**
   * The address lines that actually carry text, in workbook row order, with
   * blanks REMOVED — at most five, often two or three.
   *
   * Earlier versions kept the five slots fixed and printed the blanks, on the
   * theory that the empty rows were what kept IC / DIC level with Tax Charged
   * and Payable On in the meta grid. They are not: the meta table is one grid
   * whose row heights come from the LEFT column, which is fixed at ten rows of
   * labels no matter what the address does. Only the address's own tail is
   * affected, so an unused "Ulice 3" now closes up instead of punching a hole
   * through the block.
   */
  slots: string[];
  ic: string;
  dic: string;
}

/* ------------------------------------------------------------------ */
/* EFT receipt                                                         */
/* ------------------------------------------------------------------ */

/** Two spaces between columns — enough to read as a gutter, cheap in width. */
const EFT_GUTTER = "  ";
/**
 * Printable width. A4 is 210 mm and INVOICE_MARGINS takes 6 mm off each side,
 * leaving 198 mm; 194 keeps a safety margin against rounding in Chrome's own
 * layout, since overshooting clips the right-hand column silently.
 */
const EFT_WIDTH_MM = 194;
/** Courier's advance width is exactly 0.6 em, and 1 pt is 25.4/72 mm. */
const EFT_ADVANCE_EM = 0.6;
const MM_PER_PT = 25.4 / 72;
/**
 * Below ~3.6 pt the slip stops being legible in print, so an absurdly wide
 * paste is allowed to overflow instead of shrinking into a grey smear — a
 * visibly-too-wide block tells the user to fix the paste, an unreadable one
 * does not. The ceiling matches the recap's 8 pt so the slip never looks
 * larger than the document around it.
 */
const EFT_MIN_PT = 3.6;
const EFT_MAX_PT = 8;

/**
 * The pasted terminal slip → a preformatted, column-aligned monospace block,
 * or "" when the draft carries no receipt.
 *
 * Every cell is padded to its column's widest value, which in a monospace face
 * IS the column layout — no table involved, deliberately: a nested table
 * straddling a page break renders its rows twice in Chrome (see `.inv-bank`).
 *
 * The font size is DERIVED from the widest row rather than fixed, because the
 * column count is a property of the paste, not of the document: a single slip
 * is 4 columns wide and prints comfortably at 8 pt, while a merchant copy and
 * cardholder copy pasted together push one row to 6 columns and must shrink to
 * fit. A fixed size would either overflow the page on the wide case or waste
 * half the width on the common one.
 */
function buildEft(raw: string): string {
  const rows = eftGrid(raw);
  if (rows.length === 0) return "";

  const widths = eftColumnWidths(rows);
  const pad = (s: string, w: number): string => s + " ".repeat(Math.max(0, w - s.length));
  const body = rows
    .map((cells) =>
      esc(
        cells
          .map((c, i) => pad(c, widths[i]))
          .join(EFT_GUTTER)
          // Trailing padding is invisible under white-space: pre, but carrying
          // it into the HTML bloats the payload for no gain.
          .replace(/\s+$/, "")
      )
    )
    .join("\n");

  const chars =
    widths.reduce((sum, w) => sum + w, 0) + EFT_GUTTER.length * Math.max(0, widths.length - 1);
  const fitted = EFT_WIDTH_MM / (chars * EFT_ADVANCE_EM * MM_PER_PT);
  const size = Math.min(EFT_MAX_PT, Math.max(EFT_MIN_PT, fitted));

  return `<div class="inv-eft-slip" style="font-size:${size.toFixed(2)}pt">${body}</div>`;
}

/** Zip and city share one line, as they do when written on an envelope. */
function addressSlots(p: PartyAddress): string[] {
  const zipCity = [p.zip, p.city].filter((s) => !!s && !!s.trim()).join(" ");
  return [p.street1, p.street2, p.street3, zipCity, p.country]
    .map((s) => (s ?? "").trim())
    .filter((s) => s !== "");
}

/**
 * `billTo` is either a pointer into the agency address book or an inline
 * person. An agency id that no longer resolves degrades to a nameless block
 * rather than throwing — the PDF must still render.
 *
 * Every field is `deaccent()`-ed here, and this is the ONLY place it needs to
 * happen for the payer: both surfaces that print the payer — the meta grid's
 * Correspondence Address column and the Billed To band — read the party from
 * this one function, so a new payer field added to `ResolvedParty` is folded by
 * construction rather than by remembering to.
 */
function resolveBillTo(draft: InvoiceDraft, config: FakturyConfig): ResolvedParty {
  const billTo = draft.billTo;
  if (billTo.kind === "agency") {
    const agency = config.agencies.find((a) => a.id === billTo.agencyId);
    if (!agency) return { name: "", slots: [], ic: "", dic: "" };
    return {
      name: deaccent(agency.name),
      slots: addressSlots(agency).map(deaccent),
      ic: deaccent(agency.ic),
      dic: deaccent(agency.dic),
    };
  }
  return {
    name: deaccent(billTo.name),
    slots: addressSlots(billTo).map(deaccent),
    ic: deaccent(billTo.ic),
    dic: deaccent(billTo.dic),
  };
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
  const totals = computeTotals(draft.lines, config.vatRates, draft.deposit);
  const rate = draft.eurRate;
  const party = resolveBillTo(draft, config);

  /* 1 — header band. The logo is ours (the Excel export has none, the
     customer wants one); the title block reproduces the export's two
     stacked bold lines, Czech over English. */
  const header = `<table><colgroup>
      <col style="width:45%"><col style="width:55%">
    </colgroup><tbody><tr>
      <td>${hotel ? logoImg(hotel.logoDataUri) : ""}</td>
      <td class="inv-title">
        <div>${
          draft.deposit ? "Danovy doklad k prijate zaloze" : "Faktura - Danovy Doklad"
        }</div>
        <div>${draft.deposit ? "Deposit Invoice" : "Invoice"}</div>
      </td>
    </tr></tbody></table>`;

  /*
   * 2 + 3 — the ten-row meta grid. Left column pair is the guest, right
   * column pair the correspondence address; row 7 is a spacer on the left and
   * row 8 blank on the right, exactly as the workbook rows run. Building it
   * as ONE table is what guarantees IC/DIC line up with Tax Charged and
   * Payable On, which is how the original reads.
   *
   * The address slots are COMPACTED (see `addressSlots`), so an unused
   * "Ulice 3" closes up rather than printing an empty row mid-block. The ten
   * rows survive regardless: their heights come from the left column's fixed
   * labels, not from the address.
   */
  const metaRows: [string, string, string, string][] = [
    // The payer's fields are already folded by `resolveBillTo`; the guest name
    // is the only other user-entered string this document prints.
    ["Guest Name / Jmeno Hosta:", deaccent(draft.guestName), "Correspondence Address", ""],
    ["Room Number / Cislo Pokoje:", draft.roomNo, `<span class="bold">${esc(party.name)}</span>`, ""],
    ["Arrival / Prijezd:", fmtShort(draft.arrival), esc(party.slots[0]), ""],
    ["Departure / Odjezd:", fmtShort(draft.departure), esc(party.slots[1]), ""],
    ["Reservation No. / Cislo Rezervace:", draft.reservationNo, esc(party.slots[2]), ""],
    [
      "Supplier Reservation Number:",
      supplierRefLine(draft.availProNo, draft.partnerResNo),
      esc(party.slots[3]),
      "",
    ],
    ["", "", esc(party.slots[4]), ""],
    ["Issued / Vystaveno:", fmtLong(draft.issuedAt), "", ""],
    // Both derived, never stored: the tax point IS the issue date and the
    // invoice falls due seven days later.
    [
      "Tax Charged / Datum zdanit. plneni:",
      fmtLong(taxDateFrom(draft.issuedAt)),
      "IC:",
      esc(party.ic),
    ],
    [
      "Payable On / Datum Splatnosti:",
      fmtLong(dueDateFrom(draft.issuedAt)),
      "DIC:",
      esc(party.dic),
    ],
  ];
  // Rows 2 / 3 of the right column are pre-escaped markup; the left pair and
  // the IC/DIC values are raw and still need escaping.
  const meta = `<table class="inv-meta"><colgroup>
      <col style="width:30%"><col style="width:30%">
      <col style="width:6%"><col style="width:34%">
    </colgroup><tbody>
      ${metaRows
        .map(
          ([l, v, rl, rv], i) =>
            `<tr${i === 6 ? ' class="sp"' : ""}>
              <td>${esc(l)}</td><td>${esc(v)}</td>
              <td colspan="${rv ? 1 : 2}">${rl}</td>${rv ? `<td>${rv}</td>` : ""}
            </tr>`
        )
        .join("")}
    </tbody></table>`;

  /*
   * 4 — Billed To band: the same payer again, as up to six non-empty lines
   * (the name plus the compacted address) poured COLUMN-major into a 3 × 2
   * grid:
   *
   *     [1] [3] [5]
   *     [2] [4] [6]
   *
   * Filling by position rather than by field is what makes a short address
   * read correctly: a payer with one street line and no country simply stops
   * after [3] instead of leaving the middle column blank and the last column
   * stranded on its own.
   */
  const billedEntries: string[] = [
    ...(party.name ? [`<span class="bold">${esc(party.name)}</span>`] : []),
    ...party.slots.map((s) => esc(s)),
  ];
  const billedCol = (a: string | undefined, b: string | undefined): string =>
    `<td>${a ? `<div>${a}</div>` : ""}${b ? `<div>${b}</div>` : ""}</td>`;
  const billed = `<div class="bold" style="margin-top:4mm">Billed To:</div>
    <table class="inv-billed"><colgroup>
      <col style="width:40%"><col style="width:25%"><col style="width:35%">
    </colgroup><tbody><tr>
      ${billedCol(billedEntries[0], billedEntries[1])}
      ${billedCol(billedEntries[2], billedEntries[3])}
      ${billedCol(billedEntries[4], billedEntries[5])}
    </tr></tbody></table>`;

  /* 5 — invoice number: plain bold text at a tab stop, no box. */
  const invoiceNo = `<div class="inv-no">Invoice No. / Faktura Cislo<span class="val">${esc(
    draft.invoiceNo
  )}</span></div>${
    draft.note && draft.note.trim()
      ? `<div class="inv-note"><span class="bold">Note: </span>${esc(draft.note.trim())}</div>`
      : ""
  }`;

  /* 6 — line table. Payment and transfer rows already carry their sign. */
  const cell = (cls: string, value: string): string =>
    `<td class="${cls}"><div class="clip">${value}</div></td>`;

  const lineRow = (line: InvoiceLine): string => `<tr>
      ${cell("pad", esc(fmtShort(line.date)))}
      ${cell("ctr pad", esc(fmtUnits(line.units)))}
      ${cell("pad", esc(line.description))}
      ${cell("ital pad", esc(fmtShort(line.detail)))}
      ${cell("num pad", esc(fmtCzk(line.unitPrice)))}
      ${cell("num", esc(fmtCzk(lineTotal(line))))}
    </tr>`;

  /*
   * Column widths, summing to 100. Date and Units are kept tight — a
   * fixed-width DD/MM/YY plus its 3 mm pad, and a one- or two-digit count —
   * which pulls Description and the free Detail column leftwards and gives
   * them the room the long postings actually need. Do not squeeze Date below
   * ~10 %: cells are CLIPPED now, so a column too narrow for its content loses
   * the end of the date silently rather than wrapping it.
   *
   * The two money columns are right-aligned, so their FIGURES sit at each
   * column's right edge — shrinking Total Price is what moves Price per Unit
   * rightwards, not shrinking Price per Unit itself.
   */
  const lines = `<table class="inv-lines"><colgroup>
      <col style="width:10%"><col style="width:5%"><col style="width:23%">
      <col style="width:28%"><col style="width:18%"><col style="width:16%">
    </colgroup>
    <thead><tr>
      <th>Date</th><th class="ctr">Units</th><th>Description</th><th></th>
      <th class="num">Price per Unit CZK</th><th class="num">Total Price CZK</th>
    </tr></thead>
    <tbody>${draft.lines.map(lineRow).join("")}</tbody></table>
    <div class="rule-strong" style="margin-top:1.5mm"></div>`;

  /* 7 — totals, always dual currency. Only the Total row is bold. */
  const totalsRow = (label: string, czk: number, bold = false): string => {
    const c = bold ? ' class="bold"' : "";
    return `<tr>
      <td${c}>${esc(label)}</td>
      <td class="num pad${bold ? " bold" : ""}">${esc(fmtCzk(czk))}</td>
      <td class="num${bold ? " bold" : ""}">${esc(fmtEur(czk, rate))}</td>
    </tr>`;
  };

  /* The CZK and EUR figures sit directly under the line table's last two
     columns, so widths 2 and 3 mirror those (18 % / 16 %) exactly — change one
     and the other has to follow. */
  const totalsBlock = `<table class="inv-totals"><colgroup>
      <col style="width:66%"><col style="width:18%"><col style="width:16%">
    </colgroup><tbody>
      ${totalsRow("Total / Celkem:", totals.total, true)}
      ${totalsRow("Received Payments / Uhrazeno:", totals.payments)}
      ${totalsRow("Open (Payable) / K uhrade:", totals.open)}
    </tbody></table>
    <div class="rule" style="margin-top:2mm"></div>`;

  /* 8 — VAT recap. Every active bucket is listed, zeros included; the
     advance block is distinguished by its label ("Deposit 12.00 %"), which
     the číselník carries, not by a sub-heading. */
  const recapRow = (row: RecapRow): string => `<tr>
      <td>${esc(row.label)}</td>
      <td class="num">${esc(fmt(row.base))}</td>
      <td class="num">${esc(fmt(row.vat))}</td>
      <td class="num">${esc(fmt(row.total))}</td>
    </tr>`;

  const recapBlock = `<table class="inv-recap"><colgroup>
      <col style="width:36%"><col style="width:20%">
      <col style="width:18%"><col style="width:26%">
    </colgroup>
    <thead><tr>
      <th>VAT Rate / Sazba DPH</th>
      <th class="num">Tax Base / Zaklad dane CZK</th>
      <th class="num">VAT / Castka DPH CZK</th>
      <th class="num">Total inc. VAT / Celkem s DPH CZK</th>
    </tr></thead>
    <tbody>
      ${totals.recap.map(recapRow).join("")}
      <tr class="total">
        <td>Total / Celkem:</td>
        <td class="num">${esc(fmt(totals.recapBase))}</td>
        <td class="num">${esc(fmt(totals.recapVat))}</td>
        <td class="num">${esc(fmt(totals.recapTotal))}</td>
      </tr>
    </tbody></table>`;

  /* 9 — EFT receipt, issued-by, then the two bank blocks. The heading prints
     unconditionally; the slip below it only when the draft carries one. */
  const eft = `<div class="inv-eft">EFT Receipt:</div>
    ${buildEft(draft.eftReceipt)}
    <div class="inv-issued">Issued By:&nbsp;&nbsp;&nbsp;${esc(draft.issuedBy)}</div>`;

  const bankRows = (
    suffix: string,
    bank: { account: string; swift: string; iban: string }
  ): string =>
    [
      [`A/C No. ${suffix}:`, bank.account],
      [`SWIFT ${suffix}:`, bank.swift],
      [`IBAN ${suffix}:`, bank.iban],
    ]
      .map(([l, v]) => `<tr><td class="lbl">${esc(l)}</td><td>${esc(v)}</td></tr>`)
      .join("");

  const bankCell = (
    heading: string,
    suffix: string,
    bank: { account: string; swift: string; iban: string } | undefined
  ): string => `<td class="cell">
      <div class="bhead">${esc(heading)}</div>
      <div>${esc(hotel?.bankName ?? "")}</div>
      <table><tbody>
        ${bank ? bankRows(suffix, bank) : ""}
      </tbody></table>
    </td>`;

  // No rule above this block: the original has none under "Issued By".
  const bank = `<table class="inv-bank" style="margin-top:4mm"><colgroup>
      <col style="width:50%"><col style="width:50%">
    </colgroup><tbody><tr>
      ${bankCell("EUR Account Number / EUR bankovni ucet Czech Republic", "EUR", hotel?.bankEur)}
      ${bankCell("CZK Account Number / CZK bankovni ucet Czech Republic", "CZK", hotel?.bankCzk)}
    </tr></tbody></table>`;

  /* 10 — issuing entity, then the Excel print footer pinned to the sheet. */
  const companyLine = company
    ? `<div class="inv-company">${esc(
        [
          company.name,
          company.address,
          company.ic ? `ICO: ${company.ic}` : "",
          company.dic ? `DIC: ${company.dic}` : "",
          company.fileNo,
        ]
          .filter((s) => !!s && s.trim().length > 0)
          .join(", ")
      )}</div>`
    : "";

  const pageFooter = hotel && hotel.footer
    ? `<div class="inv-page-footer">${escMultiline(hotel.footer)}</div>`
    : "";

  return `<div class="inv-content">
    ${header}
    ${meta}
    ${billed}
    ${invoiceNo}
    ${lines}
    ${totalsBlock}
    ${recapBlock}
    ${eft}
    ${bank}
    ${companyLine}
  </div>${pageFooter}`;
}
