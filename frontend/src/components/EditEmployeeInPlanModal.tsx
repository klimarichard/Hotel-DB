import { useState } from "react";
import { api } from "../lib/api";
import {
  SECTIONS,
  HOTEL_CODES,
  HOTEL_NAMES,
  type Section,
  type HotelCode,
} from "../lib/shiftConstants";
import type { PlanEmployee } from "../pages/ShiftPlannerPage";
import styles from "./AddEmployeeToPlanModal.module.css";

interface Props {
  planId: string;
  employee: PlanEmployee;
  onClose: () => void;
  onSaved: () => void;
}

export default function EditEmployeeInPlanModal({ planId, employee, onClose, onSaved }: Props) {
  const [section, setSection] = useState<Section>(employee.section as Section);
  const [primaryShiftType, setPrimaryShiftType] = useState(employee.primaryShiftType ?? "");
  const [primaryHotel, setPrimaryHotel] = useState(employee.primaryHotel ?? "");
  const [displayOrder, setDisplayOrder] = useState(employee.displayOrder);
  const [active, setActive] = useState(employee.active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    try {
      await api.put(`/shifts/plans/${planId}/employees/${employee.id}`, {
        section,
        primaryShiftType: primaryShiftType || null,
        primaryHotel: primaryHotel || null,
        displayOrder,
        active,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba při ukládání");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>
            Upravit: {employee.lastName} {employee.firstName}
          </h2>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div className={styles.body}>
          <label className={styles.label}>Sekce</label>
          <select
            className={styles.select}
            value={section}
            onChange={(e) => setSection(e.target.value as Section)}
          >
            {SECTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          <label className={styles.label}>Primární typ směny</label>
          <select
            className={styles.select}
            value={primaryShiftType}
            onChange={(e) => setPrimaryShiftType(e.target.value)}
          >
            <option value="">— žádný —</option>
            <option value="D">D — denní (12h)</option>
            <option value="N">N — noční (12h)</option>
            <option value="R">R — vedoucí (8h)</option>
            <option value="DP">DP — portýr denní (12h)</option>
            <option value="NP">NP — portýr noční (12h)</option>
          </select>

          <label className={styles.label}>Primární hotel</label>
          <select
            className={styles.select}
            value={primaryHotel}
            onChange={(e) => setPrimaryHotel(e.target.value)}
          >
            <option value="">— žádný —</option>
            {HOTEL_CODES.map((h) => (
              <option key={h} value={h}>
                {h} — {HOTEL_NAMES[h as HotelCode]}
              </option>
            ))}
          </select>

          <label className={styles.label}>Pořadí zobrazení</label>
          <input
            type="number"
            className={styles.input}
            value={displayOrder}
            onChange={(e) => setDisplayOrder(Number(e.target.value))}
            min={1}
          />

          <label className={styles.label}>Dostupnost</label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", color: "#374151", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            Aktivní zaměstnanec (počítat jako dostupného)
          </label>

          {error && <p className={styles.error}>{error}</p>}
        </div>
        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose}>Zrušit</button>
          <button
            className={styles.saveBtn}
            onClick={handleSubmit}
            disabled={saving}
          >
            {saving ? "Ukládám…" : "Uložit"}
          </button>
        </div>
      </div>
    </div>
  );
}
