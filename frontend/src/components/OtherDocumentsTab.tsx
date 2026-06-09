import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { blobToBase64 } from "@/lib/blobToBase64";
import { formatTimestampCZ } from "@/lib/dateFormat";
import Button from "./Button";
import IconButton from "./IconButton";
import ConfirmModal from "./ConfirmModal";
import styles from "./OtherDocumentsTab.module.css";

// Pull the filename out of a Content-Disposition header, preferring the UTF-8
// (filename*=) form so diacritics survive; fall back to the plain filename= or
// a supplied default. (Copied from ContractActionButtons.)
function filenameFromDisposition(cd: string | null, fallback: string): string {
  if (!cd) return fallback;
  const star = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) { try { return decodeURIComponent(star[1]); } catch { /* malformed */ } }
  const plain = cd.match(/filename="([^"]+)"/i);
  return plain ? plain[1] : fallback;
}

interface OtherDocument {
  id: string;
  name: string;
  uploadedAt: { seconds?: number; _seconds?: number } | null;
  uploadedBy?: string;
}

interface Props {
  employeeId: string;
}

const MAX_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB

export default function OtherDocumentsTab({ employeeId }: Props) {
  const { user, can } = useAuth();
  // Each action gated by its own permission so custom user types can be granted
  // granular access. Built-in admin/director hold all of these → unchanged.
  const canView = can("documents.view");
  const canUpload = can("documents.upload");
  const canDelete = can("documents.delete");
  const [docs, setDocs] = useState<OtherDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<OtherDocument | null>(null);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.get<OtherDocument[]>(
        `/employees/${employeeId}/other-documents`
      );
      setDocs(list);
    } catch {
      setError("Nepodařilo se načíst dokumenty.");
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  async function handlePreview(doc: OtherDocument) {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const resp = await fetch(
        `/api/employees/${employeeId}/other-documents/${doc.id}/download`,
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
    } catch {
      setError("Nepodařilo se otevřít PDF.");
    }
  }

  async function handleDownload(doc: OtherDocument) {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const resp = await fetch(
        `/api/employees/${employeeId}/other-documents/${doc.id}/download`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!resp.ok) {
        setError("Nepodařilo se stáhnout PDF.");
        return;
      }
      const filename = filenameFromDisposition(
        resp.headers.get("Content-Disposition"),
        `${doc.name || "dokument"}.pdf`
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
    } catch {
      setError("Nepodařilo se stáhnout PDF.");
    }
  }

  async function confirmDelete() {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    try {
      await api.delete(`/employees/${employeeId}/other-documents/${target.id}`);
      await fetchDocs();
    } catch {
      setError("Nepodařilo se smazat dokument.");
    }
  }

  function openUpload() {
    setUploadName("");
    setUploadFile(null);
    setUploadOpen(true);
  }

  function closeUpload() {
    if (uploading) return;
    setUploadOpen(false);
    setUploadName("");
    setUploadFile(null);
  }

  async function submitUpload() {
    const name = uploadName.trim();
    if (!name || !uploadFile) return;
    if (uploadFile.size > MAX_SIZE_BYTES) {
      setError("Soubor je příliš velký. Maximální velikost je 15 MB.");
      return;
    }
    setUploading(true);
    try {
      const pdfBase64 = await blobToBase64(uploadFile);
      await api.post<{ id: string }>(
        `/employees/${employeeId}/other-documents`,
        { name, pdfBase64 }
      );
      setUploadOpen(false);
      setUploadName("");
      setUploadFile(null);
      await fetchDocs();
    } catch {
      setError("Nepodařilo se nahrát dokument.");
    } finally {
      setUploading(false);
    }
  }

  const canSubmit = uploadName.trim().length > 0 && uploadFile !== null && !uploading;

  return (
    <div className={styles.wrap}>
      {canUpload && (
        <div className={styles.toolbar}>
          <Button data-tour="emp-doc-upload" variant="primary" size="sm" onClick={openUpload}>
            Nahrát dokument
          </Button>
        </div>
      )}

      <div className={styles.card}>
        {loading ? (
          <div className={styles.empty}>Načítám…</div>
        ) : docs.length === 0 ? (
          <div className={styles.empty}>Žádné další dokumenty.</div>
        ) : (
          docs.map((doc) => (
            <div key={doc.id} className={styles.row}>
              <div className={styles.meta}>
                <span className={styles.name}>{doc.name}</span>
                <span className={styles.date}>{formatTimestampCZ(doc.uploadedAt)}</span>
              </div>
              <div className={styles.actions}>
                {canView && (
                  <>
                    <Button data-tour="emp-doc-view" variant="secondary" size="sm" onClick={() => handlePreview(doc)}>
                      Zobrazit
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => handleDownload(doc)}>
                      Stáhnout
                    </Button>
                  </>
                )}
                {canDelete && (
                  <Button data-tour="emp-doc-delete" variant="danger" size="sm" onClick={() => setDeleteTarget(doc)}>
                    Smazat
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {uploadOpen && (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Nahrát dokument</h2>
              <IconButton aria-label="Zavřít" onClick={closeUpload} disabled={uploading}>✕</IconButton>
            </div>
            <div className={styles.modalBody}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Název dokumentu</span>
                <input
                  type="text"
                  className={styles.input}
                  value={uploadName}
                  onChange={(e) => setUploadName(e.target.value)}
                  disabled={uploading}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Soubor (PDF)</span>
                <input
                  type="file"
                  accept="application/pdf"
                  className={styles.fileInput}
                  onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                  disabled={uploading}
                />
              </label>
            </div>
            <div className={styles.modalFooter}>
              <Button variant="secondary" onClick={closeUpload} disabled={uploading}>
                Zrušit
              </Button>
              <Button variant="primary" onClick={submitUpload} disabled={!canSubmit}>
                {uploading ? "Nahrávám…" : "Nahrát"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <ConfirmModal
          title="Smazat dokument"
          message={`Dokument „${deleteTarget.name}“ bude trvale smazán. Tuto akci nelze vrátit zpět.`}
          confirmLabel="Smazat"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {error && (
        <ConfirmModal
          title="Chyba"
          message={error}
          confirmLabel="OK"
          showCancel={false}
          onConfirm={() => setError(null)}
          onCancel={() => setError(null)}
        />
      )}
    </div>
  );
}
