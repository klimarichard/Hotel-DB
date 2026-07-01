import { useMemo, useState } from "react";
import { formatDateCZ } from "../lib/dateFormat";
import { employeeSurnameFirst } from "../lib/employeeName";
import { getCellColor, parseShiftExpression } from "../lib/shiftConstants";
import { useTheme } from "../context/ThemeContext";
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
  ["DPQ", "NPQ", "DPA", "NPA"],
];

const csCollator = new Intl.Collator("cs", { sensitivity: "base", numeric: true });

// The user picks ONE preset (or none), then presses "Odeslat žádost". When no
// preset is picked but the "Jiné" field has text, the request is a free-text
// "other" request (never auto-applied).
type Selection =
  | { kind: "none" }
  | { kind: "type"; value: string }
  | { kind: "hours" }
  | { kind: "delete" }
  | { kind: "swap"; employeeId: string };

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
  const [sel, setSel] = useState<Selection>({ kind: "none" });
  const [hours, setHours] = useState("");
  const [other, setOther] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { theme } = useTheme();
  const isDark = theme === "dark";

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

  // Turn the current selection into the submit payload, or null when it isn't a
  // valid, complete choice yet. No preset + "Jiné" text → free-text request; a
  // preset + "Jiné" text → that preset with the text kept as a note.
  function buildRequestedChange(): RequestedChange | null {
    if (sel.kind === "type") return { action: "set-type", value: sel.value };
    if (sel.kind === "delete") return { action: "delete" };
    if (sel.kind === "hours") {
      const v = hours.trim().replace(",", ".");
      const n = Number(v);
      if (!/^\d+(\.\d+)?$/.test(v) || !Number.isFinite(n) || n < 0 || n > 24) return null;
      return { action: "set-hours", value: v };
    }
    if (sel.kind === "swap") {
      const emp = swapCandidates.find((e) => e.employeeId === sel.employeeId);
      return {
        action: "swap",
        swapWithEmployeeId: sel.employeeId,
        swapWithName: emp ? employeeSurnameFirst(emp) : undefined,
      };
    }
    if (other.trim()) return { action: "other" };
    return null;
  }

  async function handleSubmit() {
    const rc = buildRequestedChange();
    if (!rc) {
      setError(
        sel.kind === "hours"
          ? "Zadejte počet hodin v rozsahu 0–24."
          : "Vyberte požadovanou změnu nebo vyplňte pole „Jiné“.",
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({ requestedChange: rc, reason: other.trim() });
      // Parent closes the modal on success.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba při odesílání");
      setSaving(false);
    }
  }

  const canSubmit = !saving && buildRequestedChange() !== null;

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

          <div className={styles.sectionLabel}>Požadovaná změna na:</div>
          <div className={styles.grid}>
            {TYPE_ROWS.flat().map((label) => {
              const active = sel.kind === "type" && sel.value === label;
              // Selected type shows its own shift-plan colour (matches the grid).
              const c = active ? getCellColor(parseShiftExpression(label), isDark) : null;
              return (
                <button
                  key={label}
                  type="button"
                  className={styles.typeBtn}
                  style={c ? { background: c.bg, color: c.text, borderColor: c.bg } : undefined}
                  disabled={saving}
                  onClick={() => {
                    setError(null);
                    setSel(active ? { kind: "none" } : { kind: "type", value: label });
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div className={styles.swapRow}>
            <div className={styles.sectionLabel}>vyměnit s:</div>
            <select
              className={styles.select}
              disabled={saving}
              value={sel.kind === "swap" ? sel.employeeId : ""}
              onChange={(e) => {
                setError(null);
                setSel(e.target.value ? { kind: "swap", employeeId: e.target.value } : { kind: "none" });
              }}
            >
              <option value="">— vyberte zaměstnance —</option>
              {swapCandidates.map((e) => (
                <option key={e.employeeId} value={e.employeeId}>
                  {employeeSurnameFirst(e)}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.actionRow}>
            <button
              type="button"
              className={`${styles.actionBtn} ${sel.kind === "hours" ? styles.active : ""}`}
              disabled={saving}
              onClick={() => {
                setError(null);
                setSel(sel.kind === "hours" ? { kind: "none" } : { kind: "hours" });
              }}
            >
              zadat počet hodin
            </button>
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.deleteBtn} ${sel.kind === "delete" ? styles.active : ""}`}
              disabled={saving}
              onClick={() => {
                setError(null);
                setSel(sel.kind === "delete" ? { kind: "none" } : { kind: "delete" });
              }}
            >
              smazat
            </button>
          </div>

          {sel.kind === "hours" && (
            <div className={styles.hoursRow} style={{ marginTop: 8 }}>
              <input
                className={styles.hoursInput}
                type="text"
                inputMode="decimal"
                placeholder="počet hodin (0–24), např. 8"
                value={hours}
                autoFocus
                disabled={saving}
                onChange={(e) => { setError(null); setHours(e.target.value); }}
                onKeyDown={(e) => { if (e.key === "Enter" && canSubmit) handleSubmit(); }}
              />
            </div>
          )}

          <div className={styles.divider} />

          <div className={styles.sectionLabel}>Jiné:</div>
          <textarea
            className={styles.reason}
            placeholder="Vlastní požadavek nebo poznámka…"
            value={other}
            disabled={saving}
            onChange={(e) => { setError(null); setOther(e.target.value); }}
          />

          {error && <p className={styles.error}>{error}</p>}
        </div>
        <div className={shell.footer}>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Zrušit</Button>
          <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit}>
            {saving ? "Odesílám…" : "Odeslat žádost"}
          </Button>
        </div>
      </div>
    </div>
  );
}
