/**
 * Frontend mirror of the backend test clock (functions/src/services/clock.ts).
 * Holds a signed offset so the UI shows the same fake "now" as the server
 * (fakeNow = realNow + offsetMs). Every "what is today/now" computation in the
 * app reads now()/today() from here, so an active override shifts the whole UI.
 *
 * The offset is fed by TimeOverrideContext (which fetches it from
 * GET /api/settings/time-override). localStorage caches it purely to avoid a
 * flash of real time on first paint — the server is the source of truth, and
 * in production the server always reports offset 0, so the cache self-corrects.
 *
 * NOTE: in production this is always a no-op (offset stays 0); the backend
 * never honours an override there, and the settings UI to set one is hidden.
 */
const LS_KEY = "hotel_hr_time_offset_ms";

function readCache(): number {
  const v = Number(localStorage.getItem(LS_KEY));
  return Number.isFinite(v) ? v : 0;
}

let offsetMs = readCache();

export function setOffsetMs(ms: number): void {
  offsetMs = Number.isFinite(ms) ? ms : 0;
  localStorage.setItem(LS_KEY, String(offsetMs));
}

export function getOffsetMs(): number {
  return offsetMs;
}

/** Current instant, honouring the active offset. */
export function now(): Date {
  return new Date(Date.now() + offsetMs);
}

/**
 * Today as YYYY-MM-DD in local time. Matches how dates are stored/compared
 * across the app, and avoids the new Date(...).toISOString() off-by-one.
 */
export function today(): string {
  const d = now();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
