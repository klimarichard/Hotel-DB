/**
 * Client-side PDF shrinking + splitting for the signed-contract upload.
 *
 * WHY CLIENT-SIDE: the scans staff upload (a phone photo or an office scanner
 * set to 600 DPI colour) are one big raster per page, and the file size is
 * almost entirely that raster. pdf-lib – which the backend already uses – copies
 * image streams through untouched; it cannot re-encode them, so it can't shrink
 * a scan. Re-encoding needs a rasteriser, and the browser already is one
 * (pdf.js → <canvas> → JPEG). Doing it here also means the SMALL file is what
 * crosses the wire, so we stay well under the 10 MB express.json body cap
 * instead of dying on an opaque body-parser 413.
 *
 * WHY IT IS CONDITIONAL: rasterising destroys a real text layer (selectable
 * text, and the AcroForm fields of a generated Prohlášení). So we only rasterise
 * documents that carry no meaningful text – i.e. actual scans. A digitally
 * generated PDF is passed through untouched, and is already small anyway.
 *
 * Both libraries are imported dynamically: pdf.js is ~1 MB and would otherwise
 * land in the main bundle for every user, including those who never upload.
 */

/** Render target. 150 DPI is the usual archival floor for scanned paper: still
 *  crisp on screen and printable, roughly a quarter of the pixels of a 300 DPI
 *  scan. PDF user-space is 72 units/inch, hence the ratio. */
const TARGET_DPI = 150;
const PDF_UNITS_PER_INCH = 72;

/** JPEG quality. 0.72 keeps handwriting and stamps legible while cutting most
 *  of the bulk; colour is preserved (never converted to grayscale) because
 *  signatures are usually blue ink and that is worth keeping. */
const JPEG_QUALITY = 0.72;

/**
 * Chars of extractable text, across the whole document, above which we treat it
 * as digitally generated and refuse to rasterise. A scan yields ~0 (an OCR'd
 * scan yields some, but those are already text-bearing and worth preserving).
 */
const TEXT_LAYER_THRESHOLD = 200;

export interface CompressResult {
  bytes: Uint8Array;
  originalSize: number;
  finalSize: number;
  /** False when the original was returned untouched (digital PDF, or the
   *  re-encode came out no smaller). */
  compressed: boolean;
}

/** pdf.js needs its worker URL set once. Vite resolves `?url` to an asset URL. */
async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjs;
}

/** Page count, without rendering anything. */
export async function getPageCount(bytes: Uint8Array): Promise<number> {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return doc.getPageCount();
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("canvas.toBlob returned null"));
          return;
        }
        blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject);
      },
      "image/jpeg",
      JPEG_QUALITY
    );
  });
}

/**
 * Shrink a scanned PDF by re-encoding each page as a JPEG at TARGET_DPI.
 *
 * Returns the ORIGINAL bytes unchanged when the document has a real text layer,
 * when it comes out no smaller, or when anything at all goes wrong – shrinking
 * is an optimisation, never a reason to fail an upload or lose the document.
 */
export async function compressScannedPdf(file: File): Promise<CompressResult> {
  const originalBytes = new Uint8Array(await file.arrayBuffer());
  const untouched: CompressResult = {
    bytes: originalBytes,
    originalSize: originalBytes.byteLength,
    finalSize: originalBytes.byteLength,
    compressed: false,
  };

  try {
    const pdfjs = await loadPdfJs();
    // pdf.js takes ownership of (and detaches) the buffer it is handed, which
    // would leave `originalBytes` empty for the fallback paths below. Give it a
    // copy so the original survives.
    const doc = await pdfjs.getDocument({ data: originalBytes.slice() }).promise;

    let textChars = 0;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const text = await page.getTextContent();
      for (const item of text.items) {
        if ("str" in item) textChars += item.str.trim().length;
      }
      if (textChars > TEXT_LAYER_THRESHOLD) return untouched; // digital → leave alone
    }

    const { PDFDocument } = await import("pdf-lib");
    const out = await PDFDocument.create();
    const scale = TARGET_DPI / PDF_UNITS_PER_INCH;

    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext("2d");
      if (!ctx) return untouched;
      // Scanned pages are transparent where nothing was drawn; JPEG has no alpha
      // and would render those areas black. Paint the sheet white first.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvasContext: ctx, viewport }).promise;
      const jpeg = await canvasToJpeg(canvas);

      // Keep the page its original physical size (viewport at scale 1 = points),
      // so the shrunken PDF still prints as A4 rather than as a huge bitmap.
      const pt = page.getViewport({ scale: 1 });
      const outPage = out.addPage([pt.width, pt.height]);
      const img = await out.embedJpg(jpeg);
      outPage.drawImage(img, { x: 0, y: 0, width: pt.width, height: pt.height });

      canvas.width = 0; // release the backing store eagerly
      canvas.height = 0;
    }

    const bytes = await out.save();
    if (bytes.byteLength >= originalBytes.byteLength) return untouched;

    return {
      bytes,
      originalSize: originalBytes.byteLength,
      finalSize: bytes.byteLength,
      compressed: true,
    };
  } catch {
    return untouched;
  }
}

/**
 * Split `bytes` after page `splitAfterPage` (1-based, inclusive).
 * Pages 1..splitAfterPage become `first`; the remainder becomes `second`.
 */
export async function splitPdf(
  bytes: Uint8Array,
  splitAfterPage: number
): Promise<{ first: Uint8Array; second: Uint8Array }> {
  const { PDFDocument } = await import("pdf-lib");
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const total = src.getPageCount();
  if (splitAfterPage < 1 || splitAfterPage >= total) {
    throw new Error(`splitAfterPage ${splitAfterPage} out of range for ${total} pages`);
  }

  const firstDoc = await PDFDocument.create();
  const firstPages = await firstDoc.copyPages(
    src,
    Array.from({ length: splitAfterPage }, (_, i) => i)
  );
  firstPages.forEach((p) => firstDoc.addPage(p));

  const secondDoc = await PDFDocument.create();
  const secondPages = await secondDoc.copyPages(
    src,
    Array.from({ length: total - splitAfterPage }, (_, i) => splitAfterPage + i)
  );
  secondPages.forEach((p) => secondDoc.addPage(p));

  return { first: await firstDoc.save(), second: await secondDoc.save() };
}

/** Base64-encode raw bytes in chunks (a single String.fromCharCode(...bytes)
 *  blows the argument limit on multi-MB files). Mirrors lib/blobToBase64. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
