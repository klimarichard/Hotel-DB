import { useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import ConfirmModal from "./ConfirmModal";
import { ContractType } from "@/lib/contractVariables";
import { blobToBase64 } from "@/lib/blobToBase64";
import type { ContractRecord } from "@/lib/employmentSessions";
import styles from "./ContractActionButtons.module.css";

interface Props {
  /** The existing contract record for this slot, or null when nothing has been generated yet. */
  contract: ContractRecord | null;
  /** Template id used to materialise a record when the user clicks "Nahrát podepsanou" before generating. */
  defaultType: ContractType;
  /** Owning employment row id (omit for ad-hoc / standalone contracts). */
  employmentRowId?: string;
  /** Snapshot to persist on the new record so the "row changed → regenerate" detector still works downstream. */
  rowSnapshot?: Record<string, unknown>;
  /** Filename shown in the Content-Disposition header on download. */
  defaultDisplayName: string;
  employeeId: string;
  canEdit: boolean;
  /** Open the generation modal. Required when `contract` is null and the row supports generation. */
  onGenerate?: () => void;
  /** Called after any mutation (delete, upload, create-and-upload) so the parent can refetch. */
  onChanged: () => void;
}

export default function ContractActionButtons({
  contract,
  defaultType,
  employmentRowId,
  rowSnapshot,
  defaultDisplayName,
  employeeId,
  canEdit,
  onGenerate,
  onChanged,
}: Props) {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [busy, setBusy] = useState<null | "uploading" | "deleting">(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload(kind: "unsigned" | "signed") {
    if (!user || !contract) return;
    const token = await user.getIdToken();
    const resp = await fetch(
      `/api/employees/${employeeId}/contracts/${contract.id}/download?kind=${kind}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!resp.ok) {
      setError("Nepodařilo se stáhnout PDF.");
      return;
    }
    const cd = resp.headers.get("Content-Disposition") ?? "";
    let filename = `${defaultDisplayName}.pdf`;
    const utf8 = cd.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
    if (utf8) {
      try { filename = decodeURIComponent(utf8[1]); } catch { /* fall through */ }
    }
    if (!utf8) {
      const ascii = cd.match(/filename\s*=\s*"?([^";]+)"?/i);
      if (ascii) filename = ascii[1];
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function ensureContractId(): Promise<string | null> {
    if (contract) return contract.id;
    if (!user) return null;
    const token = await user.getIdToken();
    const body: Record<string, unknown> = {
      type: defaultType,
      status: "unsigned",
      displayName: defaultDisplayName,
    };
    if (employmentRowId) body.employmentRowId = employmentRowId;
    if (rowSnapshot) body.rowSnapshot = rowSnapshot;
    const resp = await fetch(`/api/employees/${employeeId}/contracts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      setError("Nepodařilo se vytvořit záznam smlouvy.");
      return null;
    }
    const json = (await resp.json()) as { id: string };
    return json.id;
  }

  async function handleUploadSigned(file: File) {
    if (!user) return;
    setBusy("uploading");
    setError(null);
    try {
      const contractId = await ensureContractId();
      if (!contractId) return;
      const pdfBase64 = await blobToBase64(file);
      const token = await user.getIdToken();
      const resp = await fetch(
        `/api/employees/${employeeId}/contracts/${contractId}/signed-pdf`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ pdfBase64 }),
        }
      );
      if (!resp.ok) {
        setError("Nepodařilo se nahrát podepsanou smlouvu.");
        return;
      }
      onChanged();
    } finally {
      setBusy(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function confirmDelete() {
    if (!user || !contract) { setDeleteConfirm(false); return; }
    setBusy("deleting");
    setError(null);
    try {
      const token = await user.getIdToken();
      const resp = await fetch(`/api/employees/${employeeId}/contracts/${contract.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        setError("Nepodařilo se smazat smlouvu.");
        return;
      }
      onChanged();
    } finally {
      setBusy(null);
      setDeleteConfirm(false);
    }
  }

  const hasSigned = !!contract?.signedStoragePath;
  const hasUnsigned = !!contract?.unsignedStoragePath;
  const downloadKind: "signed" | "unsigned" | null = hasSigned
    ? "signed"
    : hasUnsigned
      ? "unsigned"
      : null;
  const downloadLabel = hasSigned
    ? "Stáhnout podepsanou"
    : hasUnsigned
      ? "Stáhnout"
      : null;

  return (
    <div className={styles.actions}>
      {downloadKind && downloadLabel && (
        <button
          type="button"
          className={styles.downloadBtn}
          onClick={() => handleDownload(downloadKind)}
          disabled={busy !== null}
        >
          {downloadLabel}
        </button>
      )}

      {!contract && canEdit && onGenerate && (
        <button
          type="button"
          className={styles.generateBtn}
          onClick={onGenerate}
          disabled={busy !== null}
        >
          Generovat smlouvu
        </button>
      )}

      {canEdit && (
        <label className={styles.uploadBtn}>
          {busy === "uploading" ? "Nahrávám…" : "Nahrát podepsanou smlouvu"}
          <input
            type="file"
            accept="application/pdf"
            style={{ display: "none" }}
            ref={fileInputRef}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUploadSigned(f);
            }}
            disabled={busy !== null}
          />
        </label>
      )}

      {contract && canEdit && (
        <button
          type="button"
          className={styles.deleteBtn}
          onClick={() => setDeleteConfirm(true)}
          disabled={busy !== null}
        >
          Smazat smlouvu
        </button>
      )}

      {error && <span className={styles.error}>{error}</span>}

      {deleteConfirm && (
        <ConfirmModal
          title="Smazat smlouvu"
          message="Smlouva bude trvale smazána včetně případné podepsané kopie."
          confirmLabel="Smazat"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setDeleteConfirm(false)}
        />
      )}
    </div>
  );
}
