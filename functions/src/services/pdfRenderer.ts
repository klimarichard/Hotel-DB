import puppeteer, { Browser } from "puppeteer";

export interface RenderMargins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const DEFAULT_MARGINS: RenderMargins = { top: 15, bottom: 15, left: 15, right: 15 };

/**
 * CSS rules applied to the rendered document. **Must stay in lockstep
 * with the editor's `.editorContent` rules in
 * `frontend/src/pages/ContractTemplatesPage.module.css`** so what the
 * user sees in the editor preview matches the generated PDF
 * byte-for-byte. With real Chromium doing the rendering, native list
 * markers, font-metrics, and line-spacing all match the browser
 * preview — no marker emulation needed.
 */
const RENDER_CSS = `
  body {
    font-family: Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.6;
    color: #000;
    margin: 0;
    padding: 0;
  }
  p { margin: 0 0 0.5em; }
  img { max-width: 100%; height: auto; display: block; }
  ul, ol { padding-left: 1.5em; margin-bottom: 0.5em; }
  ul { list-style-type: "– "; }
  ul ul { list-style-type: circle; }
  li { line-height: 1.3; }
  li > p { margin: 0; }
  table {
    border-collapse: collapse;
    margin: 0.5cm 0;
    table-layout: fixed;
    width: 100%;
  }
  table td, table th {
    border: 1px solid #000;
    padding: 4px 8px;
    vertical-align: top;
    min-width: 40px;
  }
  table.hpm-borderless td, table.hpm-borderless th { border: none; }
  table th { font-weight: 600; }
  li::marker { font-size: inherit; }
  /*
   * Page-break node ↧ — strip every visual the editor may have baked
   * into the saved HTML (older templates carried inline border-top +
   * margin). We only want the page-break-before behaviour in the PDF,
   * not the dashed divider or the 1 cm gap.
   */
  [data-page-break] {
    border: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    height: 0 !important;
  }
`;

let browserPromise: Promise<Browser> | null = null;

/**
 * Lazy, module-level browser singleton — one Chromium per Cloud Function
 * instance, reused across requests so cold-start cost is paid only on
 * the first render. If the browser dies (closed, crashed), null out the
 * promise so the next call relaunches.
 */
async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer
      .launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
      })
      .then((b) => {
        b.on("disconnected", () => {
          browserPromise = null;
        });
        return b;
      })
      .catch((e) => {
        browserPromise = null;
        throw e;
      });
  }
  return browserPromise;
}

export async function renderPdf(
  bodyHtml: string,
  margins: RenderMargins = DEFAULT_MARGINS
): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    const fullHtml = `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <style>${RENDER_CSS}</style>
</head>
<body>${bodyHtml}</body>
</html>`;
    await page.setContent(fullHtml, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: `${margins.top}mm`,
        bottom: `${margins.bottom}mm`,
        left: `${margins.left}mm`,
        right: `${margins.right}mm`,
      },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => undefined);
  }
}
