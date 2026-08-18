/**
 * Scheduled-job run recording + health.
 *
 * Until this existed the ten `onSchedule` functions in index.ts only
 * `console.log`ed, so a failure was visible in Cloud Functions logs and NOWHERE
 * in the app. Every scheduled function now runs inside `runJob()`, which stamps
 * `jobRuns/{jobId}` with the outcome, and Upozornění → Úlohy reads that back.
 *
 * Two failure modes are deliberately distinguished, because the second is the
 * one that used to go unnoticed indefinitely:
 *   - "error"   — the job ran and threw.
 *   - "overdue" — the job has not SUCCEEDED within its schedule + grace. Covers a
 *                 job that stopped being invoked at all, or that dies before it
 *                 can record anything (a crash inside runJob's own write, an OOM,
 *                 a deploy that dropped the trigger). No record is written in
 *                 those cases, so error-only monitoring would stay silent.
 */
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import * as clock from "./clock";

const db = () => admin.firestore();
const COL = "jobRuns";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Overdue grace, as a multiple of the nominal period: a job is late only once it
 * has missed its slot by half a period on top of it (1.5 × period since the last
 * success). Absorbs the ordinary jitter of Cloud Scheduler — "every 24 hours" is
 * not a wall-clock guarantee, and a run landing a few minutes late must not alert.
 */
export const OVERDUE_FACTOR = 1.5;

export interface JobDef {
  /** Firestore doc id under jobRuns/ — stable, never rename (it IS the history). */
  id: string;
  /** Czech label shown in Upozornění → Úlohy. */
  title: string;
  /** One-line Czech description of what the job does. */
  description: string;
  /** Czech rendering of the schedule, for the UI. */
  schedule: string;
  /** Nominal gap between runs, used for the overdue calculation. */
  periodMs: number;
  /**
   * The `trigger-*` endpoint that re-runs this job by hand, where one exists.
   * Four of the ten have none — surfaced in the UI so nobody hunts for a button
   * that was never built.
   */
  triggerEndpoint?: string;
}

/**
 * The ten scheduled functions in index.ts. Keep in step with them: an entry here
 * with no `runJob()` wrapper reports "unknown" forever, and a wrapped function
 * with no entry here is recorded but never displayed.
 */
export const JOB_DEFS: readonly JobDef[] = [
  {
    id: "checkPlanDeadlines",
    title: "Přechody plánů směn",
    description:
      "Provede naplánované přechody stavů plánů směn (otevření, uzávěrka, publikování), jejichž čas už nastal.",
    schedule: "každých 5 minut",
    periodMs: 5 * MINUTE,
    triggerEndpoint: "/shifts/trigger-deadlines",
  },
  {
    id: "checkScheduledDeactivations",
    title: "Naplánovaná deaktivace účtů",
    description: "Deaktivuje uživatelské účty, u kterých nastal naplánovaný čas deaktivace.",
    schedule: "každých 5 minut",
    periodMs: 5 * MINUTE,
  },
  {
    id: "refreshPayroll",
    title: "Přepočet mezd",
    description:
      "Přepočítá mzdová období všech publikovaných plánů směn, aby se do nich promítly dodatečné úpravy směn. Uzamčená období přeskakuje.",
    schedule: "každých 24 hodin",
    periodMs: DAY,
  },
  {
    id: "sweepMultisport",
    title: "Údržba Multisportu",
    description: "Ukončí Multisport období, kterým vypršela platnost.",
    schedule: "každých 24 hodin",
    periodMs: DAY,
    triggerEndpoint: "/benefits/trigger-multisport-sweep",
  },
  {
    id: "refreshProbationAlerts",
    title: "Upozornění na zkušební doby",
    description: "Přepočítá upozornění na blížící se konce zkušebních dob.",
    schedule: "každých 24 hodin",
    periodMs: DAY,
    triggerEndpoint: "/employees/trigger-probation-refresh",
  },
  {
    id: "refreshDocumentAlerts",
    title: "Upozornění na doklady",
    description: "Přepočítá upozornění na expiraci dokladů zaměstnanců.",
    schedule: "každých 24 hodin",
    periodMs: DAY,
    triggerEndpoint: "/employees/trigger-alert-refresh",
  },
  {
    id: "refreshEmployeeEffective",
    title: "Aktuální údaje zaměstnanců",
    description:
      "Přepočítá denormalizované aktuální údaje (pozice, oddělení, smlouva) u všech aktivních zaměstnanců.",
    schedule: "denně v 00:00",
    periodMs: DAY,
    triggerEndpoint: "/employees/trigger-effective-refresh",
  },
  {
    id: "sweepRecepceHistory",
    title: "Úklid historie recepce",
    description:
      "Smaže záznamy historie a auditu předávacích protokolů starší než retenční lhůta.",
    schedule: "denně v 00:00",
    periodMs: DAY,
    triggerEndpoint: "/recepce/trigger-retention-sweep",
  },
  {
    id: "sweepSmenarnaSnapshots",
    title: "Úklid snímků směnárny",
    description: "Smaže snímky kurzovního lístku směnárny starší než 6 měsíců.",
    schedule: "denně v 00:15",
    periodMs: DAY,
  },
  {
    id: "rolloverVacationYear",
    title: "Roční nárok na dovolenou",
    description:
      "Založí nový ročník dovolenkové evidence a naplní letošní nárok všem zaměstnancům. Loňský zůstatek se nepřevádí automaticky.",
    schedule: "1. ledna v 01:00",
    periodMs: 365 * DAY,
    triggerEndpoint: "/employees/trigger-vacation-rollover",
  },
];

export type JobHealth = "ok" | "error" | "overdue" | "unknown";

export interface JobRunRecord {
  lastStatus?: "ok" | "error";
  lastRunAt?: Timestamp;
  lastSuccessAt?: Timestamp;
  lastFailureAt?: Timestamp;
  lastDurationMs?: number;
  lastError?: string | null;
  consecutiveFailures?: number;
}

/**
 * Wrap a scheduled function body. Records the outcome and RE-THROWS on failure —
 * swallowing the error would hide it from Cloud Functions' own error reporting
 * and suppress the platform's retry, trading one blind spot for another.
 *
 * Timestamps come from `clock.nowMs()`, not `serverTimestamp()`, so recording and
 * the overdue comparison in `healthOf()` read the same clock. Under the staging
 * test clock a serverTimestamp write would be compared against a shifted "now",
 * and every job would read as overdue the moment the clock jumps forward.
 *
 * Recording must never fail the job itself: the write is best-effort, and on the
 * failure path the original error always wins.
 */
export async function runJob(jobId: string, fn: () => Promise<void>): Promise<void> {
  const ref = db().collection(COL).doc(jobId);
  // Real elapsed time — a duration must not be distorted by the test clock.
  const startedAt = Date.now();

  try {
    await fn();
  } catch (err) {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    try {
      const prev = ((await ref.get()).data()?.consecutiveFailures as number | undefined) ?? 0;
      await ref.set(
        {
          jobId,
          lastStatus: "error",
          lastRunAt: Timestamp.fromMillis(clock.nowMs()),
          lastFailureAt: Timestamp.fromMillis(clock.nowMs()),
          lastDurationMs: Date.now() - startedAt,
          // Truncated: a stack raised from inside a long loop can be enormous,
          // and the tab only ever shows the head of it.
          lastError: message.slice(0, 4000),
          consecutiveFailures: prev + 1,
        },
        { merge: true }
      );
    } catch (recordErr) {
      console.error(`[jobRuns] failed to record FAILURE of ${jobId}`, recordErr);
    }
    throw err;
  }

  try {
    await ref.set(
      {
        jobId,
        lastStatus: "ok",
        lastRunAt: Timestamp.fromMillis(clock.nowMs()),
        lastSuccessAt: Timestamp.fromMillis(clock.nowMs()),
        lastDurationMs: Date.now() - startedAt,
        // Explicitly cleared: set(merge:true) never removes an omitted key, so
        // without this the previous failure's message would survive a success.
        lastError: null,
        consecutiveFailures: 0,
      },
      { merge: true }
    );
  } catch (recordErr) {
    console.error(`[jobRuns] failed to record SUCCESS of ${jobId}`, recordErr);
  }
}

/**
 * Health of one job.
 *
 * ⚠️ "Never recorded" is `unknown`, NOT a failure. Every job starts with no record
 * on the day this ships, and the yearly rollover legitimately has none until the
 * next 1 January — reporting those as broken would make the tab cry wolf on day
 * one and teach everyone to ignore it.
 */
export function healthOf(
  def: JobDef,
  rec: JobRunRecord | undefined,
  nowMs: number
): JobHealth {
  if (!rec || (!rec.lastSuccessAt && !rec.lastFailureAt)) return "unknown";
  if (rec.lastStatus === "error") return "error";
  if (!rec.lastSuccessAt) return "unknown";
  const sinceMs = nowMs - rec.lastSuccessAt.toMillis();
  return sinceMs > def.periodMs * OVERDUE_FACTOR ? "overdue" : "ok";
}

/** True for the health values the Úlohy tab raises as an alert. */
export function isAlerting(health: JobHealth): boolean {
  return health === "error" || health === "overdue";
}

/** Every job with its latest record and computed health, in JOB_DEFS order. */
export async function listJobHealth(): Promise<
  Array<JobDef & JobRunRecord & { health: JobHealth }>
> {
  const snap = await db().collection(COL).get();
  const byId = new Map<string, JobRunRecord>();
  snap.docs.forEach((d) => byId.set(d.id, d.data() as JobRunRecord));

  const nowMs = clock.nowMs();
  return JOB_DEFS.map((def) => {
    const rec = byId.get(def.id);
    return { ...def, ...(rec ?? {}), health: healthOf(def, rec, nowMs) };
  });
}
