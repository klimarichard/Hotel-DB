/**
 * Escape a string for safe interpolation into an HTML string that will be
 * assigned to `innerHTML` (the client-side PDF builders in PayrollPage /
 * ShiftPlannerPage build a full HTML document from employee data and render it
 * via html2pdf). Without this, an employee name containing markup — e.g.
 * `<img onerror=…>` — would be injected into the generated document.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
