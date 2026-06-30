/**
 * Human-readable rendering for audit field values. THE RULE: the change log must
 * never show a raw identifier (field key, permission key, page key, doc/job code,
 * internal doc-id) — every value resolves to the same Czech text the app shows.
 *
 * Resolution is TARGETED per field leaf (a blanket "humanise camelCase" would
 * wrongly mangle real values like the insurer code "VoZP"), reusing the app's
 * own label sources: field-label maps, the RBAC catalogue, the menu registry,
 * the contract-variable defs, plus small maps for doc/job codes mirrored from
 * the UI. Returns a string, or null to HIDE the row (internal-only fields).
 */
import { formatAuditValue } from "./format";
import { fieldLabel } from "./labels";
import { nationalityName } from "@/lib/nationalities";
import { PERMISSION_SECTIONS } from "@/lib/permissions/catalog";
import { MENU_ITEMS } from "@/lib/menuItems";
import { VARIABLE_GROUPS } from "@/lib/contractVariables";

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function isNullish(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

// ── Flat label maps built from the app's own sources ─────────────────────────
const PERMISSION_LABELS = (() => {
  const m = new Map<string, string>();
  for (const sec of PERMISSION_SECTIONS)
    for (const sub of sec.subsections) for (const it of sub.items) m.set(it.key, it.label);
  return m;
})();
const MENU_LABELS = new Map(MENU_ITEMS.map((i) => [i.id, i.label] as const));
const VARIABLE_LABELS = (() => {
  const m = new Map<string, string>();
  for (const g of VARIABLE_GROUPS) for (const v of g.vars) m.set(v.key, v.label);
  return m;
})();

// Document codes (audit extra.document) — mirrors the UI buttons.
const DOC_TYPE_LABELS: Record<string, string> = {
  taxDeclaration: "Prohlášení poplatníka",
  questionnaire: "Osobní dotazník",
};
// Manual-trigger job codes (audit extra.trigger) — mirrors Settings → Úlohy titles.
const TRIGGER_LABELS: Record<string, string> = {
  refreshDocumentAlerts: "Upozornění na doklady",
  updateDocumentAlerts: "Upozornění na doklady",
  refreshAllProbationAlerts: "Upozornění na zkušební doby",
  refreshEffectiveRootForAllActive: "Aktuální údaje zaměstnanců",
  sweepMultisport: "Údržba Multisportu",
  sweepExpiredMultisport: "Údržba Multisportu",
  checkPlanDeadlines: "Přechody plánů směn",
  transitionPlanDeadlines: "Přechody plánů směn",
  refreshPayroll: "Aktualizace mezd",
};

// Resolve a value that is a KEY (or array of keys) via a key→label function.
// Unknown keys still go through the fn (e.g. fieldLabel humanises), never raw.
function resolveKeys(value: unknown, label: (k: string) => string): string {
  const arr = Array.isArray(value) ? value : [value];
  const out = arr.filter((x) => typeof x === "string" && x).map((x) => label(x as string));
  return out.length ? out.join(", ") : formatAuditValue(value);
}

// ── Per-shape renderers ──────────────────────────────────────────────────────
function renderOverrides(v: unknown): string {
  if (!isObj(v)) return formatAuditValue(v);
  const parts = Object.entries(v)
    .filter(([, val]) => !isNullish(val))
    .map(([k, val]) => `${fieldLabel("payrollPeriods/entries", k)}: ${formatAuditValue(val, k)}`);
  return parts.length ? parts.join(", ") : "—";
}
function renderPeriods(v: unknown): string {
  if (!Array.isArray(v) || !v.length) return "—";
  return v
    .map((p) => {
      const o = isObj(p) ? p : {};
      return `${o.from ? formatAuditValue(o.from) : "?"} – ${o.to ? formatAuditValue(o.to) : "trvá"}`;
    })
    .join("; ");
}
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
  "počet hodin": "Počet hodin týdně",
};
function renderChanges(v: unknown): string {
  if (!Array.isArray(v) || !v.length) return "—";
  return v
    .map((c) => {
      const o = isObj(c) ? c : {};
      const kind = typeof o.changeKind === "string" ? o.changeKind : "";
      return `${CHANGE_KIND_LABELS[kind] ?? kind ?? "Změna"}: ${formatAuditValue(o.value)}`;
    })
    .join("; ");
}
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
    return n !== undefined && JOB_RESULT_PHRASES[k] ? JOB_RESULT_PHRASES[k](n) : `${k}: ${formatAuditValue(val)}`;
  });
  return parts.length ? parts.join(", ") : "—";
}

// Internal foreign-key / bookkeeping fields with no human-meaningful value —
// the record's identity is already in the card title, so hide these rows.
const HIDDEN_ID_LEAVES = new Set([
  "departmentId",
  "employeeId",
  "sourcePlanId",
  "sourceNoteId",
  "deletedDueToEmploymentRowDelete",
]);
// An array is a menu-order list iff every element is a known menu page key —
// detected by shape (not leaf name) so CUSTOM role types (e.g. "rezervace")
// are covered too, not just the built-in roles.
function isMenuOrderArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" && MENU_LABELS.has(x));
}

/** Live lookups the caller injects (data the static maps can't know). */
export interface RenderOpts {
  /** user-type id → its display name (for roleType / legacy role fields). */
  resolveType?: (id: string) => string | undefined;
}

/**
 * Render an audit value for display, or null to hide the field row entirely.
 * Dispatch is by field leaf, so each identifier class resolves to in-app text.
 */
export function renderAuditFieldValue(
  fieldPath: string | undefined,
  value: unknown,
  opts?: RenderOpts
): string | null {
  const leaf = (fieldPath ?? "").split(".").pop() ?? "";
  if (HIDDEN_ID_LEAVES.has(leaf)) return null;
  switch (leaf) {
    case "autoOverrides":
      return null; // system recompute noise (hidden per decision)
    case "overrides":
      return renderOverrides(value);
    case "multisportPeriods":
      return renderPeriods(value);
    case "multisportCompanions":
      return renderCompanions(value);
    case "changes":
      return renderChanges(value);
    case "result":
      return renderJobResult(value);
    case "extraPermissions":
    case "revokedPermissions":
    case "permissions":
      return resolveKeys(value, (k) => PERMISSION_LABELS.get(k) ?? k);
    case "recalculatedFields":
      return resolveKeys(value, (k) => fieldLabel("payrollPeriods", k));
    case "fields":
    case "fieldName":
      return resolveKeys(value, (k) => fieldLabel("employees", k));
    case "variables":
      return resolveKeys(value, (k) => VARIABLE_LABELS.get(k) ?? k);
    case "document":
      return typeof value === "string" ? DOC_TYPE_LABELS[value] ?? value : formatAuditValue(value);
    case "trigger":
      return typeof value === "string" ? TRIGGER_LABELS[value] ?? value : formatAuditValue(value);
    case "nationality":
      // App shows the resolved country name (nationalityName), not the code.
      return typeof value === "string" && value ? nationalityName(value) : formatAuditValue(value);
    case "roleType":
    case "role":
      // User-type id → its display name (matches user management).
      return typeof value === "string" && value
        ? opts?.resolveType?.(value) ?? value
        : formatAuditValue(value);
    default:
      if (isMenuOrderArray(value)) return resolveKeys(value, (k) => MENU_LABELS.get(k) ?? k);
      return formatAuditValue(value, leaf);
  }
}
