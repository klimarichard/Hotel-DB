import { useState, useEffect } from "react";
import Button from "./Button";
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
import { generatePdf, useContractGeneration } from "@/hooks/useContractGeneration";
import { useAuth } from "@/hooks/useAuth";
import styles from "./GenerateContractModal.module.css";

interface Props {
  employeeId: string;
  contractType: ContractType;
  employmentRowId?: string;
  employeeData: EmployeeData;
  companyData: CompanyData;
  onClose: () => void;
  onGenerated: (contractId: string) => void;
}

type Step = "confirm" | "generating" | "done" | "error";

export default function GenerateContractModal({
  employeeId,
  contractType,
  employmentRowId,
  employeeData,
  companyData,
  onClose,
  onGenerated,
}: Props) {
  const { user, role } = useAuth();
  const { uploadContract } = useContractGeneration();
  const [step, setStep] = useState<Step>("confirm");
  const [errorMsg, setErrorMsg] = useState("");
  const [template, setTemplate] = useState<string | null>(null);
  const [loadingTemplate, setLoadingTemplate] = useState(true);

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

  async function handleGenerate() {
    if (!template) return;
    setStep("generating");

    try {
      const filled = fillTemplate(template, vars);
      const blob = await generatePdf(filled);
      const id = await uploadContract(employeeId, blob, {
        type: contractType,
        employmentRowId,
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
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div className={styles.body}>
          <p className={styles.contractType}>{CONTRACT_TYPE_LABELS[contractType]}</p>

          {step === "confirm" && (
            <>
              {loadingTemplate ? (
                <p className={styles.info}>Načítám šablonu…</p>
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
                disabled={loadingTemplate || !template}
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
