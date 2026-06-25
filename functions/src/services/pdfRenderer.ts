import puppeteer, { Browser } from "puppeteer-core";
import chromium from "@sparticuz/chromium";

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

/** True when running under the Firebase Functions emulator. */
const IS_EMULATOR = !!process.env.FUNCTIONS_EMULATOR;

/**
 * Local Chrome the emulator drives. `puppeteer-core` ships no browser of
 * its own — that is the whole point: it keeps the deployed bundle small.
 * Local development therefore relies on a system Chrome install. Override
 * `LOCAL_CHROME_PATH` in `functions/.env` if Chrome lives elsewhere.
 */
const LOCAL_CHROME_PATH =
  process.env.LOCAL_CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

// PDF rendering needs no WebGL/graphics stack — skip unpacking those libs.
chromium.setGraphicsMode = false;

/**
 * Resolve launch options for the current environment and start Chromium.
 *
 * Deployed: the Chromium binary ships *inside* `node_modules` via
 * `@sparticuz/chromium`, and the GCF buildpack carries `node_modules` into
 * the runtime image — which is exactly why plain `puppeteer`'s
 * postinstall-downloaded browser failed ("Could not find Chrome").
 *
 * Emulator: drive a locally installed Chrome via `LOCAL_CHROME_PATH`.
 */
async function launchBrowser(): Promise<Browser> {
  if (IS_EMULATOR) {
    return puppeteer.launch({
      headless: true,
      executablePath: LOCAL_CHROME_PATH,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
  }
  return puppeteer.launch({
    headless: chromium.headless,
    executablePath: await chromium.executablePath(),
    args: chromium.args,
  });
}

/**
 * Lazy, module-level browser singleton — one Chromium per Cloud Function
 * instance, reused across requests so cold-start cost is paid only on
 * the first render. The promise is assigned synchronously so concurrent
 * callers share a single launch. If the browser dies (closed, crashed),
 * null out the promise so the next call relaunches.
 */
async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launchBrowser()
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
    // SSRF guard: the rendered HTML originates from admin-editable contract
    // templates, so block the headless browser from fetching ANY remote
    // resource. Only inline data: URIs (base64 images) and about:blank are
    // allowed; http/https/file requests are aborted, preventing reads of
    // internal services or the GCP metadata endpoint. Templates embed images as
    // base64, so legitimate rendering is unaffected.
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = request.url();
      if (url.startsWith("data:") || url === "about:blank") {
        request.continue();
      } else {
        request.abort();
      }
    });

    const fullHtml = `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <style>${RENDER_CSS}</style>
</head>
<body>${bodyHtml}</body>
</html>`;
    await page.setContent(fullHtml, { waitUntil: "networkidle0" });

    // Body text on page 1 starts after the logo image; on page 2+ it would
    // start at `margins.top` from the page edge — too high. Measure where
    // the first <img> ends in the rendered DOM and bump the default @page
    // top margin by that much so page 2+ start at the same y-offset as the
    // post-logo body text on page 1. `@page :first` reverts page 1 to the
    // template's original top margin so the logo still pins to where the
    // template author put it.
    const logoBottomPx = await page.evaluate(() => {
      const img = document.body.querySelector("img");
      return img ? img.getBoundingClientRect().bottom : 0;
    });
    const PX_TO_MM = 25.4 / 96;
    const logoMm = +(logoBottomPx * PX_TO_MM).toFixed(1);
    if (logoMm > 0) {
      await page.addStyleTag({
        content: `
          @page {
            margin: ${margins.top + logoMm}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm;
          }
          @page :first {
            margin-top: ${margins.top}mm;
          }
        `,
      });
    }

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
