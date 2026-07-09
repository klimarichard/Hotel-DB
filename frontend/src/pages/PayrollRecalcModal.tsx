import { useState } from "react";
import Button from "@/components/Button";
import { employeeDisplayName } from "@/lib/employeeName";
import styles from "./PayrollPage.module.css";
import type { PayrollEntry, OverrideField } from "./PayrollPage";

interface Props {
  entry: PayrollEntry;
  onClose: () => void;
  /** Recalculate the given fields for this employee (discards their manual edit). */
  onConfirm: (fields: string[]) => Promise<void>;
}

// The columns the admin can selectively recalculate. `ov` is the override key on
// the entry (absent for Nemoc, which is its own sickLeaveHours field).
const RECALC_FIELDS: { key: string; label: string; ov?: OverrideField }[] = [
  { key: "totalHours", label: "Hodiny", ov: "totalHours" },
  { key: "reportHours", label: "Výkaz", ov: "reportHours" },
  { key: "vacationHours", label: "Dovolená", ov: "vacationHours" },
  { key: "sickLeaveHours", label: "Nemoc" },
  { key: "nightHours", label: "Noční", ov: "nightHours" },
  { key: "holidayHours", label: "Svátek", ov: "holidayHours" },
  { key: "weekendHours", label: "So+Ne", ov: "weekendHours" },
  { key: "extraPay", label: "Navíc", ov: "extraPay" },
  { key: "foodVouchers", label: "Stravenky", ov: "foodVouchers" },
];

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export default function PayrollRecalcModal({ entry, onClose, onConfirm }: Props) {
  // Default: everything ON.
  const [selected, setSelected] = useState<Record<string, boolean>>(
    () => Object.fromEntries(RECALC_FIELDS.map((f) => [f.key, true]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The current manual value on a field (so the admin sees what would be discarded).
  const editedValue = (f: { key: string; ov?: OverrideField }): number | null => {
    if (f.key === "sickLeaveHours") {
      const s = entry.sickLeaveHours ?? 0;
      return s > 0 ? s : null;
    }
    const ov = f.ov ? entry.overrides?.[f.ov] : undefined;
    return ov !== undefined ? ov : null;
  };

  const chosen = RECALC_FIELDS.filter((f) => selected[f.key]).map((f) => f.key);
  const allOn = chosen.length === RECALC_FIELDS.length;

  function toggle(key: string) {
    setSelected((prev) => ({ ...prev, [key]: !prev[key] }));
  }
  function setAll(value: boolean) {
    setSelected(Object.fromEntries(RECALC_FIELDS.map((f) => [f.key, value])));
  }

  async function handleConfirm() {
    if (chosen.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await onConfirm(chosen);
      onClose();
    } catch (e) {
      setError((e as Error).message ?? "Chyba při přepočtu.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <span className={styles.modalTitle}>Přepočítat – {employeeDisplayName(entry)}</span>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>
        <div className={styles.modalBody}>
          <p className={styles.recalcHint}>
            Vybrané složky se přepočítají načisto ze směnného plánu a ruční úpravy se zahodí.
            Nevybrané složky si ponechají svou ruční úpravu. (Nemoc se přepočtem vynuluje.)
          </p>
          <div className={styles.recalcToolbar}>
            <button
              type="button"
              className={styles.recalcSelectAll}
              onClick={() => setAll(!allOn)}
            >
              {allOn ? "Zrušit vše" : "Vybrat vše"}
            </button>
          </div>
          <div className={styles.recalcList}>
            {RECALC_FIELDS.map((f) => {
              const edited = editedValue(f);
              return (
                <label key={f.key} className={styles.recalcItem}>
                  <input
                    type="checkbox"
                    checked={!!selected[f.key]}
                    onChange={() => toggle(f.key)}
                  />
                  <span className={styles.recalcItemLabel}>{f.label}</span>
                  {edited !== null && (
                    <span className={styles.recalcEditedTag}>ručně: {fmt(edited)}</span>
                  )}
                </label>
              );
            })}
          </div>
          {error && <div className={styles.modalError}>{error}</div>}
        </div>
        <div className={styles.modalActions}>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Zrušit</Button>
          <Button variant="primary" onClick={handleConfirm} disabled={saving || chosen.length === 0}>
            {saving ? "Přepočítávám…" : `Přepočítat (${chosen.length})`}
          </Button>
        </div>
      </div>
    </div>
  );
}
