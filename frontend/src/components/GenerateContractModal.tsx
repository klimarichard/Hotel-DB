import { useState, useEffect, useRef } from "react";
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
  usedCustomVars,
  formatCustomValue,
  customDefaultRaw,
  isFixedVarPassthrough,
  resolveComparableRaw,
  evalCondition,
  missingCustomVars,
  isCustomVarKey,
  CUSTOM_VAR_TYPE_LABELS,
  type CustomVarDefs,
} from "@/lib/contractVariables";
import { formatDateCZ } from "@/lib/dateFormat";
import { isWeekendOrHoliday } from "@/lib/workingDays";

/** True when ISO date `a` is strictly after ISO date `b` (both YYYY-MM-DD). */
function isDateAfter(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return a > b;
}
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
   * record (ad-hoc "row-first" flow) instead of creating a new one – the
   * record's signingDate / displayName are preserved.
   */
  existingContractId?: string;
  /**
   * One-step ad-hoc flow: collect the signing date (and, for Multisport, the
   * request/validity dates) INSIDE this modal, then create the contract record
   * together with the PDF in a single call. Used instead of the old "enter
   * signing date → empty row → generate" two-step. Ignored when
   * `existingContractId` is set.
   */
  collectSigningDate?: boolean;
  /** Seed value (ISO) for the in-modal signing date when collecting it. */
  initialSigningDate?: string;
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
  collectSigningDate = false,
  initialSigningDate = "",
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
  // A deactivated template must not be generatable. The picker surfaces already
  // filter inactive templates out; this is the backend-sourced backstop for the
  // row-tied flow, where the template id is forced by the employment row.
  const [templateInactive, setTemplateInactive] = useState(false);
  const [companyData, setCompanyData] = useState<CompanyData>({});
  const [loadingCompany, setLoadingCompany] = useState(false);
  // Per-field manual overrides of the automatic values (ad-hoc / back-dated
  // contracts). Held as a sparse patch so each field can be reverted to auto.
  const [editedVars, setEditedVars] = useState<Record<string, string>>({});
  // The template's own config of the {{var1}}..{{var10}} slots (label + type).
  const [variableDefs, setVariableDefs] = useState<CustomVarDefs>({});
  // Raw form input per custom slot, as typed (ISO date, digits, "true"/"" for a
  // checkbox). Formatted into the final string only at fill time.
  const [customRaw, setCustomRaw] = useState<Record<string, string>>({});
  // Only complain about unfilled custom variables once the user has actually
  // tried to generate. Flagging empty fields the moment the dialog opens reads
  // as an error the user hasn't made yet.
  const [triedGenerate, setTriedGenerate] = useState(false);

  // One-step ad-hoc flow: signing date (+ Multisport request/validity dates)
  // collected here instead of a separate prompt. Ignored when attaching to an
  // existing record (that record already carries its signing date).
  const collectDates = collectSigningDate && !existingContractId;
  const isMultisport = contractType === "multisport";
  const [signingDate, setSigningDate] = useState(initialSigningDate);
  const [requestedAt, setRequestedAt] = useState(initialSigningDate);
  const [validFrom, setValidFrom] = useState(initialSigningDate);

  // When collecting dates in-modal, feed them into the variable resolver so the
  // {{signingDate}} / {{requestedAt}} / {{validFrom}} tokens track the inputs.
  const effectiveEmployeeData: EmployeeData = collectDates
    ? {
        ...employeeData,
        signingDate,
        requestedAt: isMultisport ? requestedAt : employeeData.requestedAt,
        validFrom: isMultisport ? validFrom : employeeData.validFrom,
      }
    : employeeData;
  const autoVars = resolveVariables(effectiveEmployeeData, companyData);

  // Custom slots this template uses, and the values they resolve to. A
  // `condition` slot is COMPUTED from its comparison (raw typed values). A slot
  // whose default references a fixed variable passes its already-formatted value
  // through untouched (isFixedVarPassthrough); everything else is formatted.
  const customKeys = template ? usedCustomVars(template) : [];
  const rawComparable = resolveComparableRaw(effectiveEmployeeData);
  const customVars: Record<string, string> = {};
  for (const key of customKeys) {
    const def = variableDefs[key];
    const type = def?.type ?? "text";
    if (type === "condition") {
      customVars[key] = evalCondition(def?.condition, rawComparable) ? "ano" : "";
    } else if (isFixedVarPassthrough(def)) {
      customVars[key] = customRaw[key] ?? "";
    } else {
      customVars[key] = formatCustomValue(type, customRaw[key] ?? "");
    }
  }

  // Pre-fill the custom-slot inputs from their configured defaults, once the
  // template + company data (needed to resolve fixed-variable defaults) are in.
  // Only seeds slots the user hasn't touched; runs once.
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (prefilledRef.current || loadingTemplate || loadingCompany || !template) return;
    const keys = usedCustomVars(template);
    const seed: Record<string, string> = {};
    for (const key of keys) {
      const init = customDefaultRaw(variableDefs[key], autoVars);
      if (init) seed[key] = init;
    }
    if (Object.keys(seed).length > 0) {
      setCustomRaw((prev) => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(seed)) if (!(k in next)) next[k] = v;
        return next;
      });
    }
    prefilledRef.current = true;
  }, [loadingTemplate, loadingCompany, template, variableDefs, autoVars]);

  // Signing date is complete enough to generate (only relevant when collecting).
  const signingReady =
    !collectDates || (!!signingDate && (!isMultisport || (!!requestedAt && !!validFrom)));

  // Working copy: automatic values, manual edits, then the custom slots.
  const vars = { ...autoVars, ...editedVars, ...customVars };

  // Built-in variables with no value — a warning, generation still allowed.
  // Custom slots are stricter: they are the whole point of the document (a
  // penalty amount, a deadline), so an empty one BLOCKS generation. `bool` is
  // exempt — an unticked checkbox is a real answer, not an omission.
  const missing = template
    ? getMissingVariables(template, vars).filter((k) => !isCustomVarKey(k))
    : [];
  const missingCustom = template
    ? missingCustomVars(template, variableDefs, customRaw)
    : [];

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
          setTemplateInactive(doc.active === false);
          if (doc.margins) setMargins(doc.margins);
          setVariableDefs(doc.variableDefs ?? {});
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
    // Validate on submit, not on open: the button stays live so pressing it is
    // what surfaces the list of what's still missing (custom vars + signing date).
    if (missingCustom.length > 0 || !signingReady) {
      setTriedGenerate(true);
      return;
    }
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
          // One-step ad-hoc flow: persist the in-modal signing date onto the new
          // record together with the PDF (no empty intermediate row).
          ...(collectDates
            ? {
                signingDate,
                requestedAt: isMultisport ? requestedAt : undefined,
                validFrom: isMultisport ? validFrom : undefined,
              }
            : {}),
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
              ) : templateInactive ? (
                <p className={styles.warn}>
                  Tato šablona je neaktivní, a proto z ní nelze generovat smlouvu.
                  Aktivujte ji nejdříve v sekci „Šablony smluv".
                </p>
              ) : !template ? (
                <p className={styles.warn}>
                  Šablona pro tento typ smlouvy není uložena. Uložte ji nejdříve v sekci
                  „Šablony smluv".
                </p>
              ) : (
                <>
                  {collectDates && (
                    <div className={styles.varTable}>
                      <div className={styles.varTableHead}>
                        <p className={styles.varTableTitle}>
                          {isMultisport ? "Datum podpisu a platnosti" : "Datum podpisu"}
                        </p>
                      </div>
                      <table>
                        <tbody>
                          <tr>
                            <td className={styles.varKey}>Datum podpisu</td>
                            <td className={styles.varVal}>
                              <div className={styles.varValRow}>
                                <input
                                  type="date"
                                  className={styles.varInput}
                                  value={signingDate}
                                  autoFocus
                                  onChange={(e) => setSigningDate(e.target.value)}
                                />
                              </div>
                            </td>
                          </tr>
                          {isMultisport && (
                            <>
                              <tr>
                                <td className={styles.varKey}>Datum žádosti</td>
                                <td className={styles.varVal}>
                                  <div className={styles.varValRow}>
                                    <input
                                      type="date"
                                      className={styles.varInput}
                                      value={requestedAt}
                                      onChange={(e) => setRequestedAt(e.target.value)}
                                    />
                                  </div>
                                </td>
                              </tr>
                              <tr>
                                <td className={styles.varKey}>Platnost od</td>
                                <td className={styles.varVal}>
                                  <div className={styles.varValRow}>
                                    <input
                                      type="date"
                                      className={styles.varInput}
                                      value={validFrom}
                                      onChange={(e) => setValidFrom(e.target.value)}
                                    />
                                  </div>
                                </td>
                              </tr>
                            </>
                          )}
                        </tbody>
                      </table>
                      {isMultisport && isDateAfter(signingDate, validFrom) && (
                        <div className={styles.missingBox}>
                          Upozornění: datum podpisu je pozdější než datum platnosti
                          ({formatDateCZ(validFrom)}). Zkontrolujte prosím správnost.
                        </div>
                      )}
                      {/* Applies to EVERY document with a signing date, unlike the
                          Multisport-only note above (a plain document has no
                          validity date to compare against). Both can show at once
                          – they are different objections to the same date. */}
                      {isWeekendOrHoliday(signingDate) && (
                        <div className={styles.missingBox}>
                          Datum podpisu připadá na víkend nebo svátek.
                        </div>
                      )}
                      {triedGenerate && !signingReady && (
                        <div className={styles.missingBox}>
                          <strong>
                            Vyplňte datum podpisu{isMultisport ? " a data platnosti" : ""}.
                          </strong>
                        </div>
                      )}
                    </div>
                  )}

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

                  {customKeys.length > 0 && (
                    <div className={styles.varTable}>
                      <div className={styles.varTableHead}>
                        <p className={styles.varTableTitle}>Vlastní proměnné</p>
                      </div>
                      <p className={styles.varTableHint}>
                        Tyto hodnoty nejsou nikde uložené – vyplňte je pro tento
                        dokument. Bez nich nelze dokument vygenerovat.
                      </p>
                      <table>
                        <tbody>
                          {customKeys.map((key) => {
                            const def = variableDefs[key];
                            const type = def?.type ?? "text";
                            const label = def?.label || key;
                            const raw = customRaw[key] ?? "";
                            const setRaw = (v: string) =>
                              setCustomRaw((prev) => ({ ...prev, [key]: v }));

                            return (
                              <tr key={key}>
                                <td className={styles.varKey}>
                                  {label}
                                  {/* Optional slots ("Nepovinná" on the
                                      template) may be left blank, so say which
                                      ones – otherwise the only way to find out is
                                      to try generating. bool/condition are never
                                      typed in, so the hint would be noise there. */}
                                  {def?.optional && type !== "bool" && type !== "condition" && (
                                    <>
                                      {" "}
                                      <span className={styles.varTableHint}>(nepovinné)</span>
                                    </>
                                  )}
                                  {/* Slot used in the template but never given a
                                      name/type: say so plainly instead of showing
                                      a bare "var1" that means nothing here. */}
                                  {!def?.label?.trim() && (
                                    <>
                                      {" "}
                                      <code>{`{{${key}}}`}</code>{" "}
                                      <span className={styles.varTableHint}>
                                        (v šabloně bez nastavení)
                                      </span>
                                    </>
                                  )}
                                </td>
                                <td className={styles.varVal}>
                                  <div className={styles.varValRow}>
                                    {type === "condition" ? (
                                      // Computed from a comparison — read-only, shown
                                      // so the user sees which branch will apply.
                                      <span className={styles.varInput} style={{ border: 0, display: "flex", alignItems: "center", gap: 6 }}>
                                        {customVars[key] ? "Ano" : "Ne"}
                                        <span className={styles.varTableHint}>(vypočteno z podmínky)</span>
                                      </span>
                                    ) : type === "bool" ? (
                                      <label className={styles.varInput} style={{ border: 0, display: "flex", alignItems: "center", gap: 6 }}>
                                        <input
                                          type="checkbox"
                                          checked={raw === "true"}
                                          onChange={(e) => setRaw(e.target.checked ? "true" : "")}
                                        />
                                        {raw === "true" ? "Ano" : "Ne"}
                                      </label>
                                    ) : type === "list" && (def?.options?.length ?? 0) > 0 ? (
                                      // Fixed choice list. An optionless list slot is
                                      // an authoring mistake (the template editor
                                      // warns about it) and deliberately falls through
                                      // to the text input below, so a half-configured
                                      // template can still be generated.
                                      <select
                                        className={styles.varInput}
                                        value={raw}
                                        onChange={(e) => setRaw(e.target.value)}
                                      >
                                        <option value="">– vyberte –</option>
                                        {(def?.options ?? []).map((o, i) => (
                                          <option key={`${o}-${i}`} value={o}>{o}</option>
                                        ))}
                                      </select>
                                    ) : (
                                      <input
                                        // A fixed-variable default resolves to an
                                        // already-formatted string, so its field is
                                        // a plain text box (a date/number widget
                                        // can't hold "1. 1. 2024" / "42 000 Kč").
                                        type={
                                          isFixedVarPassthrough(def)
                                            ? "text"
                                            : type === "date"
                                              ? "date"
                                              : type === "number"
                                                ? "number"
                                                : "text"
                                        }
                                        className={styles.varInput}
                                        value={raw}
                                        placeholder={CUSTOM_VAR_TYPE_LABELS[type]}
                                        onChange={(e) => setRaw(e.target.value)}
                                      />
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {triedGenerate && missingCustom.length > 0 && (
                        <div className={styles.missingBox}>
                          <strong>Vyplňte všechny vlastní proměnné:</strong>
                          <ul className={styles.missingList}>
                            {missingCustom.map((k) => (
                              <li key={k}>{variableDefs[k]?.label || k}</li>
                            ))}
                          </ul>
                        </div>
                      )}
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
                      smlouva). Úpravy se nikam neukládají – ovlivní jen toto generování.
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
                disabled={loadingTemplate || loadingCompany || !template || templateInactive}
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
