/**
 * Test clock — lets a fake "current time" be set in NON-PRODUCTION only, so
 * time-dependent behaviour (probation/document/multisport sweeps, plan
 * deadline transitions) can be tested without waiting for real calendar time.
 *
 * Stored in Firestore at settings/timeOverride as a signed offset:
 *
 *     fakeNow = realNow + offsetMs        (offset mode → the clock keeps ticking)
 *
 * SAFETY (data integrity): the override is honoured ONLY in the local emulator
 * and the staging project. In production — or any environment we cannot
 * positively identify as emulator/staging — now()/nowMs() return the real time
 * unconditionally. Production business logic can never run on a faked clock,
 * regardless of what the settings/timeOverride doc says.
 *
 * now()/nowMs() are synchronous and read an in-memory cached offset. Call
 * refresh() at the start of each request (Express middleware does this) and at
 * the start of each scheduled job to pull the latest override; it's TTL-cached
 * so it only actually re-reads Firestore every TTL_MS.
 */
import * as admin from "firebase-admin";

const STAGING_PROJECT_ID = "hote-hr-app-staging";

function projectId(): string | undefined {
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;
  if (process.env.GCP_PROJECT) return process.env.GCP_PROJECT;
  try {
    return JSON.parse(process.env.FIREBASE_CONFIG || "{}").projectId;
  } catch {
    return undefined;
  }
}

/**
 * True only where faking time is safe. Note the emulator runs under the prod
 * project id, so the FUNCTIONS_EMULATOR check MUST come first. Anything that
 * isn't positively the emulator or the staging project is treated as prod.
 */
function overrideAllowed(): boolean {
  if (process.env.FUNCTIONS_EMULATOR === "true") return true;
  return projectId() === STAGING_PROJECT_ID;
}

let cachedOffsetMs = 0;
let cacheExpiry = 0;
const TTL_MS = 30_000;

const docRef = () => admin.firestore().collection("settings").doc("timeOverride");

export interface TimeOverrideState {
  enabled: boolean;
  offsetMs: number;
  targetISO: string | null; // the instant the admin jumped to (at set time)
  setAtISO: string | null; // real wall-clock time when it was set
  setBy: string | null;
}

const REAL_STATE: TimeOverrideState = {
  enabled: false,
  offsetMs: 0,
  targetISO: null,
  setAtISO: null,
  setBy: null,
};

/** Re-read the override doc if the TTL cache has expired. No-op in production. */
export async function refresh(force = false): Promise<void> {
  if (!overrideAllowed()) {
    cachedOffsetMs = 0;
    return;
  }
  const real = Date.now();
  if (!force && real < cacheExpiry) return;
  cacheExpiry = real + TTL_MS;
  try {
    const snap = await docRef().get();
    const data = snap.exists ? (snap.data() as Record<string, unknown>) : null;
    cachedOffsetMs =
      data && data.enabled === true && typeof data.offsetMs === "number"
        ? (data.offsetMs as number)
        : 0;
  } catch {
    cachedOffsetMs = 0; // fail safe → real time
  }
}

/** Current time, honouring a non-prod override. Synchronous. */
export function now(): Date {
  return new Date(Date.now() + (overrideAllowed() ? cachedOffsetMs : 0));
}

export function nowMs(): number {
  return Date.now() + (overrideAllowed() ? cachedOffsetMs : 0);
}

/** Full override state for the API/UI. Reads live (bypasses the cache). */
export async function getState(): Promise<TimeOverrideState> {
  if (!overrideAllowed()) return { ...REAL_STATE };
  const snap = await docRef().get();
  const d = (snap.exists ? snap.data() : null) as Record<string, unknown> | null;
  if (!d || d.enabled !== true) return { ...REAL_STATE };
  return {
    enabled: true,
    offsetMs: typeof d.offsetMs === "number" ? (d.offsetMs as number) : 0,
    targetISO: (d.targetISO as string) ?? null,
    setAtISO: (d.setAtISO as string) ?? null,
    setBy: (d.setBy as string) ?? null,
  };
}

export function isOverrideAllowed(): boolean {
  return overrideAllowed();
}

export { docRef as overrideDocRef };
