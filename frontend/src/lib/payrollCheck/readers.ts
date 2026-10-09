/**
 * Kontrola mezd — browser file readers. Turn the uploaded files into the plain
 * rows / text lines `core.ts` works on. Both libraries are lazy-loaded so the
 * Payroll page bundle doesn't grow; nothing is uploaded anywhere.
 */
import { loadPdfJs } from "@/lib/pdfCompress";
import { CheckInputError, type Cell, type CellValue } from "./core";

/** First sheet of an .xls/.xlsx as rows of (value, solid fill RRGGBB | null). */
export async function readXlsRows(file: File): Promise<Cell[][]> {
  const XLSX = await import("xlsx");
  let wb;
  try {
    wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { cellStyles: true });
  } catch {
    throw new CheckInputError(`Soubor „${file.name}“ se nepodařilo načíst jako Excel.`);
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws || !ws["!ref"]) throw new CheckInputError(`Soubor „${file.name}“ neobsahuje žádná data.`);
  const range = XLSX.utils.decode_range(ws["!ref"]);
  const rows: Cell[][] = [];
  for (let r = 0; r <= range.e.r; r++) {
    const row: Cell[] = [];
    for (let c = 0; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      const raw = cell?.v;
      const value: CellValue = raw === undefined || raw === null ? "" : typeof raw === "number" || typeof raw === "string" ? raw : String(raw);
      const s = cell?.s as { patternType?: string; fgColor?: { rgb?: string } } | undefined;
      const rgb = s?.patternType && s.patternType !== "none" && s.fgColor?.rgb ? s.fgColor.rgb.slice(-6).toUpperCase() : null;
      row.push([value, rgb]);
    }
    rows.push(row);
  }
  return rows;
}

/**
 * PDF text as lines. pdf.js returns positioned text runs; a separator is added
 * between runs on the same line when they are apart OR overlap (a clipped
 * label like "…PAUSAL" claims a width that runs into the next number — without
 * the overlap rule those lines silently fail to parse). Verified to give the
 * same items as the Python script's pypdf extraction.
 */
export async function readPdfLines(file: File): Promise<string[]> {
  const pdfjs = await loadPdfJs();
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  } catch {
    throw new CheckInputError(`Soubor „${file.name}“ se nepodařilo načíst jako PDF.`);
  }
  let text = "";
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      let prev: { hasEOL: boolean; transform: number[]; width: number } | null = null;
      for (const it of content.items) {
        if (!("str" in it)) continue;
        if (prev && !prev.hasEOL && it.str && !/\s$/.test(text) && !/^\s/.test(it.str)) {
          const gap = it.transform[4] - (prev.transform[4] + prev.width);
          if (Math.abs(it.transform[5] - prev.transform[5]) < 1 && (gap > 0.5 || gap < -1)) text += " ";
        }
        text += it.str + (it.hasEOL ? "\n" : "");
        prev = it;
      }
      text += "\n";
    }
  } finally {
    void doc.destroy();
  }
  return text.split(/\r?\n/);
}
