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
import styles from "./ContractsTab.module.css";

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
  const [generateModal, setGenerateModal] = useState<ContractType | null>(null);
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
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    // Revoke after the new tab has had time to claim the URL.
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
                {STANDALONE_TYPES.map((t) => (
                  <button
                    key={t}
                    className={styles.dropdownItem}
                    onClick={() => {
                      setGenerateModal(t);
                      setStandaloneDropdown(false);
                    }}
                  >
                    {CONTRACT_TYPE_LABELS[t]}
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
                <td>{CONTRACT_TYPE_LABELS[c.type]}</td>
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

      {generateModal && (
        <GenerateContractModal
          employeeId={employeeId}
          contractType={generateModal}
          companyId={employeeData.currentCompanyId ?? null}
          employeeData={employeeData}
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
