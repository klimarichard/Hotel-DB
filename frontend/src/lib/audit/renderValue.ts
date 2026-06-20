/**
 * Bespoke, human-readable rendering for audit field values that would otherwise
 * surface as machine output (objects / arrays of objects). Dispatch is by field
 * leaf name. Returns a display string, or `null` to HIDE the row entirely.
 *
 * Decisions (2026-06-20, with the user):
 * - Payroll entry edits: show only the manual `overrides` (Czech labels from the
 *   payroll field map); HIDE `autoOverrides` (system recompute noise).
 * - Multisport periods/companions: human summary, internal `id` hidden, dates
 *   formatted, price in Kč.
 * - Employment Dodatek `changes[]`: "Mzda: 28 000" style.
 * - Job-run results (`extra.result`): a Czech sentence ("Aktualizováno 107 záznamů").
 * - Everything else falls through to formatAuditValue (which never emits JSON).
 */
import { formatAuditValue } from "./format";
import { fieldLabel } from "./labels";

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function isNullish(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

// Payroll manual overrides {vacationHours:24, extraPay:500} →
// "Dovolená: 24, Navíc: 500" (labels from the payroll field map).
function renderOverrides(v: unknown): string {
  if (!isObj(v)) return formatAuditValue(v);
  const parts = Object.entries(v)
    .filter(([, val]) => !isNullish(val))
    .map(([k, val]) => `${fieldLabel("payrollPeriods/entries", k)}: ${formatAuditValue(val, k)}`);
  return parts.length ? parts.join(", ") : "—";
}

// Multisport periods [{from,to}] → "1.1.2026 – trvá; 1.6.2025 – 1.11.2025".
function renderPeriods(v: unknown): string {
  if (!Array.isArray(v) || !v.length) return "—";
  return v
    .map((p) => {
      const o = isObj(p) ? p : {};
      const from = o.from ? formatAuditValue(o.from) : "?";
      const to = o.to ? formatAuditValue(o.to) : "trvá";
      return `${from} – ${to}`;
    })
    .join("; ");
}

// Multisport companions [{name,from,to,price,id}] →
// "Patrik Valenta (1.1.2026 – trvá, 1 800 Kč)" — internal id hidden.
function renderCompanions(v: unknown): string {
  if (!Array.isArray(v) || !v.length) return "—";
  return v
    .map((c) => {
      const o = isObj(c) ? c : {};
      const name = typeof o.name === "string" && o.name.trim() ? o.name : "Doprovodná osoba";
      const from = o.from ? formatAuditValue(o.from) : "?";
      const to = o.to ? formatAuditValue(o.to) : "trvá";
      const price = !isNullish(o.price) ? `, ${formatAuditValue(o.price)} Kč` : "";
      return `${name} (${from} – ${to}${price})`;
    })
    .join("; ");
}

const CHANGE_KIND_LABELS: Record<string, string> = {
  mzda: "Mzda",
  "pracovní pozice": "Pozice",
  úvazek: "Úvazek",
  "délka smlouvy": "Délka smlouvy",
};

// Employment Dodatek changes[] [{changeKind,value}] → "Mzda: 28 000; Pozice: Recepční".
function renderChanges(v: unknown): string {
  if (!Array.isArray(v) || !v.length) return "—";
  return v
    .map((c) => {
      const o = isObj(c) ? c : {};
      const kind = typeof o.changeKind === "string" ? o.changeKind : "";
      const label = CHANGE_KIND_LABELS[kind] ?? kind ?? "Změna";
      return `${label}: ${formatAuditValue(o.value)}`;
    })
    .join("; ");
}

// Manual job-run results → a Czech sentence. Numeric or array-length values.
const JOB_RESULT_PHRASES: Record<string, (n: number) => string> = {
  refreshed: (n) => `Aktualizováno ${n} záznamů`,
  scanned: (n) => `Zkontrolováno ${n} záznamů`,
  updated: (n) => `Změněno ${n} záznamů`,
  transitioned: (n) => `Změněno ${n} plánů`,
  unticked: (n) => `Upraveno ${n} záznamů`,
};
function renderJobResult(v: unknown): string {
  if (!isObj(v)) return formatAuditValue(v);
  const num = (x: unknown) => (typeof x === "number" ? x : Array.isArray(x) ? x.length : undefined);
  const parts = Object.entries(v).map(([k, val]) => {
    const n = num(val);
    return n !== undefined && JOB_RESULT_PHRASES[k]
      ? JOB_RESULT_PHRASES[k](n)
      : `${k}: ${formatAuditValue(val)}`;
  });
  return parts.length ? parts.join(", ") : "—";
}

/**
 * Render an audit value for display, or return null to hide the field entirely.
 * `fieldPath` drives the special-case dispatch (by leaf name).
 */
export function renderAuditFieldValue(fieldPath: string | undefined, value: unknown): string | null {
  const leaf = (fieldPath ?? "").split(".").pop() ?? "";
  switch (leaf) {
    case "autoOverrides":
      return null; // system recompute noise — hidden per decision
    case "overrides":
      return renderOverrides(value);
    case "multisportPeriods":
      return renderPeriods(value);
    case "multisportCompanions":
      return renderCompanions(value);
    case "changes":
      return renderChanges(value);
    case "result":
      return renderJobResult(value); // manual-trigger extra.result
    default:
      return formatAuditValue(value, leaf);
  }
}
