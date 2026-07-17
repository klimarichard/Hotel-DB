import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/hooks/useAuth";
import ConfirmModal from "./ConfirmModal";
import Button from "./Button";
import IconButton from "./IconButton";
import { ContractType } from "@/lib/contractVariables";
import { pagesAccusative } from "@/lib/czechPlural";
import {
  bytesToBase64,
  compressScannedPdf,
  getPageCount,
  splitPdf,
} from "@/lib/pdfCompress";
import type { ContractRecord } from "@/lib/employmentSessions";
import modalStyles from "./ConfirmModal.module.css";
import styles from "./ContractActionButtons.module.css";

/**
 * Raw-bytes ceiling for an upload. The JSON body cap on the backend is 10 MB
 * (express.json in functions/src/index.ts) and base64 inflates by ~4/3, so
 * anything above ~7.5 MB raw dies inside the body parser and surfaces as an
 * opaque failure. Refuse it here with an explanation instead. Compression runs
 * first, so this only trips on genuinely huge originals that would not shrink.
 */
const MAX_UPLOAD_BYTES = 7 * 1024 * 1024;

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "Smlouva = strana 1." for a single page, "Smlouva = strany 2 až 3." for a range. */
function pageRangeCz(label: string, from: number, to: number): string {
  return from === to
    ? `${label} = strana ${from}.`
    : `${label} = strany ${from} až ${to}.`;
}

// The split dialog reuses ConfirmModal's chrome but needs its own form fields;
// these match the inline field styling used by the other prompts on the
// employee detail page.
const fieldLabelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.8125rem",
  fontWeight: 500,
  color: "var(--color-text-secondary)",
  marginBottom: "4px",
};

const fieldInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: "0.875rem",
  border: "1px solid var(--color-border)",
  borderRadius: "6px",
  background: "var(--color-surface)",
  color: "var(--color-text)",
};

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
  // The "Smlouva + prohlášení" mode files the trailing pages into the employee's
  // Další dokumenty, so it needs the upload permission on top of contracts.sign.
  const canUploadDocuments = can("documents.upload");
  // A Prohlášení poplatníka is an onboarding artefact of an employment contract;
  // ad-hoc / standalone documents never carry one, so the split mode – and the
  // menu offering it – exist only in the employment-history context. Derived from
  // employmentRowId rather than taking a prop, so the two call sites cannot
  // contradict it.
  const canSplitUpload = canUploadDocuments && !!employmentRowId;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [busy, setBusy] = useState<
    null | "preparing" | "uploading" | "deleting" | "downloading"
  >(null);
  const [error, setError] = useState<string | null>(null);

  // Signed-upload mode picker. "contract" uploads the file as-is; "split" cuts
  // the scan into the contract + the Prohlášení poplatníka.
  //
  // The menu is PORTALLED to <body> and positioned fixed, rather than absolutely
  // inside this component. The employment-history session card sets
  // `overflow: hidden` (it clips its children to its rounded corners), so an
  // absolutely-positioned menu was cut off whenever the card was shorter than the
  // menu - i.e. exactly on the one- and two-row sessions. Escaping to <body> makes
  // the menu immune to ANY ancestor's overflow / transform / stacking context,
  // instead of trading a dropdown bug for a border-radius bug.
  const [signMenuOpen, setSignMenuOpen] = useState(false);
  const [signMenuPos, setSignMenuPos] = useState<{ top: number; right: number } | null>(null);
  const signBtnRef = useRef<HTMLButtonElement | null>(null);
  const signMenuRef = useRef<HTMLDivElement | null>(null);
  const uploadModeRef = useRef<"contract" | "split">("contract");

  /** Anchor the fixed menu under the button, right-aligned with it. */
  function openSignMenu() {
    const r = signBtnRef.current?.getBoundingClientRect();
    if (!r) return;
    setSignMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    setSignMenuOpen(true);
  }

  // Split dialog, opened once the picked file has been read and (if it is a
  // scan) shrunk. We keep the PROCESSED bytes so the split and the upload both
  // operate on the same, already-compressed document.
  const [splitPrompt, setSplitPrompt] = useState<{
    bytes: Uint8Array;
    pageCount: number;
    originalSize: number;
    finalSize: number;
    compressed: boolean;
  } | null>(null);
  const [splitAfterPage, setSplitAfterPage] = useState(1);
  const [declarationName, setDeclarationName] = useState("");

  useEffect(() => {
    if (!signMenuOpen) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      // The menu is portalled, so it is NOT inside the button's wrapper – both
      // have to be checked or clicking a menu item would close the menu first.
      if (signMenuRef.current?.contains(t) || signBtnRef.current?.contains(t)) return;
      setSignMenuOpen(false);
    }
    // A fixed-position menu doesn't travel with the page, so it would detach from
    // its button on scroll. Close instead of trying to keep it glued.
    const close = () => setSignMenuOpen(false);
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("scroll", close, true); // capture: catches scrolling containers too
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [signMenuOpen]);

  async function handlePreview(kind: "unsigned" | "signed") {
    if (!user || !contract) return;
    const token = await user.getIdToken();
    // Backend sends Content-Disposition: inline – open the blob in a new tab to
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

  /** Whole file → the contract record, unchanged behaviour (now shrunk first). */
  async function handleUploadSigned(file: File) {
    if (!user) return;
    setBusy("preparing");
    setError(null);
    try {
      const { bytes, finalSize } = await compressScannedPdf(file);
      if (finalSize > MAX_UPLOAD_BYTES) {
        setError(
          `Soubor je i po zmenšení příliš velký (${formatMb(finalSize)}, max ${formatMb(MAX_UPLOAD_BYTES)}). Naskenujte jej prosím v nižší kvalitě.`
        );
        return;
      }
      setBusy("uploading");
      const contractId = await ensureContractId();
      if (!contractId) return;
      const token = await user.getIdToken();
      const resp = await fetch(
        `/api/employees/${employeeId}/contracts/${contractId}/signed-pdf`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ pdfBase64: bytesToBase64(bytes) }),
        }
      );
      if (!resp.ok) {
        setError("Nepodařilo se nahrát podepsanou smlouvu.");
        return;
      }
      onChanged();
    } catch {
      setError("Nepodařilo se zpracovat PDF.");
    } finally {
      setBusy(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  /**
   * "Smlouva + prohlášení": read + shrink the scan, then ask where to cut it.
   * We do NOT assume the contract is exactly one page — a 2-page contract in a
   * 4-page scan is common, and silently filing page 2 under the Prohlášení
   * would be a quiet, hard-to-notice mistake.
   */
  async function handlePickSplitFile(file: File) {
    setBusy("preparing");
    setError(null);
    try {
      const result = await compressScannedPdf(file);
      const pageCount = await getPageCount(result.bytes);
      if (pageCount < 2) {
        setError(
          "PDF má jen jednu stranu, není co rozdělit. Použijte volbu „Smlouva“."
        );
        return;
      }
      setSplitAfterPage(1);
      setDeclarationName(`Prohlášení poplatníka ${new Date().getFullYear()}`);
      setSplitPrompt({
        bytes: result.bytes,
        pageCount,
        originalSize: result.originalSize,
        finalSize: result.finalSize,
        compressed: result.compressed,
      });
    } catch {
      setError("Nepodařilo se načíst PDF.");
    } finally {
      setBusy(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  /** Cut the prepared scan and file both halves in one request. */
  async function confirmSplitUpload() {
    if (!user || !splitPrompt) return;
    setBusy("uploading");
    setError(null);
    try {
      const { first, second } = await splitPdf(splitPrompt.bytes, splitAfterPage);
      if (first.byteLength > MAX_UPLOAD_BYTES || second.byteLength > MAX_UPLOAD_BYTES) {
        setError(
          `Soubor je i po zmenšení příliš velký (max ${formatMb(MAX_UPLOAD_BYTES)}). Naskenujte jej prosím v nižší kvalitě.`
        );
        return;
      }
      const contractId = await ensureContractId();
      if (!contractId) return;
      const token = await user.getIdToken();
      const resp = await fetch(
        `/api/employees/${employeeId}/contracts/${contractId}/signed-pdf-with-declaration`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            contractPdfBase64: bytesToBase64(first),
            declarationPdfBase64: bytesToBase64(second),
            declarationName: declarationName.trim(),
          }),
        }
      );
      if (!resp.ok) {
        setError("Nepodařilo se nahrát podepsanou smlouvu s prohlášením.");
        return;
      }
      setSplitPrompt(null);
      onChanged();
    } catch {
      setError("Nepodařilo se rozdělit PDF.");
    } finally {
      setBusy(null);
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
          title="Parametry řádku se změnily – vygenerovaná smlouva je neaktuální"
        >
          {busy === "deleting" ? "Zahazuji…" : "Znovu generovat smlouvu"}
        </button>
      ) : (
        canViewContracts && previewKind && previewLabel && (
          <>
            <button
              data-tour="emp-contract-view"
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
          data-tour="emp-contract-generate"
          type="button"
          className={styles.generateBtn}
          onClick={onGenerate}
          disabled={busy !== null}
        >
          Generovat smlouvu
        </button>
      )}

      {canSign && !hasSigned && (
        <div className={styles.signWrap}>
          <button
            data-tour="emp-contract-sign"
            type="button"
            ref={signBtnRef}
            className={styles.uploadBtn}
            disabled={busy !== null}
            onClick={() => {
              // With no Prohlášení to file – no documents.upload permission, or
              // not an employment row – skip the menu and keep the one-click flow.
              if (!canSplitUpload) {
                uploadModeRef.current = "contract";
                fileInputRef.current?.click();
                return;
              }
              if (signMenuOpen) setSignMenuOpen(false);
              else openSignMenu();
            }}
          >
            {busy === "preparing"
              ? "Zpracovávám…"
              : busy === "uploading"
                ? "Nahrávám…"
                : employmentRowId
                  ? `Nahrát podepsanou smlouvu${canSplitUpload ? " ▾" : ""}`
                  : "Nahrát podepsaný dokument"}
          </button>
          {signMenuOpen && signMenuPos &&
            createPortal(
              <div
                ref={signMenuRef}
                className={styles.signMenu}
                style={{ top: signMenuPos.top, right: signMenuPos.right }}
              >
                <button
                  type="button"
                  className={styles.signMenuItem}
                  onClick={() => {
                    uploadModeRef.current = "contract";
                    setSignMenuOpen(false);
                    fileInputRef.current?.click();
                  }}
                >
                  Smlouva
                </button>
                <button
                  type="button"
                  className={styles.signMenuItem}
                  onClick={() => {
                    uploadModeRef.current = "split";
                    setSignMenuOpen(false);
                    fileInputRef.current?.click();
                  }}
                >
                  Smlouva + prohlášení
                </button>
              </div>,
              document.body
            )}
          <input
            type="file"
            accept="application/pdf"
            style={{ display: "none" }}
            ref={fileInputRef}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (uploadModeRef.current === "split") handlePickSplitFile(f);
              else handleUploadSigned(f);
            }}
            disabled={busy !== null}
          />
        </div>
      )}

      {contract && canDeleteContract && (
        <button
          data-tour="emp-contract-delete"
          type="button"
          className={styles.deleteBtn}
          onClick={() => setDeleteConfirm(true)}
          disabled={busy !== null}
        >
          Smazat smlouvu
        </button>
      )}

      {error && <span className={styles.error}>{error}</span>}

      {splitPrompt && (
        <div className={modalStyles.overlay}>
          <div className={modalStyles.modal}>
            <div className={modalStyles.header}>
              <h2 className={modalStyles.title}>Smlouva + prohlášení</h2>
              <IconButton
                aria-label="Zavřít"
                onClick={() => setSplitPrompt(null)}
                disabled={busy !== null}
              >
                ✕
              </IconButton>
            </div>
            <div className={modalStyles.body}>
              <p style={{ margin: "0 0 12px", fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
                Dokument má {pagesAccusative(splitPrompt.pageCount)}. Zvolte, kolik prvních
                stran tvoří smlouvu – zbytek se uloží jako prohlášení poplatníka do Dalších
                dokumentů.
              </p>

              <div style={{ marginBottom: "12px" }}>
                <label style={fieldLabelStyle}>Počet stran smlouvy</label>
                <input
                  type="number"
                  min={1}
                  max={splitPrompt.pageCount - 1}
                  value={splitAfterPage}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) {
                      setSplitAfterPage(
                        Math.min(Math.max(1, Math.trunc(n)), splitPrompt.pageCount - 1)
                      );
                    }
                  }}
                  autoFocus
                  disabled={busy !== null}
                  style={fieldInputStyle}
                />
                <p style={{ margin: "6px 0 0", fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
                  {pageRangeCz("Smlouva", 1, splitAfterPage)}{" "}
                  {pageRangeCz("Prohlášení", splitAfterPage + 1, splitPrompt.pageCount)}
                </p>
              </div>

              <div>
                <label style={fieldLabelStyle}>Název prohlášení</label>
                <input
                  type="text"
                  value={declarationName}
                  onChange={(e) => setDeclarationName(e.target.value)}
                  disabled={busy !== null}
                  style={fieldInputStyle}
                />
              </div>

              {splitPrompt.compressed && (
                <p style={{ margin: "12px 0 0", fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
                  Sken byl zmenšen z {formatMb(splitPrompt.originalSize)} na{" "}
                  {formatMb(splitPrompt.finalSize)}.
                </p>
              )}
            </div>
            <div className={modalStyles.footer}>
              <Button
                variant="secondary"
                onClick={() => setSplitPrompt(null)}
                disabled={busy !== null}
              >
                Zrušit
              </Button>
              <Button
                variant="primary"
                onClick={confirmSplitUpload}
                disabled={busy !== null || !declarationName.trim()}
              >
                {busy === "uploading" ? "Nahrávám…" : "Nahrát a rozdělit"}
              </Button>
            </div>
          </div>
        </div>
      )}

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
