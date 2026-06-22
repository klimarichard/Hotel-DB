/**
 * Czech field labels for the `employees` collection and its sub-docs
 * (contact / documents / benefits / employment / contracts).
 *
 * All employee field names are merged into one map keyed by "employees";
 * the audit collection suffix ("employees/contact" …) drives the section
 * sub-grouping, not the lookup. Labels reuse the wording already used on the
 * employee form (selfEditFields.ts) and CSV export (csvExport.ts).
 */

import type { FieldLabelMap } from "./labels";

const employees: FieldLabelMap = {
  // ── Root / Osobní údaje ──
  firstName: "Jméno",
  lastName: "Příjmení",
  birthSurname: "Rodné příjmení",
  displayName: "Zobrazované jméno",
  dateOfBirth: "Datum narození",
  gender: "Pohlaví",
  genderNeutralDisplay: "Nerozlišovat tvary podle pohlaví",
  maritalStatus: "Rodinný stav",
  education: "Vzdělání",
  nationality: "Státní příslušnost",
  placeOfBirth: "Místo narození",
  birthNumber: "Rodné číslo",
  status: "Stav",
  // Systém auto status-change summary (employee.autoTerminate / autoReactivate)
  from: "Původní stav",
  to: "Nový stav",
  // Denormalized "current*" fields kept on the root doc
  currentJobTitle: "Pracovní pozice (aktuální)",
  currentDepartment: "Oddělení (aktuální)",
  currentCompanyId: "Společnost (aktuální)",
  currentContractType: "Typ smlouvy (aktuální)",
  currentSalary: "Mzda (aktuální)",
  currentHourlyRate: "Hodinová sazba (aktuální)",

  // ── Kontakt ──
  phone: "Telefon",
  email: "E-mail",
  permanentAddress: "Trvalá adresa",
  contactAddress: "Kontaktní adresa",
  contactAddressSameAsPermanent: "Kontaktní adresa stejná jako trvalá",

  // ── Doklady ──
  idCardNumber: "Číslo OP",
  idCardExpiry: "Platnost OP",
  passportNumber: "Číslo pasu",
  passportIssueDate: "Datum vydání pasu",
  passportExpiry: "Platnost pasu",
  passportAuthority: "Úřad (pas)",
  visaNumber: "Číslo povolení k pobytu",
  visaType: "Typ víza",
  visaIssueDate: "Datum vydání víza",
  visaExpiry: "Platnost povolení k pobytu",

  // ── Pojištění a banka / benefity ──
  insuranceCompany: "Pojišťovna",
  insuranceNumber: "Číslo pojištěnce",
  bankAccount: "Číslo bankovního účtu",
  multisport: "Multisport",
  homeOffice: "Home office",
  allowances: "Náhrady",
  nepodepiseProhlaseni: "Nepodepíše prohlášení poplatníka",
  zaucovani: "Zaučování",
  zaucovaniDo: "Zaučování do",

  // ── Pracovní poměr (employment session rows) ──
  type: "Typ záznamu",
  startDate: "Začátek platnosti",
  endDate: "Konec platnosti",
  salary: "Mzda",
  hourlyRate: "Hodinová sazba",
  contractType: "Typ smlouvy",
  jobTitle: "Pracovní pozice",
  department: "Oddělení",
  companyId: "Společnost",
  signingDate: "Datum podpisu",
  changeKind: "Druh změny",
  changes: "Změny (dodatek)",
  value: "Nová hodnota",
  reason: "Důvod",
  note: "Poznámka",
};

export const EMPLOYEE_FIELDS: Record<string, FieldLabelMap> = { employees };
