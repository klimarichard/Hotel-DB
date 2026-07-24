/**
 * Reading an image file into a base64 `data:` URI, downscaling it through a
 * canvas until it fits a character budget.
 *
 * WHY A CHARACTER BUDGET AND NOT A FILE SIZE. Every image this app stores ends
 * up inlined as base64 inside a single Firestore document, and Firestore caps a
 * document at 1 MiB. The thing that has to fit is therefore the length of the
 * encoded string, not the size of the file on disk — base64 inflates by ~4/3,
 * and several images plus the document's HTML share the same ceiling.
 *
 * WHY DATA URIs AT ALL, rather than Firebase Storage + a URL. The PDF renderer
 * (`functions/src/services/pdfRenderer.ts`) installs an SSRF guard that aborts
 * every request that is not a `data:` URI — the HTML it renders comes from
 * admin-editable templates, so the headless browser must not be able to fetch
 * internal services or the GCP metadata endpoint. A Storage URL would render as
 * a broken image in every PDF. Inlining is not a shortcut here; it is the only
 * option that does not require weakening that guard.
 *
 * This logic began life inside `FakturyPage.tsx` for invoice logos (five hotels
 * sharing one config document) and was lifted here when the "Obrázek" custom
 * variable needed the same thing. FakturyPage still carries its own near
 * identical copy; migrating it is a safe follow-up, deliberately not bundled
 * into this change so an invoice feature is not touched for tidiness alone.
 */

/** Raster formats we accept. SVG is excluded on purpose — see isImageDataUri. */
export const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** Read a File into a base64 data URI. */
export function readFileAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Soubor se nepodařilo přečíst."));
    reader.readAsDataURL(file);
  });
}

/** Re-encode a data URI through a canvas at `maxWidth`. Returns null on failure. */
export function downscaleDataUri(
  dataUri: string,
  maxWidth: number,
  mime: string,
  quality: number
): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / (img.naturalWidth || maxWidth));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round((img.naturalWidth || maxWidth) * scale));
      canvas.height = Math.max(1, Math.round((img.naturalHeight || maxWidth) * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      try {
        resolve(canvas.toDataURL(mime, quality));
      } catch {
        // Tainted canvas, or a mime the browser refuses to encode.
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUri;
  });
}

export type PrepareImageResult =
  | { ok: true; dataUri: string; shrunk: boolean }
  | { ok: false; message: string };

/**
 * Read an image file and, if it exceeds `maxChars`, downscale it progressively
 * until it fits. Refuses outright rather than truncating: a silently truncated
 * base64 string is a corrupt image that renders as a broken icon in a printed
 * document, which is worse than being told to pick a smaller file.
 *
 * The attempt ladder trades format before it trades size — a screenshot-style
 * PNG usually collapses far more by re-encoding to JPEG than by shrinking, and
 * dropping resolution first would throw away detail the format change could
 * have kept.
 */
export async function prepareImageDataUri(
  file: File,
  maxChars: number
): Promise<PrepareImageResult> {
  if (!IMAGE_MIME_TYPES.includes(file.type)) {
    return { ok: false, message: "Obrázek musí být ve formátu PNG, JPEG, WEBP nebo GIF." };
  }
  const original = await readFileAsDataUri(file);
  if (original.length <= maxChars) return { ok: true, dataUri: original, shrunk: false };

  const attempts: { width: number; mime: string; quality: number }[] = [
    { width: 900, mime: "image/jpeg", quality: 0.9 },
    { width: 700, mime: "image/jpeg", quality: 0.85 },
    { width: 500, mime: "image/jpeg", quality: 0.75 },
    { width: 360, mime: "image/jpeg", quality: 0.7 },
  ];
  for (const a of attempts) {
    const shrunk = await downscaleDataUri(original, a.width, a.mime, a.quality);
    if (shrunk && shrunk.length <= maxChars) return { ok: true, dataUri: shrunk, shrunk: true };
  }
  return {
    ok: false,
    message:
      "Obrázek je i po zmenšení příliš velký. Použijte prosím menší soubor – " +
      "ideálně JPEG o šířce do 900 bodů.",
  };
}

/** Rough kB of a base64 data URI, for a size readout in the editor. */
export function dataUriKb(dataUri: string): number {
  // base64 carries 3 bytes per 4 characters; the "data:...;base64," prefix is
  // noise at this scale, so the estimate is deliberately simple.
  return Math.round((dataUri.length * 3) / 4 / 1024);
}
