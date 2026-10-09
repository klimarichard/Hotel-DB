import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import Button from "@/components/Button";
import IconButton from "@/components/IconButton";
import modalStyles from "@/components/ConfirmModal.module.css";
import { MONTH_NAMES } from "@/lib/dateFormat";
import { fmtNum, signed } from "@/lib/payrollCheck/core";
import {
  buildSections,
  CheckInputError,
  fuzzyNames,
  runPayrollCheck,
  type AppCheckData,
  type CheckResult,
  type SectionCell,
  type VacationAction,
} from "@/lib/payrollCheck";
import styles from "./PayrollCheckModal.module.css";

/**
 * Kontrola mezd: upload the attendance XLS + the payslip PDF, compare them with
 * each other and with the (locked) period in the app. Everything is parsed in
 * the browser — the files are never uploaded, so closing the modal (which
 * unmounts it) discards them. Closes only via ✕ / Zavřít, never the backdrop.
 */
export default function PayrollCheckModal({
  periodId,
  year,
  month,
  onClose,
}: {
  periodId: string;
  year: number;
  month: number;
  onClose: () => void;
}) {
  const [xlsFile, setXlsFile] = useState<File | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { can } = useAuth();
  // The ledger PATCH enforces this server-side too; without it the rows still
  // show, just with no button.
  const canFixVacation = can("employees.vacationBalance.manage");
  // employeeId → state of its vacation correction.
  const [applied, setApplied] = useState<Record<string, "saving" | "done">>({});

  async function applyVacation(a: VacationAction) {
    setApplied((s) => ({ ...s, [a.employeeId]: "saving" }));
    setError(null);
    try {
      await api.patch(`/employees/${a.employeeId}/vacation-ledger/${a.year}`, { currentYearHours: a.currentYearHours });
      setApplied((s) => ({ ...s, [a.employeeId]: "done" }));
    } catch (err) {
      setApplied(({ [a.employeeId]: _drop, ...rest }) => rest);
      setError(`Nárok na dovolenou se nepodařilo uložit.${err instanceof Error && err.message ? ` (${err.message})` : ""}`);
    }
  }

  const sections = useMemo(() => (result ? buildSections(result) : []), [result]);
  const fuzzy = useMemo(() => (result ? fuzzyNames(result) : []), [result]);

  function addFiles(files: FileList | File[]) {
    setError(null);
    const rejected: string[] = [];
    for (const f of Array.from(files)) {
      const ext = f.name.toLowerCase().split(".").pop();
      if (ext === "xls" || ext === "xlsx") setXlsFile(f);
      else if (ext === "pdf") setPdfFile(f);
      else rejected.push(f.name);
    }
    if (rejected.length) setError(`Soubor ${rejected.join(", ")} není XLS ani PDF.`);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (result || running) return;
    addFiles(e.dataTransfer.files);
  }

  function onZoneKey(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      inputRef.current?.click();
    }
  }

  async function run() {
    if (!xlsFile || !pdfFile) return;
    setRunning(true);
    setError(null);
    try {
      const app = await api.get<AppCheckData>(`/payroll/periods/${periodId}/check-data`);
      setResult(await runPayrollCheck(xlsFile, pdfFile, app));
    } catch (err) {
      setError(
        err instanceof CheckInputError
          ? err.message
          : `Kontrolu se nepodařilo provést.${err instanceof Error && err.message ? ` (${err.message})` : ""}`,
      );
    } finally {
      setRunning(false);
    }
  }

  async function exportXlsx() {
    if (!result) return;
    setExporting(true);
    try {
      const { exportCheckXlsx } = await import("@/lib/payrollCheck/report");
      await exportCheckXlsx(result);
    } catch {
      setError("Export do Excelu se nezdařil.");
    } finally {
      setExporting(false);
    }
  }

  const fmtCell = (v: SectionCell, isDelta: boolean) => {
    if (v === null || v === "") return "";
    if (typeof v === "number") return isDelta ? signed(v) : fmtNum(v);
    return v;
  };

  return (
    <div className={modalStyles.overlay}>
      <div className={modalStyles.modal} style={{ width: result ? "min(1180px, 100vw - 2rem)" : "min(560px, 100vw - 2rem)" }}>
        <div className={modalStyles.header} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 className={modalStyles.title}>
            Kontrola mezd – {MONTH_NAMES[month - 1]} {year}
          </h2>
          <IconButton aria-label="Zavřít" onClick={onClose} disabled={running}>
            ✕
          </IconButton>
        </div>

        <div className={modalStyles.body}>
          {!result && (
            <>
              <div
                role="button"
                tabIndex={0}
                className={`${styles.dropzone} ${dragging ? styles.dropzoneActive : ""}`}
                onClick={() => !running && inputRef.current?.click()}
                onKeyDown={onZoneKey}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
              >
                <div>Přetáhněte sem podklady (XLS) a mzdové lístky (PDF)</div>
                <div className={styles.dropzoneHint}>nebo klikněte a vyberte soubory</div>
              </div>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept=".xls,.xlsx,.pdf,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                style={{ display: "none" }}
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <div className={styles.slots}>
                <div className={`${styles.slot} ${xlsFile ? styles.slotFilled : ""}`}>
                  <span className={styles.slotLabel}>XLS:</span>
                  <span className={styles.slotName} title={xlsFile?.name}>{xlsFile?.name ?? "nevybráno"}</span>
                </div>
                <div className={`${styles.slot} ${pdfFile ? styles.slotFilled : ""}`}>
                  <span className={styles.slotLabel}>PDF:</span>
                  <span className={styles.slotName} title={pdfFile?.name}>{pdfFile?.name ?? "nevybráno"}</span>
                </div>
              </div>
              <div className={styles.privacy}>Soubory se zpracují jen ve vašem prohlížeči a nikam se neukládají.</div>
            </>
          )}

          {error && <div className={styles.error}>{error}</div>}

          {result && (
            <>
              {result.warnings.map((w) => (
                <div key={w} className={styles.warning}>⚠ {w}</div>
              ))}
              <div className={styles.summary}>
                XLS: <strong>{result.employees.length}</strong> zaměstnanců · PDF: <strong>{result.slips.length}</strong> mzdových
                lístků · spárováno <strong>{result.pairs.length}</strong> · ve mzdách aplikace <strong>{result.appEntries.length}</strong>
              </div>
              {fuzzy.length > 0 && (
                <div className={styles.warning}>
                  Nepřesná shoda jmen, ověřte prosím párování (list Párování v exportu): {fuzzy.join(", ")}
                </div>
              )}
              {sections.map((s) => (
                <div key={s.key} className={styles.section}>
                  <h3 className={styles.sectionTitle}>
                    {s.title}
                    <span className={styles.count}>({s.rows.length})</span>
                  </h3>
                  {s.rows.length === 0 ? (
                    <div className={styles.ok}>Bez rozdílů</div>
                  ) : (
                    <div className={styles.tableWrap}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            {s.columns.map((c) => (
                              <th key={c}>{c}</th>
                            ))}
                            {canFixVacation && s.rows.some((r) => r.action) && <th />}
                          </tr>
                        </thead>
                        <tbody>
                          {s.rows.map((row, ri) => (
                            <tr key={ri} className={row.warn ? styles.warnRow : undefined}>
                              {row.cells.map((v, ci) => {
                                const isDelta = s.deltaCols.includes(ci);
                                const cls = [
                                  typeof v === "number" ? styles.num : "",
                                  isDelta && typeof v === "number" && v !== 0 ? styles.delta : "",
                                ].join(" ").trim();
                                return (
                                  <td key={ci} className={cls || undefined}>
                                    {fmtCell(v, isDelta)}
                                  </td>
                                );
                              })}
                              {canFixVacation && row.action && (
                                <td className={styles.actionCell}>
                                  {applied[row.action.employeeId] === "done" ? (
                                    <span className={styles.applied}>Převzato ✓</span>
                                  ) : (
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      disabled={applied[row.action.employeeId] === "saving"}
                                      onClick={() => applyVacation(row.action!)}
                                      title="Nastavit Letošní nárok v aplikaci tak, aby zůstatek odpovídal mzdovému lístku"
                                    >
                                      {applied[row.action.employeeId] === "saving" ? "Ukládám…" : "Převzít"}
                                    </Button>
                                  )}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>

        <div className={modalStyles.footer}>
          <Button variant="secondary" onClick={onClose} disabled={running}>
            Zavřít
          </Button>
          {result ? (
            <Button variant="primary" onClick={exportXlsx} disabled={exporting}>
              {exporting ? "Exportuji…" : "Exportovat"}
            </Button>
          ) : (
            <Button variant="primary" onClick={run} disabled={!xlsFile || !pdfFile || running}>
              {running ? "Kontroluji…" : "Provést kontrolu"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
