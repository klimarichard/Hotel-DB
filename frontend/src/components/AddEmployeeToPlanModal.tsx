import { useEffect, useState } from "react";
import { api } from "../lib/api";
import {
  SECTIONS,
  HOTEL_CODES,
  HOTEL_NAMES,
  type Section,
  type HotelCode,
  type ShiftType,
} from "../lib/shiftConstants";
import type { PlanEmployee } from "../pages/ShiftPlannerPage";
import styles from "./AddEmployeeToPlanModal.module.css";

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
}

interface Props {
  planId: string;
  onClose: () => void;
  onAdded: (emp: PlanEmployee) => void;
}

export default function AddEmployeeToPlanModal({ planId, onClose, onAdded }: Props) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loadingEmps, setLoadingEmps] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Employee | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [section, setSection] = useState<Section>("recepce");
  const [primaryShiftType, setPrimaryShiftType] = useState<ShiftType | "">("");
  const [primaryHotel, setPrimaryHotel] = useState<HotelCode | "">("");
  const [displayOrder, setDisplayOrder] = useState(100);
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Employee[]>("/employees")
      .then((data) => setEmployees(data))
      .catch(() => setEmployees([]))
      .finally(() => setLoadingEmps(false));
  }, []);

  const filtered = employees.filter((e) => {
    const full = `${e.lastName} ${e.firstName}`.toLowerCase();
    return full.includes(search.toLowerCase());
  });

  async function handleSubmit() {
    if (!selected) {
      setError("Vyberte zaměstnance");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await api.post<{ id: string }>(`/shifts/plans/${planId}/employees`, {
        employeeId: selected.id,
        firstName: selected.firstName,
        lastName: selected.lastName,
        section,
        primaryShiftType: primaryShiftType || null,
        primaryHotel: primaryHotel || null,
        displayOrder,
        active,
      });
      onAdded({
        id: result.id,
        employeeId: selected.id,
        firstName: selected.firstName,
        lastName: selected.lastName,
        section,
        primaryShiftType: (primaryShiftType || null) as "D" | "N" | "R" | null,
        primaryHotel: (primaryHotel || null) as string | null,
        displayOrder,
        active,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba při ukládání");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Přidat zaměstnance do plánu</h2>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div className={styles.body}>
          {/* Employee search */}
          <label className={styles.label}>Zaměstnanec</label>
          <div className={styles.searchWrapper}>
            <input
              className={styles.input}
              placeholder={loadingEmps ? "Načítám…" : "Hledat jméno…"}
              value={search}
              disabled={loadingEmps}
              onChange={(e) => {
                setSearch(e.target.value);
                setSelected(null);
                setShowDropdown(true);
              }}
              onFocus={() => setShowDropdown(true)}
            />
            {showDropdown && search && !selected && (
              <ul className={styles.dropdown}>
                {filtered.slice(0, 8).map((emp) => (
                  <li
                    key={emp.id}
                    className={styles.dropdownItem}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setSelected(emp);
                      setSearch(`${emp.lastName} ${emp.firstName}`);
                      setShowDropdown(false);
                    }}
                  >
                    {emp.lastName} {emp.firstName}
                  </li>
                ))}
                {filtered.length === 0 && (
                  <li className={styles.dropdownEmpty}>Žádný výsledek</li>
                )}
              </ul>
            )}
          </div>

          {/* Section */}
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

          {/* Primary shift type */}
          <label className={styles.label}>Primární typ směny</label>
          <select
            className={styles.select}
            value={primaryShiftType}
            onChange={(e) => setPrimaryShiftType(e.target.value as ShiftType | "")}
          >
            <option value="">— žádný —</option>
            <option value="D">D — denní (12h)</option>
            <option value="N">N — noční (12h)</option>
            <option value="R">R — vedoucí (8h)</option>
          </select>

          {/* Primary hotel */}
          <label className={styles.label}>Primární hotel</label>
          <select
            className={styles.select}
            value={primaryHotel}
            onChange={(e) => setPrimaryHotel(e.target.value as HotelCode | "")}
          >
            <option value="">— žádný —</option>
            {HOTEL_CODES.map((h) => (
              <option key={h} value={h}>
                {h} — {HOTEL_NAMES[h]}
              </option>
            ))}
          </select>

          {/* Display order */}
          <label className={styles.label}>Pořadí zobrazení</label>
          <input
            type="number"
            className={styles.input}
            value={displayOrder}
            onChange={(e) => setDisplayOrder(Number(e.target.value))}
            min={1}
          />

          {/* Active flag */}
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
          <button className={styles.cancelBtn} onClick={onClose}>
            Zrušit
          </button>
          <button
            className={styles.saveBtn}
            onClick={handleSubmit}
            disabled={saving || !selected}
          >
            {saving ? "Ukládám…" : "Přidat"}
          </button>
        </div>
      </div>
    </div>
  );
}
