/**
 * Payroll calculation engine — replicates MZDY.xlsx logic.
 *
 * Key rules (derived from MZDY.xlsx formulas):
 *  - Base hours = (Mon–Fri days in month) × 8  (state holidays on workdays are INCLUDED)
 *  - Night hours per night segment = 8 (= 12h × 2/3, matching Excel formula (hours/3)*2)
 *  - Max night hours = FLOOR(baseHours/12) × 8
 *  - Vacation (HPP) = baseHours − reportHours
 *  - Vacation (PPP) = MAX(0, baseHours/2 − reportHours)
 *  - Extra hours = MAX(0, totalHours − baseHours)
 *  - NAVÍC = CEIL(hourlyRate × extraHours / 100) × 100  (or 0 if no hourlyRate)
 *  - Food vouchers = workingDays × foodVoucherRate
 *  - DPP: only totalHours (= dppHours) — all other columns null
 */

import * as admin from "firebase-admin";

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
  contractType: "HPP" | "PPP" | "DPP" | string;
  salary: number | null;
  hourlyRate: number | null;
  jobTitle: string;
  section: string;
  sickLeaveHours: number;
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
  dppHours: number | null;
  updatedAt: admin.firestore.FieldValue;
}

// ─── Core calculation ─────────────────────────────────────────────────────────

export function calculateEntry(
  employee: {
    employeeId: string;
    firstName: string;
    lastName: string;
    contractType: string;
    salary: number | null;
    hourlyRate: number | null;
    jobTitle: string;
    section: string;
    sickLeaveHours?: number;
  },
  shifts: ShiftDoc[],
  holidays: Set<string>,
  baseHours: number,
  foodVoucherRate: number
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
      workingDays++;
      if (isWeekend(shift.date)) weekendHours += h;
      if (holidays.has(shift.date)) holidayHours += h;
      // Night hours: 8h per night segment (each 12h night shift → 8 night hours)
      for (const seg of shift.segments) {
        if (isNightCode(seg.code)) nightHours += 8;
      }
    }
    // X (day_off) shifts: hours = 0, don't count toward anything
  }

  const reportHours = Math.min(baseHours, totalHours);
  const extraHours = Math.max(0, totalHours - baseHours);
  const maxNightHours = Math.floor(baseHours / 12) * 8;
  const nightCapped = Math.min(maxNightHours, nightHours);

  let vacationHours = 0;
  if (!isDpp) {
    if (employee.contractType === "HPP") {
      vacationHours = Math.max(0, baseHours - reportHours);
    } else if (employee.contractType === "PPP") {
      vacationHours = Math.max(0, Math.floor(baseHours / 2) - reportHours);
    }
  }

  // NAVÍC: round up to nearest 100 CZK
  let extraPay = 0;
  if (!isDpp && extraHours > 0 && employee.hourlyRate != null && employee.hourlyRate > 0) {
    const raw = employee.hourlyRate * extraHours;
    extraPay = Math.ceil(raw / 100) * 100;
  }

  const foodVouchers = isDpp ? 0 : workingDays * foodVoucherRate;

  return {
    employeeId: employee.employeeId,
    firstName: employee.firstName,
    lastName: employee.lastName,
    contractType: employee.contractType,
    salary: employee.salary,
    hourlyRate: employee.hourlyRate,
    jobTitle: employee.jobTitle,
    section: employee.section,
    sickLeaveHours: employee.sickLeaveHours ?? 0,
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
    dppHours: isDpp ? totalHours : null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/** Read foodVoucherRate from settings/payroll, fallback to 129.5 if not set. */
async function getFoodVoucherRate(): Promise<number> {
  const snap = await db().collection("settings").doc("payroll").get();
  return snap.exists ? (snap.data()?.foodVoucherRate as number ?? 129.5) : 129.5;
}

/**
 * Get the most recent active employment record for an employee.
 * Returns salary, hourlyRate, contractType, jobTitle.
 */
async function getActiveEmployment(employeeId: string): Promise<{
  salary: number | null;
  hourlyRate: number | null;
  contractType: string;
  jobTitle: string;
} | null> {
  const snap = await db()
    .collection("employees")
    .doc(employeeId)
    .collection("employment")
    .where("status", "==", "active")
    .orderBy("startDate", "desc")
    .limit(1)
    .get();
  if (snap.empty) return null;
  const d = snap.docs[0].data() as Record<string, unknown>;
  return {
    salary: (d.salary as number) ?? null,
    hourlyRate: (d.hourlyRate as number) ?? null,
    contractType: (d.contractType as string) ?? "",
    jobTitle: (d.jobTitle as string) ?? "",
  };
}

/**
 * Create or update a payrollPeriod for a given published shift plan.
 * Preserves manually entered sickLeaveHours on existing entries.
 */
export async function createOrUpdatePayrollPeriod(
  planId: string,
  year: number,
  month: number
): Promise<void> {
  const holidays = getCzechHolidays(year);
  const baseHours = getBaseHours(year, month);
  const foodVoucherRate = await getFoodVoucherRate();

  // Find or create the payrollPeriod document
  const periodsRef = db().collection("payrollPeriods");
  const existing = await periodsRef
    .where("year", "==", year)
    .where("month", "==", month)
    .limit(1)
    .get();

  let periodRef: admin.firestore.DocumentReference;
  const periodData = {
    year,
    month,
    shiftPlanId: planId,
    baseHours,
    foodVoucherRate,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (existing.empty) {
    periodRef = periodsRef.doc();
    await periodRef.set({
      ...periodData,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
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

  // Read existing entries to preserve sickLeaveHours
  const existingEntriesSnap = await periodRef.collection("entries").get();
  const sickLeaveMap = new Map<string, number>();
  for (const d of existingEntriesSnap.docs) {
    sickLeaveMap.set(d.id, (d.data().sickLeaveHours as number) ?? 0);
  }

  // Calculate and write each employee's entry
  const batch = db().batch();
  for (const empDoc of empSnap.docs) {
    const planEmp = empDoc.data() as Record<string, unknown>;
    const employeeId = planEmp.employeeId as string;

    const employment = await getActiveEmployment(employeeId);

    const employee = {
      employeeId,
      firstName: planEmp.firstName as string ?? "",
      lastName: planEmp.lastName as string ?? "",
      contractType: employment?.contractType ?? planEmp.contractType as string ?? "",
      salary: employment?.salary ?? null,
      hourlyRate: employment?.hourlyRate ?? null,
      jobTitle: employment?.jobTitle ?? planEmp.jobTitle as string ?? "",
      section: planEmp.section as string ?? "",
      sickLeaveHours: sickLeaveMap.get(employeeId) ?? 0,
    };

    const entry = calculateEntry(employee, allShifts, holidays, baseHours, foodVoucherRate);
    const entryRef = periodRef.collection("entries").doc(employeeId);
    batch.set(entryRef, entry);
  }

  await batch.commit();
}
