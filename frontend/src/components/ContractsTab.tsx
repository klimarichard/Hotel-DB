import { useState, useEffect, useRef } from "react";
import { getStorage, ref, getDownloadURL, deleteObject } from "firebase/storage";
import { useAuth } from "@/hooks/useAuth";
import GenerateContractModal from "./GenerateContractModal";
import {
  ContractType,
  CONTRACT_TYPE_LABELS,
  STANDALONE_TYPES,
  EmployeeData,
  CompanyData,
} from "@/lib/contractVariables";
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
  companyData: CompanyData;
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

export default function ContractsTab({ employeeId, employeeData, companyData }: Props) {
  const { user, role } = useAuth();
  const [contracts, setContracts] = useState<ContractRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [generateModal, setGenerateModal] = useState<ContractType | null>(null);
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
  }, [employeeId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  async function handleDownload(storagePath: string) {
    const storage = getStorage();
    const url = await getDownloadURL(ref(storage, storagePath));
    window.open(url, "_blank");
  }

  async function handleDeleteUnsigned(contract: ContractRecord) {
    if (!user) return;
    if (!confirm("Smazat nepodepsanou smlouvu?")) return;

    const token = await user.getIdToken();

    // Delete Firestore record
    await fetch(`/api/employees/${employeeId}/contracts/${contract.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    // Delete Storage file
    if (contract.unsignedStoragePath) {
      try {
        await deleteObject(ref(getStorage(), contract.unsignedStoragePath));
      } catch {
        // ignore — file may already be gone
      }
    }

    await fetchContracts();
  }

  async function handleUploadSigned(contract: ContractRecord, file: File) {
    if (!user) return;

    const storage = getStorage();
    const { uploadBytes } = await import("firebase/storage");
    const storagePath = `contracts/${employeeId}/${contract.id}_signed.pdf`;
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, file, { contentType: "application/pdf" });

    const token = await user.getIdToken();
    await fetch(`/api/employees/${employeeId}/contracts/${contract.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status: "signed", signedStoragePath: storagePath }),
    });

    await fetchContracts();
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
    await fetchContracts();
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
            <button
              className={styles.generateBtn}
              onClick={() => setStandaloneDropdown((v) => !v)}
            >
              Generovat ▾
            </button>
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
                        onClick={() => handleDownload(c.unsignedStoragePath!)}
                      >
                        Stáhnout
                      </button>
                    )}
                    {c.signedStoragePath && (
                      <button
                        className={styles.actionBtn}
                        onClick={() => handleDownload(c.signedStoragePath!)}
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
                          onClick={() => handleDeleteUnsigned(c)}
                        >
                          Smazat
                        </button>
                      </>
                    )}
                    {canEdit && c.status === "signed" && (
                      <button
                        className={styles.actionBtn}
                        onClick={() => handleArchive(c)}
                      >
                        Archivovat
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
          employeeData={employeeData}
          companyData={companyData}
          onClose={() => setGenerateModal(null)}
          onGenerated={async () => {
            setGenerateModal(null);
            await fetchContracts();
          }}
        />
      )}
    </div>
  );
}
