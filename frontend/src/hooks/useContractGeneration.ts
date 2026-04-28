import { getStorage, ref, deleteObject } from "firebase/storage";
import { useAuth } from "./useAuth";
import type { ContractType } from "../lib/contractVariables";

/** Convert a Blob to a base64 string (no data: prefix) for JSON transport. */
async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

export interface ContractMeta {
  type: ContractType;
  employmentRowId?: string;
  notes?: string;
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

  // Wrap the HTML in a styled container for consistent A4 rendering
  const wrapper = document.createElement("div");
  wrapper.style.fontFamily = "Arial, sans-serif";
  wrapper.style.fontSize = "11pt";
  wrapper.style.lineHeight = "1.5";
  wrapper.style.color = "#000";
  // Inject table border rules: tables with data-borderless="true" render
  // without any visible border in the PDF; default tables get 1px solid.
  // (The editor's CSS module is scoped to .a4Page and not present on this
  // detached wrapper, so we inline the rules here.)
  const styleTag = document.createElement("style");
  styleTag.textContent = `
    table { border-collapse: collapse; margin: 0.5cm 0; }
    table td, table th {
      border: 1px solid #000;
      padding: 4px 8px;
      vertical-align: top;
    }
    table.hpm-borderless td, table.hpm-borderless th { border: none; }
    table th { font-weight: 600; }
    li::marker { font-size: inherit; font-family: inherit; }
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

  /** Delete the unsigned PDF from Storage (backend record deletion is separate) */
  async function deleteStorageFile(storagePath: string): Promise<void> {
    const storage = getStorage();
    const storageRef = ref(storage, storagePath);
    await deleteObject(storageRef);
  }

  return { uploadContract, deleteStorageFile };
}
