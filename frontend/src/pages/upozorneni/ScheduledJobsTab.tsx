import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatDatetimeCZ } from "@/lib/dateFormat";
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

function JobRows({ jobs }: { jobs: Job[] }) {
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
            <JobRow key={j.id} job={j} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JobRow({ job }: { job: Job }) {
  // The detail row carries the failure context. Shown only when something is
  // wrong – on a healthy job it would be noise on every line.
  const showDetail = isAlerting(job.health);
  return (
    <>
      <tr className={rowClass(job.health)}>
        <td>
          {job.title}
          {(job.consecutiveFailures ?? 0) > 1 && (
            <span className={own.failCount}>{job.consecutiveFailures}× po sobě</span>
          )}
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
            <p className={own.hint}>
              {job.triggerEndpoint
                ? "Ručně ji spustíte v Nastavení → Úlohy."
                : "Tato úloha nemá tlačítko pro ruční spuštění."}
            </p>
          </td>
        </tr>
      )}
    </>
  );
}

export default function ScheduledJobsTab() {
  const [data, setData] = useState<JobsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<JobsResponse>("/jobs")
      .then(setData)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Stav úloh se nepodařilo načíst")
      )
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className={styles.state}>Načítám…</div>;
  if (error) return <div className={styles.state}>{error}</div>;
  if (!data) return null;

  const alerting = data.jobs.filter((j) => isAlerting(j.health));
  const healthy = data.jobs.filter((j) => !isAlerting(j.health));

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
          <JobRows jobs={alerting} />
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionLabel}>Ostatní úlohy</div>
        {healthy.length === 0 ? (
          <div className={styles.empty}>Žádné další úlohy.</div>
        ) : (
          <JobRows jobs={healthy} />
        )}
      </div>
    </div>
  );
}
