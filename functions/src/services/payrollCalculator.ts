/**
 * Payroll calculation engine — replicates MZDY.xlsx logic.
 *
 * Key rules (derived from MZDY.xlsx formulas):
 *  - Base hours = (Mon–Fri days in month) × 8  (state holidays on workdays are INCLUDED)
 *  - totalHours and weekendHours are CEIL'd before any downstream calculation
 *  - Night hours per night segment = 8 (= 12h × 2/3, matching Excel formula (hours/3)*2)
 *  - Max night hours = FLOOR(baseHours/12) × 8
 *  - Vacation (HPP) = baseHours − reportHours
 *  - Vacation (PPP) = MAX(0, baseHours/2 − reportHours)
 *  - Extra hours = MAX(0, totalHours − baseHours)
 *  - NAVÍC (extraPay, raw net) = hourlyRate × extraHours  (or 0 if no hourlyRate).
 *      Display rounding (gross-up + ceil to nearest 100) lives in the UI's formatNavic only.
 *  - Food vouchers = workingDays × foodVoucherRate
 *  - DPP: only totalHours (= dppHours) — all other columns null
 *  - Vedoucí (managers): reportHours += countMonFriHolidays × 8 (holiday credit)
 *  - Cascades: Výkaz override → Dovolená; Nemoc → Dovolená → Výkaz → NAVÍC; NAVÍC → SVÁTEK
 */

import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { randomUUID } from "crypto";

const db = () => admin.firestore();

// ─── Czech public holidays ───────────────────────────────────────────────────
// Mirrored from frontend/src/lib/shiftConstants.ts — keep in sync manually.

function computeEasterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function getCzechHolidays(year: number): Set<string> {
  const fixed: [number, number][] = [
    [1, 1], [5, 1], [5, 8], [7, 5], [7, 6],
    [9, 28], [10, 28], [11, 17], [12, 24], [12, 25], [12, 26],
  ];
  const holidays = new Set<string>();
  for (const [m, d] of fixed) {
    holidays.add(`${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  const easter = computeEasterSunday(year);
  const goodFriday = new Date(easter); goodFriday.setDate(goodFriday.getDate() - 2);
  const easterMonday = new Date(easter); easterMonday.setDate(easterMonday.getDate() + 1);
  holidays.add(isoDate(goodFriday));
  holidays.add(isoDate(easterMonday));
  return holidays;
}

// ─── Base hours calculation ───────────────────────────────────────────────────

/** Count Mon–Fri days in the given month × 8 (state holidays on workdays included). */
export function getBaseHours(year: number, month: number): number {
  let workdays = 0;
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month - 1, d).getDay(); // 0=Sun, 6=Sat
    if (dow !== 0 && dow !== 6) workdays++;
  }
  return workdays * 8;
}

/** Count Mon–Fri days in [startDay, endDay] (inclusive) of the given month. */
function countMonFriDaysInRange(year: number, month: number, startDay: number, endDay: number): number {
  let n = 0;
  for (let d = startDay; d <= endDay; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}

interface ChangeLite {
  changeKind?: string;
  value?: string;
}

interface EmploymentRowLite {
  changeType?: string;
  startDate?: string;
  endDate?: string | null;
  contractType?: string;
  jobTitle?: string;
  salary?: number | null;
  hourlyRate?: number | null;
  changes?: ChangeLite[];
}

interface SessionLite {
  nastup: EmploymentRowLite;
  dodatky: EmploymentRowLite[];
  ukonceni: EmploymentRowLite | null;
  start: string;        // Nástup startDate
  end: string | null;   // effective end: Ukončení startDate / "délka smlouvy" / Nástup endDate
}

/**
 * Map an úvazek-change free-text value (e.g. "poloviční pracovní úvazek…") to
 * the HPP/PPP contract-type code. Mirrors uvazekToContractType in
 * frontend/src/lib/employmentSessions.ts — keep in sync.
 */
function uvazekToContractType(value: string): "HPP" | "PPP" | null {
  const v = value.toLowerCase();
  if (v.includes("polovič") || v.includes("zkrácen") || v.includes("částečn")) return "PPP";
  if (v.includes("plný") || v.includes("plny")) return "HPP";
  return null;
}

/**
 * Group employment rows into sessions — Nástup opens one, "změna smlouvy" rows
 * append, "ukončení" closes it. Mirrors groupBySession in
 * frontend/src/lib/employmentSessions.ts. A session's effective end is the
 * Ukončení startDate, else a "délka smlouvy" Dodatek value, else the Nástup
 * endDate (both ends inclusive).
 */
function buildSessions(rows: EmploymentRowLite[]): SessionLite[] {
  const sessions: SessionLite[] = [];
  let cur: { nastup: EmploymentRowLite; dodatky: EmploymentRowLite[]; ukonceni: EmploymentRowLite | null } | null = null;
  const flush = () => {
    if (!cur || !cur.nastup.startDate) { cur = null; return; }
    let end = cur.nastup.endDate ?? null;
    for (const dod of cur.dodatky) {
      for (const ch of dod.changes ?? []) {
        if (ch.changeKind === "délka smlouvy" && ch.value) end = ch.value;
      }
    }
    if (cur.ukonceni && cur.ukonceni.startDate) end = cur.ukonceni.startDate;
    sessions.push({ nastup: cur.nastup, dodatky: cur.dodatky, ukonceni: cur.ukonceni, start: cur.nastup.startDate, end });
    cur = null;
  };
  const sorted = [...rows].sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""));
  for (const r of sorted) {
    if (r.changeType === "nástup") { flush(); cur = { nastup: r, dodatky: [], ukonceni: null }; }
    else if (r.changeType === "změna smlouvy" && cur) cur.dodatky.push(r);
    else if (r.changeType === "ukončení" && cur) cur.ukonceni = r;
  }
  flush();
  return sessions;
}

function monthBounds(year: number, month: number): { daysInMonth: number; monthStart: string; monthEnd: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const daysInMonth = new Date(year, month, 0).getDate();
  return {
    daysInMonth,
    monthStart: `${year}-${pad(month)}-01`,
    monthEnd: `${year}-${pad(month)}-${pad(daysInMonth)}`,
  };
}

/** The latest session overlapping the given month, or null when none does. */
function relevantSessionForMonth(sessions: SessionLite[], year: number, month: number): SessionLite | null {
  const { monthStart, monthEnd } = monthBounds(year, month);
  let relevant: SessionLite | null = null;
  for (const s of sessions) {
    if (s.start <= monthEnd && (s.end == null || s.end >= monthStart)) relevant = s;
  }
  return relevant;
}

/**
 * Prorate base hours for an employee who started or was terminated mid-month.
 * Mirrors the session model in frontend/src/lib/employmentSessions.ts: a session
 * runs from its Nástup startDate to its effective end. Both ends are inclusive
 * (the employee works on their first and last day).
 *
 * Returns the prorated base (8 × Mon–Fri days, weekday holidays included, within
 * the employed span), or `null` when the employee was employed the WHOLE month
 * (caller then uses the full-month base), or `0` if not employed that month.
 * Pure + exported for unit testing.
 */
export function proratedBaseFromRows(rows: EmploymentRowLite[], year: number, month: number): number | null {
  const relevant = relevantSessionForMonth(buildSessions(rows), year, month);
  if (!relevant) return 0;
  const { daysInMonth, monthStart, monthEnd } = monthBounds(year, month);
  const startDay = relevant.start > monthStart ? Number(relevant.start.slice(8, 10)) : 1;
  const endDay = (relevant.end != null && relevant.end < monthEnd) ? Number(relevant.end.slice(8, 10)) : daysInMonth;
  if (endDay < startDay) return 0;
  if (startDay === 1 && endDay === daysInMonth) return null; // full month → use standard base
  return countMonFriDaysInRange(year, month, startDay, endDay) * 8;
}

/**
 * Resolve effective compensation for the payroll month by folding the relevant
 * session's Nástup row + applicable Dodatek `changes[]`, mirroring
 * computeEffectiveState in frontend/src/lib/employmentSessions.ts.
 *
 * This is the NAVÍC fix: the old getActiveEmployment read salary/hourlyRate
 * straight off the most-recent ACTIVE employment row, which for an employee
 * with a Dodatek is the "změna smlouvy" row. Those rows store the amendment
 * inside changes[] and carry no salary/hourlyRate of their own, so both came
 * back null and extraPay (= hourlyRate × extraHours) collapsed to 0. Folding
 * the session keeps the Nástup's hourlyRate and applies the mzda amendment.
 * Pure + exported for unit testing.
 */
export function effectiveCompFromRows(
  rows: EmploymentRowLite[],
  year: number,
  month: number
): { salary: number | null; hourlyRate: number | null; contractType: string; jobTitle: string } | null {
  const relevant = relevantSessionForMonth(buildSessions(rows), year, month);
  if (!relevant) return null;
  const { monthEnd } = monthBounds(year, month);

  let salary: number | null = null;
  let hourlyRate: number | null = null;
  let contractType = "";
  let jobTitle = "";

  // Nástup first, then Dodatky whose validity (startDate) has arrived by the
  // month's end. A future-dated Dodatek must not change comp until its day.
  const applicable = [relevant.nastup, ...relevant.dodatky.filter((d) => (d.startDate ?? "") <= monthEnd)];
  for (const row of applicable) {
    if (row.salary != null) salary = row.salary;
    if (row.hourlyRate != null) hourlyRate = row.hourlyRate;
    if (row.contractType) contractType = row.contractType;
    if (row.jobTitle) jobTitle = row.jobTitle;
    for (const ch of row.changes ?? []) {
      if (ch.changeKind === "mzda" && ch.value) {
        const n = Number(ch.value);
        if (Number.isFinite(n)) salary = n;
      } else if (ch.changeKind === "pracovní pozice" && ch.value) {
        jobTitle = ch.value;
      } else if (ch.changeKind === "úvazek" && ch.value) {
        const m = uvazekToContractType(ch.value);
        if (m) contractType = m;
      }
    }
  }
  return { salary, hourlyRate, contractType, jobTitle };
}

/**
 * Auto-generated payroll notes for a mid-month start/termination, matched to the
 * proration window: a "Nástup" note when the session begins after the 1st, an
 * "Ukončení" note when it ends before the last day. Returns note texts only —
 * the orchestrator wraps them into note docs. These are month-specific
 * (carryForward is always false). Pure + exported for unit testing.
 */
export function autoNotesFromRows(
  rows: EmploymentRowLite[],
  year: number,
  month: number
): Array<{ kind: "nastup" | "ukonceni"; text: string }> {
  const relevant = relevantSessionForMonth(buildSessions(rows), year, month);
  if (!relevant) return [];
  const { monthStart, monthEnd } = monthBounds(year, month);
  const fmt = (iso: string) => {
    const p = iso.split("-");
    return p.length === 3 ? `${p[2]}. ${p[1]}. ${p[0]}` : iso; // DD. MM. YYYY — app convention
  };
  const notes: Array<{ kind: "nastup" | "ukonceni"; text: string }> = [];
  if (relevant.start > monthStart) {
    notes.push({ kind: "nastup", text: `Nástup ${fmt(relevant.start)}` });
  }
  if (relevant.end != null && relevant.end < monthEnd) {
    notes.push({ kind: "ukonceni", text: `Ukončení ${fmt(relevant.end)}` });
  }
  return notes;
}

/** Count holidays in the given month that fall on Mon–Fri (used for manager holiday credit). */
function countMonFriHolidays(year: number, month: number, holidays: Set<string>): number {
  const prefix = `${year}-${String(month).padStart(2, "0")}-`;
  let count = 0;
  for (const h of holidays) {
    if (!h.startsWith(prefix)) continue;
    const dow = new Date(h + "T00:00:00").getDay();
    if (dow >= 1 && dow <= 5) count++;
  }
  return count;
}

// ─── Shift classification ─────────────────────────────────────────────────────

/** Night segment codes: each contributes 8 night hours (12h × 2/3). */
function isNightCode(code: string): boolean {
  return code === "N" || code === "NP" || code === "ZN";
}

function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr + "T00:00:00");
  const dow = d.getDay();
  return dow === 0 || dow === 6;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ShiftDoc {
  employeeId: string;
  date: string;
  rawInput: string;
  segments: { code: string; hotel: string | null; hours: number }[];
  hoursComputed: number;
  isDouble: boolean;
  status: string;
}

export interface EmployeeEntry {
  employeeId: string;
  firstName: string;
  lastName: string;
  displayName: string;
  contractType: "HPP" | "PPP" | "DPP" | string;
  salary: number | null;
  hourlyRate: number | null;
  jobTitle: string;
  section: string;
  sickLeaveHours: number;
  baseHours: number; // effective norm used in the calc (override ?? prorated/full)
  baseHoursNorm: number; // prorated/full-month norm BEFORE any per-employee override
  // calculated:
  totalHours: number;
  reportHours: number;
  vacationHours: number;
  nightHours: number;
  holidayHours: number;
  weekendHours: number;
  extraHours: number;
  extraPay: number;
  workingDays: number;
  foodVouchers: number;
  dppAmount: number | null;   // CZK: totalHours × hourlyRate (DPP only)
  // manual overrides: fieldName -> overridden value (preserves computed value separately)
  overrides: Record<string, number>;
  // system-cascade overrides: always recomputed, never manually set
  autoOverrides: Record<string, number>;
  updatedAt: FieldValue;
}

// ─── Core calculation ─────────────────────────────────────────────────────────

export function calculateEntry(
  employee: {
    employeeId: string;
    firstName: string;
    lastName: string;
    displayName?: string;
    contractType: string;
    salary: number | null;
    hourlyRate: number | null;
    jobTitle: string;
    section: string;
    sickLeaveHours?: number;
    overrides?: Record<string, number>;
  },
  shifts: ShiftDoc[],
  holidays: Set<string>,
  baseHours: number,
  foodVoucherRate: number,
  year: number,
  month: number
): EmployeeEntry {
  const myShifts = shifts.filter((s) => s.employeeId === employee.employeeId);
  const isDpp = employee.contractType === "DPP";

  let totalHours = 0;
  let nightHours = 0;
  let holidayHours = 0;
  let weekendHours = 0;
  let workingDays = 0;

  for (const shift of myShifts) {
    if (shift.status === "unassigned") continue;
    const h = shift.hoursComputed;

    if (shift.status === "assigned" && h > 0) {
      totalHours += h;
      // Food vouchers: only days worked more than 6 hours (HO at 6h does NOT count)
      if (h > 6) workingDays++;
      if (isWeekend(shift.date)) weekendHours += h;
      if (holidays.has(shift.date)) holidayHours += h;
      // Night hours: 8h per night segment (each 12h night shift → 8 night hours)
      for (const seg of shift.segments) {
        if (isNightCode(seg.code)) nightHours += 8;
      }
    }
    // X (day_off) shifts: hours = 0, don't count toward anything
  }

  // Round up fractional hours before all downstream calculations
  totalHours = Math.ceil(totalHours);
  weekendHours = Math.ceil(weekendHours);

  // Effective base — a per-employee override (overrides.baseHours, set in the
  // payroll balance dialog) wins over the prorated / full-month norm passed in.
  const userOv = employee.overrides ?? {};
  const effBase = userOv.baseHours !== undefined ? userOv.baseHours : baseHours;

  // ── Manager holiday credit (vedoucí section) ──────────────────────────────
  // Managers get Mon–Fri holidays counted toward VÝKAZ regardless of whether worked.
  const isVeduci = employee.section === "vedoucí";
  const managerBonus = isVeduci ? countMonFriHolidays(year, month, holidays) * 8 : 0;
  const rawReportHours = totalHours + managerBonus;

  // Clean (pre-Nemoc, pre-override) values. Výkaz is capped at the base norm;
  // worked hours over the norm are always overtime. Vacation accrues toward the
  // full base for HPP, toward half the base for PPP.
  const isPpp = employee.contractType === "PPP";
  const cleanReport = Math.min(effBase, rawReportHours);
  const cleanExtra = Math.max(0, rawReportHours - effBase);
  const vacTarget = isDpp ? 0 : (isPpp ? effBase / 2 : effBase);
  const cleanVacation = Math.max(0, vacTarget - cleanReport);
  const cleanExtraPay = (!isDpp && cleanExtra > 0 && employee.hourlyRate != null && employee.hourlyRate > 0)
    ? employee.hourlyRate * cleanExtra : 0;

  const maxNightHours = Math.floor(effBase / 12) * 8;
  const nightCapped = Math.min(maxNightHours, nightHours);
  const foodVouchers = isDpp ? 0 : workingDays * foodVoucherRate;

  // ── Balance: Výkaz + Dovolená + Nemoc = target (HPP base, PPP base/2) ───────
  // MIRROR: keep in sync with computeBalance() in frontend/src/pages/PayrollPage.tsx.
  // Recomputed from CLEAN values on every call (idempotent), so re-editing Nemoc
  // never compounds. Nemoc fills Dovolená first, then pushes worked hours out of
  // Výkaz; any worked hours not in Výkaz (overtime + Nemoc-displaced) spill to
  // SVÁTEK first (up to maxHolidayHours), the remainder to NAVÍC.
  const rate = employee.hourlyRate ?? 0;
  const nemoc = employee.sickLeaveHours ?? 0;
  const allHolsInMonth = [...holidays].filter(
    (h) => h.startsWith(`${year}-${String(month).padStart(2, "0")}-`)
  ).length;
  const maxHolHours = allHolsInMonth * 12;

  const newAutoOv: Record<string, number> = {};
  if (!isDpp) {
    const hasVykazOv = userOv.reportHours !== undefined;
    const V0 = hasVykazOv ? userOv.reportHours : cleanReport;
    const vacAtV0 = Math.max(0, vacTarget - V0);
    const nemocIntoVykaz = hasVykazOv ? 0 : Math.max(0, nemoc - vacAtV0);
    const V = Math.max(0, V0 - nemocIntoVykaz);             // effective Výkaz
    const D = Math.max(0, vacTarget - V - nemoc);           // effective Dovolená
    const spill = Math.max(0, rawReportHours - V);          // worked hours not in Výkaz

    const availHol = Math.max(0, maxHolHours - holidayHours);
    const transferH = Math.min(spill, availHol);
    const holiday = holidayHours + transferH;
    const navicHours = spill - transferH;
    const navicPay = rate > 0 ? rate * navicHours : 0;

    // Auto-overrides only where the balanced value differs from clean and the
    // user hasn't pinned that field manually (overrides win over autoOverrides).
    if (!hasVykazOv && V !== cleanReport) newAutoOv.reportHours = V;
    if (userOv.vacationHours === undefined && D !== cleanVacation) newAutoOv.vacationHours = D;
    if (userOv.holidayHours === undefined && holiday !== holidayHours) newAutoOv.holidayHours = holiday;
    if (userOv.extraPay === undefined && navicPay !== cleanExtraPay) newAutoOv.extraPay = navicPay;
  }

  const reportHours = cleanReport;
  const vacationHours = cleanVacation;
  const extraHours = cleanExtra;
  const extraPay = cleanExtraPay;

  return {
    employeeId: employee.employeeId,
    firstName: employee.firstName,
    lastName: employee.lastName,
    displayName: employee.displayName ?? "",
    contractType: employee.contractType,
    salary: employee.salary,
    hourlyRate: employee.hourlyRate,
    jobTitle: employee.jobTitle,
    section: employee.section,
    sickLeaveHours: employee.sickLeaveHours ?? 0,
    baseHours: effBase,
    baseHoursNorm: baseHours,
    totalHours,
    reportHours,
    vacationHours,
    nightHours: isDpp ? 0 : nightCapped,
    holidayHours: isDpp ? 0 : holidayHours,
    weekendHours: isDpp ? 0 : weekendHours,
    extraHours: isDpp ? 0 : extraHours,
    extraPay: isDpp ? 0 : extraPay,
    workingDays,
    foodVouchers,
    dppAmount: isDpp
      ? Math.round(totalHours * (employee.hourlyRate ?? 0))
      : null,
    overrides: employee.overrides ?? {},
    autoOverrides: newAutoOv,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/** Read foodVoucherRate from settings/payroll, fallback to 129.5 if not set. */
async function getFoodVoucherRate(): Promise<number> {
  const snap = await db().collection("settings").doc("payroll").get();
  return snap.exists ? (snap.data()?.foodVoucherRate as number ?? 129.5) : 129.5;
}

/**
 * Read the one benefits doc for an employee and decide whether the Multisport
 * benefit is active for the payroll month. The month window is
 * [YYYY-MM-01, YYYY-MM-<lastDay>]; either date field may be null (open ended).
 */
export async function getMultisportActive(
  employeeId: string,
  year: number,
  month: number
): Promise<boolean> {
  const snap = await db()
    .collection("employees")
    .doc(employeeId)
    .collection("benefits")
    .limit(1)
    .get();
  if (snap.empty) return false;
  const data = snap.docs[0].data() as Record<string, unknown>;
  if (data.multisport !== true) return false;
  const from = (data.multisportFrom as string | null | undefined) ?? null;
  const to = (data.multisportTo as string | null | undefined) ?? null;
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const last = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  if (from && from > last) return false;
  if (to && to < first) return false;
  return true;
}

/**
 * Find the most recent payroll period strictly before (year, month) and return
 * that employee's entry doc data, or null. Used to seed carry-forward notes
 * into a newly-created period.
 */
async function getPriorEntryData(
  employeeId: string,
  year: number,
  month: number
): Promise<Record<string, unknown> | null> {
  const snap = await db()
    .collection("payrollPeriods")
    .orderBy("year", "desc")
    .orderBy("month", "desc")
    .get();
  for (const p of snap.docs) {
    const d = p.data() as Record<string, unknown>;
    const py = d.year as number;
    const pm = d.month as number;
    const isPrior = py < year || (py === year && pm < month);
    if (!isPrior) continue;
    const entrySnap = await p.ref.collection("entries").doc(employeeId).get();
    if (entrySnap.exists) return entrySnap.data() as Record<string, unknown>;
  }
  return null;
}

/**
 * Create or update a payrollPeriod for a given published shift plan.
 * Preserves manually entered sickLeaveHours and overrides on existing entries.
 * autoOverrides are always recomputed — never preserved.
 *
 * `opts.discardOverrides` (hard recompute, admin-only): drop the per-field manual
 * overrides (Výkaz pin, Svátek=0, Základ override, …) so every cell recomputes
 * cleanly from the shift plan. sickLeaveHours (Nemoc) and notes are still
 * preserved — those are real data, not fudged numbers.
 */
export async function createOrUpdatePayrollPeriod(
  planId: string,
  year: number,
  month: number,
  opts: { discardOverrides?: boolean } = {}
): Promise<void> {
  const holidays = getCzechHolidays(year);
  const baseHours = getBaseHours(year, month);

  // Count Czech holidays that fall within this month
  const monthPrefix = `${year}-${String(month).padStart(2, "0")}-`;
  let holidaysInMonth = 0;
  for (const h of holidays) {
    if (h.startsWith(monthPrefix)) holidaysInMonth++;
  }
  const maxHolidayHours = holidaysInMonth * 12;
  const maxNightHours = Math.floor(baseHours / 12) * 8;

  // Find or create the payrollPeriod document
  const periodsRef = db().collection("payrollPeriods");
  const existing = await periodsRef
    .where("year", "==", year)
    .where("month", "==", month)
    .limit(1)
    .get();

  // Locked periods are immutable — skip entirely.
  if (!existing.empty && (existing.docs[0].data() as Record<string, unknown>).locked === true) {
    return;
  }

  // Preserve the rate stored on an existing period; only pull from settings for new periods.
  // This ensures a settings change does not retroactively alter past payrolls.
  const foodVoucherRate = existing.empty
    ? await getFoodVoucherRate()
    : ((existing.docs[0].data().foodVoucherRate as number | undefined) ?? await getFoodVoucherRate());

  let periodRef: admin.firestore.DocumentReference;
  const periodData = {
    year,
    month,
    shiftPlanId: planId,
    baseHours,
    maxNightHours,
    maxHolidayHours,
    foodVoucherRate,
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (existing.empty) {
    periodRef = periodsRef.doc();
    await periodRef.set({
      ...periodData,
      locked: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  } else {
    periodRef = existing.docs[0].ref;
    await periodRef.update(periodData);
  }

  // Read all planEmployees
  const planRef = db().collection("shiftPlans").doc(planId);
  const [empSnap, shiftsSnap] = await Promise.all([
    planRef.collection("planEmployees").get(),
    planRef.collection("shifts").get(),
  ]);

  const allShifts: ShiftDoc[] = shiftsSnap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    return {
      employeeId: data.employeeId as string,
      date: data.date as string,
      rawInput: data.rawInput as string,
      segments: (data.segments as ShiftDoc["segments"]) ?? [],
      hoursComputed: (data.hoursComputed as number) ?? 0,
      isDouble: (data.isDouble as boolean) ?? false,
      status: (data.status as string) ?? "unassigned",
    };
  });

  // Read existing entries to preserve sickLeaveHours + overrides + notes
  // (NOT autoOverrides — those are always recomputed)
  const existingEntriesSnap = await periodRef.collection("entries").get();
  const sickLeaveMap = new Map<string, number>();
  const overridesMap = new Map<string, Record<string, number>>();
  const notesMap = new Map<string, Record<string, unknown>[]>();
  for (const d of existingEntriesSnap.docs) {
    const data = d.data();
    sickLeaveMap.set(d.id, (data.sickLeaveHours as number) ?? 0);
    // Hard recompute (discardOverrides) skips preserving manual overrides so the
    // cascade recomputes clean; Nemoc + notes below are still carried over.
    if (!opts.discardOverrides && data.overrides && typeof data.overrides === "object") {
      overridesMap.set(d.id, data.overrides as Record<string, number>);
    }
    if (Array.isArray(data.notes)) {
      notesMap.set(d.id, data.notes as Record<string, unknown>[]);
    }
  }

  // Calculate and write each employee's entry
  const batch = db().batch();
  for (const empDoc of empSnap.docs) {
    const planEmp = empDoc.data() as Record<string, unknown>;
    const employeeId = planEmp.employeeId as string;

    // Read this employee's employment rows once, then derive everything from
    // the relevant session (mirrors frontend/src/lib/employmentSessions.ts).
    const empRowsSnap = await db()
      .collection("employees").doc(employeeId)
      .collection("employment").orderBy("startDate", "asc").get();
    const empRows = empRowsSnap.docs.map((d) => d.data() as EmploymentRowLite);
    const eff = effectiveCompFromRows(empRows, year, month);

    // Contract type still prefers the employee root's currentContractType (kept
    // folded with the latest Dodatek by recomputeRootFromLatestSession). The
    // session-folded value is the fallback; both beat the Nástup-only planEmp.
    const rootSnap = await db().collection("employees").doc(employeeId).get();
    const currentContractType = rootSnap.exists
      ? ((rootSnap.data() as Record<string, unknown>).currentContractType as string | undefined)
      : undefined;

    const employee = {
      employeeId,
      firstName: planEmp.firstName as string ?? "",
      lastName: planEmp.lastName as string ?? "",
      displayName: planEmp.displayName as string ?? "",
      contractType: currentContractType || eff?.contractType || (planEmp.contractType as string) || "",
      salary: eff?.salary ?? null,
      hourlyRate: eff?.hourlyRate ?? null,
      jobTitle: eff?.jobTitle || (planEmp.jobTitle as string) || "",
      section: planEmp.section as string ?? "",
      sickLeaveHours: sickLeaveMap.get(employeeId) ?? 0,
      overrides: overridesMap.get(employeeId) ?? {},
    };

    // Prorate the norm for employees who started or were terminated mid-month;
    // null → employed the whole month, so use the standard full-month base.
    const proratedBase = proratedBaseFromRows(empRows, year, month);
    const empBaseHours = proratedBase ?? baseHours;

    const entry = calculateEntry(employee, allShifts, holidays, empBaseHours, foodVoucherRate, year, month);
    const multisportActive = await getMultisportActive(employeeId, year, month);

    let notes = notesMap.get(employeeId);
    if (!notes) {
      // Brand-new entry in a brand-new period — seed carry-forward notes from
      // the most recent prior period, if any (never auto/system notes — those
      // are month-specific and regenerated below).
      if (existing.empty) {
        const priorEntry = await getPriorEntryData(employeeId, year, month);
        const priorNotes = (priorEntry?.notes as Record<string, unknown>[] | undefined) ?? [];
        const now = Timestamp.now();
        notes = priorNotes
          // Carry forward unread user notes only — a note read in an earlier
          // month must not reappear in later periods, and auto/system notes are
          // month-specific (regenerated below).
          .filter((n) => n.carryForward === true && n.auto !== true && n.read !== true)
          .map((n) => ({
            ...n,
            id: randomUUID(),
            sourceNoteId: (n.sourceNoteId as string) ?? (n.id as string),
            createdAt: now,
          }));
      } else {
        notes = [];
      }
    }

    // System notes for a mid-month start/termination are regenerated on every
    // run: drop any previous auto note, then prepend this month's. carryForward
    // stays false so they never leak into other periods.
    const autoStamp = Timestamp.now();
    const autoNotes = autoNotesFromRows(empRows, year, month).map((n) => ({
      id: randomUUID(),
      sourceNoteId: randomUUID(),
      text: n.text,
      kind: n.kind,
      auto: true,
      carryForward: false,
      createdBy: "system",
      createdByName: "Systém",
      createdAt: autoStamp,
    }));
    notes = [...autoNotes, ...notes.filter((n) => (n as Record<string, unknown>).auto !== true)];

    const entryRef = periodRef.collection("entries").doc(employeeId);
    batch.set(entryRef, { ...entry, multisportActive, notes });
  }

  await batch.commit();
}
