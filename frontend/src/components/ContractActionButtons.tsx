import { useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import ConfirmModal from "./ConfirmModal";
import { ContractType } from "@/lib/contractVariables";
import { blobToBase64 } from "@/lib/blobToBase64";
import type { ContractRecord } from "@/lib/employmentSessions";
import styles from "./ContractActionButtons.module.css";

// Key-sorted JSON so a row snapshot stored in Firestore (which may return keys
// in a different order) compares equal to a freshly-built one when unchanged.
function stableStringify(o: unknown): string {
  if (o === null || typeof o !== "object") return JSON.stringify(o ?? null);
  const obj = o as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) sorted[k] = obj[k];
  return JSON.stringify(sorted);
}

// Pull the filename out of a Content-Disposition header, preferring the UTF-8
// (filename*=) form so diacritics survive; fall back to the plain filename= or
// a supplied default.
function filenameFromDisposition(cd: string | null, fallback: string): string {
  if (!cd) return fallback;
  const star = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) { try { return decodeURIComponent(star[1]); } catch { /* malformed */ } }
  const plain = cd.match(/filename="([^"]+)"/i);
  return plain ? plain[1] : fallback;
}

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
  onGenerate,
  onChanged,
}: Props) {
  const { user, can } = useAuth();
  // Each contract action is gated by its own permission so custom user types can
  // be granted granular access. Built-in admin/director hold all of these →
  // unchanged. (Regenerate deletes the stale PDF then reopens the generator, but
  // contracts.generate is the show-gate per the matrix.)
  const canViewContracts = can("contracts.view");
  const canGenerate = can("contracts.generate");
  const canSign = can("contracts.sign");
  const canDeleteContract = can("contracts.delete");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [busy, setBusy] = useState<null | "uploading" | "deleting" | "downloading">(null);
  const [error, setError] = useState<string | null>(null);

  async function handlePreview(kind: "unsigned" | "signed") {
    if (!user || !contract) return;
    const token = await user.getIdToken();
    // Backend sends Content-Disposition: inline — open the blob in a new tab to
    // preview. (A blob URL can't carry a filename, so the tab title is generic;
    // use "Stáhnout" for a correctly-named download.)
    const resp = await fetch(
      `/api/employees/${employeeId}/contracts/${contract.id}/download?kind=${kind}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!resp.ok) {
      setError("Nepodařilo se otevřít PDF.");
      return;
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  // Download with the correct convention filename. The backend already puts it
  // in Content-Disposition; read it back and name the saved file accordingly
  // (a blob preview can't, so this is the path that yields the right name).
  async function handleDownload(kind: "unsigned" | "signed") {
    if (!user || !contract) return;
    setBusy("downloading");
    setError(null);
    try {
      const token = await user.getIdToken();
      const resp = await fetch(
        `/api/employees/${employeeId}/contracts/${contract.id}/download?kind=${kind}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!resp.ok) {
        setError("Nepodařilo se stáhnout PDF.");
        return;
      }
      const filename = filenameFromDisposition(
        resp.headers.get("Content-Disposition"),
        `${defaultDisplayName || "smlouva"}.pdf`
      );
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5_000);
    } finally {
      setBusy(null);
    }
  }

  // Discard a stale (row-changed) generated contract and reopen the generator.
  async function handleRegenerate() {
    if (!user || !contract) return;
    setBusy("deleting");
    setError(null);
    try {
      const token = await user.getIdToken();
      const resp = await fetch(`/api/employees/${employeeId}/contracts/${contract.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        setError("Nepodařilo se zahodit neaktuální smlouvu.");
        return;
      }
      onChanged();
      onGenerate?.();
    } finally {
      setBusy(null);
    }
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
  const previewKind: "signed" | "unsigned" | null = hasSigned
    ? "signed"
    : hasUnsigned
      ? "unsigned"
      : null;
  const previewLabel = hasSigned
    ? "Zobrazit podepsanou"
    : hasUnsigned
      ? "Zobrazit"
      : null;

  // A generated (unsigned) contract goes stale once the employment row it was
  // generated from changes: the stored snapshot no longer matches the current
  // row. Signed (user-uploaded) contracts are never auto-invalidated. Only
  // editors get the regenerate path; read-only roles still see the preview.
  const storedSnap = contract?.rowSnapshot;
  const isStale =
    canGenerate &&
    !!onGenerate &&
    !!rowSnapshot &&
    !!storedSnap &&
    hasUnsigned &&
    !hasSigned &&
    stableStringify(storedSnap) !== stableStringify(rowSnapshot);

  return (
    <div className={styles.actions}>
      {isStale ? (
        <button
          type="button"
          className={styles.generateBtn}
          onClick={handleRegenerate}
          disabled={busy !== null}
          title="Parametry řádku se změnily — vygenerovaná smlouva je neaktuální"
        >
          {busy === "deleting" ? "Zahazuji…" : "Znovu generovat smlouvu"}
        </button>
      ) : (
        canViewContracts && previewKind && previewLabel && (
          <>
            <button
              type="button"
              className={styles.downloadBtn}
              onClick={() => handlePreview(previewKind)}
              disabled={busy !== null}
            >
              {previewLabel}
            </button>
            <button
              type="button"
              className={styles.downloadBtn}
              onClick={() => handleDownload(previewKind)}
              disabled={busy !== null}
              title="Stáhnout PDF se správným názvem podle konvence"
            >
              {busy === "downloading" ? "Stahuji…" : "Stáhnout"}
            </button>
          </>
        )
      )}

      {canGenerate && onGenerate && !hasUnsigned && !hasSigned && !isStale && (
        <button
          type="button"
          className={styles.generateBtn}
          onClick={onGenerate}
          disabled={busy !== null}
        >
          Generovat smlouvu
        </button>
      )}

      {canSign && !hasSigned && (
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

      {contract && canDeleteContract && (
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
