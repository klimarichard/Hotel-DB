import { useState, useEffect } from "react";
import Button from "./Button";
import IconButton from "./IconButton";
import {
  ContractType,
  CONTRACT_TYPE_LABELS,
  VARIABLE_GROUPS,
  EmployeeData,
  CompanyData,
  resolveVariables,
  fillTemplate,
  getMissingVariables,
} from "@/lib/contractVariables";
import { useContractGeneration, DEFAULT_MARGINS, type PageMargins } from "@/hooks/useContractGeneration";
import { useAuth } from "@/hooks/useAuth";
import styles from "./GenerateContractModal.module.css";

interface Props {
  employeeId: string;
  contractType: ContractType;
  employmentRowId?: string;
  /**
   * ID of the company that this contract should reference. For row-tied
   * contracts, pass the row's `companyId` (legally correct for that
   * specific contract); for standalone contracts, pass the employee's
   * current company. The modal fetches the doc itself so the parent
   * doesn't have to keep a `company` state in sync.
   */
  companyId: string | null | undefined;
  employeeData: EmployeeData;
  /**
   * Snapshot of the row's identifying parameters at generation time.
   * Persisted on the contract doc so we can later detect whether the row
   * has been edited since the contract was generated.
   */
  rowSnapshot?: Record<string, unknown>;
  /**
   * Human-readable filename (without extension) for the generated
   * contract. Persisted on the contract doc so the download endpoint
   * can serve it via Content-Disposition.
   */
  displayName?: string;
  /**
   * When set, the generated PDF is ATTACHED to this existing contract
   * record (ad-hoc "row-first" flow) instead of creating a new one — the
   * record's signingDate / displayName are preserved.
   */
  existingContractId?: string;
  onClose: () => void;
  onGenerated: (contractId: string) => void;
}

type Step = "confirm" | "generating" | "done" | "error";

export default function GenerateContractModal({
  employeeId,
  contractType,
  employmentRowId,
  companyId,
  employeeData,
  rowSnapshot,
  displayName,
  existingContractId,
  onClose,
  onGenerated,
}: Props) {
  const { user } = useAuth();
  const { generatePdf, uploadContract, attachUnsignedPdf } = useContractGeneration();
  const [step, setStep] = useState<Step>("confirm");
  const [errorMsg, setErrorMsg] = useState("");
  const [template, setTemplate] = useState<string | null>(null);
  const [margins, setMargins] = useState<PageMargins>(DEFAULT_MARGINS);
  const [loadingTemplate, setLoadingTemplate] = useState(true);
  const [companyData, setCompanyData] = useState<CompanyData>({});
  const [loadingCompany, setLoadingCompany] = useState(false);
  // Per-field manual overrides of the automatic values (ad-hoc / back-dated
  // contracts). Held as a sparse patch so each field can be reverted to auto.
  const [editedVars, setEditedVars] = useState<Record<string, string>>({});

  const autoVars = resolveVariables(employeeData, companyData);
  // Working copy: automatic values with any manual edits applied on top.
  const vars = { ...autoVars, ...editedVars };
  const missing = template ? getMissingVariables(template, vars) : [];

  function revertField(key: string) {
    setEditedVars((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const token = await user.getIdToken();
        const resp = await fetch(`/api/contractTemplates/${contractType}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (resp.ok) {
          const doc = await resp.json();
          setTemplate(doc.htmlContent ?? "");
          if (doc.margins) setMargins(doc.margins);
        } else {
          setTemplate("");
        }
      } catch {
        setTemplate("");
      } finally {
        setLoadingTemplate(false);
      }
    })();
  }, [user, contractType]);

  useEffect(() => {
    if (!user || !companyId) {
      setCompanyData({});
      return;
    }
    setLoadingCompany(true);
    (async () => {
      try {
        const token = await user.getIdToken();
        const resp = await fetch(`/api/companies/${companyId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (resp.ok) {
          const doc = await resp.json();
          setCompanyData(doc as CompanyData);
        } else {
          setCompanyData({});
        }
      } catch {
        setCompanyData({});
      } finally {
        setLoadingCompany(false);
      }
    })();
  }, [user, companyId]);

  async function handleGenerate() {
    if (!template) return;
    setStep("generating");

    try {
      const filled = fillTemplate(template, vars);
      const blob = await generatePdf(filled, margins);
      let id: string;
      if (existingContractId) {
        // Ad-hoc row-first flow: attach the PDF to the record that already
        // holds the signingDate, rather than creating a new one.
        await attachUnsignedPdf(employeeId, existingContractId, blob);
        id = existingContractId;
      } else {
        id = await uploadContract(employeeId, blob, {
          type: contractType,
          employmentRowId,
          rowSnapshot,
          displayName,
        });
      }
      setStep("done");
      onGenerated(id);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Neznámá chyba");
      setStep("error");
    }
  }

  // All variable groups flattened for the confirm table
  const allVars = VARIABLE_GROUPS.flatMap((g) => g.vars);

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Generovat smlouvu</h2>
          <IconButton onClick={onClose} aria-label="Zavřít">✕</IconButton>
        </div>

        <div className={styles.body}>
          <p className={styles.contractType}>{CONTRACT_TYPE_LABELS[contractType]}</p>

          {step === "confirm" && (
            <>
              {loadingTemplate || loadingCompany ? (
                <p className={styles.info}>Načítám…</p>
              ) : !template ? (
                <p className={styles.warn}>
                  Šablona pro tento typ smlouvy není uložena. Uložte ji nejdříve v sekci
                  „Šablony smluv".
                </p>
              ) : (
                <>
                  {missing.length > 0 && (
                    <div className={styles.missingBox}>
                      <strong>Chybějící údaje:</strong>
                      <ul className={styles.missingList}>
                        {missing.map((k) => {
                          const label = allVars.find((v) => v.key === k)?.label ?? k;
                          return <li key={k}>{label} <code>{`{{${k}}}`}</code></li>;
                        })}
                      </ul>
                      <p>Smlouva bude vygenerována s nevyplněnými poli.</p>
                    </div>
                  )}

                  <div className={styles.varTable}>
                    <div className={styles.varTableHead}>
                      <p className={styles.varTableTitle}>Hodnoty proměnných</p>
                      {Object.keys(editedVars).length > 0 && (
                        <button
                          type="button"
                          className={styles.revertAllBtn}
                          onClick={() => setEditedVars({})}
                        >
                          Vrátit vše na automatické
                        </button>
                      )}
                    </div>
                    <p className={styles.varTableHint}>
                      Hodnoty lze upravit pro tuto smlouvu (např. zpětně datovaná
                      smlouva). Úpravy se nikam neukládají — ovlivní jen toto generování.
                    </p>
                    <table>
                      <tbody>
                        {allVars
                          .filter((v) => template.includes(`{{${v.key}}}`))
                          .map((v) => {
                            const edited = editedVars[v.key] !== undefined;
                            return (
                              <tr key={v.key}>
                                <td className={styles.varKey}>{v.label}</td>
                                <td className={styles.varVal}>
                                  <div className={styles.varValRow}>
                                    <input
                                      type="text"
                                      className={`${styles.varInput} ${edited ? styles.varInputEdited : ""}`}
                                      value={vars[v.key] ?? ""}
                                      placeholder={autoVars[v.key] || "–"}
                                      onChange={(e) =>
                                        setEditedVars((prev) => ({ ...prev, [v.key]: e.target.value }))
                                      }
                                    />
                                    {edited && (
                                      <button
                                        type="button"
                                        className={styles.revertBtn}
                                        title="Vrátit na automatickou hodnotu"
                                        onClick={() => revertField(v.key)}
                                      >
                                        Vrátit
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}

          {step === "generating" && (
            <p className={styles.info}>Generuji PDF a nahrávám…</p>
          )}

          {step === "done" && (
            <p className={styles.success}>Smlouva byla úspěšně vygenerována a uložena.</p>
          )}

          {step === "error" && (
            <p className={styles.warn}>Chyba: {errorMsg}</p>
          )}
        </div>

        <div className={styles.footer}>
          {step === "confirm" && (
            <>
              <Button variant="secondary" onClick={onClose}>Zrušit</Button>
              <Button
                variant="primary"
                onClick={handleGenerate}
                disabled={loadingTemplate || loadingCompany || !template}
              >
                Generovat PDF
              </Button>
            </>
          )}
          {(step === "done" || step === "error") && (
            <Button variant="secondary" onClick={onClose}>Zavřít</Button>
          )}
        </div>
      </div>
    </div>
  );
}
