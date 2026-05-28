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
 * Verb phrase for the card header, e.g. "Upravil — Zaměstnanec".
 * `subject` is the Czech collection label so the phrase reads
 * "Vytvořil zaměstnance".
 */
export function actionVerb(action: AuditAction): string {
  switch (action) {
    case "create":
      return "Vytvořil";
    case "update":
      return "Upravil";
    case "delete":
      return "Smazal";
    case "reveal":
      return "Zobrazil citlivý údaj";
    case "export":
      return "Exportoval data";
    case "manual-trigger":
      return "Spustil úlohu";
    default:
      return action;
  }
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
