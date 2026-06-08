/**
 * Generates the "Prohlášení poplatníka daně z příjmů fyzických osob ze závislé
 * činnosti" (Czech tax declaration, official form MFin 5457 vzor č. 26) by
 * OVERLAYING employer + employee data onto the bundled blank PDF
 * (`assets/prohlaseni.pdf`).
 *
 * The blank is a FLAT PDF (no AcroForm fields), so we draw text at calibrated
 * coordinates with pdf-lib. pdf-lib's standard fonts use WinAnsi encoding, which
 * lacks the Czech caron/ring glyphs (č š ž ř ě ů ň ť ď), so we embed a Unicode
 * TTF (DejaVu Sans) via @pdf-lib/fontkit. Only page 1 carries data; page 2 (the
 * declaration/change tables) is left blank for the employee to complete by hand.
 *
 * Sensitive values (rodné číslo, doklad totožnosti) arrive already DECRYPTED —
 * the caller handles permission gating and audit logging.
 *
 * pdf-lib coordinate origin is BOTTOM-LEFT; A4 = 595.28 × 841.89 pt.
 */
import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import * as fs from "fs";
import * as path from "path";

export interface ProhlaseniData {
  taxYear?: number | null;
  companyName?: string | null;
  companyAddress?: string | null;
  lastName?: string | null;
  firstName?: string | null;
  birthNumber?: string | null; // decrypted
  permanentAddress?: string | null;
  // Daňový nerezident ČR (non-resident) block — only filled for foreigners.
  isNonResident?: boolean;
  dateOfBirth?: string | null; // YYYY-MM-DD
  idDocument?: string | null; // "Číslo a typ dokladu prokazující totožnost"
  idDocumentIssuer?: string | null; // "Stát, který tento doklad vydal"
}

/** x/y in PDF points (bottom-left origin); size in pt; maxWidth caps the text. */
interface FieldBox {
  x: number;
  y: number;
  size: number;
  maxWidth: number;
}

/**
 * Calibrated coordinate map for page 1. Tuned against the bundled blank form;
 * adjust here if the source PDF is ever replaced. Set PROHLASENI_DEBUG_GRID=1
 * to overlay a coordinate grid that makes re-calibration quick.
 */
const FIELDS: Record<keyof Omit<ProhlaseniData, "isNonResident">, FieldBox> = {
  taxYear: { x: 448, y: 762, size: 11, maxWidth: 95 },
  companyName: { x: 120, y: 707, size: 10, maxWidth: 430 },
  companyAddress: { x: 90, y: 686, size: 10, maxWidth: 460 },
  lastName: { x: 78, y: 641, size: 9, maxWidth: 150 },
  firstName: { x: 268, y: 641, size: 9, maxWidth: 120 },
  birthNumber: { x: 440, y: 641, size: 9, maxWidth: 110 },
  permanentAddress: { x: 200, y: 620, size: 9, maxWidth: 350 },
  dateOfBirth: { x: 250, y: 583, size: 9, maxWidth: 290 },
  idDocument: { x: 235, y: 562, size: 9, maxWidth: 200 },
  idDocumentIssuer: { x: 470, y: 562, size: 9, maxWidth: 80 },
};

const FONT_PATH = path.join(__dirname, "..", "assets", "DejaVuSans.ttf");
const PDF_PATH = path.join(__dirname, "..", "assets", "prohlaseni.pdf");

/** Czech `D. M. YYYY` from `YYYY-MM-DD`, string-based (avoids the UTC-shift bug). */
function formatDateCZ(iso?: string | null): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  return `${Number(d)}. ${Number(mo)}. ${y}`;
}

/**
 * Draw a value inside a box: shrink the font down to a 6pt floor to fit
 * maxWidth, then ellipsis-truncate if still too wide. No-ops on empty values.
 */
function drawFitted(page: PDFPage, font: PDFFont, value: string, box: FieldBox): void {
  const text = value.trim();
  if (!text) return;

  let size = box.size;
  while (size > 6 && font.widthOfTextAtSize(text, size) > box.maxWidth) {
    size -= 0.5;
  }

  let out = text;
  if (font.widthOfTextAtSize(out, size) > box.maxWidth) {
    while (out.length > 1 && font.widthOfTextAtSize(out + "…", size) > box.maxWidth) {
      out = out.slice(0, -1);
    }
    out += "…";
  }

  page.drawText(out, { x: box.x, y: box.y, size, font, color: rgb(0, 0, 0) });
}

/** Dev aid: faint 50pt grid + axis labels so coordinates can be read off. */
function drawDebugGrid(page: PDFPage, font: PDFFont): void {
  const { width, height } = page.getSize();
  const faint = rgb(0.8, 0.85, 1);
  for (let x = 0; x <= width; x += 50) {
    page.drawLine({ start: { x, y: 0 }, end: { x, y: height }, thickness: 0.3, color: faint });
    page.drawText(String(x), { x: x + 1, y: 4, size: 5, font, color: rgb(0, 0, 0.8) });
  }
  for (let y = 0; y <= height; y += 50) {
    page.drawLine({ start: { x: 0, y }, end: { x: width, y }, thickness: 0.3, color: faint });
    page.drawText(String(y), { x: 2, y: y + 1, size: 5, font, color: rgb(0, 0, 0.8) });
  }
}

export async function renderProhlaseni(data: ProhlaseniData): Promise<Buffer> {
  const pdfBytes = fs.readFileSync(PDF_PATH);
  const fontBytes = fs.readFileSync(FONT_PATH);

  const pdfDoc = await PDFDocument.load(pdfBytes);
  pdfDoc.registerFontkit(fontkit);
  const font = await pdfDoc.embedFont(fontBytes, { subset: true });

  const page = pdfDoc.getPages()[0];

  if (process.env.PROHLASENI_DEBUG_GRID === "1") {
    drawDebugGrid(page, font);
  }

  const draw = (key: keyof typeof FIELDS, value?: string | null) => {
    if (value) drawFitted(page, font, value, FIELDS[key]);
  };

  draw("taxYear", data.taxYear != null ? String(data.taxYear) : "");
  draw("companyName", data.companyName);
  draw("companyAddress", data.companyAddress);
  draw("lastName", data.lastName);
  draw("firstName", data.firstName);
  draw("birthNumber", data.birthNumber);
  draw("permanentAddress", data.permanentAddress);

  // Non-resident identity block — only for foreign employees.
  if (data.isNonResident) {
    draw("dateOfBirth", formatDateCZ(data.dateOfBirth));
    draw("idDocument", data.idDocument);
    draw("idDocumentIssuer", data.idDocumentIssuer);
  }

  const out = await pdfDoc.save();
  return Buffer.from(out);
}
