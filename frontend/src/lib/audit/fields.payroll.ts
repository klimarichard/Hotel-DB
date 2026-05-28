/**
 * Czech field labels for the `payrollPeriods` collection and its sub-docs
 * (entries, notes). Filled in by the payroll-labels task.
 *
 * One root map — period docs (`payrollPeriods`), per-employee entries
 * (`payrollPeriods/entries`) and notes (`payrollPeriods/entries/notes`) all
 * resolve through this single map, since the leaf field names are unique
 * enough not to collide. Labels mirror the column headers / modal wording in
 * frontend/src/pages/PayrollPage.tsx, PayrollBalanceModal.tsx and
 * PayrollRecalcModal.tsx so the audit log reads the same as the UI.
 */

import type { FieldLabelMap } from "./labels";

const payrollPeriods: FieldLabelMap = {
  // ── Period-level fields (payrollPeriods doc) ────────────────────────────────
  year: "Rok",
  month: "Měsíc",
  shiftPlanId: "Směnný plán",
  baseHours: "Základ", // also per-employee effective norm on an entry
  maxNightHours: "Max. nočních hodin",
  maxHolidayHours: "Max. svátečních hodin",
  foodVoucherRate: "Sazba stravenky",
  dppMaxMonthlyReward: "Max. měsíční odměna DPP",
  locked: "Uzamčeno",
  lockedAt: "Uzamčeno dne",
  lockedBy: "Uzamkl",
  createdAt: "Vytvořeno",
  updatedAt: "Upraveno",
  updatedBy: "Upravil",
  // Period delete / recalc summaries
  entryCount: "Počet záznamů",
  kind: "Druh akce", // "recalculate" | "hard-recalculate" | system-note kind
  period: "Období",

  // ── Per-employee entry fields (payrollPeriods/entries doc) ─────────────────
  firstName: "Jméno",
  lastName: "Příjmení",
  displayName: "Zobrazované jméno",
  contractType: "Typ smlouvy",
  salary: "Mzda",
  hourlyRate: "Hodinová sazba",
  jobTitle: "Pracovní pozice",
  section: "Oddělení",
  baseHoursNorm: "Základ (norma)",
  sickLeaveHours: "Nemoc",
  totalHours: "Hodiny",
  reportHours: "Výkaz",
  vacationHours: "Dovolená",
  nightHours: "Noční",
  holidayHours: "Svátek",
  weekendHours: "So+Ne",
  extraHours: "Hodiny navíc",
  extraPay: "Navíc",
  workingDays: "Pracovní dny",
  foodVouchers: "Stravenky",
  dppAmount: "DPP/faktura",
  overrides: "Ruční úpravy",
  autoOverrides: "Automatické úpravy",
  recalculatedFields: "Přepočtené složky",
  multisportActive: "Multisport aktivní",
  multisport: "Multisport",
  multisportFrom: "Multisport od",
  multisportTo: "Multisport do",

  // ── Notes (payrollPeriods/entries/notes) ────────────────────────────────────
  notes: "Poznámky",
  text: "Text poznámky",
  carryForward: "Přenášet do dalších měsíců",
  sourceNoteId: "ID zdrojové poznámky",
  sourceYear: "Rok vzniku",
  sourceMonth: "Měsíc vzniku",
  read: "Přečteno",
  readAt: "Přečteno dne",
  readBy: "Přečetl",
  readByName: "Přečetl (jméno)",
  auto: "Automatická poznámka",
  createdBy: "Vytvořil",
  createdByName: "Vytvořil (jméno)",
  editedBy: "Upravil",
  editedByName: "Upravil (jméno)",
  editedAt: "Upraveno dne",
};

export const PAYROLL_FIELDS: Record<string, FieldLabelMap> = { payrollPeriods };
