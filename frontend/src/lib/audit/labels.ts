/**
 * Human-readable label layer for the audit log ("Log změn").
 *
 * The backend writes one audit doc per changed field, keyed by a `collection`
 * string (e.g. "employees", "employees/contact", "payrollPeriods/entries") and
 * a `fieldPath` (e.g. "currentSalary", "documents.idCardNumber"). This module
 * turns those raw machine keys into Czech labels for display.
 *
 * Field labels are split into per-area data files so each can be maintained in
 * isolation (fields.employee.ts / fields.payroll.ts / fields.shifts.ts /
 * fields.misc.ts). Each file exports a `Record<rootCollection, FieldLabelMap>`
 * partial that is merged into FIELD_LABELS here.
 */

import { EMPLOYEE_FIELDS } from "./fields.employee";
import { PAYROLL_FIELDS } from "./fields.payroll";
import { SHIFT_FIELDS } from "./fields.shifts";
import { MISC_FIELDS } from "./fields.misc";

/** Maps a leaf field name (or full fieldPath) to its Czech label. */
export type FieldLabelMap = Record<string, string>;

export type AuditAction = "create" | "update" | "delete" | "reveal" | "export" | "manual-trigger";

// ─── Field labels ────────────────────────────────────────────────────────────

/** Merged field-label registry, keyed by ROOT collection (segment before "/"). */
export const FIELD_LABELS: Record<string, FieldLabelMap> = {
  ...EMPLOYEE_FIELDS,
  ...PAYROLL_FIELDS,
  ...SHIFT_FIELDS,
  ...MISC_FIELDS,
};

/**
 * "currentSalary" → "Mzda (aktuální)"; falls back to a humanised key.
 *
 * Walks the collection path most-specific-first so a sub-area that has its own
 * label map wins over the root. e.g. "employees/contracts" resolves a contract
 * field against the `contracts` map before the `employees` map (where a key
 * like `displayName` would otherwise mean the employee's display name).
 */
export function fieldLabel(collection: string, fieldPath: string | undefined): string {
  if (!fieldPath) return "—";
  const leaf = fieldPath.split(".").pop() ?? fieldPath;
  const segments = (collection || "").split("/");
  for (let i = segments.length - 1; i >= 0; i--) {
    const map = FIELD_LABELS[segments[i]];
    const hit = map?.[fieldPath] ?? map?.[leaf];
    if (hit !== undefined) return hit;
  }
  return humanizeKey(leaf);
}

/** Last-resort prettifier: "passportIssueDate" → "Passport issue date". */
export function humanizeKey(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// ─── Collections ─────────────────────────────────────────────────────────────

export function rootCollection(collection: string): string {
  return (collection || "").split("/")[0];
}

/** Czech label for a root collection. */
export const COLLECTION_LABELS: Record<string, string> = {
  employees: "Zaměstnanec",
  payrollPeriods: "Mzdy",
  shiftPlans: "Plán směn",
  vacationRequests: "Dovolená",
  employeeChangeRequests: "Žádost o změnu údajů",
  contracts: "Smlouva",
  contractTemplates: "Šablona smlouvy",
  companies: "Společnost",
  users: "Uživatel",
  jobPositions: "Pracovní pozice",
  departments: "Oddělení",
  educationLevels: "Stupeň vzdělání",
  settings: "Nastavení",
  alerts: "Upozornění",
  documentAlerts: "Upozornění – doklady",
  probationAlerts: "Upozornění – zkušební doba",
};

/**
 * Czech label for a sub-area (the segment after "/" in a collection string).
 * Employee sub-docs reuse the self-edit section labels; the rest are listed
 * here. Drives both collectionLabel() and the in-card section sub-headers.
 */
export const SUBAREA_LABELS: Record<string, string> = {
  // employees/*
  contact: "Kontakt",
  documents: "Doklady",
  benefits: "Pojištění a banka",
  employment: "Pracovní poměr",
  contracts: "Smlouvy",
  // payrollPeriods/*
  entries: "Záznam zaměstnance",
  notes: "Poznámky",
  // shiftPlans/*
  shifts: "Směny",
  planEmployees: "Zaměstnanci plánu",
  rules: "Pravidla",
  modRow: "Řádek MOD",
  shiftChangeRequests: "Žádosti o změnu směny",
  shiftOverrideRequests: "Žádosti o výjimku",
  unavailabilityRequests: "Nedostupnost",
};

/** "employees/contact" → "Zaměstnanec · Kontakt"; used in the filter dropdown. */
export function collectionLabel(collection: string): string {
  if (!collection) return "—";
  const [root, sub] = collection.split("/");
  const rootLabel = COLLECTION_LABELS[root] ?? humanizeKey(root);
  if (!sub) return rootLabel;
  const subLabel = SUBAREA_LABELS[sub] ?? humanizeKey(sub);
  return `${rootLabel} · ${subLabel}`;
}

// ─── Page categories (change-log overhaul) ───────────────────────────────────

/** Page bucket an audit entry belongs to — mirrors the backend AuditCategory. */
export type AuditCategory =
  | "smeny"
  | "dovolena"
  | "zamestnanci"
  | "mzdy"
  | "sablony"
  | "mujProfil"
  | "nastaveni"
  | "system";

/** Categories in display order for the "stránka" multi-select filter. */
export const CATEGORIES: AuditCategory[] = [
  "smeny",
  "dovolena",
  "zamestnanci",
  "mzdy",
  "sablony",
  "mujProfil",
  "nastaveni",
  "system",
];

export const CATEGORY_LABELS: Record<AuditCategory, string> = {
  smeny: "Směny",
  dovolena: "Dovolená",
  zamestnanci: "Zaměstnanci",
  mzdy: "Mzdy",
  sablony: "Šablony smluv",
  mujProfil: "Můj profil",
  nastaveni: "Nastavení",
  system: "Systém",
};

/** Nastavení sub-area — mirrors the backend SettingsArea. */
export type SettingsArea =
  | "uzivatele"
  | "spolecnosti"
  | "oddeleni"
  | "pozice"
  | "vzdelani"
  | "mzdy";

export const SETTINGS_AREAS: SettingsArea[] = [
  "uzivatele",
  "spolecnosti",
  "oddeleni",
  "pozice",
  "vzdelani",
  "mzdy",
];

export const SETTINGS_AREA_LABELS: Record<SettingsArea, string> = {
  uzivatele: "Uživatelé a oprávnění",
  spolecnosti: "Společnosti",
  oddeleni: "Oddělení",
  pozice: "Pracovní pozice",
  vzdelani: "Vzdělání",
  mzdy: "Mzdová nastavení",
};

/**
 * Section label used to sub-group fields inside one event card. For employee
 * edits this is the sub-doc area ("Osobní údaje" / "Kontakt" / …); the root
 * doc itself is "Osobní údaje". For other collections, a single section keyed
 * on the (sub-)area, or the collection label when there is no sub-area.
 */
export function sectionLabel(collection: string): string {
  const [root, sub] = collection.split("/");
  if (root === "employees") {
    if (!sub) return "Osobní údaje";
    return SUBAREA_LABELS[sub] ?? humanizeKey(sub);
  }
  if (sub) return SUBAREA_LABELS[sub] ?? humanizeKey(sub);
  return COLLECTION_LABELS[root] ?? humanizeKey(root);
}

// ─── Actions ─────────────────────────────────────────────────────────────────

/** Noun labels for the filter dropdown. */
export const ACTION_LABELS: Record<AuditAction, string> = {
  create: "Vytvoření",
  update: "Změna",
  delete: "Smazání",
  reveal: "Odhalení citlivého údaje",
  export: "Export dat",
  "manual-trigger": "Ruční spuštění úlohy",
};

/** Filterable actions, in dropdown order. */
export const ACTIONS: AuditAction[] = ["create", "update", "delete", "reveal", "export", "manual-trigger"];

/**
 * Action noun for the card header. Verbal-noun form (matches the event labels
 * "Schválení / Zamítnutí …"); for create/update/delete it pairs with the
 * GENITIVE subject from subjectNoun() so the phrase reads "Vytvoření
 * zaměstnance", "Upravení společnosti", "Smazání dokumentu".
 */
export function actionVerb(action: AuditAction): string {
  switch (action) {
    case "create":
      return "Vytvoření";
    case "update":
      return "Upravení";
    case "delete":
      return "Smazání";
    case "reveal":
      return "Zobrazení citlivého údaje";
    case "export":
      return "Export dat";
    case "manual-trigger":
      return "Spuštění úlohy";
    default:
      return action;
  }
}

/**
 * The thing an action acted on, in Czech GENITIVE (reads after the action noun:
 * "Vytvoření dokumentu", "Upravení kontaktních údajů", "Smazání dokumentu").
 * Keyed by collection — sub-area wins over root (so employees/contracts is a
 * "dokument", not a "zaměstnanec"). Lower-cased: common noun mid-phrase.
 */
const SUBJECT_GEN: Record<string, string> = {
  employees: "zaměstnance",
  "employees/contact": "kontaktních údajů",
  "employees/documents": "dokladů",
  "employees/benefits": "benefitů",
  "employees/employment": "pracovního poměru",
  "employees/contracts": "dokumentu",
  payrollPeriods: "mezd",
  "payrollPeriods/entries": "mzdového záznamu",
  "payrollPeriods/entries/notes": "poznámky ke mzdě",
  shiftPlans: "plánu směn",
  vacationRequests: "žádosti o dovolenou",
  employeeChangeRequests: "žádosti o změnu údajů",
  contractTemplates: "šablony smlouvy",
  companies: "společnosti",
  users: "uživatele",
  jobPositions: "pracovní pozice",
  departments: "oddělení",
  educationLevels: "stupně vzdělání",
  settings: "nastavení",
  alerts: "upozornění",
  documentAlerts: "upozornění",
  probationAlerts: "upozornění",
};

/** Genitive noun for the "<action noun> <noun>" header phrase. */
export function subjectNoun(collection: string): string {
  if (SUBJECT_GEN[collection]) return SUBJECT_GEN[collection];
  const root = rootCollection(collection);
  if (SUBJECT_GEN[root]) return SUBJECT_GEN[root];
  return (COLLECTION_LABELS[root] ?? humanizeKey(root)).toLowerCase();
}

/** Icon glyph for the card header, by action. */
export function actionGlyph(action: AuditAction): string {
  switch (action) {
    case "create":
      return "＋";
    case "update":
      return "✎";
    case "delete":
      return "🗑";
    case "reveal":
      return "👁";
    case "export":
      return "⭳";
    case "manual-trigger":
      return "⚙";
    default:
      return "•";
  }
}

// ─── Semantic events (change-log overhaul) ───────────────────────────────────

/**
 * Full Czech header phrase for a semantic `event` id. When an entry carries one
 * of these (approvals/rejections, free-shift claims, automatic Systém actions),
 * the card uses this phrase INSTEAD of the generic "<verb> <noun>" header.
 */
export const EVENT_LABELS: Record<string, string> = {
  // Dovolená
  "vacation.approve": "Schválení žádosti o dovolenou",
  "vacation.reject": "Zamítnutí žádosti o dovolenou",
  "vacation.approveEdit": "Schválení úpravy dovolené",
  "vacation.rejectEdit": "Zamítnutí úpravy dovolené",
  // Směny — žádosti
  "shift.unavailability.approve": "Schválení nedostupnosti",
  "shift.unavailability.reject": "Zamítnutí nedostupnosti",
  "shift.override.approve": "Schválení žádosti o výjimku",
  "shift.override.reject": "Zamítnutí žádosti o výjimku",
  "shift.change.approve": "Schválení žádosti o změnu směny",
  "shift.change.reject": "Zamítnutí žádosti o změnu směny",
  "shift.freeClaim.approve": "Schválení nároku na volnou směnu",
  "shift.freeClaim.reject": "Zamítnutí nároku na volnou směnu",
  "shift.freeClaim.autoReject": "Automatické zamítnutí nároku na volnou směnu",
  // Můj profil → Zaměstnanci
  "employeeChange.approve": "Schválení žádosti o úpravu profilu",
  "employeeChange.reject": "Zamítnutí žádosti o úpravu profilu",
  // Systém — automatické akce
  "plan.autoTransition": "Automatický přechod plánu",
  "multisport.autoStart": "Automatické zahájení Multisportu",
  "multisport.autoEnd": "Automatické ukončení Multisportu",
  "employee.autoTerminate": "Automatické ukončení zaměstnance",
  "employee.autoReactivate": "Automatické obnovení zaměstnance",
  "employee.autoStatusChange": "Automatická změna stavu zaměstnance",
};

/** Header phrase for a semantic event id, or undefined if unknown. */
export function eventLabel(event: string | undefined): string | undefined {
  if (!event) return undefined;
  return EVENT_LABELS[event];
}

/**
 * Render-derive a semantic event id for a LEGACY entry that predates the
 * `event` field — from its (collection, status newValue). Lets old approvals /
 * rejections render as "Schválení / Zamítnutí" instead of a bare status change.
 * Returns undefined when nothing maps (falls back to the generic header).
 */
export function deriveLegacyEventId(
  collection: string,
  statusValue: unknown
): string | undefined {
  const v = typeof statusValue === "string" ? statusValue : "";
  if (v !== "approved" && v !== "rejected") return undefined;
  const suffix = v === "approved" ? "approve" : "reject";
  switch (collection) {
    case "vacationRequests":
      return `vacation.${suffix}`;
    case "shiftPlans/unavailabilityRequests":
      return `shift.unavailability.${suffix}`;
    case "shiftPlans/shiftOverrideRequests":
      return `shift.override.${suffix}`;
    case "shiftPlans/shiftChangeRequests":
      // Legacy can't distinguish free-claim from change → default to change.
      return `shift.change.${suffix}`;
    case "employeeChangeRequests":
      return `employeeChange.${suffix}`;
    default:
      return undefined;
  }
}
