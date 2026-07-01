import { useMemo, useState } from "react";
import { formatDateCZ } from "../lib/dateFormat";
import { employeeSurnameFirst } from "../lib/employeeName";
import type { PlanEmployee } from "../pages/ShiftPlannerPage";
import type { RequestedChange } from "../lib/shiftChangeRequest";
import Button from "./Button";
import IconButton from "./IconButton";
import shell from "./AddEmployeeToPlanModal.module.css";
import styles from "./ShiftChangeRequestModal.module.css";

// The 12 counted shift types, in the layout the user asked for.
const TYPE_ROWS: string[][] = [
  ["DA", "DS", "DQ", "DK"],
  ["NA", "NS", "NQ", "NK"],
  ["DPA", "DPQ", "NPA", "NPQ"],
];

const csCollator = new Intl.Collator("cs", { sensitivity: "base", numeric: true });

interface Props {
  employeeName: string;
  date: string;          // YYYY-MM-DD
  currentShift: string;  // current rawInput shown for context
  planEmployees: PlanEmployee[];
  requesterEmployeeId: string;
  onSubmit: (payload: { requestedChange: RequestedChange; reason: string }) => Promise<void>;
  onClose: () => void;
}

export default function ShiftChangeRequestModal({
  employeeName,
  date,
  currentShift,
  planEmployees,
  requesterEmployeeId,
  onSubmit,
  onClose,
}: Props) {
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<"menu" | "hours">("menu");
  const [hours, setHours] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Everyone in this month's plan, surname-sorted (cs), excluding the requester.
  const swapCandidates = useMemo(
    () =>
      planEmployees
        .filter((e) => e.employeeId !== requesterEmployeeId)
        .sort(
          (a, b) =>
            csCollator.compare(a.lastName ?? "", b.lastName ?? "") ||
            csCollator.compare(a.firstName ?? "", b.firstName ?? ""),
        ),
    [planEmployees, requesterEmployeeId],
  );

  async function submit(requestedChange: RequestedChange) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit({ requestedChange, reason: reason.trim() });
      // Parent closes the modal on success.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba při odesílání");
      setSaving(false);
    }
  }

  function confirmHours() {
    const v = hours.trim().replace(",", ".");
    const n = Number(v);
    if (!/^\d+(\.\d+)?$/.test(v) || !Number.isFinite(n) || n < 0 || n > 24) {
      setError("Zadejte počet hodin v rozsahu 0–24.");
      return;
    }
    submit({ action: "set-hours", value: v });
  }

  function requestSwap(employeeId: string) {
    if (!employeeId) return;
    const emp = swapCandidates.find((e) => e.employeeId === employeeId);
    submit({
      action: "swap",
      swapWithEmployeeId: employeeId,
      swapWithName: emp ? employeeSurnameFirst(emp) : undefined,
    });
  }

  return (
    <div className={shell.overlay}>
      <div className={shell.modal}>
        <div className={shell.header}>
          <h2 className={shell.title}>Žádost o změnu směny</h2>
          <IconButton onClick={onClose} aria-label="Zavřít">✕</IconButton>
        </div>
        <div className={shell.body}>
          <p className={styles.context}>
            <strong>{employeeName}</strong> — {formatDateCZ(date)} — aktuálně:{" "}
            <strong>{currentShift || "—"}</strong>
          </p>

          <div className={styles.sectionLabel}>Poznámka (nepovinné)</div>
          <textarea
            className={styles.reason}
            placeholder="Volitelně uveďte důvod žádosti…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />

          <div className={styles.divider} />

          {mode === "menu" ? (
            <>
              <div className={styles.sectionLabel}>Požadovaná změna na:</div>
              <div className={styles.grid}>
                {TYPE_ROWS.flat().map((label) => (
                  <button
                    key={label}
                    type="button"
                    className={styles.typeBtn}
                    disabled={saving}
                    onClick={() => submit({ action: "set-type", value: label })}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className={styles.actionRow}>
                <button
                  type="button"
                  className={styles.actionBtn}
                  disabled={saving}
                  onClick={() => { setError(null); setMode("hours"); }}
                >
                  zadat počet hodin
                </button>
                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.deleteBtn}`}
                  disabled={saving}
                  onClick={() => submit({ action: "delete" })}
                >
                  smazat
                </button>
              </div>

              <div className={styles.swapRow}>
                <div className={styles.sectionLabel}>vyměnit s:</div>
                <select
                  className={styles.select}
                  disabled={saving}
                  defaultValue=""
                  onChange={(e) => requestSwap(e.target.value)}
                >
                  <option value="" disabled>— vyberte zaměstnance —</option>
                  {swapCandidates.map((e) => (
                    <option key={e.employeeId} value={e.employeeId}>
                      {employeeSurnameFirst(e)}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <>
              <div className={styles.sectionLabel}>Zadejte počet hodin (0–24):</div>
              <div className={styles.hoursRow}>
                <input
                  className={styles.hoursInput}
                  type="text"
                  inputMode="decimal"
                  placeholder="např. 8"
                  value={hours}
                  autoFocus
                  disabled={saving}
                  onChange={(e) => setHours(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") confirmHours(); }}
                />
                <Button variant="secondary" size="sm" onClick={() => { setError(null); setMode("menu"); }} disabled={saving}>
                  Zpět
                </Button>
                <Button variant="primary" size="sm" onClick={confirmHours} disabled={saving}>
                  {saving ? "Odesílám…" : "Odeslat"}
                </Button>
              </div>
            </>
          )}

          {error && <p className={styles.error}>{error}</p>}
        </div>
        <div className={shell.footer}>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Zrušit</Button>
        </div>
      </div>
    </div>
  );
}
