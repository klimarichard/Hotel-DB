import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import Button from "./Button";
import ConfirmModal from "./ConfirmModal";
import GenerateContractModal from "./GenerateContractModal";
import {
  ContractType,
  CONTRACT_TYPE_LABELS,
  STANDALONE_TYPES,
  EmployeeData,
} from "@/lib/contractVariables";
import { blobToBase64 } from "@/lib/blobToBase64";
import { formatTimestampCZ } from "@/lib/dateFormat";
import { buildContractName } from "@/lib/contractNaming";
import styles from "./ContractsTab.module.css";
import modalStyles from "./ConfirmModal.module.css";

interface ContractRecord {
  id: string;
  type: ContractType;
  status: "unsigned" | "signed" | "archived";
  employmentRowId?: string;
  unsignedStoragePath?: string;
  signedStoragePath?: string;
  generatedAt?: { seconds: number };
  signedAt?: { seconds: number };
  notes?: string;
}

interface Props {
  employeeId: string;
  employeeData: EmployeeData;
  /**
   * Notify the parent whenever the contracts collection changes (create,
   * delete, signed-PDF upload/delete, archive, unarchive). Lets the
   * parent (EmployeeDetailPage) refresh its own copy of the list, which
   * drives the "hide Generovat once a matching contract exists" logic
   * in the Historie tab.
   */
  onContractsChanged?: () => void;
}

const STATUS_LABEL: Record<ContractRecord["status"], string> = {
  unsigned: "Nepodepsáno",
  signed: "Podepsáno",
  archived: "Archivováno",
};

const STATUS_CLASS: Record<ContractRecord["status"], string> = {
  unsigned: styles.statusUnsigned,
  signed: styles.statusSigned,
  archived: styles.statusArchived,
};

export default function ContractsTab({ employeeId, employeeData, onContractsChanged }: Props) {
  const { user, role } = useAuth();
  const [contracts, setContracts] = useState<ContractRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [generateModal, setGenerateModal] = useState<{
    type: ContractType;
    signingDate?: string;
    requestedAt?: string;
    validFrom?: string;
  } | null>(null);
  const [signingDatePrompt, setSigningDatePrompt] = useState<ContractType | null>(null);
  const [signingDateDraft, setSigningDateDraft] = useState<string>("");
  const [requestedAtDraft, setRequestedAtDraft] = useState<string>("");
  const [validFromDraft, setValidFromDraft] = useState<string>("");
  // Custom user-created standalone templates fetched from the backend.
  // Built-in standalone types live in STANDALONE_TYPES; the dropdown
  // concatenates the two sources.
  const [customStandalone, setCustomStandalone] = useState<{ id: string; name: string }[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<ContractRecord | null>(null);
  const [deleteSignedTarget, setDeleteSignedTarget] = useState<ContractRecord | null>(null);
  const [standaloneDropdown, setStandaloneDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const uploadRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const canEdit = role === "admin" || role === "director";

  async function fetchContracts() {
    if (!user) return;
    const token = await user.getIdToken();
    const resp = await fetch(`/api/employees/${employeeId}/contracts`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.ok) {
      const data: ContractRecord[] = await resp.json();
      setContracts(data);
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchContracts();
  }, [employeeId, user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch user-created custom standalone templates so the Generovat ▾
  // dropdown can list them alongside the built-in two. Only admins see
  // this tab's edit affordances anyway, but the listing endpoint is
  // admin/director-gated server-side too.
  useEffect(() => {
    if (!user || !canEdit) return;
    (async () => {
      const token = await user.getIdToken();
      const resp = await fetch("/api/contractTemplates", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) return;
      const list = (await resp.json()) as { id: string; name: string; kind?: string | null }[];
      setCustomStandalone(
        list.filter((t) => t.kind === "standalone").map((t) => ({ id: t.id, name: t.name }))
      );
    })();
  }, [user, canEdit]);

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setStandaloneDropdown(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  async function handleDownload(contractId: string, kind: "unsigned" | "signed") {
    if (!user) return;
    const token = await user.getIdToken();
    const resp = await fetch(
      `/api/employees/${employeeId}/contracts/${contractId}/download?kind=${kind}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!resp.ok) return;

    // Pull the human-readable filename from Content-Disposition. Prefer
    // filename*=UTF-8''… (proper UTF-8 with diacritics) and fall back to
    // the ASCII filename="…" if the UTF-8 form is missing.
    const cd = resp.headers.get("Content-Disposition") ?? "";
    let filename = "smlouva.pdf";
    const utf8 = cd.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
    if (utf8) {
      try {
        filename = decodeURIComponent(utf8[1]);
      } catch {
        // fall through to ASCII match
      }
    }
    if (filename === "smlouva.pdf") {
      const ascii = cd.match(/filename\s*=\s*"?([^";]+)"?/i);
      if (ascii) filename = ascii[1];
    }

    // A blob URL has no filename, so saving from a preview tab would land
    // a generic name. Trigger a real download via a hidden <a download>
    // so the browser writes the file as `filename`.
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

  async function refreshAfterMutation() {
    await fetchContracts();
    onContractsChanged?.();
  }

  async function confirmDeleteUnsigned() {
    if (!user || !deleteTarget) return;
    const contract = deleteTarget;
    setDeleteTarget(null);

    const token = await user.getIdToken();
    await fetch(`/api/employees/${employeeId}/contracts/${contract.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    await refreshAfterMutation();
  }

  async function handleUploadSigned(contract: ContractRecord, file: File) {
    if (!user) return;

    const pdfBase64 = await blobToBase64(file);
    const token = await user.getIdToken();
    await fetch(
      `/api/employees/${employeeId}/contracts/${contract.id}/signed-pdf`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ pdfBase64 }),
      }
    );

    await refreshAfterMutation();
  }

  function handleFileInput(contract: ContractRecord, files: FileList | null) {
    if (!files || files.length === 0) return;
    handleUploadSigned(contract, files[0]);
  }

  async function handleArchive(contract: ContractRecord) {
    if (!user) return;
    const token = await user.getIdToken();
    await fetch(`/api/employees/${employeeId}/contracts/${contract.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status: "archived" }),
    });
    await refreshAfterMutation();
  }

  async function confirmDeleteSigned() {
    if (!user || !deleteSignedTarget) return;
    const contract = deleteSignedTarget;
    setDeleteSignedTarget(null);

    const token = await user.getIdToken();
    await fetch(
      `/api/employees/${employeeId}/contracts/${contract.id}/signed-pdf`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    await refreshAfterMutation();
  }

  async function handleUnarchive(contract: ContractRecord) {
    if (!user) return;
    const restored = contract.signedStoragePath ? "signed" : "unsigned";
    const token = await user.getIdToken();
    await fetch(`/api/employees/${employeeId}/contracts/${contract.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status: restored }),
    });
    await refreshAfterMutation();
  }

  if (loading) {
    return <p className={styles.loading}>Načítám smlouvy…</p>;
  }

  return (
    <div className={styles.tab}>
      <div className={styles.tabHeader}>
        <h3 className={styles.tabTitle}>Smlouvy zaměstnance</h3>
        {canEdit && (
          <div className={styles.standaloneWrapper} ref={dropdownRef}>
            <Button
              variant="primary"
              onClick={() => setStandaloneDropdown((v) => !v)}
            >
              Generovat ▾
            </Button>
            {standaloneDropdown && (
              <div className={styles.dropdown}>
                {[
                  ...STANDALONE_TYPES.map((t) => ({ id: t, label: CONTRACT_TYPE_LABELS[t] })),
                  ...customStandalone.map((t) => ({ id: t.id, label: t.name })),
                ].map((entry) => (
                  <button
                    key={entry.id}
                    className={styles.dropdownItem}
                    onClick={() => {
                      const today = new Date().toISOString().split("T")[0];
                      setSigningDatePrompt(entry.id);
                      setSigningDateDraft(today);
                      setRequestedAtDraft(today);
                      setValidFromDraft(today);
                      setStandaloneDropdown(false);
                    }}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {contracts.length === 0 ? (
        <p className={styles.empty}>Žádné smlouvy.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Typ</th>
              <th>Datum</th>
              <th>Stav</th>
              <th>Akce</th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((c) => (
              <tr key={c.id}>
                <td>{CONTRACT_TYPE_LABELS[c.type] ?? customStandalone.find((t) => t.id === c.type)?.name ?? c.type}</td>
                <td>{formatTimestampCZ(c.generatedAt)}</td>
                <td>
                  <span className={`${styles.status} ${STATUS_CLASS[c.status]}`}>
                    {STATUS_LABEL[c.status]}
                  </span>
                </td>
                <td>
                  <div className={styles.actions}>
                    {c.unsignedStoragePath && (
                      <button
                        className={styles.actionBtn}
                        onClick={() => handleDownload(c.id, "unsigned")}
                      >
                        Stáhnout
                      </button>
                    )}
                    {c.signedStoragePath && (
                      <button
                        className={styles.actionBtn}
                        onClick={() => handleDownload(c.id, "signed")}
                      >
                        Podepsaná
                      </button>
                    )}
                    {canEdit && c.status === "unsigned" && (
                      <>
                        <label className={`${styles.actionBtn} ${styles.uploadBtn}`}>
                          Nahrát podepsanou
                          <input
                            type="file"
                            accept="application/pdf"
                            style={{ display: "none" }}
                            ref={(el) => { uploadRefs.current[c.id] = el; }}
                            onChange={(e) => handleFileInput(c, e.target.files)}
                          />
                        </label>
                        <button
                          className={`${styles.actionBtn} ${styles.deleteBtn}`}
                          onClick={() => setDeleteTarget(c)}
                        >
                          Smazat
                        </button>
                      </>
                    )}
                    {canEdit && c.status === "signed" && (
                      <>
                        <button
                          className={`${styles.actionBtn} ${styles.deleteBtn}`}
                          onClick={() => setDeleteSignedTarget(c)}
                        >
                          Smazat podepsanou
                        </button>
                        <button
                          className={styles.actionBtn}
                          onClick={() => handleArchive(c)}
                        >
                          Archivovat
                        </button>
                      </>
                    )}
                    {canEdit && c.status === "archived" && (
                      <button
                        className={styles.actionBtn}
                        onClick={() => handleUnarchive(c)}
                      >
                        Obnovit
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {signingDatePrompt && (() => {
        const isMultisport = signingDatePrompt === "multisport";
        const promptLabel =
          CONTRACT_TYPE_LABELS[signingDatePrompt] ??
          customStandalone.find((t) => t.id === signingDatePrompt)?.name ??
          signingDatePrompt;
        const dateInputStyle: React.CSSProperties = {
          width: "100%",
          padding: "8px 10px",
          fontSize: "0.875rem",
          border: "1px solid var(--color-border)",
          borderRadius: "6px",
          background: "var(--color-surface)",
          color: "var(--color-text)",
        };
        const labelStyle: React.CSSProperties = {
          display: "block",
          fontSize: "0.8125rem",
          fontWeight: 500,
          color: "var(--color-text-secondary)",
          marginBottom: "4px",
        };
        const fieldStyle: React.CSSProperties = { marginBottom: "12px" };
        const canContinue = signingDateDraft && (!isMultisport || (requestedAtDraft && validFromDraft));
        return (
          <div className={modalStyles.overlay}>
            <div className={modalStyles.modal}>
              <div className={modalStyles.header}>
                <h2 className={modalStyles.title}>{promptLabel}</h2>
              </div>
              <div className={modalStyles.body}>
                <div style={fieldStyle}>
                  <label style={labelStyle}>Datum podpisu</label>
                  <input
                    type="date"
                    value={signingDateDraft}
                    onChange={(e) => setSigningDateDraft(e.target.value)}
                    autoFocus
                    style={dateInputStyle}
                  />
                </div>
                {isMultisport && (
                  <>
                    <div style={fieldStyle}>
                      <label style={labelStyle}>Datum žádosti</label>
                      <input
                        type="date"
                        value={requestedAtDraft}
                        onChange={(e) => setRequestedAtDraft(e.target.value)}
                        style={dateInputStyle}
                      />
                    </div>
                    <div style={{ ...fieldStyle, marginBottom: 0 }}>
                      <label style={labelStyle}>Platnost od</label>
                      <input
                        type="date"
                        value={validFromDraft}
                        onChange={(e) => setValidFromDraft(e.target.value)}
                        style={dateInputStyle}
                      />
                    </div>
                  </>
                )}
              </div>
              <div className={modalStyles.footer}>
                <Button variant="secondary" onClick={() => setSigningDatePrompt(null)}>
                  Zrušit
                </Button>
                <Button
                  variant="primary"
                  disabled={!canContinue}
                  onClick={() => {
                    setGenerateModal({
                      type: signingDatePrompt,
                      signingDate: signingDateDraft,
                      requestedAt: isMultisport ? requestedAtDraft : undefined,
                      validFrom: isMultisport ? validFromDraft : undefined,
                    });
                    setSigningDatePrompt(null);
                  }}
                >
                  Pokračovat
                </Button>
              </div>
            </div>
          </div>
        );
      })()}

      {generateModal && (
        <GenerateContractModal
          employeeId={employeeId}
          contractType={generateModal.type}
          companyId={employeeData.currentCompanyId ?? null}
          employeeData={{
            ...employeeData,
            signingDate: generateModal.signingDate,
            requestedAt: generateModal.requestedAt,
            validFrom: generateModal.validFrom,
          }}
          displayName={buildContractName(
            generateModal.type,
            undefined,
            `${employeeData.firstName ?? ""} ${employeeData.lastName ?? ""}`.trim(),
            customStandalone.find((t) => t.id === generateModal.type)?.name
          )}
          onClose={() => setGenerateModal(null)}
          onGenerated={async () => {
            setGenerateModal(null);
            await fetchContracts();
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title="Smazat smlouvu"
          message="Smazat nepodepsanou smlouvu? Tato akce je nevratná."
          confirmLabel="Smazat"
          danger
          onConfirm={confirmDeleteUnsigned}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {deleteSignedTarget && (
        <ConfirmModal
          title="Smazat podepsanou smlouvu"
          message="Smazat podepsanou kopii? Smlouva se vrátí do stavu Nepodepsáno. Tato akce je nevratná."
          confirmLabel="Smazat"
          danger
          onConfirm={confirmDeleteSigned}
          onCancel={() => setDeleteSignedTarget(null)}
        />
      )}
    </div>
  );
}
