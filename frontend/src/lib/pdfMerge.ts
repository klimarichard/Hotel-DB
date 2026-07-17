/**
 * Client-side PDF concatenation for "Hromadné generování".
 *
 * WHY CLIENT-SIDE: the merged document is print-only – it is never stored and
 * never crosses the wire, so building it here means no upload, no 10 MB
 * express.json body cap, and no server round-trip. The inputs are Puppeteer-
 * generated, text-bearing PDFs, which is exactly the case pdf-lib handles well:
 * copyPages moves page objects across documents untouched. (Its inability to
 * RE-ENCODE image streams – the reason lib/pdfCompress.ts rasterises scans via
 * pdf.js instead – doesn't bite here, and compressScannedPdf must NOT be run
 * over these: they carry a real text layer, and rasterising would destroy it.)
 *
 * pdf-lib is imported dynamically, matching lib/pdfCompress.ts: it is only ever
 * needed by users who actually run a batch, so it stays out of the main bundle.
 */

/**
 * Concatenate PDFs in the given order into one document.
 *
 * `title` becomes the PDF's own title, which is what the browser shows in the
 * tab and offers as the save-as name — a blob-URL open ignores
 * Content-Disposition, so setTitle is the only thing that names the file.
 */
export async function mergePdfBlobs(blobs: readonly Blob[], title: string): Promise<Blob> {
  const { PDFDocument } = await import("pdf-lib");
  const merged = await PDFDocument.create();

  for (const blob of blobs) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = await merged.copyPages(src, src.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }

  merged.setTitle(title);
  const out = await merged.save();
  // save() hands back a Uint8Array over an ArrayBufferLike, which BlobPart does
  // not accept (it could be a SharedArrayBuffer). Copy into a plain ArrayBuffer.
  return new Blob([new Uint8Array(out).buffer], { type: "application/pdf" });
}

/**
 * Open a PDF blob in a new tab for printing. Mirrors the generate-and-open
 * idiom used for the Dotazník / Prohlášení / blank questionnaire: the browser's
 * own PDF viewer offers printing, and window.print() could not target another
 * tab anyway. The object URL is revoked after a minute – long enough for the
 * viewer to have loaded it, short enough not to leak the blob for the session.
 */
export function openPdfBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
