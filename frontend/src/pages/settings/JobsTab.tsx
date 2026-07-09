import { useState } from "react";
import Button from "@/components/Button";
import ConfirmModal from "@/components/ConfirmModal";
import { api, ApiError } from "@/lib/api";
import styles from "./JobsTab.module.css";

/**
 * Settings → Úlohy: manual triggers for the daily scheduled maintenance jobs.
 * Each button POSTs the matching admin-only `trigger-*` endpoint (gated by
 * `system.triggers`); the backend mirrors the scheduled function and writes a
 * `manual-trigger` audit entry. For use after a missed/failed scheduled run or
 * when data needs an immediate recompute.
 */
interface Job {
  id: string;
  title: string;
  description: string;
  endpoint: string;
}

const JOBS: Job[] = [
  {
    id: "deadlines",
    title: "Přechody plánů směn",
    description:
      "Provede naplánované přechody stavů plánů směn (otevření, uzávěrka, publikování), jejichž čas už nastal.",
    endpoint: "/shifts/trigger-deadlines",
  },
  {
    id: "multisport",
    title: "Údržba Multisportu",
    description: "Ukončí Multisport období, kterým vypršela platnost.",
    endpoint: "/benefits/trigger-multisport-sweep",
  },
  {
    id: "probation",
    title: "Upozornění na zkušební doby",
    description: "Přepočítá upozornění na blížící se konce zkušebních dob.",
    endpoint: "/employees/trigger-probation-refresh",
  },
  {
    id: "documents",
    title: "Upozornění na doklady",
    description: "Přepočítá upozornění na expiraci dokladů zaměstnanců.",
    endpoint: "/employees/trigger-alert-refresh",
  },
  {
    id: "effective",
    title: "Aktuální údaje zaměstnanců",
    description:
      "Přepočítá denormalizované aktuální údaje (pozice, oddělení, smlouva) u všech aktivních zaměstnanců.",
    endpoint: "/employees/trigger-effective-refresh",
  },
];

/** Build a short summary line from the job's returned result object. */
function summarize(result: unknown): string {
  if (result && typeof result === "object") {
    const parts = Object.entries(result as Record<string, unknown>)
      .filter(([, v]) => typeof v === "number" || typeof v === "string" || typeof v === "boolean")
      .map(([k, v]) => `${k}: ${v}`);
    if (parts.length) return parts.join(", ");
  }
  return "";
}

export default function JobsTab() {
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [confirmJob, setConfirmJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runJob(job: Job) {
    setRunning(job.id);
    setResults((r) => {
      const next = { ...r };
      delete next[job.id];
      return next;
    });
    try {
      const result = await api.post<unknown>(job.endpoint, {});
      const s = summarize(result);
      setResults((r) => ({ ...r, [job.id]: { ok: true, msg: s ? `Hotovo · ${s}` : "Hotovo" } }));
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Úlohu se nepodařilo spustit.";
      setError(msg);
      setResults((r) => ({ ...r, [job.id]: { ok: false, msg: "Chyba" } }));
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className={styles.wrap}>
      <p className={styles.intro}>
        Tyto úlohy běží automaticky každý den. Zde je můžete spustit ručně – například po výpadku
        nebo když potřebujete okamžitě přepočítat data. Každé spuštění se zaznamenává do Logu změn.
      </p>
      <div className={styles.list} data-tour="settings-jobs-list">
        {JOBS.map((job) => {
          const res = results[job.id];
          const isRunning = running === job.id;
          return (
            <div key={job.id} className={styles.card}>
              <div className={styles.cardMain}>
                <h3 className={styles.cardTitle}>{job.title}</h3>
                <p className={styles.cardDesc}>{job.description}</p>
                {res && <span className={res.ok ? styles.ok : styles.err}>{res.msg}</span>}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setConfirmJob(job)}
                disabled={running !== null}
              >
                {isRunning ? "Spouštím…" : "Spustit"}
              </Button>
            </div>
          );
        })}
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
      {error && (
        <ConfirmModal
          title="Chyba"
          message={error}
          confirmLabel="OK"
          showCancel={false}
          onConfirm={() => setError(null)}
          onCancel={() => setError(null)}
        />
      )}
    </div>
  );
}
