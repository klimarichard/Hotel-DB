/**
 * Centralised Czech date formatting helpers.
 *
 * Convention used throughout the app: "DD. MM. YYYY" — Czech-style,
 * with spaces between segments. Every user-facing date display goes
 * through these helpers, including contract output, so changing the
 * convention is a one-line edit here.
 *
 * NOT for use with:
 *   - <input type="date">  (needs YYYY-MM-DD)
 *   - Firestore document keys or composite IDs (need ISO)
 */

type FirestoreTimestamp = { seconds?: number; _seconds?: number } | null | undefined;

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Format an ISO date string (YYYY-MM-DD) or a JS Date as "DD. MM. YYYY".
 * Returns "" for null/undefined/empty input so it plays nicely with val()
 * wrappers. For ISO strings, uses string splitting rather than new Date()
 * to avoid timezone shifts.
 */
export function formatDateCZ(input: string | Date | null | undefined): string {
  if (!input) return "";
  if (input instanceof Date) {
    return `${pad(input.getDate())}. ${pad(input.getMonth() + 1)}. ${input.getFullYear()}`;
  }
  const parts = input.split("-");
  if (parts.length !== 3) return input; // fallback for unexpected formats
  return `${parts[2]}. ${parts[1]}. ${parts[0]}`;
}

/**
 * Format a Firestore Timestamp as "DD. MM. YYYY" (date only).
 * Handles both `seconds` and `_seconds` field names (admin SDK variance).
 */
export function formatTimestampCZ(ts: FirestoreTimestamp): string {
  if (!ts) return "—";
  const secs = ts.seconds ?? ts._seconds;
  if (secs === undefined) return "—";
  const d = new Date(secs * 1000);
  return `${pad(d.getDate())}. ${pad(d.getMonth() + 1)}. ${d.getFullYear()}`;
}

/**
 * Format a Firestore Timestamp as "DD. MM. YYYY HH:MM:SS".
 * Used for request panels where the precise time is meaningful for ordering.
 */
export function formatDatetimeCZ(ts: FirestoreTimestamp): string {
  if (!ts) return "—";
  const secs = ts.seconds ?? ts._seconds;
  if (secs === undefined) return "—";
  const d = new Date(secs * 1000);
  return (
    `${pad(d.getDate())}. ${pad(d.getMonth() + 1)}. ${d.getFullYear()} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}
