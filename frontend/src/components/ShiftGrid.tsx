import { useCallback, useMemo, useState } from "react";
import type { PlanDetail, PlanEmployee, ShiftDoc, ModShiftDoc } from "../pages/ShiftPlannerPage";
import { SECTION_LABELS, SECTIONS, type Section, getCzechHolidays, MOD_PERSONS } from "../lib/shiftConstants";
import ShiftCell from "./ShiftCell";
import ModCell from "./ModCell";
import styles from "./ShiftGrid.module.css";

interface Props {
  plan: PlanDetail;
  onCellSave: (employeeId: string, date: string, rawInput: string) => Promise<void>;
  onModSave: (date: string, code: string) => Promise<void>;
  onEditEmployee: (emp: PlanEmployee) => void;
  onDeleteEmployee: (emp: PlanEmployee) => void;
  canEditEmployees: boolean;
  readOnly: boolean;
}

const DAY_NAMES = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];

function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const d = new Date(year, month - 1, 1);
  while (d.getMonth() === month - 1) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isWeekend(d: Date): boolean {
  return d.getDay() === 0 || d.getDay() === 6;
}

export default function ShiftGrid({
  plan,
  onCellSave,
  onModSave,
  onEditEmployee,
  onDeleteEmployee,
  canEditEmployees,
  readOnly,
}: Props) {
  const days = useMemo(() => getDaysInMonth(plan.year, plan.month), [plan.year, plan.month]);

  const holidays = useMemo(() => getCzechHolidays(plan.year), [plan.year]);

  const shiftMap = useMemo(() => {
    const m = new Map<string, ShiftDoc>();
    for (const s of plan.shifts) m.set(s.id, s);
    return m;
  }, [plan.shifts]);

  const modShiftMap = useMemo(() => {
    const m = new Map<string, ModShiftDoc>();
    for (const s of plan.modShifts) m.set(s.date, s);
    return m;
  }, [plan.modShifts]);

  const employeeMonthHours = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of plan.shifts) {
      m.set(s.employeeId, (m.get(s.employeeId) ?? 0) + s.hoursComputed);
    }
    return m;
  }, [plan.shifts]);

  const sectionDayHours = useMemo(() => {
    const m = new Map<string, number>();
    for (const emp of plan.employees) {
      for (const shift of plan.shifts) {
        if (shift.employeeId === emp.employeeId) {
          const key = `${emp.section}_${shift.date}`;
          m.set(key, (m.get(key) ?? 0) + shift.hoursComputed);
        }
      }
    }
    return m;
  }, [plan.employees, plan.shifts]);

  const grouped = useMemo(() => {
    const map = new Map<Section, PlanEmployee[]>();
    for (const sec of SECTIONS) map.set(sec, []);
    for (const emp of plan.employees) {
      map.get(emp.section as Section)?.push(emp);
    }
    return map;
  }, [plan.employees]);

  // Flat ordered list of employees for arrow key navigation
  const flatEmployees = useMemo(() => {
    const list: PlanEmployee[] = [];
    for (const sec of SECTIONS) {
      const emps = grouped.get(sec) ?? [];
      list.push(...emps);
    }
    return list;
  }, [grouped]);

  const [focusedCell, setFocusedCell] = useState<{ row: number; col: number } | null>(null);
  const [focusedModCol, setFocusedModCol] = useState<number | null>(null);

  const handleNavigate = useCallback(
    (row: number, col: number, dir: "up" | "down" | "left" | "right") => {
      let newRow = row;
      let newCol = col;
      switch (dir) {
        case "up":    newRow = Math.max(0, row - 1); break;
        case "down":  newRow = Math.min(flatEmployees.length - 1, row + 1); break;
        case "left":  newCol = Math.max(0, col - 1); break;
        case "right": newCol = Math.min(days.length - 1, col + 1); break;
      }
      setFocusedCell({ row: newRow, col: newCol });
      setFocusedModCol(null);
    },
    [flatEmployees.length, days.length]
  );

  const handleModNavigate = useCallback(
    (col: number, dir: "up" | "down" | "left" | "right") => {
      if (dir === "left") {
        setFocusedModCol(Math.max(0, col - 1));
      } else if (dir === "right") {
        setFocusedModCol(Math.min(days.length - 1, col + 1));
      } else if (dir === "up") {
        // Move to last employee in vedoucí section
        const vedouci = grouped.get("vedoucí") ?? [];
        if (vedouci.length > 0) {
          const lastEmp = vedouci[vedouci.length - 1];
          const idx = flatEmployees.findIndex((e) => e.id === lastEmp.id);
          if (idx >= 0) {
            setFocusedCell({ row: idx, col });
            setFocusedModCol(null);
          }
        }
      } else if (dir === "down") {
        // Move to first employee in recepce section
        const recepce = grouped.get("recepce") ?? [];
        if (recepce.length > 0) {
          const firstEmp = recepce[0];
          const idx = flatEmployees.findIndex((e) => e.id === firstEmp.id);
          if (idx >= 0) {
            setFocusedCell({ row: idx, col });
            setFocusedModCol(null);
          }
        }
      }
    },
    [days.length, grouped, flatEmployees]
  );

  function dayClass(d: Date): string {
    const dateStr = formatDate(d);
    const parts: string[] = [];
    if (isWeekend(d)) parts.push(styles.weekend);
    else if (holidays.has(dateStr)) parts.push(styles.holiday);
    return parts.join(" ");
  }

  // Build a lookup from employeeId to flat row index
  const empRowIndex = useMemo(() => {
    const m = new Map<string, number>();
    flatEmployees.forEach((emp, i) => m.set(emp.employeeId, i));
    return m;
  }, [flatEmployees]);

  // Build a lookup from full name to MOD letter
  const modPersonByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const [letter, fullName] of Object.entries(MOD_PERSONS)) {
      m.set(fullName, letter);
    }
    return m;
  }, []);

  return (
    <div className={styles.wrapper}>
      <table className={styles.grid}>
        <colgroup>
          <col className={styles.nameCol} />
          {days.map((d) => (
            <col
              key={d.getDate()}
              className={isWeekend(d) ? styles.weekendCol : styles.dayCol}
            />
          ))}
          <col className={styles.totalCol} />
        </colgroup>
        <thead>
          <tr>
            <th className={styles.nameHeader}>Zaměstnanec</th>
            {days.map((d) => (
              <th
                key={d.getDate()}
                className={`${styles.dayHeader} ${dayClass(d)}`}
              >
                <div>{d.getDate()}</div>
                <div className={styles.dayName}>{DAY_NAMES[d.getDay()]}</div>
              </th>
            ))}
            <th className={styles.totalHeader}>Σ hod</th>
          </tr>
        </thead>
        <tbody>
          {SECTIONS.flatMap((section) => {
            const emps = grouped.get(section) ?? [];
            if (emps.length === 0) return [];

            const rows = [
              <tr key={`sec-${section}`} className={styles.sectionRow}>
                <td className={styles.sectionCell} colSpan={days.length + 2}>
                  {SECTION_LABELS[section]}
                </td>
              </tr>,
              ...emps.map((emp) => {
                const rowIdx = empRowIndex.get(emp.employeeId) ?? 0;
                const modLetter = modPersonByName.get(`${emp.firstName} ${emp.lastName}`);
                return (
                  <tr key={emp.id} className={styles.empRow}>
                    <td className={styles.nameCell}>
                      <span className={styles.empNameText}>
                        {emp.lastName} {emp.firstName}
                        {modLetter ? <span className={styles.modBadge}>{modLetter}</span> : null}
                      </span>
                      {canEditEmployees && (
                        <span className={styles.empActions}>
                          <button
                            className={styles.empActionBtn}
                            onClick={() => onEditEmployee(emp)}
                            title="Upravit"
                          >
                            ✎
                          </button>
                          <button
                            className={styles.empActionBtn}
                            onClick={() => onDeleteEmployee(emp)}
                            title="Odebrat"
                          >
                            ✕
                          </button>
                        </span>
                      )}
                    </td>
                    {days.map((d, colIdx) => {
                      const dateStr = formatDate(d);
                      const shiftDoc = shiftMap.get(`${emp.employeeId}_${dateStr}`);
                      const isFocused =
                        focusedCell !== null &&
                        focusedCell.row === rowIdx &&
                        focusedCell.col === colIdx;
                      return (
                        <td
                          key={dateStr}
                          className={`${styles.cell} ${dayClass(d)}`}
                        >
                          <ShiftCell
                            rawInput={shiftDoc?.rawInput ?? ""}
                            hoursComputed={shiftDoc?.hoursComputed ?? 0}
                            readOnly={readOnly}
                            onSave={(raw) => onCellSave(emp.employeeId, dateStr, raw)}
                            focused={isFocused}
                            onNavigate={(dir) => handleNavigate(rowIdx, colIdx, dir)}
                            onFocus={() => {
                              setFocusedCell({ row: rowIdx, col: colIdx });
                              setFocusedModCol(null);
                            }}
                          />
                        </td>
                      );
                    })}
                    <td className={styles.totalCell}>
                      {employeeMonthHours.get(emp.employeeId) ?? 0}
                    </td>
                  </tr>
                );
              }),
              <tr key={`footer-${section}`} className={styles.footerRow}>
                <td className={styles.footerLabel}>Σ {SECTION_LABELS[section]}</td>
                {days.map((d) => {
                  const dateStr = formatDate(d);
                  const hrs = sectionDayHours.get(`${section}_${dateStr}`) ?? 0;
                  return (
                    <td
                      key={dateStr}
                      className={`${styles.footerCell} ${dayClass(d)}`}
                    >
                      {hrs > 0 ? hrs : ""}
                    </td>
                  );
                })}
                <td className={styles.footerCell}></td>
              </tr>,
            ];

            // Insert MOD row after the vedoucí section
            if (section === "vedoucí") {
              rows.push(
                <tr key="mod-row" className={styles.modRow}>
                  <td className={styles.modLabel}>MOD</td>
                  {days.map((d, colIdx) => {
                    const dateStr = formatDate(d);
                    const modDoc = modShiftMap.get(dateStr);
                    return (
                      <td
                        key={dateStr}
                        className={`${styles.cell} ${dayClass(d)}`}
                      >
                        <ModCell
                          code={modDoc?.code ?? ""}
                          readOnly={readOnly}
                          onSave={(code) => onModSave(dateStr, code)}
                          focused={focusedModCol === colIdx}
                          onNavigate={(dir) => handleModNavigate(colIdx, dir)}
                          onFocus={() => {
                            setFocusedModCol(colIdx);
                            setFocusedCell(null);
                          }}
                        />
                      </td>
                    );
                  })}
                  <td className={styles.totalCell} />
                </tr>
              );
            }

            return rows;
          })}
        </tbody>
      </table>
    </div>
  );
}
