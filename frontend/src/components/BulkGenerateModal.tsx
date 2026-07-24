import { useState, useEffect, useMemo } from "react";
import Button from "./Button";
import IconButton from "./IconButton";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { employeeDisplayName, employeeSurnameFirst } from "@/lib/employeeName";
import { resolveStandaloneEmployment, type EmploymentRow } from "@/lib/employmentSessions";
import { useContractGeneration, DEFAULT_MARGINS, type PageMargins } from "@/hooks/useContractGeneration";
import { buildContractName } from "@/lib/contractNaming";
import { mergePdfBlobs, openPdfBlob } from "@/lib/pdfMerge";
import * as clock from "@/lib/clock";
import {
  ContractType,
  CONTRACT_TYPE_LABELS,
  STANDALONE_TYPES,
  EmployeeData,
  CompanyData,
  resolveVariables,
  fillTemplate,
  requiredCustomVars,
  formatCustomValue,
  customDefaultRaw,
  isFixedVarPassthrough,
  isComputedVarType,
  resolveComparableRaw,
  resolveComputedVars,
  type CustomVarDef,
  type CustomVarDefs,
} from "@/lib/contractVariables";
import styles from "./BulkGenerateModal.module.css";

/** The employee-list row this modal selects over – the shape EmployeesPage
 *  already holds, so opening the picker costs no extra fetch. */
export interface BulkEmployee {
  id: string;
  firstName: string;
  lastName: string;
  displayName?: string;
  status: "active" | "before-start" | "terminated";
  currentDepartment: string;
  currentJobTitle: string;
  currentCompanyId: string | null;
}

interface Props {
  employees: BulkEmployee[];
  onClose: () => void;
}

type Step = "setup" | "running" | "done";

/** Per-employee outcome. A batch is N independent generations with no
 *  transaction across them, so a failure part-way leaves earlier employees with
 *  a stored document. We therefore never abort the run – we record who failed
 *  and show it at the end, so the operator can retry just those people. */
interface Outcome {
  employeeId: string;
  name: string;
  ok: boolean;
  error?: string;
}

const STATUS_LABELS: Record<BulkEmployee["status"], string> = {
  active: "Aktivní",
  "before-start": "Před nástupem",
  terminated: "Ukončení",
};

/**
 * The employee's LEGAL name, for the generated document's filename. Not
 * employeeDisplayName: a display name is a nickname for screens ("Bob"), while
 * the document is a legal record. The single-generate flow passes first+last to
 * buildContractName for the same reason.
 */
function legalNameOf(e: BulkEmployee): string {
  return `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim();
}

/**
 * The choices an "Obrázek" slot can actually offer – a name to pick and a
 * picture to substitute. A slot with none of them is an authoring mistake the
 * template editor flags; here it only decides what to show instead of a field.
 */
function imageChoicesOf(def: CustomVarDef | undefined): { label: string; src: string }[] {
  return (def?.images ?? []).filter((o) => o.label.trim() !== "" && !!o.src);
}

/** Surname-first, Czech collation – the ordering every other picker uses. */
function sortEmployees(list: BulkEmployee[]): BulkEmployee[] {
  return [...list].sort((a, b) =>
    employeeSurnameFirst(a).localeCompare(employeeSurnameFirst(b), "cs")
  );
}

/**
 * "Hromadné generování" – generate the same standalone document for many
 * employees at once.
 *
 * Deliberately orchestrated CLIENT-side, one existing single-document request
 * per employee, rather than through a new bulk endpoint. Three reasons, all
 * load-bearing:
 *  - Rendering is server-side Puppeteer on a 60s-per-request budget; a single
 *    "generate 50" call would blow it, whereas N calls each get their own.
 *  - A bulk endpoint taking an array of employeeIds would bypass the router's
 *    per-id `enforceEmpAccess` guard. Going through /employees/:id/... inherits
 *    the management-record scoping for free.
 *  - It gives per-person progress and per-person error reporting.
 *
 * Closes only via its buttons (never backdrop click) – it holds a half-filled
 * form, and mid-run it holds work in progress.
 */
export default function BulkGenerateModal({ employees, onClose }: Props) {
  const { user } = useAuth();
  const { generatePdf, uploadContract } = useContractGeneration();

  const [step, setStep] = useState<Step>("setup");

  // ── Template ───────────────────────────────────────────────────────────────
  const [templateOptions, setTemplateOptions] = useState<{ id: string; label: string }[]>([]);
  const [templateId, setTemplateId] = useState<string>("");
  const [template, setTemplate] = useState<string>("");
  const [variableDefs, setVariableDefs] = useState<CustomVarDefs>({});
  const [margins, setMargins] = useState<PageMargins>(DEFAULT_MARGINS);
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);

  // ── Selection ──────────────────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<BulkEmployee["status"]>("active");
  const [department, setDepartment] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ── Values ─────────────────────────────────────────────────────────────────
  const [customRaw, setCustomRaw] = useState<Record<string, string>>({});
  const [signingDate, setSigningDate] = useState(clock.today());

  // ── Run ────────────────────────────────────────────────────────────────────
  const [progress, setProgress] = useState<{ done: number; total: number; current: string }>({
    done: 0,
    total: 0,
    current: "",
  });
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [runError, setRunError] = useState<string | null>(null);

  // Standalone templates only. Row-tied types (nastup_*/ukonceni_*/zmena_smlouvy)
  // need a specific employment row chosen per employee and don't generalise.
  // The built-ins carry no `kind` on their docs, so filtering on kind alone would
  // silently drop Hmotná odpovědnost + Multisport – union them in explicitly.
  useEffect(() => {
    api
      .get<{ id: string; name: string; kind?: string | null; active?: boolean }[]>("/contractTemplates")
      .then((list) => {
        const inactive = list.filter((t) => t.active === false).map((t) => t.id);
        const builtins = STANDALONE_TYPES.filter((t) => !inactive.includes(t)).map((t) => ({
          id: t,
          label: CONTRACT_TYPE_LABELS[t] ?? t,
        }));
        const customs = list
          .filter((t) => t.kind === "standalone" && t.active !== false)
          .map((t) => ({ id: t.id, label: t.name }));
        setTemplateOptions([...builtins, ...customs]);
      })
      .catch(() => setTemplateOptions([]));
  }, []);

  // Template doc: fetched ONCE per template, not per employee – htmlContent,
  // margins and variableDefs are template-level, not employee-level.
  useEffect(() => {
    if (!templateId || !user) {
      setTemplate("");
      setVariableDefs({});
      return;
    }
    let cancelled = false;
    setLoadingTemplate(true);
    setTemplateError(null);
    (async () => {
      try {
        const token = await user.getIdToken();
        const resp = await fetch(`/api/contractTemplates/${templateId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;
        if (resp.status === 403) {
          // Reading a template's HTML needs nav.contractTemplates.view, which is
          // a DIFFERENT key from contracts.generate. Say so plainly – the single
          // generate dialog silently renders this as "šablona není uložena".
          setTemplateError("Nemáte oprávnění číst šablony (Šablony smluv).");
          setTemplate("");
          return;
        }
        if (!resp.ok) {
          setTemplateError("Šablonu se nepodařilo načíst.");
          setTemplate("");
          return;
        }
        const doc = await resp.json();
        setTemplate(doc.htmlContent ?? "");
        setVariableDefs(doc.variableDefs ?? {});
        if (doc.margins) setMargins(doc.margins);
        if (doc.active === false) setTemplateError("Tato šablona je neaktivní.");
        setCustomRaw({});
      } catch {
        if (!cancelled) {
          setTemplateError("Šablonu se nepodařilo načíst.");
          setTemplate("");
        }
      } finally {
        if (!cancelled) setLoadingTemplate(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [templateId, user]);

  const departments = useMemo(
    () => [...new Set(employees.map((e) => e.currentDepartment).filter(Boolean))].sort((a, b) => a.localeCompare(b, "cs")),
    [employees]
  );
  const jobTitles = useMemo(
    () => [...new Set(employees.map((e) => e.currentJobTitle).filter(Boolean))].sort((a, b) => a.localeCompare(b, "cs")),
    [employees]
  );

  const candidates = useMemo(
    () =>
      sortEmployees(
        employees.filter(
          (e) =>
            e.status === statusFilter &&
            (!department || e.currentDepartment === department) &&
            (!jobTitle || e.currentJobTitle === jobTitle)
        )
      ),
    [employees, statusFilter, department, jobTitle]
  );

  // Narrowing the filters must not silently keep people who dropped out of view
  // selected – the count next to "Generovat" would then lie.
  useEffect(() => {
    setSelectedIds((prev) => {
      const visible = new Set(candidates.map((e) => e.id));
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [candidates]);

  // requiredCustomVars, NOT usedCustomVars: a `math` slot's operands may appear
  // nowhere in the document's text, and without a field they get no value – the
  // total would then print blank on every document in the batch.
  const customKeys = template ? requiredCustomVars(template, variableDefs) : [];

  // Slots the operator types once for the whole batch. The computed slots
  // (`condition`, `math`) are derived per employee, and a slot defaulting to a
  // fixed variable (e.g. {{firstName}}) RESOLVES per employee – none of them is
  // a shared input, so all are excluded here and shown read-only instead.
  const sharedKeys = customKeys.filter((k) => {
    const def = variableDefs[k];
    if (isComputedVarType(def?.type ?? "text")) return false;
    return def?.default?.kind !== "fixedVar";
  });
  const perEmployeeKeys = customKeys.filter((k) => !sharedKeys.includes(k));

  /** Why a slot is not typed in here – shown in place of its input. */
  function autoFillNote(key: string): string {
    const type = variableDefs[key]?.type ?? "text";
    if (type === "math") return "Vypočítá se ze vzorce.";
    if (type === "condition") return "Vyhodnotí se u každého zaměstnance.";
    return "Vyplní se automaticky u každého zaměstnance.";
  }

  const missingShared = sharedKeys.filter((k) => {
    const def = variableDefs[k];
    const type = def?.type ?? "text";
    if (type === "bool") return false;
    if (def?.optional) return false;
    // An image slot with no usable choices has nothing to pick, and the operator
    // running a batch usually cannot edit the template – blocking on it would be
    // a dead end. It prints nothing, as an unfilled optional slot does, and the
    // template editor is where the omission is flagged.
    //
    // ⚠️ This repeats a rule that `missingCustomVars` enforces in the engine.
    // The repetition is unavoidable rather than sloppy: this list is the SHARED
    // slots only (per-employee ones are excluded above), so the engine's
    // whole-template answer is the wrong set here. Keep the two in step.
    if (type === "image" && imageChoicesOf(def).length === 0) return false;
    return !(customRaw[k] ?? "").trim();
  });

  const canGenerate =
    !!template && !templateError && selectedIds.size > 0 && missingShared.length === 0 && !!signingDate;

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setAll(on: boolean) {
    setSelectedIds(on ? new Set(candidates.map((e) => e.id)) : new Set());
  }

  /** Assemble one employee's variable inputs from the endpoints that already
   *  exist. Going per-id keeps the router's management scoping in force. */
  async function loadEmployeeData(id: string): Promise<{ data: EmployeeData; companyId: string | null }> {
    const [root, contact, documents, employment] = await Promise.all([
      api.get<Record<string, unknown>>(`/employees/${id}`),
      api.get<Record<string, unknown> | null>(`/employees/${id}/contact`).catch(() => null),
      api.get<Record<string, unknown> | null>(`/employees/${id}/documents`).catch(() => null),
      api.get<EmploymentRow[]>(`/employees/${id}/employment`).catch(() => [] as EmploymentRow[]),
    ]);
    const companyId = (root.currentCompanyId as string) ?? null;
    return {
      companyId,
      data: {
        // Employment tokens ({{startDate}}, {{contractType}}, …) resolved from the
        // running contract – a standalone document is tied to no employment row.
        ...resolveStandaloneEmployment(employment),
        id: root.id as string,
        firstName: root.firstName as string,
        lastName: root.lastName as string,
        currentJobTitle: root.currentJobTitle as string,
        currentCompanyId: companyId ?? undefined,
        address: (contact?.contactAddress as string) || (contact?.permanentAddress as string),
        birthDate: (root.dateOfBirth as string) ?? undefined,
        nationality: root.nationality as string,
        gender: root.gender as EmployeeData["gender"],
        passportNumber: documents?.passportNumber as string | undefined,
        visaNumber: documents?.visaNumber as string | undefined,
        visaType: documents?.visaType as string | undefined,
        signingDate,
      },
    };
  }

  async function handleGenerate() {
    if (!canGenerate) return;
    const targets = candidates.filter((e) => selectedIds.has(e.id));
    setStep("running");
    setRunError(null);
    setOutcomes([]);
    setProgress({ done: 0, total: targets.length, current: "" });

    const companyCache = new Map<string, CompanyData | null>();
    const blobs: Blob[] = [];
    const results: Outcome[] = [];

    // SEQUENTIAL on purpose. The api function runs on a 1GB instance with a
    // module-level Chromium (~500MB resident); firing renders concurrently risks
    // OOM-ing the instance for everyone, not just this batch.
    for (const emp of targets) {
      // Screens show the display name; the document carries the legal one.
      const name = employeeDisplayName(emp);
      setProgress((p) => ({ ...p, current: name }));
      try {
        const { data, companyId } = await loadEmployeeData(emp.id);

        if (companyId && !companyCache.has(companyId)) {
          const company = await api
            .get<CompanyData>(`/companies/${companyId}`)
            .catch(() => null);
          companyCache.set(companyId, company);
        }
        // resolveVariables takes a required CompanyData; the single-generate
        // modal seeds it to {} for the same reason. An employee with no company
        // simply leaves the {{company*}} tokens empty rather than blocking.
        const companyData = (companyId ? companyCache.get(companyId) : null) ?? {};

        const autoVars = resolveVariables(data, companyData);
        const rawComparable = resolveComparableRaw(data);

        // Per-employee slot INPUTS: the shared typed values, with any
        // fixed-variable default resolved to THIS employee's value on top.
        const inputRaw: Record<string, string> = { ...customRaw };
        for (const key of customKeys) {
          const def = variableDefs[key];
          if (def?.default?.kind === "fixedVar") {
            inputRaw[key] = customDefaultRaw(def, autoVars) ?? "";
          }
        }
        // Computed slots derived from those inputs, per employee: a condition
        // evaluates against THIS employee's comparables (rawComparable), and a
        // formula over the shared inputs is resolved through the same fixpoint
        // the single-generate dialog uses.
        const computed = resolveComputedVars(customKeys, variableDefs, inputRaw, rawComparable);

        const customVars: Record<string, string> = {};
        for (const key of customKeys) {
          const def = variableDefs[key];
          const type = def?.type ?? "text";
          if (isComputedVarType(type)) {
            customVars[key] = computed.formatted[key] ?? "";
          } else if (isFixedVarPassthrough(def)) {
            // Already a formatted string – re-formatting it would corrupt it.
            customVars[key] = inputRaw[key] ?? "";
          } else {
            // The third argument is required for "image" slots and harmless for
            // every other type: the raw value of an image slot is a choice's
            // NAME, and resolving that to an <img> needs the slot's own picture
            // list. Formatted without it, an image slot prints nothing.
            customVars[key] = formatCustomValue(type, inputRaw[key] ?? "", def);
          }
        }

        const vars = { ...autoVars, ...customVars };
        // Third argument = the RAW map {{#case}} matches on, layered over the
        // printed values so a switch on a key with no raw form still matches on
        // its display string, exactly as it did before a raw map was passed.
        const filled = fillTemplate(template, vars, { ...vars, ...computed.raw });
        const blob = await generatePdf(filled, margins);
        blobs.push(blob);

        await uploadContract(emp.id, blob, {
          type: templateId as ContractType,
          displayName: buildContractName(
            templateId as ContractType,
            undefined,
            legalNameOf(emp),
            templateOptions.find((t) => t.id === templateId)?.label
          ),
          signingDate,
        });
        results.push({ employeeId: emp.id, name, ok: true });
      } catch (err) {
        results.push({
          employeeId: emp.id,
          name,
          ok: false,
          error: err instanceof Error ? err.message : "Generování se nezdařilo.",
        });
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }

    setOutcomes(results);

    // One merged PDF for printing. Never uploaded – it exists only in this tab.
    if (blobs.length > 0) {
      try {
        const label = templateOptions.find((t) => t.id === templateId)?.label ?? "Dokumenty";
        const merged = await mergePdfBlobs(blobs, `${label} (${blobs.length})`);
        openPdfBlob(merged);
      } catch {
        setRunError("Dokumenty byly vygenerovány a uloženy, ale sloučený tisk se nepodařilo otevřít.");
      }
    }
    setStep("done");
  }

  const okCount = outcomes.filter((o) => o.ok).length;
  const failed = outcomes.filter((o) => !o.ok);

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Hromadné generování</h2>
          {step !== "running" && <IconButton variant="close" aria-label="Zavřít" onClick={onClose} />}
        </div>

        {step === "setup" && (
          <div className={styles.body}>
            <label className={styles.label}>
              Šablona
              <select
                className={styles.select}
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
              >
                <option value="" disabled>
                  {templateOptions.length === 0 ? "Žádné samostatné šablony" : "Vyberte šablonu…"}
                </option>
                {templateOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            {templateError && <div className={styles.error}>{templateError}</div>}

            <label className={styles.label}>
              Datum podpisu
              <input
                type="date"
                className={styles.input}
                value={signingDate}
                onChange={(e) => setSigningDate(e.target.value)}
              />
            </label>

            <div className={styles.filterRow}>
              <label className={styles.label}>
                Stav
                <select
                  className={styles.select}
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as BulkEmployee["status"])}
                >
                  {(Object.keys(STATUS_LABELS) as BulkEmployee["status"][]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.label}>
                Oddělení
                <select className={styles.select} value={department} onChange={(e) => setDepartment(e.target.value)}>
                  <option value="">Všechna</option>
                  {departments.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.label}>
                Pozice
                <select className={styles.select} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)}>
                  <option value="">Všechny</option>
                  {jobTitles.map((j) => (
                    <option key={j} value={j}>
                      {j}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className={styles.listHead}>
              <span>
                Vybráno {selectedIds.size} z {candidates.length}
              </span>
              <div className={styles.listHeadActions}>
                <button type="button" className={styles.linkBtn} onClick={() => setAll(true)}>
                  Vybrat vše
                </button>
                <button type="button" className={styles.linkBtn} onClick={() => setAll(false)}>
                  Zrušit výběr
                </button>
              </div>
            </div>
            <div className={styles.list}>
              {candidates.length === 0 ? (
                <p className={styles.empty}>Zadaným filtrům neodpovídá žádný zaměstnanec.</p>
              ) : (
                candidates.map((e) => (
                  <label key={e.id} className={styles.listItem}>
                    <input type="checkbox" checked={selectedIds.has(e.id)} onChange={() => toggle(e.id)} />
                    <span className={styles.listName}>{employeeDisplayName(e)}</span>
                    <span className={styles.listMeta}>{e.currentJobTitle}</span>
                  </label>
                ))
              )}
            </div>

            {customKeys.length > 0 && (
              <div className={styles.varTable}>
                <p className={styles.varTableTitle}>Vlastní proměnné</p>
                <p className={styles.hint}>
                  Tyto hodnoty nejsou nikde uložené a použijí se stejné pro všechny vybrané zaměstnance.
                </p>
                <table>
                  <tbody>
                    {sharedKeys.map((key) => {
                      const def = variableDefs[key];
                      const type = def?.type ?? "text";
                      const raw = customRaw[key] ?? "";
                      const setRaw = (v: string) => setCustomRaw((prev) => ({ ...prev, [key]: v }));
                      return (
                        <tr key={key}>
                          <td className={styles.varKey}>
                            {def?.label || key}
                            {def?.optional && type !== "bool" && (
                              <span className={styles.hint}> (nepovinné)</span>
                            )}
                          </td>
                          <td>
                            {type === "bool" ? (
                              <label className={styles.boolRow}>
                                <input
                                  type="checkbox"
                                  checked={raw === "true"}
                                  onChange={(ev) => setRaw(ev.target.checked ? "true" : "")}
                                />
                                {raw === "true" ? "Ano" : "Ne"}
                              </label>
                            ) : type === "image" ? (
                              // Picked by name; the picture it stands for is
                              // substituted at generation. One choice for the
                              // whole batch, like every other shared slot here.
                              imageChoicesOf(def).length === 0 ? (
                                // No free-text fallback: any text at all would
                                // name no picture and print nothing, so a box to
                                // type it in would only mislead.
                                <span className={styles.hint}>
                                  Šablona k této proměnné nemá žádné obrázky – v
                                  dokumentech se nic nevypíše.
                                </span>
                              ) : (
                                <select
                                  className={styles.select}
                                  value={raw}
                                  onChange={(ev) => setRaw(ev.target.value)}
                                >
                                  <option value="">– vyberte –</option>
                                  {imageChoicesOf(def).map((o, i) => (
                                    <option key={`${o.label}-${i}`} value={o.label}>
                                      {o.label}
                                    </option>
                                  ))}
                                </select>
                              )
                            ) : type === "longtext" ? (
                              // Prose with line breaks; a single-line input would
                              // hide everything past the first line and swallow Enter.
                              <textarea
                                className={styles.input}
                                style={{ resize: "vertical", minHeight: 92, fontFamily: "inherit" }}
                                rows={5}
                                value={raw}
                                onChange={(ev) => setRaw(ev.target.value)}
                              />
                            ) : (
                              <input
                                className={styles.input}
                                type={type === "date" ? "date" : type === "number" ? "number" : "text"}
                                value={raw}
                                onChange={(ev) => setRaw(ev.target.value)}
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {/* Slots that cannot be shared: a condition is computed from
                        this employee's own data, a math slot from its formula, and
                        a fixed-variable default resolves to this employee's value.
                        Listed so it is clear they are handled, not forgotten. */}
                    {perEmployeeKeys.map((key) => (
                      <tr key={key}>
                        <td className={styles.varKey}>{variableDefs[key]?.label || key}</td>
                        <td className={styles.hint}>{autoFillNote(key)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {step === "running" && (
          <div className={styles.body}>
            <p>
              Generuji {progress.done} z {progress.total}…
            </p>
            <div className={styles.progressTrack}>
              <div
                className={styles.progressBar}
                style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
              />
            </div>
            <p className={styles.hint}>{progress.current}</p>
            <p className={styles.hint}>Nezavírejte prosím okno, dokud generování neskončí.</p>
          </div>
        )}

        {step === "done" && (
          <div className={styles.body}>
            <p>
              Vygenerováno a uloženo: <strong>{okCount}</strong> z {outcomes.length}.
            </p>
            {okCount > 0 && (
              <p className={styles.hint}>
                Dokumenty najdete u každého zaměstnance v sekci „Další dokumenty“. Sloučený dokument pro tisk
                se otevřel v nové záložce.
              </p>
            )}
            {runError && <div className={styles.error}>{runError}</div>}
            {failed.length > 0 && (
              <div className={styles.error}>
                <p>Nepodařilo se vygenerovat pro:</p>
                <ul className={styles.failList}>
                  {failed.map((f) => (
                    <li key={f.employeeId}>
                      {f.name} – {f.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className={styles.footer}>
          {step === "setup" && (
            <>
              <Button variant="secondary" onClick={onClose}>
                Zrušit
              </Button>
              <Button onClick={handleGenerate} disabled={!canGenerate || loadingTemplate}>
                {selectedIds.size > 0 ? `Generovat (${selectedIds.size})` : "Generovat"}
              </Button>
            </>
          )}
          {step === "done" && <Button onClick={onClose}>Zavřít</Button>}
        </div>
      </div>
    </div>
  );
}
