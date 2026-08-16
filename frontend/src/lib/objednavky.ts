/**
 * Objednávky (Tabulky → Objednávky) — client mirror of the číselník types, plus
 * the e-mail rendering.
 *
 * The e-mail is built HERE and only here. The server never renders it (see
 * `functions/src/routes/objednavky.ts`), because nothing about an order is
 * stored — the whole feature is "assemble text, put it on the clipboard".
 *
 * Types mirror `functions/src/services/orderTypes.ts`; keep them in step.
 */

/** Printed verbatim into the e-mail. See orderTypes.ts for why there is no label map. */
export type OrderUnit = "ks" | "balení";

export const ORDER_UNITS: readonly OrderUnit[] = ["ks", "balení"];

export interface OrderItem {
  id: string;
  name: string;
  code: string;
  unit: OrderUnit;
  active: boolean;
}

export interface OrderHotel {
  id: string;
  name: string;
  deliveryAddress: string;
  /**
   * Points at a `companies/{id}` doc — the same registry Nastavení → Společnosti
   * edits (HPM, STP). Billing details are NOT free text: they are a legal
   * identity that already exists in one place, and retyping it per hotel is how
   * an IČO ends up wrong in a supplier's records with nothing to reconcile it
   * against. `null` = not chosen yet, which blocks the copy.
   */
  companyId: string | null;
  active: boolean;
}

/**
 * A company as `GET /api/companies` returns it. Only the fields the e-mail
 * needs are modelled; `abbreviation` and `fileNo` exist on the document and are
 * deliberately NOT here, because neither belongs in an order e-mail.
 */
export interface OrderCompany {
  id: string;
  name: string;
  address: string;
  ic: string;
  dic: string;
}

/**
 * The billing block as it is printed mid-sentence:
 *
 *   Hotel Property Management s.r.o., IČO: 06947697, Panská 897/12, Praha 1, 110 00
 *
 * Note the order — name, IČO, THEN address — and that **DIČ is not printed**.
 * Both were corrected by the customer on 2026-08-16 after an earlier version
 * that read "name, address, IČO, DIČ"; the supplier wants the company
 * identified before it is located. `dic` is still carried on `OrderCompany`
 * because the field exists on the document and dropping it from the type would
 * make its absence here look like an oversight rather than a decision.
 *
 * Resolved at READ time from the company document, never stored on the hotel —
 * so correcting an address in Nastavení fixes every future order e-mail at
 * once, with nothing to re-save here. Empty parts are dropped rather than
 * printed as a dangling "IČO: ,".
 */
export function companyInvoiceDetails(company: OrderCompany): string {
  return [company.name, company.ic ? `IČO: ${company.ic}` : "", company.address]
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join(", ");
}

export interface ObjednavkyConfig {
  items: OrderItem[];
  hotels: OrderHotel[];
}

export const EMPTY_OBJEDNAVKY_CONFIG: ObjednavkyConfig = { items: [], hotels: [] };

/* ------------------------------------------------------------------ */
/* Working state (never persisted)                                     */
/* ------------------------------------------------------------------ */

export interface OrderLine {
  id: string;
  itemId: string;
  /** Whole units. Kept as a number; the input coerces and clamps to >= 1. */
  qty: number;
}

/** One hotel's section of the order. */
export interface OrderBlock {
  id: string;
  hotelId: string;
  lines: OrderLine[];
}

/**
 * A block with every id already resolved — against the číselník AND against the
 * company registry, so it carries finished strings rather than references.
 *
 * Both renderers take THIS, never the raw block + config: the plain-text and
 * HTML flavours of one copy must agree line for line, and the only way to
 * guarantee that is to give them the same resolved input. Resolving the company
 * here rather than in each renderer means the same applies to the billing block.
 */
export interface ResolvedBlock {
  hotelId: string;
  hotelName: string;
  deliveryAddress: string;
  /** Already formatted by `companyInvoiceDetails`; "" when unresolvable. */
  invoiceDetails: string;
  rows: { label: string; qty: number; unit: OrderUnit }[];
}

/**
 * A local id for a freshly added row — an order line, or a catalogue row in the
 * číselník. Same shape as `faktury.ts`'s `newLineId()`; kept separate rather
 * than imported so the two features share no module.
 *
 * On a číselník row this id is what the server stores, since `idOf()` keeps any
 * client id that is non-empty and unique.
 */
export function newRowId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** "AJAX univerzál 1L (2144)", or just the name when the item has no code. */
export function itemLabel(item: Pick<OrderItem, "name" | "code">): string {
  return item.code ? `${item.name} (${item.code})` : item.name;
}

/**
 * Resolve blocks against the číselník, dropping anything unresolvable.
 *
 * A line whose item was deleted from the catalogue mid-session, or a block
 * whose hotel was, silently disappears rather than rendering a blank row — a
 * nameless line in a supplier e-mail is worse than a missing one, and the
 * on-screen row list is where the user would notice the item vanish.
 */
export function resolveBlocks(
  blocks: OrderBlock[],
  config: ObjednavkyConfig,
  companies: OrderCompany[]
): ResolvedBlock[] {
  const itemById = new Map(config.items.map((i) => [i.id, i]));
  const hotelById = new Map(config.hotels.map((h) => [h.id, h]));
  const companyById = new Map(companies.map((c) => [c.id, c]));

  const out: ResolvedBlock[] = [];
  for (const block of blocks) {
    const hotel = hotelById.get(block.hotelId);
    if (!hotel) continue;
    const rows = block.lines
      .map((line) => {
        const item = itemById.get(line.itemId);
        if (!item || line.qty <= 0) return null;
        return { label: itemLabel(item), qty: line.qty, unit: item.unit };
      })
      .filter((r): r is { label: string; qty: number; unit: OrderUnit } => r !== null);
    if (rows.length === 0) continue;

    // A companyId pointing at a deleted company resolves to "" exactly like an
    // unset one, so a company removed in Nastavení blocks the copy instead of
    // silently dropping the billing block out of a sentence that still reads
    // as complete.
    const company = hotel.companyId ? companyById.get(hotel.companyId) : undefined;

    out.push({
      hotelId: hotel.id,
      hotelName: hotel.name,
      deliveryAddress: hotel.deliveryAddress,
      invoiceDetails: company ? companyInvoiceDetails(company) : "",
      rows,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

/**
 * Every interpolated string in the HTML flavour goes through this. The
 * číselník is admin-editable free text, and the result is both injected into
 * the page (the preview uses `dangerouslySetInnerHTML` so that what you see is
 * byte-for-byte what you copy) and pasted into a mail client. Escaping at the
 * single point of interpolation is what makes both of those safe.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Addresses and billing details are substituted MID-SENTENCE, so any newline
 * the admin typed would break the sentence across lines in the finished
 * e-mail. Collapsed to single spaces at render time rather than on save, so
 * the stored value stays exactly what was typed.
 */
function inline(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sentence(block: ResolvedBlock, first: boolean): string {
  const lead = first ? "prosím o objednání" : "Dále prosím o objednání";
  return (
    `${lead} na ${block.hotelName}` +
    ` s doručením na adresu ${inline(block.deliveryAddress)}` +
    ` a fakturačními údaji ${inline(block.invoiceDetails)}.`
  );
}

/**
 * Outlook-safe HTML.
 *
 * Pasting into Outlook's compose window means the HTML is handed over as a
 * CF_HTML clipboard payload and then converted by Outlook's Word-derived
 * engine, which discards stylesheets and normalises CSS aggressively. So:
 * presentational ATTRIBUTES (`border`, `cellpadding`, `cellspacing`) plus
 * INLINE styles repeated on every cell, no classes, no <style> block, no
 * flex/grid. Built with modern CSS this arrives as an unstyled column of text.
 *
 * No `font-family` anywhere, deliberately — omitting it lets the pasted table
 * inherit the mail's own font instead of standing out as a foreign block.
 */
/**
 * Column widths are computed once across **every** table in the message, so all
 * of them come out identical — a message whose tables each sized themselves to
 * their own longest row reads as a stack of ragged boxes.
 *
 * Width is estimated from character count because there is no way to measure
 * text for a document that will be rendered in an unknown font at an unknown
 * size. `CHAR_PX` is therefore deliberately GENEROUS (a proportional 11pt face
 * averages nearer 6px/char): overshooting costs a little whitespace, while
 * undershooting is what the requirement — the widest text fits on one line —
 * explicitly rules out. `white-space:nowrap` is the belt to that braces; if the
 * estimate ever falls short, Word widens the column rather than wrapping.
 */
const CHAR_PX = 8;
/** 6px padding each side + the 1px borders either side of the content box. */
const CELL_CHROME_PX = 14;
const MIN_COL_PX = 56;

function columnWidths(blocks: ResolvedBlock[]): { label: number; qty: number } {
  let label = 0;
  let qty = 0;
  for (const block of blocks) {
    for (const row of block.rows) {
      label = Math.max(label, row.label.length);
      qty = Math.max(qty, `${row.qty} ${row.unit}`.length);
    }
  }
  return {
    label: Math.max(MIN_COL_PX, label * CHAR_PX + CELL_CHROME_PX),
    qty: Math.max(MIN_COL_PX, qty * CHAR_PX + CELL_CHROME_PX),
  };
}

/**
 * One empty line. An empty `<p>` alone is liable to be dropped as insignificant
 * whitespace, so it carries a non-breaking space to survive the conversion.
 */
const BLANK_LINE = "<p>&nbsp;</p>";

export function buildOrderHtml(blocks: ResolvedBlock[]): string {
  const w = columnWidths(blocks);
  const tableWidth = w.label + w.qty;

  // Widths are repeated on the table AND on every cell, as both an attribute
  // and an inline style. Word recomputes table geometry per row, so a width
  // declared only once (in a <colgroup>, or on the first row) is the thing it
  // most readily discards.
  const tableOpen =
    `<table border="1" cellpadding="6" cellspacing="0" width="${tableWidth}" ` +
    `style="border-collapse:collapse;border:1px solid #000000;` +
    `table-layout:fixed;width:${tableWidth}px;">`;
  // Bold on the cell AND a <strong> around the text: Word honours the element
  // unconditionally, while the inline weight covers a paste target that keeps
  // the CSS but flattens the markup. Same belt-and-braces as the widths.
  const labelCell =
    `width="${w.label}" style="border:1px solid #000000;padding:6px;` +
    `width:${w.label}px;white-space:nowrap;font-weight:bold;"`;
  const qtyCell =
    `width="${w.qty}" style="border:1px solid #000000;padding:6px;` +
    `width:${w.qty}px;white-space:nowrap;"`;

  return blocks
    .map((block, i) => {
      const rows = block.rows
        .map(
          (r) =>
            `<tr><td ${labelCell}><strong>${escapeHtml(r.label)}</strong></td>` +
            `<td ${qtyCell}>${r.qty} ${escapeHtml(r.unit)}</td></tr>`
        )
        .join("");
      // The greeting and the first sentence share one paragraph separated by a
      // <br>, matching the template's two consecutive lines.
      const lead =
        i === 0
          ? `<p>Dobrý den,<br>${escapeHtml(sentence(block, true))}</p>`
          : `<p>${escapeHtml(sentence(block, false))}</p>`;
      // One blank line above each table, two below — except after the last,
      // where trailing blanks would just push the signature down.
      const after = i === blocks.length - 1 ? "" : BLANK_LINE + BLANK_LINE;
      return `${lead}${BLANK_LINE}${tableOpen}<tbody>${rows}</tbody></table>${after}`;
    })
    .join("");
}

/**
 * The plain-text flavour of the same message, written to the clipboard
 * alongside the HTML. There is no way to draw a table in plain text that
 * survives a proportional font, so this lists one item per line instead —
 * which is what a recipient reading in plain text would want anyway.
 */
export function buildOrderText(blocks: ResolvedBlock[]): string {
  const parts = blocks.map((block, i) => {
    const rows = block.rows.map((r) => `${r.label} – ${r.qty} ${r.unit}`).join("\n");
    const lead = i === 0 ? `Dobrý den,\n${sentence(block, true)}` : sentence(block, false);
    return `${lead}\n\n${rows}`;
  });
  // Mirrors the HTML spacing: one blank line between a sentence and its list
  // (above), two between one block and the next (below).
  return parts.join("\n\n\n") + "\n";
}

/* ------------------------------------------------------------------ */
/* Clipboard                                                           */
/* ------------------------------------------------------------------ */

export type CopyFlavour = "rich" | "plain";

/**
 * Put both flavours on the clipboard in ONE ClipboardItem, so the paste target
 * picks: Outlook/Gmail take the HTML and render a real table, a plain-text
 * field takes the text.
 *
 * Falls back to `writeText` when the richer API is missing or refuses (older
 * browsers, and any non-secure context). The fallback is reported back to the
 * caller rather than swallowed, because "you got the plain-text version" is
 * something the user needs to know BEFORE they send the e-mail.
 *
 * Note the blob types carry no `;charset=` parameter: ClipboardItem requires
 * the key to match the blob's own type exactly, and adding one makes the
 * constructor throw.
 */
export async function copyOrderEmail(html: string, text: string): Promise<CopyFlavour> {
  const clip = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  if (!clip) throw new Error("Schránka není v tomto prohlížeči dostupná.");

  if (typeof ClipboardItem !== "undefined" && typeof clip.write === "function") {
    try {
      await clip.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      return "rich";
    } catch {
      // Fall through to the text-only path below.
    }
  }

  await clip.writeText(text);
  return "plain";
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

/**
 * Diacritic-insensitive, case-insensitive search key. Typing "uterka" has to
 * find "Mikroutěrka" — accents are the first thing to go when typing fast.
 * Same NFD-strip as `employmentSessions.ts` uses for name matching.
 */
export function searchKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Active items matching `query` on name OR code, in catalogue order. */
export function searchItems(items: OrderItem[], query: string): OrderItem[] {
  const q = searchKey(query);
  const active = items.filter((i) => i.active);
  if (q === "") return active;
  return active.filter((i) => searchKey(`${i.name} ${i.code}`).includes(q));
}
