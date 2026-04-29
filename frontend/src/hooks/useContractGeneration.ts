import { useAuth } from "./useAuth";
import { blobToBase64 } from "../lib/blobToBase64";
import type { ContractType } from "../lib/contractVariables";

export interface ContractMeta {
  type: ContractType;
  employmentRowId?: string;
  notes?: string;
  rowSnapshot?: Record<string, unknown>;
}

export interface PageMargins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export const DEFAULT_MARGINS: PageMargins = { top: 15, bottom: 15, left: 15, right: 15 };

/**
 * Generate a PDF Blob from filled HTML using html2pdf.js.
 * The library is loaded lazily so it doesn't affect initial bundle size.
 * html2pdf's margin order is [top, left, bottom, right].
 */
export async function generatePdf(
  filledHtml: string,
  margins: PageMargins = DEFAULT_MARGINS
): Promise<Blob> {
  const html2pdf = (await import("html2pdf.js" as string)).default;

  // Wrap the HTML in a styled container for consistent A4 rendering.
  // Line-height matches the editor's `.editorContent` (1.6).
  const wrapper = document.createElement("div");
  wrapper.style.fontFamily = "Arial, sans-serif";
  wrapper.style.fontSize = "11pt";
  wrapper.style.lineHeight = "1.6";
  wrapper.style.color = "#000";
  // The editor's CSS module is scoped to `.a4Page` / `.editorContent`
  // and not present on this detached wrapper, so we mirror the rules
  // here. **MUST stay in lockstep with `ContractTemplatesPage.module.css`**
  // — anything that affects layout, spacing, or marker rendering in the
  // editor preview must be replicated below or the PDF will diverge.
  // The list rules in particular use the same ::before counter scheme
  // the editor uses, so editor preview and PDF render identically
  // (html2canvas can't reliably render native ::marker, but it handles
  // ::before content with counters correctly).
  const styleTag = document.createElement("style");
  styleTag.textContent = `
    p { margin: 0 0 0.5em; }
    img { max-width: 100%; height: auto; display: block; }
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

    ul, ol { list-style: none; padding-left: 1.5em; margin: 0 0 0.5em; }
    ol { counter-reset: ol-counter; }
    ol > li { counter-increment: ol-counter; position: relative; }
    ol > li::before {
      content: counter(ol-counter) ".";
      position: absolute;
      right: calc(100% + 0.4em);
      top: 0;
      white-space: nowrap;
    }
    ul > li { position: relative; }
    ul > li::before {
      content: "\\2022";
      position: absolute;
      right: calc(100% + 0.4em);
      top: 0;
    }
    li > p:last-child { margin-bottom: 0; }
  `;
  wrapper.appendChild(styleTag);
  const contentDiv = document.createElement("div");
  contentDiv.innerHTML = filledHtml;
  wrapper.appendChild(contentDiv);
  document.body.appendChild(wrapper);

  const opt = {
    margin: [margins.top, margins.left, margins.bottom, margins.right] as [number, number, number, number],
    filename: "smlouva.pdf",
    image: { type: "jpeg", quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
  };

  try {
    const blob: Blob = await html2pdf().set(opt).from(wrapper).outputPdf("blob");
    return blob;
  } finally {
    document.body.removeChild(wrapper);
  }
}

/**
 * Upload a contract PDF to Firebase Storage and create the Firestore record.
 * Returns the contract ID.
 */
export function useContractGeneration() {
  const { user } = useAuth();

  async function uploadContract(
    employeeId: string,
    blob: Blob,
    meta: ContractMeta
  ): Promise<string> {
    if (!user) throw new Error("Not authenticated");

    // storage.rules deny all direct client access. Upload the PDF
    // through the Cloud Function endpoint, which uses the Admin SDK
    // to write to Storage and create the Firestore record atomically.
    const token = await user.getIdToken();
    const pdfBase64 = await blobToBase64(blob);

    const body: Record<string, unknown> = {
      type: meta.type,
      pdfBase64,
    };
    if (meta.employmentRowId) body.employmentRowId = meta.employmentRowId;
    if (meta.notes) body.notes = meta.notes;
    if (meta.rowSnapshot) body.rowSnapshot = meta.rowSnapshot;

    const resp = await fetch(`/api/employees/${employeeId}/contracts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Failed to create contract record${text ? `: ${text}` : ""}`);
    }

    const { id } = await resp.json();
    return id;
  }

  return { uploadContract };
}
