import { useMemo, useState } from "react";
import type { PlanEmployee } from "../pages/ShiftPlannerPage";
import { employeeSurnameFirst } from "../lib/employeeName";
import Button from "./Button";
import IconButton from "./IconButton";
import styles from "./AddEmployeeToPlanModal.module.css";

const csCollator = new Intl.Collator("cs", { sensitivity: "base", numeric: true });

interface Props {
  date: string; // YYYY-MM-DD
  code: string;
  hotel: string;
  planEmployees: PlanEmployee[];
  /** Shared terminal (e.g. Recepce): require picking who claims the shift. */
  sharedTerminal?: boolean;
  /** Pre-selected claimant (the on-shift employee), when unambiguously resolved. */
  defaultRequesterEmployeeId?: string;
  /** Resolves with the picked claimant employeeId on a shared terminal, else undefined. */
  onConfirm: (claimantEmployeeId?: string) => Promise<void> | void;
  onCancel: () => void;
}

export default function FreeClaimModal({ date, code, hotel, planEmployees, sharedTerminal = false, defaultRequesterEmployeeId, onConfirm, onCancel }: Props) {
  const [claimant, setClaimant] = useState(() =>
    defaultRequesterEmployeeId && planEmployees.some((e) => e.employeeId === defaultRequesterEmployeeId)
      ? defaultRequesterEmployeeId
      : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roster = useMemo(
    () =>
      [...planEmployees].sort(
        (a, b) =>
          csCollator.compare(a.lastName ?? "", b.lastName ?? "") ||
          csCollator.compare(a.firstName ?? "", b.firstName ?? ""),
      ),
    [planEmployees],
  );

  const [y, m, d] = date.split("-").map(Number);

  async function handleConfirm() {
    if (sharedTerminal && !claimant) {
      setError("Vyberte, kdo směnu přebírá.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onConfirm(sharedTerminal ? claimant : undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba při žádosti");
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Zažádat o volnou směnu</h2>
          <IconButton onClick={onCancel} aria-label="Zavřít">✕</IconButton>
        </div>
        <div className={styles.body}>
          <p style={{ fontSize: "0.875rem", margin: "0 0 0.75rem" }}>
            Volná směna <strong>{code}{hotel}</strong> dne {d}. {m}. {y}. Žádost posoudí FOM.
          </p>
          {sharedTerminal && (
            <>
              <label className={styles.label}>Kdo směnu přebírá</label>
              <select
                className={styles.input}
                value={claimant}
                disabled={saving}
                onChange={(e) => { setError(null); setClaimant(e.target.value); }}
              >
                <option value="">– vyberte zaměstnance –</option>
                {roster.map((e) => (
                  <option key={e.employeeId} value={e.employeeId}>
                    {employeeSurnameFirst(e)}
                  </option>
                ))}
              </select>
            </>
          )}
          {error && <p className={styles.error}>{error}</p>}
        </div>
        <div className={styles.footer}>
          <Button variant="secondary" onClick={onCancel} disabled={saving}>Zrušit</Button>
          <Button variant="primary" onClick={handleConfirm} disabled={saving || (sharedTerminal && !claimant)}>
            {saving ? "Odesílám…" : "Zažádat"}
          </Button>
        </div>
      </div>
    </div>
  );
}
