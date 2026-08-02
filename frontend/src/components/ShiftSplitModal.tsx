import { useMemo, useState } from "react";
import { FULL_SHIFT_HOURS } from "../lib/shiftConstants";
import Button from "./Button";
import IconButton from "./IconButton";
import shell from "./AddEmployeeToPlanModal.module.css";
import styles from "./ShiftSplitModal.module.css";

export interface SplitEntry {
  employeeId: string;
  hours: number;
}

interface Props {
  /** YYYY-MM-DD */
  date: string;
  /** One of the 8 counted desk tags, e.g. "DS". */
  type: string;
  /** Hours already credited by real shift cells – read-only context. */
  cellContributors: { employeeId: string; name: string; hours: number }[];
  /** Currently stored manual splits for this date+type. */
  entries: SplitEntry[];
  /** Assignable people (plan roster minus cellContributors). */
  employees: { employeeId: string; name: string; sortKey: string }[];
  canEdit: boolean;
  onSave: (entries: SplitEntry[]) => Promise<void>;
  onClose: () => void;
}

const CZ_WEEKDAYS = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];

/** "čtvrtek 23. 7. 2026" – built from local date parts, never via toISOString. */
function formatLongDateCZ(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d);
  return `${CZ_WEEKDAYS[dt.getDay()]} ${dt.getDate()}. ${dt.getMonth() + 1}. ${dt.getFullYear()}`;
}

/** Hours with a Czech decimal comma and no trailing zeros: 8 → "8", 7.5 → "7,5". */
function czHours(n: number): string {
  return String(Math.round(n * 100) / 100).replace(".", ",");
}

interface Row {
  employeeId: string;
  hoursText: string;
}

export default function ShiftSplitModal({
  date,
  type,
  cellContributors,
  entries,
  employees,
  canEdit,
  onSave,
  onClose,
}: Props) {
  const [rows, setRows] = useState<Row[]>(() =>
    entries.map((e) => ({ employeeId: e.employeeId, hoursText: czHours(e.hours) }))
  );
  // Nothing is flagged until the user actually edits something – no red box on open.
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const sortedEmployees = useMemo(
    () => [...employees].sort((a, b) => a.sortKey.localeCompare(b.sortKey, "cs")),
    [employees]
  );

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of employees) m.set(e.employeeId, e.name);
    for (const c of cellContributors) m.set(c.employeeId, c.name);
    return m;
  }, [employees, cellContributors]);

  const cellHours = cellContributors.reduce((s, c) => s + c.hours, 0);

  // Parse every row once; a row is valid when it names someone and carries a
  // positive hour count no larger than a whole shift (mirrors the server).
  const parsed = rows.map((r) => {
    const t = r.hoursText.trim().replace(",", ".");
    const n = Number(t);
    const hoursValid =
      /^\d+(\.\d+)?$/.test(t) && Number.isFinite(n) && n > 0 && n <= FULL_SHIFT_HOURS;
    return { employeeId: r.employeeId, hours: n, hoursValid };
  });

  const assignedHours = parsed.reduce((s, p) => s + (p.hoursValid ? p.hours : 0), 0);
  const totalHours = cellHours + assignedHours;
  // Over-covered days (two full cells of the same type) would otherwise read
  // "Nepřiřazeno: -12 h"; there is nothing left to assign, so show 0.
  const remaining = Math.max(0, FULL_SHIFT_HOURS - totalHours);

  const problem: string | null = (() => {
    if (parsed.some((p) => !p.employeeId)) return "U každého řádku vyberte zaměstnance.";
    if (parsed.some((p) => !p.hoursValid))
      return `Zadejte počet hodin větší než 0 a nejvýše ${FULL_SHIFT_HOURS}.`;
    const seen = new Set<string>();
    for (const p of parsed) {
      if (seen.has(p.employeeId)) return "Každý zaměstnanec může být uveden jen jednou.";
      seen.add(p.employeeId);
    }
    if (totalHours > FULL_SHIFT_HOURS + 1e-9)
      return `Součet hodin přesahuje ${FULL_SHIFT_HOURS} h o ${czHours(totalHours - FULL_SHIFT_HOURS)} h.`;
    return null;
  })();

  const usedIds = new Set(rows.map((r) => r.employeeId).filter(Boolean));
  const everyoneUsed = sortedEmployees.every((e) => usedIds.has(e.employeeId));
  const canAdd = canEdit && !saving && !everyoneUsed && remaining > 1e-9;

  function updateRow(index: number, patch: Partial<Row>) {
    setTouched(true);
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function removeRow(index: number) {
    setTouched(true);
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function addRow() {
    setTouched(true);
    setRows((prev) => [...prev, { employeeId: "", hoursText: "" }]);
  }

  async function handleSave() {
    setTouched(true);
    if (problem) return;
    setSaving(true);
    try {
      await onSave(parsed.map((p) => ({ employeeId: p.employeeId, hours: p.hours })));
      // The parent closes the modal on success and surfaces any server error.
    } catch {
      setSaving(false);
    }
  }

  return (
    <div className={shell.overlay}>
      <div className={shell.modal}>
        <div className={shell.header}>
          <div>
            <h2 className={shell.title}>Rozdělení směny</h2>
            <div className={styles.subtitle}>
              {type} – {formatLongDateCZ(date)}
            </div>
          </div>
          <IconButton onClick={onClose} aria-label="Zavřít">✕</IconButton>
        </div>

        <div className={shell.body}>
          <div className={styles.sectionLabel}>Z rozpisu</div>
          {cellContributors.length === 0 ? (
            <p className={styles.empty}>Tento typ směny nemá v rozpisu žádnou buňku.</p>
          ) : (
            <ul className={styles.list}>
              {cellContributors.map((c) => (
                <li key={c.employeeId} className={styles.staticRow}>
                  <span className={styles.rowName}>{c.name}</span>
                  <span className={styles.rowHours}>{czHours(c.hours)} h</span>
                </li>
              ))}
            </ul>
          )}

          <div className={styles.sectionLabel}>Ručně přiřazeno</div>
          {rows.length === 0 && (
            <p className={styles.empty}>Zatím nikdo – zbývající hodiny nejsou nikomu přiřazeny.</p>
          )}
          {!canEdit && rows.length > 0 && (
            <ul className={styles.list}>
              {rows.map((r, i) => (
                <li key={`${r.employeeId}-${i}`} className={styles.staticRow}>
                  <span className={styles.rowName}>{nameById.get(r.employeeId) ?? r.employeeId}</span>
                  <span className={styles.rowHours}>{r.hoursText} h</span>
                </li>
              ))}
            </ul>
          )}
          {canEdit &&
            rows.map((r, i) => {
              const otherIds = new Set(
                rows.filter((_, j) => j !== i).map((x) => x.employeeId).filter(Boolean)
              );
              return (
                <div key={i} className={styles.editRow}>
                  <select
                    className={styles.select}
                    value={r.employeeId}
                    disabled={saving}
                    onChange={(e) => updateRow(i, { employeeId: e.target.value })}
                  >
                    <option value="">– vyberte zaměstnance –</option>
                    {sortedEmployees
                      .filter((e) => e.employeeId === r.employeeId || !otherIds.has(e.employeeId))
                      .map((e) => (
                        <option key={e.employeeId} value={e.employeeId}>
                          {e.sortKey || e.name}
                        </option>
                      ))}
                  </select>
                  <input
                    className={styles.hoursInput}
                    type="text"
                    inputMode="decimal"
                    placeholder="h"
                    value={r.hoursText}
                    disabled={saving}
                    onChange={(e) => updateRow(i, { hoursText: e.target.value })}
                  />
                  <button
                    type="button"
                    className={styles.removeBtn}
                    aria-label="Odebrat řádek"
                    title="Odebrat řádek"
                    disabled={saving}
                    onClick={() => removeRow(i)}
                  >
                    ✕
                  </button>
                </div>
              );
            })}

          {canEdit && (
            <div className={styles.addRow}>
              <Button variant="secondary" size="sm" onClick={addRow} disabled={!canAdd}>
                Přidat zaměstnance
              </Button>
            </div>
          )}

          <div className={styles.summary}>
            <span>
              Odpracováno <strong>{czHours(totalHours)}</strong> z {FULL_SHIFT_HOURS} h
            </span>
            <span className={remaining > 1e-9 ? styles.remainingWarn : styles.remainingOk}>
              Nepřiřazeno: {czHours(remaining)} h
            </span>
          </div>

          {touched && problem && <p className={styles.error}>{problem}</p>}
        </div>

        <div className={shell.footer}>
          {canEdit ? (
            <>
              <Button variant="secondary" onClick={onClose} disabled={saving}>Zrušit</Button>
              <Button variant="primary" onClick={handleSave} disabled={saving || !!problem}>
                {saving ? "Ukládám…" : "Uložit"}
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={onClose}>Zavřít</Button>
          )}
        </div>
      </div>
    </div>
  );
}
