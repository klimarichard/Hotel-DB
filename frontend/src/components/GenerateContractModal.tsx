import { useState, useEffect } from "react";
import Button from "./Button";
import IconButton from "./IconButton";
import {
  ContractType,
  CONTRACT_TYPE_LABELS,
  VARIABLE_GROUPS,
  EmployeeData,
  CompanyData,
  SignatoryData,
  resolveVariables,
  fillTemplate,
  getMissingVariables,
} from "@/lib/contractVariables";
import { generatePdf, useContractGeneration, DEFAULT_MARGINS, type PageMargins } from "@/hooks/useContractGeneration";
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
  onClose,
  onGenerated,
}: Props) {
  const { user, role } = useAuth();
  const { uploadContract } = useContractGeneration();
  const [step, setStep] = useState<Step>("confirm");
  const [errorMsg, setErrorMsg] = useState("");
  const [template, setTemplate] = useState<string | null>(null);
  const [margins, setMargins] = useState<PageMargins>(DEFAULT_MARGINS);
  const [loadingTemplate, setLoadingTemplate] = useState(true);
  const [companyData, setCompanyData] = useState<CompanyData>({});
  const [loadingCompany, setLoadingCompany] = useState(false);

  const signatory: SignatoryData = {
    displayName: user?.displayName ?? user?.email ?? "",
    title: role === "admin" ? "Administrátor" : role === "director" ? "Ředitel" : "",
  };

  const vars = resolveVariables(employeeData, companyData, signatory);
  const missing = template ? getMissingVariables(template, vars) : [];

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
      const id = await uploadContract(employeeId, blob, {
        type: contractType,
        employmentRowId,
        rowSnapshot,
      });
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
                    <p className={styles.varTableTitle}>Hodnoty proměnných</p>
                    <table>
                      <tbody>
                        {allVars
                          .filter((v) => template.includes(`{{${v.key}}}`))
                          .map((v) => (
                            <tr key={v.key}>
                              <td className={styles.varKey}>{v.label}</td>
                              <td className={styles.varVal}>
                                {vars[v.key] || <span className={styles.empty}>–</span>}
                              </td>
                            </tr>
                          ))}
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
