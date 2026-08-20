import { useCallback, useEffect, useState } from "react";
import Button from "@/components/Button";
import ConfirmModal from "@/components/ConfirmModal";
import { useScheduledJobsContext } from "@/context/ScheduledJobsContext";
import { api, ApiError } from "@/lib/api";
import { formatDatetimeCZ } from "@/lib/dateFormat";
import { summarizeJobResult } from "@/lib/jobResult";
import styles from "../AlertsPage.module.css";
import own from "./ScheduledJobsTab.module.css";

/**
 * Upozornění → Úlohy: health of the ten scheduled maintenance functions.
 *
 * Read-only view over `jobRuns/{jobId}`, written by `runJob()` around every
 * `onSchedule` body (functions/src/services/jobRuns.ts). The health rule itself
 * lives on the server so this tab cannot drift from it — the client only renders
 * the `health` it is given.
 *
 * The one write it can make is the "Spustit nyní" button on a failing job. It
 * POSTs that job's own `triggerEndpoint` — the very same admin endpoint that sits
 * behind Nastavení → Úlohy, gated by the same `system.triggers` key that gates
 * this tab. No extra endpoint and no extra permission: whoever may see that a job
 * failed is exactly who may re-run it, which is why the failure notice used to
 * send them to Settings for a button that can just as well live here.
 *
 * Gated on `system.triggers`, the same key as Nastavení → Úlohy: whoever may
 * re-run a job by hand is who needs to know it failed.
 */
type JobHealth = "ok" | "error" | "overdue" | "unknown";

interface FirestoreTs {
  _seconds?: number;
  seconds?: number;
}

interface Job {
  id: string;
  title: string;
  description: string;
  schedule: string;
  periodMs: number;
  triggerEndpoint?: string;
  health: JobHealth;
  lastSuccessAt?: FirestoreTs;
  lastFailureAt?: FirestoreTs;
  lastError?: string | null;
  consecutiveFailures?: number;
}

interface JobsResponse {
  jobs: Job[];
  alertCount: number;
  overdueFactor: number;
}

/** Outcome of one manual run, kept per job id. */
interface RunResult {
  ok: boolean;
  msg: string;
}

/**
 * Jobs deliberately NOT runnable from here, despite having a trigger endpoint.
 *
 * The vacation rollover seeds the yearly entitlement for every employee, so
 * Nastavení → Úlohy runs it in two steps: a dry run whose plan the user approves,
 * then the real write. One-click "Spustit nyní" would skip that review, and
 * copying the dry-run flow onto this tab would put the same data-sensitive logic
 * in two places. This row keeps its pointer to Settings instead.
 */
const NO_QUICK_RUN = new Set(["rolloverVacationYear"]);

const canQuickRun = (j: Job) => Boolean(j.triggerEndpoint) && !NO_QUICK_RUN.has(j.id);

const HEALTH_LABEL: Record<JobHealth, string> = {
  ok: "V pořádku",
  error: "Selhala",
  overdue: "Neproběhla včas",
  unknown: "Zatím neproběhla",
};

/** Row tint + badge reuse the alert surface's existing danger/warning styles. */
function badgeClass(h: JobHealth): string {
  if (h === "error") return styles.badgeExpired;
  if (h === "overdue") return styles.badgeExpiring;
  if (h === "ok") return own.badgeOk;
  return own.badgeUnknown;
}

function rowClass(h: JobHealth): string | undefined {
  if (h === "error") return styles.rowExpired;
  if (h === "overdue") return styles.rowExpiring;
  return undefined;
}

const isAlerting = (h: JobHealth) => h === "error" || h === "overdue";

interface RunState {
  /** Id of the job currently running, if any. */
  running: string | null;
  results: Record<string, RunResult>;
  onRun: (job: Job) => void;
}

function JobRows({ jobs, run }: { jobs: Job[]; run: RunState }) {
  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Úloha</th>
            <th>Plán</th>
            <th>Poslední úspěch</th>
            <th>Stav</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <JobRow key={j.id} job={j} run={run} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JobRow({ job, run }: { job: Job; run: RunState }) {
  // The detail row carries the failure context. Shown only when something is
  // wrong – on a healthy job it would be noise on every line.
  const showDetail = isAlerting(job.health);
  const isRunning = run.running === job.id;
  const result = run.results[job.id];
  return (
    <>
      <tr className={rowClass(job.health)}>
        <td>
          {job.title}
          {(job.consecutiveFailures ?? 0) > 1 && (
            <span className={own.failCount}>{job.consecutiveFailures}× po sobě</span>
          )}
          {/* The run outcome sits on the main row, not in the detail block: a
              successful run turns the job healthy and takes the detail row with
              it, which would remove the confirmation the moment it appeared. */}
          {result && <div className={result.ok ? own.runOk : own.runErr}>{result.msg}</div>}
        </td>
        <td className={own.schedule}>{job.schedule}</td>
        <td>{job.lastSuccessAt ? formatDatetimeCZ(job.lastSuccessAt) : "–"}</td>
        <td>
          <span className={badgeClass(job.health)}>{HEALTH_LABEL[job.health]}</span>
        </td>
      </tr>
      {showDetail && (
        <tr className={rowClass(job.health)}>
          <td className={own.detailCell} colSpan={4}>
            <p className={own.detailDesc}>{job.description}</p>
            {job.health === "error" && job.lastError && (
              <pre className={own.errorBox}>{job.lastError}</pre>
            )}
            {job.health === "overdue" && (
              <p className={own.detailDesc}>
                Úloha neproběhla úspěšně v očekávaném intervalu ({job.schedule}). Nejčastější
                příčinou je, že se vůbec nespustila – zkontrolujte protokoly Cloud Functions.
              </p>
            )}
            {canQuickRun(job) ? (
              <div className={own.detailActions}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => run.onRun(job)}
                  disabled={run.running !== null}
                >
                  {isRunning ? "Spouštím…" : "Spustit nyní"}
                </Button>
                <span className={own.hint}>Spustí stejnou úlohu jako Nastavení → Úlohy.</span>
              </div>
            ) : (
              <p className={own.hint}>
                {job.triggerEndpoint
                  ? "Ručně ji spustíte v Nastavení → Úlohy – nejprve se zobrazí zkušební běh."
                  : "Tato úloha nemá tlačítko pro ruční spuštění."}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function ScheduledJobsTab() {
  const { refresh: refreshBadge } = useScheduledJobsContext();
  const [data, setData] = useState<JobsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, RunResult>>({});
  const [confirmJob, setConfirmJob] = useState<Job | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api
        .get<JobsResponse>("/jobs")
        .then(setData)
        .catch((e) =>
          setError(e instanceof Error ? e.message : "Stav úloh se nepodařilo načíst")
        ),
    []
  );

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  async function runJob(job: Job) {
    if (!job.triggerEndpoint) return;
    setRunning(job.id);
    setResults((r) => {
      const next = { ...r };
      delete next[job.id];
      return next;
    });
    try {
      const result = await api.post<unknown>(job.triggerEndpoint, {});
      const s = summarizeJobResult(result);
      setResults((r) => ({ ...r, [job.id]: { ok: true, msg: s ? `Hotovo · ${s}` : "Hotovo" } }));
      // The manual endpoint records into jobRuns/ exactly like the scheduled run,
      // so re-reading flips the row to healthy and moves it out of this section.
      // The sidebar badge counts on its own fetch, so it has to be told as well.
      await load();
      refreshBadge();
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Úlohu se nepodařilo spustit.";
      setRunError(msg);
      setResults((r) => ({ ...r, [job.id]: { ok: false, msg: "Spuštění selhalo" } }));
    } finally {
      setRunning(null);
    }
  }

  if (loading) return <div className={styles.state}>Načítám…</div>;
  if (error) return <div className={styles.state}>{error}</div>;
  if (!data) return null;

  const alerting = data.jobs.filter((j) => isAlerting(j.health));
  const healthy = data.jobs.filter((j) => !isAlerting(j.health));
  const run: RunState = { running, results, onRun: setConfirmJob };

  return (
    <div>
      <div className={styles.section}>
        <div className={styles.sectionLabel}>
          Vyžaduje pozornost
          {alerting.length > 0 && <span className={styles.countBadge}>{alerting.length}</span>}
        </div>
        {alerting.length === 0 ? (
          <div className={styles.empty}>Všechny naplánované úlohy běží podle plánu.</div>
        ) : (
          <JobRows jobs={alerting} run={run} />
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionLabel}>Ostatní úlohy</div>
        {healthy.length === 0 ? (
          <div className={styles.empty}>Žádné další úlohy.</div>
        ) : (
          <JobRows jobs={healthy} run={run} />
        )}
      </div>

      {confirmJob && (
        <ConfirmModal
          title="Spustit úlohu"
          message={`Spustit úlohu „${confirmJob.title}“? ${confirmJob.description}`}
          confirmLabel="Spustit"
          onConfirm={() => {
            const job = confirmJob;
            setConfirmJob(null);
            runJob(job);
          }}
          onCancel={() => setConfirmJob(null)}
        />
      )}
      {runError && (
        <ConfirmModal
          title="Chyba"
          message={runError}
          confirmLabel="OK"
          showCancel={false}
          onConfirm={() => setRunError(null)}
          onCancel={() => setRunError(null)}
        />
      )}
    </div>
  );
}
