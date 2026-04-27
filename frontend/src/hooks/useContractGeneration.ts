import { getStorage, ref, uploadBytes, deleteObject } from "firebase/storage";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { useAuth } from "./useAuth";
import type { ContractType } from "../lib/contractVariables";

export interface ContractMeta {
  type: ContractType;
  employmentRowId?: string;
  notes?: string;
}

/**
 * Generate a PDF Blob from filled HTML using html2pdf.js.
 * The library is loaded lazily so it doesn't affect initial bundle size.
 */
export async function generatePdf(filledHtml: string): Promise<Blob> {
  const html2pdf = (await import("html2pdf.js" as string)).default;

  // Wrap the HTML in a styled container for consistent A4 rendering
  const wrapper = document.createElement("div");
  wrapper.style.fontFamily = "Arial, sans-serif";
  wrapper.style.fontSize = "11pt";
  wrapper.style.lineHeight = "1.5";
  wrapper.style.color = "#000";
  wrapper.innerHTML = filledHtml;
  document.body.appendChild(wrapper);

  const opt = {
    margin: [15, 15, 15, 15] as [number, number, number, number], // mm
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
 * Fill {key} placeholders in a .docx template and return a filled .docx Blob.
 * The template bytes come from `GET /api/contractTemplates/:id/docx`.
 *
 * docxtemplater throws structured errors when placeholders are malformed
 * (e.g. when Word split the `{` and `}` across runs). We rewrap the message
 * to something useful for the UI.
 */
export function generateDocx(templateBytes: ArrayBuffer, vars: Record<string, string>): Blob {
  const zip = new PizZip(templateBytes);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => "",
  });
  try {
    doc.render(vars);
  } catch (err) {
    const e = err as { message?: string; properties?: { errors?: Array<{ properties?: { explanation?: string } }> } };
    const detail = e.properties?.errors?.[0]?.properties?.explanation;
    throw new Error(detail ? `Šablona obsahuje chybu: ${detail}` : (e.message ?? "Chyba při plnění šablony"));
  }
  const out = doc.getZip().generate({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  return out as Blob;
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

    // Upload PDF to Storage
    const contractId = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const storage = getStorage();
    const storagePath = `contracts/${employeeId}/${contractId}.pdf`;
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, blob, { contentType: "application/pdf" });

    // Create Firestore metadata record
    const token = await user.getIdToken();
    const body: Record<string, unknown> = {
      type: meta.type,
      status: "unsigned",
      unsignedStoragePath: storagePath,
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
      // Roll back Storage upload
      try {
        await deleteObject(storageRef);
      } catch {
        // ignore cleanup errors
      }
      throw new Error("Failed to create contract record");
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
