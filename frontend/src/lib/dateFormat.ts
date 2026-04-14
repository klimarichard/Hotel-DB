/**
 * Centralised Czech date formatting helpers.
 *
 * Czech convention: DD.MM.YYYY (dots, no spaces).
 * All user-facing date displays in the app should use these helpers.
 *
 * NOT for use with:
 *   - <input type="date">  (needs YYYY-MM-DD)
 *   - Firestore document keys or composite IDs (need ISO)
 */

type FirestoreTimestamp = { seconds?: number; _seconds?: number } | null | undefined;

/**
 * Format an ISO date string (YYYY-MM-DD) as DD.MM.YYYY.
 * Returns "" for null/undefined/empty input so it plays nicely with val() wrappers.
 * Uses string splitting rather than new Date() to avoid timezone shifts.
 */
export function formatDateCZ(iso: string | null | undefined): string {
  if (!iso) return "";
  const parts = iso.split("-");
  if (parts.length !== 3) return iso; // fallback for unexpected formats
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

/**
 * Format a Firestore Timestamp as DD.MM.YYYY (date only).
 * Handles both `seconds` and `_seconds` field names (admin SDK variance).
 */
export function formatTimestampCZ(ts: FirestoreTimestamp): string {
  if (!ts) return "—";
  const secs = ts.seconds ?? ts._seconds;
  if (secs === undefined) return "—";
  const d = new Date(secs * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/**
 * Format a Firestore Timestamp as DD.MM.YYYY HH:MM:SS.
 * Used for request panels where the precise time is meaningful for ordering.
 */
export function formatDatetimeCZ(ts: FirestoreTimestamp): string {
  if (!ts) return "—";
  const secs = ts.seconds ?? ts._seconds;
  if (secs === undefined) return "—";
  const d = new Date(secs * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}
