/**
 * CSV export helpers for the Employees page.
 *
 * Produces files that match the shape of `scripts/seeds/employees.csv`:
 *   - semicolon-delimited, CRLF line endings
 *   - UTF-8 with BOM (so Excel on Windows renders diacritics)
 *   - dates as "DD. MM. YYYY" (spaces around the dots, to match the seed format)
 *   - booleans as "ANO" / empty
 *   - salary as a plain number with a single space thousands separator ("16 500")
 */

export type ColumnGroup = "basic" | "documents" | "contact" | "employment" | "benefits" | "sensitive";

export type ColumnSource = "root" | "documents" | "contact" | "benefits" | "employment";

export type ColumnFormat = "text" | "date" | "ano" | "salary" | "numberOrEmpty";

export interface ExportColumn {
  /** Stable key used as the React key and as the set-membership key for selected columns. */
  key: string;
  /** Header label written into the CSV; matches the Czech labels in scripts/seeds/employees.csv. */
  label: string;
  /** Which merged sub-object on the row contains the raw value. */
  source: ColumnSource;
  /** Field name on that sub-object. */
  field: string;
  /** How to format the raw value for CSV output. */
  format: ColumnFormat;
  /** True for fields encrypted at rest — requires the "include sensitive" toggle. */
  sensitive?: boolean;
  /** Which tab/group the checkbox lives under in the modal. */
  group: ColumnGroup;
  /**
   * Force Excel to treat the cell as a literal string. Needed for ID-like fields
   * (visa, passport, bank account, insurance, phone, birth number…) where Excel
   * would otherwise strip leading zeros, drop leading "+", or mis-parse a "/" as
   * a division. Emits `="value"` — Excel's only reliable text escape.
   */
  forceText?: boolean;
}

/**
 * Ordered catalog of every column the export supports.
 * Order matches scripts/seeds/employees.csv so a round-trip export is seed-compatible
 * when every column is selected.
 */
export const EXPORT_COLUMNS: ExportColumn[] = [
  { key: "lastName",          label: "Příjmení",           source: "root",       field: "lastName",          format: "text", group: "basic" },
  { key: "firstName",         label: "Jméno",              source: "root",       field: "firstName",         format: "text", group: "basic" },
  { key: "dateOfBirth",       label: "Datum narození",     source: "root",       field: "dateOfBirth",       format: "date", group: "basic" },
  { key: "gender",            label: "Pohlaví",            source: "root",       field: "gender",            format: "text", group: "basic" },
  { key: "idCardNumber",      label: "Číslo OP",           source: "documents",  field: "idCardNumber",      format: "text", sensitive: true, forceText: true, group: "documents" },
  { key: "passportNumber",    label: "Číslo pasu",         source: "documents",  field: "passportNumber",    format: "text", forceText: true, group: "documents" },
  { key: "passportIssueDate", label: "Vydání pasu",        source: "documents",  field: "passportIssueDate", format: "date", group: "documents" },
  { key: "passportExpiry",    label: "Platnost pasu",      source: "documents",  field: "passportExpiry",    format: "date", group: "documents" },
  { key: "passportAuthority", label: "Vydávající úřad",    source: "documents",  field: "passportAuthority", format: "text", group: "documents" },
  { key: "visaNumber",        label: "Povolení k pobytu",  source: "documents",  field: "visaNumber",        format: "text", forceText: true, group: "documents" },
  { key: "visaIssueDate",     label: "Vydání povolení",    source: "documents",  field: "visaIssueDate",     format: "date", group: "documents" },
  { key: "visaExpiry",        label: "Platnost povolení",  source: "documents",  field: "visaExpiry",        format: "date", group: "documents" },
  { key: "visaType",          label: "Typ povolení",       source: "documents",  field: "visaType",          format: "text", group: "documents" },
  { key: "permanentAddress",  label: "Trvalé bydliště",    source: "contact",    field: "permanentAddress",  format: "text", group: "contact" },
  { key: "contactAddress",    label: "Kontaktní adresa",   source: "contact",    field: "contactAddress",    format: "text", group: "contact" },
  { key: "birthSurname",      label: "Rodné příjmení",     source: "root",       field: "birthSurname",      format: "text", group: "basic" },
  { key: "nationality",       label: "Státní příslušnost", source: "root",       field: "nationality",       format: "text", group: "basic" },
  { key: "placeOfBirth",      label: "Místo narození",     source: "root",       field: "placeOfBirth",      format: "text", group: "basic" },
  { key: "birthNumber",       label: "Rodné číslo",        source: "root",       field: "birthNumber",       format: "text", sensitive: true, forceText: true, group: "sensitive" },
  { key: "maritalStatus",     label: "Rodinný stav",       source: "root",       field: "maritalStatus",     format: "text", group: "basic" },
  { key: "education",         label: "Vzdělání",           source: "root",       field: "education",         format: "text", group: "basic" },
  { key: "phone",             label: "Telefon",            source: "contact",    field: "phone",             format: "text", forceText: true, group: "contact" },
  { key: "email",             label: "E-mail",             source: "contact",    field: "email",             format: "text", group: "contact" },
  { key: "insuranceCompany",  label: "Zdrav. pojišťovna",  source: "benefits",   field: "insuranceCompany",  format: "text", group: "benefits" },
  { key: "insuranceNumber",   label: "Číslo pojištěnce",   source: "benefits",   field: "insuranceNumber",   format: "text", sensitive: true, forceText: true, group: "benefits" },
  { key: "bankAccount",       label: "Číslo účtu",         source: "benefits",   field: "bankAccount",       format: "text", sensitive: true, forceText: true, group: "benefits" },
  { key: "multisport",        label: "Multisport",         source: "benefits",   field: "multisport",        format: "ano", group: "benefits" },
  { key: "homeOffice",        label: "HO",                 source: "benefits",   field: "homeOffice",        format: "numberOrEmpty", group: "benefits" },
  { key: "allowances",        label: "Náhrady",            source: "benefits",   field: "allowances",        format: "ano", group: "benefits" },
  { key: "companyId",         label: "Firma",              source: "root",       field: "currentCompanyId",  format: "text", group: "employment" },
  { key: "contractType",      label: "Typ smlouvy",        source: "root",       field: "currentContractType", format: "text", group: "employment" },
  { key: "signingDate",       label: "Podpis smlouvy",     source: "employment", field: "signingDate",       format: "date", group: "employment" },
  { key: "jobTitle",          label: "Prac. pozice",       source: "root",       field: "currentJobTitle",   format: "text", group: "employment" },
  { key: "department",        label: "Prac. zařazení",     source: "root",       field: "currentDepartment", format: "text", group: "employment" },
  { key: "salary",            label: "Mzda (aktuální)",    source: "employment", field: "salary",            format: "salary", group: "employment" },
  { key: "employedFrom",      label: "Ve firmě od",        source: "employment", field: "startDate",         format: "date", group: "employment" },
];

export const GROUP_LABELS: Record<ColumnGroup, string> = {
  basic:       "Základní údaje",
  documents:   "Doklady",
  contact:     "Kontakt",
  employment:  "Zaměstnání",
  benefits:    "Benefity",
  sensitive:   "Citlivé údaje",
};

/** Row shape returned by GET /api/employees/export. */
export interface ExportRow {
  id: string;
  [rootField: string]: unknown;
  contact: Record<string, unknown>;
  documents: Record<string, unknown>;
  benefits: Record<string, unknown>;
  employment: Record<string, unknown>;
}

// ─── Formatters ──────────────────────────────────────────────────────────────

/**
 * ISO "YYYY-MM-DD" → "DD. MM. YYYY" (seed convention — spaces around dots).
 * Anything else (null/undefined/empty/Firestore Timestamp object) → "".
 *
 * NOTE: we split on "-" instead of constructing a Date to avoid the UTC-shift
 * bug flagged in CLAUDE.md (`new Date("YYYY-MM-DD")` is midnight UTC, which
 * formats to the previous day in UTC+2).
 */
export function formatDateDMY(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  const parts = value.split("-");
  if (parts.length !== 3) return "";
  const [y, m, d] = parts;
  if (!y || !m || !d) return "";
  return `${d.padStart(2, "0")}. ${m.padStart(2, "0")}. ${y}`;
}

/** true / "true" / "ANO" / 1 → "ANO"; anything else → "". */
export function formatAno(value: unknown): string {
  if (value === true) return "ANO";
  if (typeof value === "string" && (value === "ANO" || value === "true" || value === "1")) return "ANO";
  if (typeof value === "number" && value > 0) return "ANO";
  return "";
}

/** 16500 → "16 500"; null / undefined / "" → "". */
export function formatSalary(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return "";
  return n.toLocaleString("cs-CZ").replace(/ /g, " "); // replace NBSP with regular space to match seed
}

/** Number → its string form; null / undefined / "" → "". Used for homeOffice. */
export function formatNumberOrEmpty(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") return Number.isNaN(value) ? "" : String(value);
  if (typeof value === "string") return value;
  return "";
}

// ─── CSV assembly ────────────────────────────────────────────────────────────

const NEEDS_QUOTING = /[;"\r\n]/;

/** RFC-4180 style cell escape with semicolon as the delimiter. */
export function escapeCsvCell(value: string): string {
  if (value === "") return "";
  if (NEEDS_QUOTING.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Pull the raw value for a column from the merged row, then format it. */
export function getCellValue(row: ExportRow, column: ExportColumn): string {
  const source =
    column.source === "root"
      ? (row as unknown as Record<string, unknown>)
      : (row[column.source] as Record<string, unknown> | undefined) ?? {};
  const raw = source[column.field];

  switch (column.format) {
    case "date": return formatDateDMY(raw);
    case "ano": return formatAno(raw);
    case "salary": return formatSalary(raw);
    case "numberOrEmpty": return formatNumberOrEmpty(raw);
    case "text":
    default:
      if (raw === null || raw === undefined) return "";
      return String(raw);
  }
}

/**
 * Format a single CSV cell, applying the column's forceText flag. Excel strips
 * leading zeros and mangles values starting with "+" unless the cell is
 * prefixed with `=` and wrapped in double quotes — i.e. written as `="value"`.
 * That literal is then quoted per RFC 4180 so the inner quotes are doubled.
 */
function formatCsvCell(row: ExportRow, column: ExportColumn): string {
  const value = getCellValue(row, column);
  if (column.forceText && value !== "") {
    return escapeCsvCell(`="${value.replace(/"/g, '""')}"`);
  }
  return escapeCsvCell(value);
}

export function toCsv(rows: ExportRow[], columns: ExportColumn[]): string {
  const header = columns.map((c) => escapeCsvCell(c.label)).join(";");
  const body = rows
    .map((row) => columns.map((c) => formatCsvCell(row, c)).join(";"))
    .join("\r\n");
  return body.length > 0 ? `${header}\r\n${body}\r\n` : `${header}\r\n`;
}

// ─── Download ────────────────────────────────────────────────────────────────

/**
 * Trigger a browser download. Prepends a UTF-8 BOM so Excel on Windows
 * renders Czech diacritics correctly when the file is opened directly.
 */
export function downloadCsv(filename: string, csv: string): void {
  const BOM = "﻿";
  const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** "zamestnanci_YYYY-MM-DD.csv" using local date (never toISOString)*/
export function defaultExportFilename(today = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = today.getFullYear();
  const mm = pad(today.getMonth() + 1);
  const dd = pad(today.getDate());
  return `zamestnanci_${yyyy}-${mm}-${dd}.csv`;
}

/**
 * Normalize a user-provided filename:
 *   - strip characters forbidden in Windows/macOS filenames (`\\ / : * ? " < > |`)
 *   - trim
 *   - ensure a ".csv" suffix (case-insensitive)
 *   - fall back to the default if the user cleared the field entirely
 */
export function sanitizeFilename(input: string, fallback = defaultExportFilename()): string {
  const stripped = input.replace(/[\\/:*?"<>|]/g, "").trim();
  if (!stripped) return fallback;
  return /\.csv$/i.test(stripped) ? stripped : `${stripped}.csv`;
}
