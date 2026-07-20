import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as clock from "../lib/clock";
import type { PlanDetail, PlanEmployee, ShiftDoc, ModShiftDoc } from "../pages/ShiftPlannerPage";
import { SECTION_LABELS, SECTIONS, type Section, getCzechHolidays, parseShiftExpression, getCellColor, isNightShiftType, sortSectionEmployees, SHIFT_TYPE_TAGS, typeTagToCounterKey } from "../lib/shiftConstants";
import { modLettersByEmployeeId } from "../lib/modPersons";
import { employeeDisplayName } from "../lib/employeeName";
import { useTheme } from "../context/ThemeContext";
import ShiftCell from "./ShiftCell";
import ModCell from "./ModCell";
import styles from "./ShiftGrid.module.css";

// The per-type occupancy ("Přehled obsazení") rows == the taggable types (#29),
// so they share one source of truth in shiftConstants.
const COUNTER_ROWS = SHIFT_TYPE_TAGS;

interface Props {
  plan: PlanDetail;
  onCellSave: (employeeId: string, date: string, rawInput: string) => Promise<void>;
  /** #29: set/clear a numeric cell's shift-type tag. Undefined = tagging disabled. */
  onCellTagSave?: (employeeId: string, date: string, typeTag: string | null) => Promise<void>;
  onModSave: (date: string, code: string) => Promise<void>;
  onEditEmployee: (emp: PlanEmployee) => void;
  onDeleteEmployee: (emp: PlanEmployee) => void;
  canEditEmployees: boolean;
  canSeeInactiveFlag: boolean;
  readOnly: boolean;
  showCounterTable?: boolean;
  showModCounts?: boolean;
  onModPersonChange?: (employeeId: string, oldLetter: string | null, newLetter: string | null) => Promise<void>;
  onCellRequestChange?: (employeeId: string, date: string, currentRawInput: string) => void;
  /** Double-click an editable cell (OPEN plan) to toggle the X marker. */
  onCellDoubleClickX?: (employeeId: string, date: string) => void;
  /** Per-employee X usage + limit info for the inline badge; null = no limit (DPP/unknown).
   *  `editable` is true only when the employee has an approved vacation this month (the
   *  only case in which admin may raise the limit). `vacCount` = vacation-origin X days. */
  xInfoFor?: (emp: PlanEmployee) => { used: number; base: number; limit: number; vacCount: number; editable: boolean } | null;
  /** Save the per-employee absolute X limit for the month (admin/director). */
  onSetXAllowance?: (emp: PlanEmployee, limit: number) => Promise<void>;
  /** Show the Volné směny (free-shift) rows at the bottom (published plans). */
  showFreeShifts?: boolean;
  /** Days on which the optional DPA free-shift row is active. */
  freeShiftDpaDays?: string[];
  /** Employee double-clicks an uncovered free slot to claim it. */
  onClaimFreeShift?: (date: string, code: string, hotel: string) => void;
  /** Admin/director toggles whether a day has a DPA free row. */
  onToggleDpaDay?: (date: string, enabled: boolean) => void;
  /** Badge over the 1st-of-month cell: how the employee's PREVIOUS month ended.
   *  Negative = worked into the month end, positive = free days before it,
   *  "N/A" = unknown. Return null to render nothing (management rows, and every
   *  row when the plan is not closed). See prevMonthGapFor in ShiftPlannerPage. */
  prevMonthGapFor?: (emp: PlanEmployee) => string | null;
  alwaysReadOnlySections?: string[];
  currentEmployeeId?: string | null;
  /** Reports whether the grid's internal scroll is at the top. Used on mobile to
   *  collapse the page chrome (month nav + plan bar) for a full-screen grid. */
  onAtTopChange?: (atTop: boolean) => void;
}

/** Czech day count: 1 den, 2–4 dny, 5+ dní. */
function czDays(n: number): string {
  if (n === 1) return "1 den";
  if (n >= 2 && n <= 4) return `${n} dny`;
  return `${n} dní`;
}

/** Tooltip for the previous-month gap badge. */
function prevGapTitle(value: string): string {
  if (value === "N/A") return "nelze určit";
  const n = Number(value);
  if (n < 0) return `odpracováno ${czDays(-n)} v řadě do konce měsíce`;
  return `${czDays(n)} bez směny před 1. dnem měsíce`;
}

// Volné směny rows. DPQ/NPQ/NPA are standing daily requirements (auto:true);
// DPA appears only on admin-marked days (auto:false).
const FREE_SHIFT_ROWS: { label: string; code: string; hotel: string; auto: boolean }[] = [
  { label: "DPQ", code: "DP", hotel: "Q", auto: true },
  { label: "NPQ", code: "NP", hotel: "Q", auto: true },
  { label: "NPA", code: "NP", hotel: "A", auto: true },
  { label: "DPA", code: "DP", hotel: "A", auto: false },
];

const DAY_NAMES = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];
const ALL_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

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

/** The "active shift date" – today if it's 07:00 or later, yesterday if before 07:00. */
function currentShiftDate(): string {
  const now = clock.now();
  const d = now.getHours() < 7 ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1) : now;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ShiftGrid({
  plan,
  onCellSave,
  onCellTagSave,
  onModSave,
  onEditEmployee,
  onDeleteEmployee,
  canEditEmployees,
  canSeeInactiveFlag,
  readOnly,
  showCounterTable = false,
  showModCounts = false,
  onModPersonChange,
  onCellRequestChange,
  onCellDoubleClickX,
  xInfoFor,
  onSetXAllowance,
  showFreeShifts = false,
  freeShiftDpaDays,
  onClaimFreeShift,
  onToggleDpaDay,
  prevMonthGapFor,
  alwaysReadOnlySections = [],
  currentEmployeeId,
  onAtTopChange,
}: Props) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const days = useMemo(() => getDaysInMonth(plan.year, plan.month), [plan.year, plan.month]);

  const holidays = useMemo(() => getCzechHolidays(plan.year), [plan.year]);

  const todayShiftDate = currentShiftDate();

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

  // MOD shift counts per manager letter (admin/director only).
  // V+S = weekend OR public holiday (if both, counted once).
  // PD  = Mon–Fri that is NOT a public holiday.
  const modCountsByLetter = useMemo(() => {
    if (!showModCounts) return null;
    const counts = new Map<string, { pd: number; vs: number }>();
    for (const s of plan.modShifts) {
      const d = new Date(s.date + "T12:00:00");
      const isVS = isWeekend(d) || holidays.has(s.date);
      if (!counts.has(s.code)) counts.set(s.code, { pd: 0, vs: 0 });
      const c = counts.get(s.code)!;
      if (isVS) c.vs++; else c.pd++;
    }
    return counts;
  }, [showModCounts, plan.modShifts, holidays]);

  const employeeMonthShifts = useMemo(() => {
    const currentIds = new Set(plan.employees.map((e) => e.employeeId));
    const m = new Map<string, number>();
    for (const s of plan.shifts) {
      if (currentIds.has(s.employeeId) && s.hoursComputed > 6) {
        m.set(s.employeeId, (m.get(s.employeeId) ?? 0) + 1);
      }
    }
    return m;
  }, [plan.shifts, plan.employees]);

  const grouped = useMemo(() => {
    const map = new Map<Section, PlanEmployee[]>();
    for (const sec of SECTIONS) map.set(sec, []);
    for (const emp of plan.employees) {
      map.get(emp.section as Section)?.push(emp);
    }
    for (const sec of SECTIONS) {
      map.set(sec, sortSectionEmployees(sec, map.get(sec) ?? []));
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

  const shiftCounts = useMemo(() => {
    if (!showCounterTable) return null;
    const counts: Record<string, Record<string, number>> = {};
    const bump = (date: string, key: string) => {
      if (!counts[date]) counts[date] = {};
      counts[date][key] = (counts[date][key] ?? 0) + 1;
    };
    for (const shift of plan.shifts) {
      const parsed = parseShiftExpression(shift.rawInput);
      if (!parsed.isValid) continue;
      for (const seg of parsed.segments) {
        if (!seg.hotel) continue;
        bump(shift.date, `${seg.code}_${seg.hotel}`);
      }
      // #29: a numeric "worked hours" cell tagged with a type counts toward it.
      const tagKey = typeTagToCounterKey(shift.typeTag);
      if (tagKey) bump(shift.date, tagKey);
    }
    return counts;
  }, [showCounterTable, plan.shifts]);

  // Volné směny: per-date set of "code_hotel" slots covered by some employee.
  const freeShiftCoverage = useMemo(() => {
    const m = new Map<string, Set<string>>();
    if (!showFreeShifts) return m;
    for (const s of plan.shifts) {
      const parsed = parseShiftExpression(s.rawInput);
      if (!parsed.isValid) continue;
      for (const seg of parsed.segments) {
        if (!seg.hotel) continue;
        if (!m.has(s.date)) m.set(s.date, new Set());
        m.get(s.date)!.add(`${seg.code}_${seg.hotel}`);
      }
      // #29: a numeric "worked hours" cell tagged with a type also covers that
      // free-shift slot, so it stops showing as available to claim.
      const tagKey = typeTagToCounterKey(s.typeTag);
      if (tagKey) {
        if (!m.has(s.date)) m.set(s.date, new Set());
        m.get(s.date)!.add(tagKey);
      }
    }
    return m;
  }, [showFreeShifts, plan.shifts]);

  const dpaDaySet = useMemo(() => new Set(freeShiftDpaDays ?? []), [freeShiftDpaDays]);

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
    if (dateStr === todayShiftDate) parts.push(styles.today);
    else if (isWeekend(d)) parts.push(styles.weekend);
    else if (holidays.has(dateStr)) parts.push(styles.holiday);
    return parts.join(" ");
  }

  // Build a lookup from employeeId to flat row index
  const empRowIndex = useMemo(() => {
    const m = new Map<string, number>();
    flatEmployees.forEach((emp, i) => m.set(emp.employeeId, i));
    return m;
  }, [flatEmployees]);

  // employeeId → MOD letter, straight from the plan's modPersons map. No name
  // matching: the letter is keyed by employeeId (see lib/modPersons.ts).
  const effectiveLetterByEmployeeId = useMemo(
    () => modLettersByEmployeeId(plan.modPersons),
    [plan.modPersons]
  );

  // Letters already taken by some employee (for dropdown filtering)
  const takenLetterByLetter = useMemo(() => {
    const m = new Map<string, string>(); // letter → employeeId
    for (const [empId, letter] of effectiveLetterByEmployeeId.entries()) {
      m.set(letter, empId);
    }
    return m;
  }, [effectiveLetterByEmployeeId]);

  // Valid MOD codes are the letters actually assigned to managers (vedoucí) in
  // THIS plan – not a hardcoded list. Assigning a new letter to a manager via
  // the badge editor immediately makes it acceptable in the MOD row. Also build
  // a letter → name map so the MOD cell tooltip shows who the letter belongs to.
  const { modValidCodes, modLetterNames } = useMemo(() => {
    const codes: string[] = [];
    const names: Record<string, string> = {};
    for (const emp of plan.employees) {
      if (emp.section !== "vedoucí") continue;
      const letter = effectiveLetterByEmployeeId.get(emp.employeeId);
      if (letter && !names[letter]) {
        codes.push(letter);
        names[letter] = employeeDisplayName(emp);
      }
    }
    codes.sort();
    return { modValidCodes: codes, modLetterNames: names };
  }, [plan.employees, effectiveLetterByEmployeeId]);

  const [editingModEmployee, setEditingModEmployee] = useState<string | null>(null);
  const [editingXEmployee, setEditingXEmployee] = useState<string | null>(null);

  // Report the wrapper's vertical scroll position (at-top vs scrolled) so the
  // page can collapse its chrome on mobile. Hysteresis (>40 hide / <8 show)
  // avoids flapping near the boundary; we only fire on a state flip.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const atTopRef = useRef(true);
  const handleScroll = useCallback(() => {
    const el = wrapperRef.current;
    if (!el || !onAtTopChange) return;
    const st = el.scrollTop;
    if (atTopRef.current && st > 40) {
      atTopRef.current = false;
      onAtTopChange(false);
    } else if (!atTopRef.current && st < 8) {
      atTopRef.current = true;
      onAtTopChange(true);
    }
  }, [onAtTopChange]);
  // A fresh grid (remounted on membership change) always starts at the top.
  useEffect(() => {
    atTopRef.current = true;
    onAtTopChange?.(true);
  }, [onAtTopChange]);

  return (
    <div className={styles.wrapper} ref={wrapperRef} onScroll={handleScroll}>
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
            <th className={styles.totalHeader}>Směny</th>
          </tr>
        </thead>
        <tbody data-tour="shift-rows">
          {SECTIONS.flatMap((section) => {
            const emps = grouped.get(section) ?? [];
            if (emps.length === 0) return [];

            const rows = [
              <tr key={`sec-${section}`} className={styles.sectionRow}>
                <td className={styles.sectionCell}>{SECTION_LABELS[section]}</td>
                <td colSpan={days.length + 1} />
              </tr>,
              ...emps.map((emp, i) => {
                const rowIdx = empRowIndex.get(emp.employeeId) ?? 0;
                const modLetter = effectiveLetterByEmployeeId.get(emp.employeeId);
                const isEditingMod = editingModEmployee === emp.employeeId;
                const availableLetters = ALL_LETTERS.filter(
                  (l) => !takenLetterByLetter.has(l) || takenLetterByLetter.get(l) === emp.employeeId
                );
                // Thick divider above the first night employee in recepce/portýři.
                const showShiftDivider =
                  (section === "recepce" || section === "portýři") &&
                  i > 0 &&
                  isNightShiftType(emp.primaryShiftType) &&
                  !isNightShiftType(emps[i - 1].primaryShiftType);
                return (
                  <tr key={emp.id} className={`${styles.empRow}${showShiftDivider ? ` ${styles.shiftPeriodDivider}` : ""}${emp.employeeId === currentEmployeeId ? ` ${styles.currentEmpRow}` : ""}`}>
                    <td className={`${styles.nameCell}${emp.employeeId === currentEmployeeId ? ` ${styles.currentNameCell}` : ""}`}>
                      <div className={styles.nameCellInner}>
                        {/* Left: name line + MOD count line */}
                        <div className={styles.nameLines}>
                          <span className={styles.empNameText}>
                            {employeeDisplayName(emp)}
                            {canSeeInactiveFlag && !emp.active && (
                              <span className={styles.inactiveBadge} title="Neaktivní – nepočítá se jako dostupný">–</span>
                            )}
                          </span>
                          {showModCounts && modLetter && modCountsByLetter && (() => {
                            const c = modCountsByLetter.get(modLetter) ?? { pd: 0, vs: 0 };
                            const total = c.pd + c.vs;
                            return (
                              <span className={styles.modCountBadge}>
                                MOD: {total} ({c.pd} PD, {c.vs} V+S)
                              </span>
                            );
                          })()}
                          {/* X-limit badge: voluntary-X usage / month limit. Editable only
                              when the employee has an approved vacation this month. #34 */}
                          {xInfoFor && (() => {
                            const info = xInfoFor(emp);
                            if (!info) return null;
                            const over = info.used > info.limit;
                            const canEditLimit = info.editable && !!onSetXAllowance;
                            if (editingXEmployee === emp.employeeId && canEditLimit) {
                              return (
                                <span className={styles.xBadge}>
                                  X: {info.used} /{" "}
                                  <input
                                    type="number"
                                    className={styles.xBadgeInput}
                                    defaultValue={info.limit}
                                    min={0}
                                    max={31}
                                    autoFocus
                                    title="Nový limit X pro tento měsíc (kolik X smí napsat nad rámec dovolené) – Enter uložit, Esc zrušit"
                                    onFocus={(e) => e.target.select()}
                                    onBlur={() => setEditingXEmployee(null)}
                                    onKeyDown={async (e) => {
                                      if (e.key === "Escape") { setEditingXEmployee(null); return; }
                                      if (e.key === "Enter") {
                                        const v = Math.max(0, Math.min(31, Math.floor(Number(e.currentTarget.value) || 0)));
                                        setEditingXEmployee(null);
                                        if (v !== info.limit) await onSetXAllowance!(emp, v);
                                      }
                                    }}
                                  />
                                  <span className={styles.xBadgeHint}>({info.vacCount} dovolená)</span>
                                </span>
                              );
                            }
                            return (
                              <span
                                data-tour="shift-x-badge"
                                className={`${styles.xBadge}${over ? ` ${styles.xBadgeOver}` : ""}${canEditLimit ? ` ${styles.xBadgeEditable}` : ""}`}
                                onClick={canEditLimit ? () => setEditingXEmployee(emp.employeeId) : undefined}
                                title={canEditLimit
                                  ? `Kliknutím upravíte limit X (zaměstnanec má dovolenou: ${info.vacCount} X tento měsíc)`
                                  : undefined}
                              >
                                X: {info.used} / {info.limit}
                                {info.vacCount > 0 && (
                                  <span className={styles.xBadgeHint}>({info.vacCount} dovolená)</span>
                                )}
                                {canEditLimit && <span className={styles.xBadgeEdit}>✎</span>}
                              </span>
                            );
                          })()}
                        </div>
                        {/* Badge – vedoucí only */}
                        {section === "vedoucí" && !isEditingMod && modLetter && (
                          <span
                            className={`${styles.modBadge}${onModPersonChange ? ` ${styles.modBadgeEditable}` : ""}`}
                            onClick={onModPersonChange ? () => setEditingModEmployee(emp.employeeId) : undefined}
                            title={onModPersonChange ? "Kliknutím změníte přiřazení" : undefined}
                          >
                            {modLetter}
                          </span>
                        )}
                        {section === "vedoucí" && !isEditingMod && !modLetter && onModPersonChange && (
                          <span
                            className={`${styles.modBadge} ${styles.modBadgeEditable} ${styles.modBadgeEmpty}`}
                            onClick={() => setEditingModEmployee(emp.employeeId)}
                            title="Přiřadit MOD písmeno"
                          >
                            +
                          </span>
                        )}
                        {section === "vedoucí" && isEditingMod && onModPersonChange && (
                          <input
                            type="text"
                            className={styles.modBadgeInput}
                            defaultValue={modLetter ?? ""}
                            maxLength={1}
                            autoFocus
                            placeholder="?"
                            title={`Dostupná písmena: ${availableLetters.join(", ")} – Enter pro uložení, Esc pro zrušení`}
                            onFocus={(e) => e.target.select()}
                            onBlur={() => setEditingModEmployee(null)}
                            onKeyDown={async (e) => {
                              if (e.key === "Escape") {
                                setEditingModEmployee(null);
                                return;
                              }
                              if (e.key === "Enter") {
                                const val = e.currentTarget.value.toUpperCase().trim();
                                setEditingModEmployee(null);
                                if (val === (modLetter ?? "")) return;
                                const newLetter = val || null;
                                if (newLetter && !availableLetters.includes(newLetter)) return;
                                await onModPersonChange(emp.employeeId, modLetter ?? null, newLetter);
                              }
                            }}
                          />
                        )}
                        {/* Edit/delete actions – appear on hover, to the right of badge */}
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
                      </div>
                    </td>
                    {days.map((d, colIdx) => {
                      const dateStr = formatDate(d);
                      const shiftDoc = shiftMap.get(`${emp.employeeId}_${dateStr}`);
                      const isFocused =
                        focusedCell !== null &&
                        focusedCell.row === rowIdx &&
                        focusedCell.col === colIdx;
                      // Previous-month gap badge, 1st column only. Rendered in the
                      // <td> rather than inside ShiftCell: ShiftCell is
                      // overflow:hidden and already owns its top-right corner for
                      // the typeTag badge.
                      const prevGap = colIdx === 0 && prevMonthGapFor ? prevMonthGapFor(emp) : null;
                      return (
                        <td
                          key={dateStr}
                          className={`${styles.cell} ${dayClass(d)}`}
                        >
                          {prevGap !== null && (
                            <span
                              className={styles.prevGapBadge}
                              title={`Předchozí měsíc: ${prevGapTitle(prevGap)}`}
                            >
                              {prevGap}
                            </span>
                          )}
                          <ShiftCell
                            rawInput={shiftDoc?.rawInput ?? ""}
                            hoursComputed={shiftDoc?.hoursComputed ?? 0}
                            typeTag={shiftDoc?.typeTag ?? null}
                            onSaveTypeTag={
                              onCellTagSave && !alwaysReadOnlySections.includes(emp.section)
                                ? (tag) => onCellTagSave(emp.employeeId, dateStr, tag)
                                : undefined
                            }
                            readOnly={readOnly || alwaysReadOnlySections.includes(emp.section)}
                            onSave={(raw) => onCellSave(emp.employeeId, dateStr, raw)}
                            focused={isFocused}
                            onNavigate={(dir) => handleNavigate(rowIdx, colIdx, dir)}
                            onFocus={() => {
                              setFocusedCell({ row: rowIdx, col: colIdx });
                              setFocusedModCol(null);
                            }}
                            onRequestChange={
                              onCellRequestChange && !alwaysReadOnlySections.includes(emp.section)
                                ? () => onCellRequestChange(emp.employeeId, dateStr, shiftDoc?.rawInput ?? "")
                                : undefined
                            }
                            onDoubleClickX={
                              onCellDoubleClickX && !alwaysReadOnlySections.includes(emp.section)
                                ? () => onCellDoubleClickX(emp.employeeId, dateStr)
                                : undefined
                            }
                          />
                        </td>
                      );
                    })}
                    <td className={styles.totalCell}>
                      <strong>{employeeMonthShifts.get(emp.employeeId) ?? 0}</strong>
                    </td>
                  </tr>
                );
              }),
            ];

            // Insert MOD row after the vedoucí section
            if (section === "vedoucí") {
              rows.push(
                <tr key="mod-row" className={styles.modRow} data-tour="shift-mod-row">
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
                          validCodes={modValidCodes}
                          letterNames={modLetterNames}
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
        {shiftCounts && (
          <tbody data-tour="shift-counter">
              <tr className={styles.counterSeparatorRow}>
                <td className={styles.counterSeparatorCell}>Přehled obsazení</td>
                <td colSpan={days.length + 1} />
              </tr>
              {COUNTER_ROWS.map((row) => (
                <tr key={row.label} className={styles.counterRow}>
                  <td className={styles.counterLabelCell}>{row.label}</td>
                  {days.map((d) => {
                    const dateStr = formatDate(d);
                    const count = shiftCounts[dateStr]?.[`${row.code}_${row.hotel}`] ?? 0;
                    const cls =
                      count === 0 ? styles.counterCell0 :
                      count === 1 ? styles.counterCell1 :
                                   styles.counterCell2;
                    return (
                      <td key={dateStr} className={`${cls} ${dayClass(d)}`}>
                        {count}
                      </td>
                    );
                  })}
                  <td className={styles.footerCell} />
                </tr>
              ))}
          </tbody>
        )}
        {showFreeShifts && (
          <tbody data-tour="shift-free">
              <tr className={styles.freeSeparatorRow}>
                <td className={styles.freeSeparatorCell}>Volné směny</td>
                <td colSpan={days.length + 1} />
              </tr>
              {FREE_SHIFT_ROWS.map((row) => {
                // Match the colour the shift gets in the plan (per code+hotel, theme-aware).
                const chipColor = getCellColor(parseShiftExpression(`${row.code}${row.hotel}`), dark);
                return (
                <tr key={`free-${row.label}`} className={styles.freeRow}>
                  <td className={styles.freeLabelCell}>{row.label}</td>
                  {days.map((d) => {
                    const dateStr = formatDate(d);
                    const covered = freeShiftCoverage.get(dateStr)?.has(`${row.code}_${row.hotel}`) ?? false;
                    const applicable = row.auto || dpaDaySet.has(dateStr);
                    // DPA cells are clickable for admin/director to toggle the day on/off.
                    const cellTogglable = !row.auto && !!onToggleDpaDay;
                    let content: React.ReactNode = null;
                    if (!applicable) {
                      content = cellTogglable ? <span className={styles.freeDpaAdd}>+</span> : null;
                    } else if (covered) {
                      content = <span className={styles.freeCovered} title="Obsazeno">✓</span>;
                    } else {
                      content = (
                        <span
                          className={`${styles.freeChip}${onClaimFreeShift ? ` ${styles.freeChipClaimable}` : ""}`}
                          style={{ background: chipColor.bg, color: chipColor.text }}
                          title={onClaimFreeShift ? "Dvojklik – zažádat o volnou směnu" : "Volná (neobsazená) směna"}
                          onDoubleClick={onClaimFreeShift ? () => onClaimFreeShift(dateStr, row.code, row.hotel) : undefined}
                        >
                          {row.label}
                        </span>
                      );
                    }
                    return (
                      <td
                        key={dateStr}
                        className={`${styles.cell} ${styles.freeCell} ${dayClass(d)}${cellTogglable ? ` ${styles.freeDpaCell}` : ""}`}
                        onClick={cellTogglable ? () => onToggleDpaDay!(dateStr, !dpaDaySet.has(dateStr)) : undefined}
                        title={cellTogglable ? (dpaDaySet.has(dateStr) ? "Kliknutím zrušíte volnou DPA" : "Kliknutím přidáte volnou DPA") : undefined}
                      >
                        {content}
                      </td>
                    );
                  })}
                  <td className={styles.footerCell} />
                </tr>
                );
              })}
          </tbody>
        )}
      </table>
    </div>
  );
}
