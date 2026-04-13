import { useMemo } from "react";
import type { PlanDetail, PlanEmployee, ShiftDoc } from "../pages/ShiftPlannerPage";
import { SECTION_LABELS, SECTIONS, type Section } from "../lib/shiftConstants";
import ShiftCell from "./ShiftCell";
import styles from "./ShiftGrid.module.css";

interface Props {
  plan: PlanDetail;
  onCellSave: (employeeId: string, date: string, rawInput: string) => Promise<void>;
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
  return d.toISOString().slice(0, 10);
}

function isWeekend(d: Date): boolean {
  return d.getDay() === 0 || d.getDay() === 6;
}

export default function ShiftGrid({ plan, onCellSave, readOnly }: Props) {
  const days = useMemo(() => getDaysInMonth(plan.year, plan.month), [plan.year, plan.month]);

  const shiftMap = useMemo(() => {
    const m = new Map<string, ShiftDoc>();
    for (const s of plan.shifts) m.set(s.id, s);
    return m;
  }, [plan.shifts]);

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
                className={`${styles.dayHeader} ${isWeekend(d) ? styles.weekend : ""}`}
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
              ...emps.map((emp) => (
                <tr key={emp.id} className={styles.empRow}>
                  <td className={styles.nameCell}>
                    {emp.lastName} {emp.firstName}
                  </td>
                  {days.map((d) => {
                    const dateStr = formatDate(d);
                    const shiftDoc = shiftMap.get(`${emp.employeeId}_${dateStr}`);
                    return (
                      <td
                        key={dateStr}
                        className={`${styles.cell} ${isWeekend(d) ? styles.weekend : ""}`}
                      >
                        <ShiftCell
                          rawInput={shiftDoc?.rawInput ?? ""}
                          hoursComputed={shiftDoc?.hoursComputed ?? 0}
                          readOnly={readOnly}
                          onSave={(raw) => onCellSave(emp.employeeId, dateStr, raw)}
                        />
                      </td>
                    );
                  })}
                  <td className={styles.totalCell}>
                    {employeeMonthHours.get(emp.employeeId) ?? 0}
                  </td>
                </tr>
              )),
              <tr key={`footer-${section}`} className={styles.footerRow}>
                <td className={styles.footerLabel}>Σ {SECTION_LABELS[section]}</td>
                {days.map((d) => {
                  const dateStr = formatDate(d);
                  const hrs = sectionDayHours.get(`${section}_${dateStr}`) ?? 0;
                  return (
                    <td
                      key={dateStr}
                      className={`${styles.footerCell} ${isWeekend(d) ? styles.weekend : ""}`}
                    >
                      {hrs > 0 ? hrs : ""}
                    </td>
                  );
                })}
                <td className={styles.footerCell}></td>
              </tr>,
            ];
            return rows;
          })}
        </tbody>
      </table>
    </div>
  );
}
