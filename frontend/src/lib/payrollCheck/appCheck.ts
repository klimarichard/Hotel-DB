/**
 * Kontrola mezd — app ↔ XLS. The app only computes reception payrolls, so this
 * runs for the people present in both; every app entry missing from the XLS is
 * a finding (the XLS should list everyone the app pays).
 *
 * App figures come from `GET /payroll/periods/:id/check-data` (locked periods
 * only), already resolved to their effective values (override → auto → computed).
 */
import { navicGross } from "@/lib/payrollNavic";
import {
  asNumber,
  fmtNum,
  hasNoDeclarationFlag,
  matchNames,
  round2,
  type CellValue,
  type Pair,
  type XlsEmployee,
} from "./core";

export interface AppCheckEntry {
  employeeId: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  contractType: string;
  totalHours: number;
  reportHours: number;
  vacationHours: number;
  nightHours: number;
  holidayHours: number;
  weekendHours: number;
  extraPay: number;
  foodVouchers: number;
  dppAmount: number | null;
  sickLeaveHours: number;
  multisportPrice: number;
  allowances: boolean | null;
  nepodepiseProhlaseni: boolean | null;
  /** vacationLedger/{period year}; remaining as at the END of the period's month. null = no ledger doc. */
  vacation: {
    priorYearHours: number | null;
    currentYearHours: number | null;
    paidOutHours: number | null;
    /** Čerpáno of months 1..period month. */
    consumedHours: number;
    /** null when Nárok (Loňská + Letošní) is unset. */
    remainingHours: number | null;
  } | null;
}

export interface AppCheckData {
  id: string;
  year: number;
  month: number;
  locked: true;
  foodVoucherRate: number;
  entries: AppCheckEntry[];
}

/** "Příjmení Jméno" — the XLS order, which the name matcher expects. */
export const appEntryName = (e: AppCheckEntry) => `${e.lastName} ${e.firstName}`.trim();

export interface AppFinding {
  item: string;
  xls: CellValue | null;
  app: CellValue | null;
  delta: number | null;
  note: string;
}

type NumSpec = [column: string, label: string, value: (e: AppCheckEntry) => number, tolerance: number, unit: "h" | "Kč"];

const NUM_CHECKS: NumSpec[] = [
  // DPP has no balanced Výkaz — its worked hours are the whole total.
  ["odpr.hod.", "Výkaz", (e) => (e.contractType === "DPP" ? e.totalHours : e.reportHours), 0, "h"],
  ["dovolená", "Dovolená", (e) => e.vacationHours, 0, "h"],
  ["nemoc", "Nemoc", (e) => e.sickLeaveHours, 0, "h"],
  ["noční př.", "Noční", (e) => e.nightHours, 0, "h"],
  ["svátek", "Svátek", (e) => e.holidayHours, 0, "h"],
  ["SO+NE", "SO+NE", (e) => e.weekendHours, 0, "h"],
  ["DPČ+DPP", "DPP", (e) => e.dppAmount ?? 0, 0, "Kč"],
  // Only the gross part (≤ 6 000) is on the XLS/payslip; the net remainder is paid outside it.
  ["Pohyblivá složka", "Navíc (hrubá část)", (e) => navicGross(e.extraPay), 0, "Kč"],
  ["Stravenkový paušál", "Stravenky", (e) => e.foodVouchers, 0.5, "Kč"],
  ["Multisport", "Multisport", (e) => e.multisportPrice, 0, "Kč"],
];

const isEmpty = (v: CellValue | undefined) => v === "" || v === 0 || v === undefined;

export function checkAppEntry(emp: XlsEmployee, e: AppCheckEntry): AppFinding[] {
  const out: AppFinding[] = [];
  for (const [column, label, value, tol, unit] of NUM_CHECKS) {
    if (!(column in emp.values)) continue;
    const appVal = round2(value(e));
    const xlsVal = asNumber(emp.values[column]);
    if (xlsVal === null) {
      out.push({ item: label, xls: emp.values[column], app: appVal, delta: null, note: `V XLS je text, v aplikaci ${fmtNum(appVal)} ${unit}` });
    } else if (Math.abs(appVal - xlsVal) > tol + 0.005) {
      out.push({ item: label, xls: xlsVal, app: appVal, delta: round2(appVal - xlsVal), note: "" });
    }
  }
  if ("Náhrady" in emp.values) {
    const inXls = !isEmpty(emp.values["Náhrady"]);
    const inApp = e.allowances === true;
    if (inXls !== inApp)
      out.push({ item: "Náhrady", xls: inXls ? emp.values["Náhrady"] : null, app: inApp ? "ANO" : null, delta: null,
        note: inXls ? "V XLS jsou, v aplikaci nejsou zaškrtnuté" : "V aplikaci zaškrtnuté, v XLS nejsou" });
  }
  const xlsNoDecl = hasNoDeclarationFlag(emp);
  const appNoDecl = e.nepodepiseProhlaseni === true;
  if (xlsNoDecl !== appNoDecl)
    out.push({ item: "Nepodepíše prohlášení", xls: xlsNoDecl ? "ANO" : null, app: appNoDecl ? "ANO" : null, delta: null,
      note: xlsNoDecl ? "Označeno v XLS, v aplikaci ne" : "Označeno v aplikaci, v XLS ne" });
  return out;
}

export interface AppSection {
  rows: { emp: XlsEmployee; entry: AppCheckEntry; finding: AppFinding }[];
  /** App entries that have no XLS row. */
  missingInXls: AppCheckEntry[];
  pairs: Pair[];
}

export function runAppChecks(employees: XlsEmployee[], app: AppCheckData): AppSection {
  const { pairs, unmatchedRight } = matchNames(employees.map((e) => e.name), app.entries.map(appEntryName));
  const rows: AppSection["rows"] = [];
  for (const { left, right } of pairs) {
    for (const finding of checkAppEntry(employees[left], app.entries[right]))
      rows.push({ emp: employees[left], entry: app.entries[right], finding });
  }
  return { rows, missingInXls: unmatchedRight.map((i) => app.entries[i]), pairs };
}
