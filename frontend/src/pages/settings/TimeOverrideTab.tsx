import { useState } from "react";
import Button from "@/components/Button";
import ConfirmModal from "@/components/ConfirmModal";
import { useTimeOverride } from "@/context/TimeOverrideContext";
import { now as clockNow } from "@/lib/clock";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Format a Date for a <input type="datetime-local"> value (local time). */
function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtCZ(d: Date): string {
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Settings → Čas (test). Lets an admin jump the app's "current time" to any
 * instant so time-dependent behaviour (probation/document/multisport sweeps,
 * plan-deadline transitions, dashboards) can be exercised on demand. Offset
 * mode: the clock keeps ticking from the chosen point. Non-production only —
 * this tab is rendered only when the backend reports the override is allowed.
 */
export default function TimeOverrideTab() {
  const { enabled, targetISO, setAtISO, setBy, setOverride, clearOverride } =
    useTimeOverride();
  const [value, setValue] = useState(() => toLocalInput(clockNow()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function jumpTo(target: Date) {
    if (!Number.isFinite(target.getTime())) {
      setError("Neplatné datum/čas.");
      return;
    }
    setBusy(true);
    try {
      // Triggers a reload on success, so we won't return here in that case.
      await setOverride(target.toISOString());
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "Nepodařilo se nastavit čas.");
    }
  }

  async function handleClear() {
    setBusy(true);
    try {
      await clearOverride();
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "Nepodařilo se zrušit čas.");
    }
  }

  // Relative jumps are computed from the CURRENT effective now, so they
  // accumulate (clicking "+1 měsíc" twice advances two months).
  function addDays(n: number): Date {
    const d = clockNow();
    d.setDate(d.getDate() + n);
    return d;
  }
  function addMonths(n: number): Date {
    const d = clockNow();
    d.setMonth(d.getMonth() + n);
    return d;
  }
  function addYears(n: number): Date {
    const d = clockNow();
    d.setFullYear(d.getFullYear() + n);
    return d;
  }

  const quick: { label: string; get: () => Date }[] = [
    { label: "+1 den", get: () => addDays(1) },
    { label: "+1 týden", get: () => addDays(7) },
    { label: "+1 měsíc", get: () => addMonths(1) },
    { label: "+1 rok", get: () => addYears(1) },
  ];

  return (
    <div style={{ maxWidth: 640 }}>
      <p style={{ color: "var(--text-secondary, #888)", marginTop: 0 }}>
        Nastaví „aktuální čas“ aplikace pro testování časově závislého chování
        (zkušební doby, expirace dokladů, Multisport, přechody plánů směn).
        Čas běží dál od zvoleného okamžiku. Po nastavení se aplikace znovu
        načte. Dostupné jen v testovacím prostředí (staging / emulátor).
      </p>

      <div
        style={{
          padding: "0.75rem 1rem",
          borderRadius: 8,
          background: enabled ? "rgba(245,158,11,0.12)" : "var(--surface-2, rgba(127,127,127,0.08))",
          border: `1px solid ${enabled ? "#f59e0b" : "var(--border, rgba(127,127,127,0.25))"}`,
          marginBottom: "1.25rem",
        }}
      >
        {enabled ? (
          <>
            <div style={{ fontWeight: 600 }}>
              🕒 Testovací čas je aktivní
            </div>
            <div style={{ marginTop: 4 }}>
              Nastaveno na: <strong>{targetISO ? fmtCZ(new Date(targetISO)) : "—"}</strong>
            </div>
            <div style={{ fontSize: "0.85rem", opacity: 0.8, marginTop: 2 }}>
              Aktuálně: {fmtCZ(clockNow())}
              {setAtISO && ` · nastaveno ${fmtCZ(new Date(setAtISO))}`}
              {setBy && ` · ${setBy}`}
            </div>
            <div style={{ marginTop: "0.75rem" }}>
              <Button variant="secondary" onClick={handleClear} disabled={busy}>
                Vrátit na reálný čas
              </Button>
            </div>
          </>
        ) : (
          <div>Testovací čas není aktivní — aplikace používá reálný čas.</div>
        )}
      </div>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        {quick.map((q) => (
          <Button key={q.label} variant="ghost" size="sm" onClick={() => jumpTo(q.get())} disabled={busy}>
            {q.label}
          </Button>
        ))}
      </div>

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <label style={{ display: "block", fontSize: "0.85rem", marginBottom: 4 }}>
            Skočit na konkrétní datum a čas
          </label>
          <input
            type="datetime-local"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            style={{
              padding: "0.4rem 0.6rem",
              borderRadius: 6,
              border: "1px solid var(--border, rgba(127,127,127,0.4))",
              background: "var(--surface, transparent)",
              color: "inherit",
              fontSize: "0.9rem",
            }}
          />
        </div>
        <Button variant="primary" onClick={() => jumpTo(new Date(value))} disabled={busy || !value}>
          Nastavit
        </Button>
      </div>

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
