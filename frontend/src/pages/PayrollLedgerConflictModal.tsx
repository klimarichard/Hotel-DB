import { useState } from "react";
import Button from "@/components/Button";
import IconButton from "@/components/IconButton";
import styles from "./PayrollLedgerConflictModal.module.css";

/**
 * Pre-lock guard for the vacation ledger.
 *
 * Locking a payroll period feeds every employee's vacation hours into their
 * vacation ledger for that month, blind-writing the cell even when a human
 * typed the value there by hand. That is deliberate (re-locking periods is how
 * a bad import gets repaired), but it silently destroys manual corrections.
 * This dialog surfaces the collisions first and lets the user decide per
 * employee: keep the hand-entered value, or let payroll overwrite it.
 *
 * The default is "keep" – the number was typed deliberately, and silent
 * overwriting is the very thing this dialog exists to prevent.
 */
export interface LedgerConflict {
  employeeId: string;
  firstName: string;
  lastName: string;
  /** What the ledger holds now (hand-entered). */
  manualHours: number;
  /** What the lock would write over it. */
  payrollHours: number;
}

interface Props {
  conflicts: LedgerConflict[];
  month: number;
  year: number;
  /** Proceed with the lock, preserving the manual value for these employeeIds. */
  onConfirm: (keepEmployeeIds: string[]) => void;
  /** Abort the lock entirely – nothing is written. */
  onCancel: () => void;
  saving?: boolean;
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export default function PayrollLedgerConflictModal({
  conflicts,
  month,
  year,
  onConfirm,
  onCancel,
  saving = false,
}: Props) {
  // employeeId → true = ponechat ručně zadanou hodnotu. Default: keep everything.
  const [keep, setKeep] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(conflicts.map((c) => [c.employeeId, true]))
  );

  const keepIds = conflicts.filter((c) => keep[c.employeeId]).map((c) => c.employeeId);
  const keepCount = keepIds.length;
  const overwriteCount = conflicts.length - keepCount;

  function setAll(value: boolean) {
    setKeep(Object.fromEntries(conflicts.map((c) => [c.employeeId, value])));
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.title}>
            Ručně upravená dovolená bude přepsána
            <span className={styles.period}>
              {month}/{year}
            </span>
          </span>
          <IconButton variant="close" aria-label="Zavřít" onClick={onCancel} disabled={saving}>
            ✕
          </IconButton>
        </div>

        <div className={styles.body}>
          <p className={styles.intro}>
            Uzamčením období se hodiny dovolené za {month}/{year} zapíší do evidence dovolené podle
            mzdových podkladů. U těchto zaměstnanců je v evidenci ručně zadaná hodnota, která se od
            mzdových podkladů liší. Vyberte u každého, která hodnota má zůstat.
          </p>

          <div className={styles.toolbar}>
            <span className={styles.toolbarLabel}>Hromadně:</span>
            <button
              type="button"
              className={styles.bulkBtn}
              onClick={() => setAll(true)}
              disabled={saving}
            >
              Ponechat vše
            </button>
            <button
              type="button"
              className={styles.bulkBtn}
              onClick={() => setAll(false)}
              disabled={saving}
            >
              Přepsat vše
            </button>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Zaměstnanec</th>
                  <th className={styles.numCol}>Ručně zadáno</th>
                  <th className={styles.numCol}>Ze mzdy</th>
                  <th>Co se má stát</th>
                </tr>
              </thead>
              <tbody>
                {conflicts.map((c) => {
                  const isKeep = !!keep[c.employeeId];
                  return (
                    <tr key={c.employeeId}>
                      <td className={styles.name}>
                        {c.lastName} {c.firstName}
                      </td>
                      <td className={styles.numCol}>{fmt(c.manualHours)} h</td>
                      <td className={styles.numCol}>{fmt(c.payrollHours)} h</td>
                      <td>
                        <span className={styles.choice}>
                          <button
                            type="button"
                            className={`${styles.choiceBtn} ${isKeep ? styles.choiceActiveKeep : ""}`}
                            aria-pressed={isKeep}
                            disabled={saving}
                            onClick={() => setKeep((p) => ({ ...p, [c.employeeId]: true }))}
                          >
                            Ponechat ručně zadanou
                          </button>
                          <button
                            type="button"
                            className={`${styles.choiceBtn} ${!isKeep ? styles.choiceActiveOverwrite : ""}`}
                            aria-pressed={!isKeep}
                            disabled={saving}
                            onClick={() => setKeep((p) => ({ ...p, [c.employeeId]: false }))}
                          >
                            Přepsat ze mzdy
                          </button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className={styles.summary}>
            Ponechat ručně zadanou: <strong>{keepCount}</strong> · Přepsat ze mzdy:{" "}
            <strong>{overwriteCount}</strong>
          </div>
        </div>

        <div className={styles.actions}>
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            Zrušit
          </Button>
          <Button variant="primary" onClick={() => onConfirm(keepIds)} disabled={saving}>
            {saving ? "Uzamykám…" : "Uzamknout období"}
          </Button>
        </div>
      </div>
    </div>
  );
}
