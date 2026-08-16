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
  invoiceDetails: string;
  active: boolean;
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
 * A block with every id already resolved against the číselník.
 *
 * Both renderers take THIS, never the raw block + config: the plain-text and
 * HTML flavours of one copy must agree line for line, and the only way to
 * guarantee that is to give them the same resolved input.
 */
export interface ResolvedBlock {
  hotel: OrderHotel;
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
export function resolveBlocks(blocks: OrderBlock[], config: ObjednavkyConfig): ResolvedBlock[] {
  const itemById = new Map(config.items.map((i) => [i.id, i]));
  const hotelById = new Map(config.hotels.map((h) => [h.id, h]));

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
    out.push({ hotel, rows });
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
    `${lead} na ${block.hotel.name}` +
    ` s doručením na adresu ${inline(block.hotel.deliveryAddress)}` +
    ` a fakturačními údaji ${inline(block.hotel.invoiceDetails)}.`
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
const TABLE_OPEN =
  '<table border="1" cellpadding="6" cellspacing="0" ' +
  'style="border-collapse:collapse;border:1px solid #000000;">';
const CELL = 'style="border:1px solid #000000;padding:6px;"';

export function buildOrderHtml(blocks: ResolvedBlock[]): string {
  return blocks
    .map((block, i) => {
      const rows = block.rows
        .map(
          (r) =>
            `<tr><td ${CELL}>${escapeHtml(r.label)}</td>` +
            `<td ${CELL}>${r.qty} ${escapeHtml(r.unit)}</td></tr>`
        )
        .join("");
      // The greeting and the first sentence share one paragraph separated by a
      // <br>, matching the template's two consecutive lines.
      const lead =
        i === 0
          ? `<p>Dobrý den,<br>${escapeHtml(sentence(block, true))}</p>`
          : `<p>${escapeHtml(sentence(block, false))}</p>`;
      return `${lead}${TABLE_OPEN}<tbody>${rows}</tbody></table>`;
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
  return parts.join("\n\n") + "\n";
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
