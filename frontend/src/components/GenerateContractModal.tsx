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
import { generatePdf, generateDocx, useContractGeneration } from "@/hooks/useContractGeneration";
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
  const [templateFormat, setTemplateFormat] = useState<"html" | "docx">("html");
  const [docxVariables, setDocxVariables] = useState<string[]>([]);
  const [loadingTemplate, setLoadingTemplate] = useState(true);

  const signatory: SignatoryData = {
    displayName: user?.displayName ?? user?.email ?? "",
    title: role === "admin" ? "Administrátor" : role === "director" ? "Ředitel" : "",
  };

  const vars = resolveVariables(employeeData, companyData, signatory);
  const missing = templateFormat === "html"
    ? (template ? getMissingVariables(template, vars) : [])
    : docxVariables.filter((k) => !vars[k]);

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
          const fmt: "html" | "docx" = doc.templateFormat === "docx" ? "docx" : "html";
          setTemplateFormat(fmt);
          if (fmt === "docx") {
            setDocxVariables(Array.isArray(doc.variables) ? doc.variables : []);
            // template stays null — we fetch the bytes lazily at generate time
            setTemplate("__docx__");
          } else {
            setTemplate(doc.htmlContent ?? "");
          }
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
      if (templateFormat === "docx") {
        if (!user) throw new Error("Not authenticated");
        const token = await user.getIdToken();
        const resp = await fetch(`/api/contractTemplates/${contractType}/docx`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) throw new Error("Šablonu .docx se nepodařilo načíst");
        const bytes = await resp.arrayBuffer();
        const blob = generateDocx(bytes, vars);

        // Prototype: download directly, skip Storage upload + Firestore record.
        const filenameBase = `${employeeData.lastName ?? "smlouva"}_${contractType}_${vars.today.replace(/\.\s*/g, "-").replace(/-$/, "")}`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${filenameBase}.docx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setStep("done");
        // No contract record created in DOCX prototype mode — pass empty id.
        onGenerated("");
        return;
      }

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
          <IconButton onClick={onClose} aria-label="Zavřít">✕</IconButton>
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
                          const tag = templateFormat === "docx" ? `{${k}}` : `{{${k}}}`;
                          return <li key={k}>{label} <code>{tag}</code></li>;
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
                          .filter((v) =>
                            templateFormat === "docx"
                              ? docxVariables.includes(v.key)
                              : template.includes(`{{${v.key}}}`)
                          )
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
                {templateFormat === "docx" ? "Generovat .docx" : "Generovat PDF"}
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
