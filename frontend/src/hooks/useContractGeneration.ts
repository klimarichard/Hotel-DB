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
 * Generate a contract PDF Blob by sending the filled HTML to the
 * server-side Puppeteer renderer. Real headless Chromium drives the
 * rendering, so the PDF matches the editor preview exactly — same
 * font-metrics, same line-spacing, native list markers, etc. The
 * earlier client-side html2pdf.js path was abandoned because
 * html2canvas drifted from the browser's own rendering.
 */
export function useContractGeneration() {
  const { user } = useAuth();

  async function generatePdf(
    filledHtml: string,
    margins: PageMargins = DEFAULT_MARGINS
  ): Promise<Blob> {
    if (!user) throw new Error("Not authenticated");
    const token = await user.getIdToken();
    const resp = await fetch("/api/contracts/render-pdf", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ html: filledHtml, margins }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`PDF rendering failed${text ? `: ${text}` : ""}`);
    }
    return resp.blob();
  }

  /**
   * Upload a contract PDF to Firebase Storage and create the Firestore
   * record. Returns the contract ID.
   */
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

  return { generatePdf, uploadContract };
}
