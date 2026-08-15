import { useState } from "react";
import Button from "@/components/Button";
import ConfirmModal from "@/components/ConfirmModal";
import { useAuth } from "@/hooks/useAuth";
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

/**
 * Yearly vacation-entitlement rollover. Unlike the jobs above it runs in two
 * steps – a dry run whose plan the user confirms, then the real write – because
 * it seeds every employee's entitlement for the new year and a surprise here is
 * expensive to unpick.
 */
const ROLLOVER_ID = "vacation-rollover";
const ROLLOVER_ENDPOINT = "/employees/trigger-vacation-rollover";

interface RolloverResult {
  year: number;
  fromYear: number;
  candidates: number;
  written: number;
  skippedTerminated: number;
  skippedAlreadySet: number;
  skippedMissingEmployee: number;
  skippedUnknownContract: { employeeId: string; name: string; contractType: string }[];
  dryRun: boolean;
}

/** One-line recap of a rollover result (ConfirmModal renders a plain string). */
function rolloverCounts(r: RolloverResult): string {
  return (
    `Rok ${r.year} (nárok navazuje na ${r.fromYear}) · ` +
    `zaměstnanců ke zpracování: ${r.candidates} · ` +
    `zapíše se nárok: ${r.written} · ` +
    `přeskočeno – ukončení: ${r.skippedTerminated}, ` +
    `nárok už zadán: ${r.skippedAlreadySet}, ` +
    `chybí záznam zaměstnance: ${r.skippedMissingEmployee}, ` +
    `neznámý typ smlouvy: ${r.skippedUnknownContract.length}`
  );
}

/** Names of employees whose contract type is missing – a human has to fix those records. */
function unknownContractLine(r: RolloverResult): string {
  const list = r.skippedUnknownContract;
  if (list.length === 0) return "";
  const shown = list
    .slice(0, 15)
    .map((e) => `${e.name} (${e.contractType || "bez typu smlouvy"})`)
    .join(", ");
  const rest = list.length > 15 ? ` a další (${list.length - 15})` : "";
  return ` Bez určeného typu smlouvy, nárok nelze vypočítat – opravte záznam u: ${shown}${rest}.`;
}

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
  const { can } = useAuth();
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [confirmJob, setConfirmJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Dry-run plan awaiting the user's go-ahead before the real rollover runs.
  const [rolloverPlan, setRolloverPlan] = useState<RolloverResult | null>(null);

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

  function failRollover(e: unknown) {
    const msg =
      e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Úlohu se nepodařilo spustit.";
    setError(msg);
    setResults((r) => ({ ...r, [ROLLOVER_ID]: { ok: false, msg: "Chyba" } }));
  }

  /** Step 1 – ask the server what the rollover would do, without writing anything. */
  async function previewRollover() {
    setRunning(ROLLOVER_ID);
    setResults((r) => {
      const next = { ...r };
      delete next[ROLLOVER_ID];
      return next;
    });
    try {
      const plan = await api.post<RolloverResult>(`${ROLLOVER_ENDPOINT}?dryRun=true`, {});
      setRolloverPlan(plan);
    } catch (e) {
      failRollover(e);
    } finally {
      setRunning(null);
    }
  }

  /** Step 2 – the user approved the plan; run it for real. */
  async function runRollover(year: number) {
    setRunning(ROLLOVER_ID);
    try {
      const r = await api.post<RolloverResult>(`${ROLLOVER_ENDPOINT}?year=${year}`, {});
      setResults((res) => ({
        ...res,
        [ROLLOVER_ID]: { ok: true, msg: `Hotovo · ${rolloverCounts(r)}${unknownContractLine(r)}` },
      }));
    } catch (e) {
      failRollover(e);
    } finally {
      setRunning(null);
    }
  }

  const rolloverRes = results[ROLLOVER_ID];

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

        {can("system.triggers") && (
          <div className={styles.card}>
            <div className={styles.cardMain}>
              <h3 className={styles.cardTitle}>Nárok dovolené na nový rok</h3>
              <p className={styles.cardDesc}>
                Zapíše zaměstnancům nárok dovolené na aktuální rok a převede zůstatek z loňska.
                Nejprve se zobrazí zkušební běh – nic se nezapíše, dokud jej nepotvrdíte.
              </p>
              {rolloverRes && (
                <span className={rolloverRes.ok ? styles.ok : styles.err}>{rolloverRes.msg}</span>
              )}
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={previewRollover}
              disabled={running !== null}
            >
              {running === ROLLOVER_ID ? "Spouštím…" : "Spustit"}
            </Button>
          </div>
        )}
      </div>

      {rolloverPlan && (
        <ConfirmModal
          title="Nárok dovolené na nový rok"
          message={`Zkušební běh (zatím se nic nezapsalo). ${rolloverCounts(rolloverPlan)}.${unknownContractLine(rolloverPlan)} Spustit úlohu naostro?`}
          confirmLabel="Spustit naostro"
          onConfirm={() => {
            const year = rolloverPlan.year;
            setRolloverPlan(null);
            runRollover(year);
          }}
          onCancel={() => setRolloverPlan(null)}
        />
      )}

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
