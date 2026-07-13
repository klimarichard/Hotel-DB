/**
 * Czech field labels for the remaining audited collections:
 * vacationRequests, employeeChangeRequests, contracts, contractTemplates,
 * companies, users, jobPositions, departments, educationLevels, settings,
 * alerts, documentAlerts, probationAlerts. Filled in by the misc-labels task.
 *
 * Each top-level key is a ROOT collection; its value maps field leaf names to
 * Czech labels. Field names are taken from the backend writes that audit each
 * collection (functions/src/routes/* and services/*).
 */

import type { FieldLabelMap } from "./labels";

// ── Dovolená (functions/src/routes/vacation.ts) ──
const vacationRequests: FieldLabelMap = {
  employeeId: "Zaměstnanec",
  uid: "Uživatel (účet)",
  firstName: "Jméno",
  lastName: "Příjmení",
  startDate: "Začátek",
  endDate: "Konec",
  reason: "Důvod",
  status: "Stav",
  requestedAt: "Datum podání",
  reviewedBy: "Vyřídil",
  reviewedAt: "Datum vyřízení",
  rejectionReason: "Důvod zamítnutí",
  pendingEdit: "Čekající úprava",
  excludedDates: "Vynechané dny",
};

// ── Žádost o změnu údajů (functions/src/services/employeeChangeRequests.ts
//    + routes/selfService.ts + routes/employeeChangeRequests.ts) ──
const employeeChangeRequests: FieldLabelMap = {
  employeeId: "Zaměstnanec",
  requestedByUid: "Žádost podal (účet)",
  requestedByName: "Žádost podal",
  status: "Stav",
  changes: "Navržené změny",
  requestedAt: "Datum podání",
  reviewedByUid: "Vyřídil (účet)",
  reviewedByName: "Vyřídil",
  reviewedAt: "Datum vyřízení",
  rejectionReason: "Důvod zamítnutí",
  fields: "Pole",
  // StoredChange leaf names (inside changes[])
  field: "Pole",
  section: "Sekce",
  sensitive: "Citlivý údaj",
  label: "Označení pole",
  newValue: "Nová hodnota",
  oldValue: "Původní hodnota",
};

// ── Smlouva (functions/src/routes/contracts.ts; logged under employees/contracts) ──
const contracts: FieldLabelMap = {
  type: "Typ smlouvy",
  status: "Stav",
  displayName: "Název dokumentu",
  generatedAt: "Vytvořeno",
  generatedBy: "Vytvořil",
  employmentRowId: "Vazba na pracovní poměr",
  unsignedStoragePath: "Soubor (nepodepsaný)",
  signedStoragePath: "Soubor (podepsaný)",
  signedAt: "Datum podpisu",
  signedUploadedBy: "Podepsaný dokument nahrál",
  notes: "Poznámka",
  rowSnapshot: "Snímek pracovního poměru",
  hasUnsignedPdf: "Obsahuje nepodepsané PDF",
};

// ── Šablona smlouvy (functions/src/routes/contractTemplates.ts) ──
const contractTemplates: FieldLabelMap = {
  type: "Typ",
  name: "Název",
  kind: "Druh šablony",
  htmlContent: "Obsah šablony",
  htmlContentLength: "Délka obsahu",
  variables: "Proměnné",
  margins: "Okraje",
  createdAt: "Vytvořeno",
  createdBy: "Vytvořil",
  updatedAt: "Upraveno",
  updatedBy: "Upravil",
};

// ── Společnost (functions/src/routes/companies.ts) ──
const companies: FieldLabelMap = {
  abbreviation: "Zkratka",
  name: "Název",
  address: "Adresa",
  ic: "IČO",
  dic: "DIČ",
  fileNo: "Spisová značka",
  displayOrder: "Pořadí",
  createdAt: "Vytvořeno",
  updatedAt: "Upraveno",
  createdBy: "Vytvořil",
  updatedBy: "Upravil",
};

// ── Uživatel (functions/src/routes/auth.ts) ──
const users: FieldLabelMap = {
  name: "Jméno",
  email: "E-mail",
  role: "Role",
  active: "Aktivní účet",
  employeeId: "Propojený zaměstnanec",
  theme: "Motiv vzhledu",
  createdAt: "Vytvořeno",
  updatedAt: "Upraveno",
  lastLogin: "Poslední přihlášení",
};

// ── Pracovní pozice (functions/src/routes/jobPositions.ts) ──
const jobPositions: FieldLabelMap = {
  name: "Název",
  departmentId: "Oddělení",
  defaultSalary: "Výchozí mzda",
  hourlyRate: "Hodinová sazba",
  clothingAllowance: "Příspěvek na oblečení",
  homeOfficeAllowance: "Příspěvek na home office",
  displayOrder: "Pořadí",
  createdAt: "Vytvořeno",
  updatedAt: "Upraveno",
};

// ── Oddělení (functions/src/routes/departments.ts) ──
const departments: FieldLabelMap = {
  name: "Název",
  displayOrder: "Pořadí",
  createdAt: "Vytvořeno",
  updatedAt: "Upraveno",
};

// ── Stupeň vzdělání (functions/src/routes/educationLevels.ts) ──
const educationLevels: FieldLabelMap = {
  name: "Název",
  code: "Kód",
  displayOrder: "Pořadí",
  createdAt: "Vytvořeno",
  updatedAt: "Upraveno",
};

// ── Nastavení (settings/menuOrder via routes/menuOrder.ts;
//    settings/payroll via routes/payroll.ts) ──
const settings: FieldLabelMap = {
  // settings/payroll
  foodVoucherRate: "Sazba stravenky",
  dppMaxMonthlyReward: "Maximální měsíční odměna DPP",
  minimumWage: "Minimální mzda",
  multisportBasePrice: "Základní cena Multisport",
  mealAllowanceMinHours: "Min. délka směny pro stravenku (h)",
  // settings/menuOrder – per-role menu order arrays
  admin: "Pořadí menu – administrátor",
  director: "Pořadí menu – ředitel",
  manager: "Pořadí menu – FOM",
  employee: "Pořadí menu – zaměstnanec",
  accountant: "Pořadí menu – účetní",
  updatedAt: "Upraveno",
  updatedBy: "Upravil",
};

// ── Upozornění – doklady (functions/src/routes/employees.ts updateDocumentAlerts;
//    docs live in the `alerts` collection) ──
const alerts: FieldLabelMap = {
  employeeId: "Zaměstnanec",
  employeeFirstName: "Jméno",
  employeeLastName: "Příjmení",
  field: "Pole dokladu",
  fieldLabel: "Označení dokladu",
  expiryDate: "Datum expirace",
  daysUntilExpiry: "Dní do expirace",
  status: "Stav",
  read: "Přečteno",
  readAt: "Datum přečtení",
  readBy: "Přečetl",
  updatedAt: "Upraveno",
};

// ── Upozornění – doklady (same shape as `alerts`; collection name only appears
//    on the manual-trigger refresh audit entry) ──
const documentAlerts: FieldLabelMap = { ...alerts };

// ── Upozornění – zkušební doba (functions/src/services/probationAlerts.ts) ──
const probationAlerts: FieldLabelMap = {
  employeeId: "Zaměstnanec",
  employeeFirstName: "Jméno",
  employeeLastName: "Příjmení",
  employmentRowId: "Vazba na pracovní poměr",
  probationStartDate: "Začátek zkušební doby",
  probationEndDate: "Konec zkušební doby",
  probationPeriodRaw: "Délka zkušební doby",
  daysUntilEnd: "Dní do konce",
  status: "Stav",
  read: "Přečteno",
  readAt: "Datum přečtení",
  readBy: "Přečetl",
  updatedAt: "Upraveno",
};

export const MISC_FIELDS: Record<string, FieldLabelMap> = {
  vacationRequests,
  employeeChangeRequests,
  contracts,
  contractTemplates,
  companies,
  users,
  jobPositions,
  departments,
  educationLevels,
  settings,
  alerts,
  documentAlerts,
  probationAlerts,
};
