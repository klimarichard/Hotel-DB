/**
 * One-line recap of what a manually triggered maintenance job returned.
 *
 * Every `trigger-*` endpoint answers with a small flat object of counters
 * (`{ transitioned: 2, skipped: 0 }`), but the shape differs per job, so the
 * summary is built generically rather than per-job.
 *
 * Shared by the two surfaces that can start a job by hand – Nastavení → Úlohy
 * and Upozornění → Úlohy – so a change to the wording cannot land on only one
 * of them.
 */
export function summarizeJobResult(result: unknown): string {
  if (result && typeof result === "object") {
    const parts = Object.entries(result as Record<string, unknown>)
      .filter(([, v]) => typeof v === "number" || typeof v === "string" || typeof v === "boolean")
      .map(([k, v]) => `${k}: ${v}`);
    if (parts.length) return parts.join(", ");
  }
  return "";
}
