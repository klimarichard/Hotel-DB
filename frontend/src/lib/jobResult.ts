import { formatIsoDatetimeCZ } from "./dateFormat";

/**
 * One-line Czech recap of what a manually triggered maintenance job returned.
 *
 * Every `trigger-*` endpoint answers with a small flat object of counters, but
 * the shape differs per job, so the summary is built generically rather than
 * per-job. The keys are the SERVER's field names and therefore English
 * (`{ plans: 32, refreshed: 32 }`) — this is where they become Czech, because
 * the alternative is renaming backend fields for the sake of a status line.
 *
 * Shared by the two surfaces that can start a job by hand – Nastavení → Úlohy
 * and Upozornění → Úlohy – so a change to the wording cannot land on only one
 * of them.
 */

/**
 * Czech label per result key, covering every key the ten jobs return today:
 *
 *   checkPlanDeadlines           { transitioned }   (array – not summarised)
 *   sweepMultisport              { unticked }
 *   refreshProbationAlerts       { scanned }
 *   refreshDocumentAlerts        bare number        (not summarised)
 *   refreshEmployeeEffective     { scanned, updated }
 *   checkScheduledDeactivations  { scanned, deactivated }
 *   sweepRecepceHistory          { cutoffISO, auditDeleted, historyDeleted }
 *   sweepSmenarnaSnapshots       { cutoffISO, deleted }
 *   refreshPayroll               { plans, refreshed }
 *
 * (`rolloverVacationYear` never reaches here — JobsTab formats its richer result
 * with its own `rolloverCounts()`.)
 *
 * ⚠️ Labels are deliberately short: the job's own title sits right above the line
 * and supplies the context, so "smazáno: 4" beats repeating "snímků směnárny".
 */
const RESULT_LABELS: Record<string, string> = {
  scanned: "zkontrolováno",
  updated: "aktualizováno",
  refreshed: "přepočítáno",
  plans: "plánů",
  unticked: "ukončeno období",
  deactivated: "deaktivováno",
  deleted: "smazáno",
  auditDeleted: "smazáno auditních záznamů",
  historyDeleted: "smazáno záznamů historie",
  cutoffISO: "starší než",
};

/**
 * An unknown key keeps its raw name rather than being hidden. A future job field
 * with no label here is then visibly untranslated — which is a prompt to add one.
 * Dropping it instead would silently swallow a counter somebody added on purpose.
 */
function labelFor(key: string): string {
  return RESULT_LABELS[key] ?? key;
}

/** Dates arrive as ISO strings; everything else prints as-is. */
function formatValue(key: string, value: number | string | boolean): string {
  if (typeof value === "boolean") return value ? "ano" : "ne";
  if (key.endsWith("ISO") && typeof value === "string") return formatIsoDatetimeCZ(value);
  return String(value);
}

export function summarizeJobResult(result: unknown): string {
  if (result && typeof result === "object") {
    const parts = Object.entries(result as Record<string, unknown>)
      .filter(([, v]) => typeof v === "number" || typeof v === "string" || typeof v === "boolean")
      .map(([k, v]) => `${labelFor(k)}: ${formatValue(k, v as number | string | boolean)}`);
    if (parts.length) return parts.join(", ");
  }
  return "";
}
