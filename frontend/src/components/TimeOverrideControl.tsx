import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import Button from "./Button";
import IconButton from "./IconButton";
import ConfirmModal from "./ConfirmModal";
import { useTimeOverride } from "@/context/TimeOverrideContext";
import { now as clockNow } from "@/lib/clock";
import styles from "./TimeOverrideControl.module.css";

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
/** Compact date for the always-visible footer button (no time component). */
function fmtShort(d: Date): string {
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
}

/**
 * Sidebar-footer test-clock control. A compact button (next to Odhlásit / theme
 * toggle) that shows the test-clock state at a glance and opens a modal to jump
 * the app's "current time" or revert to real time. Replaces the former
 * Settings → Čas tab so the control is one click away. Renders nothing where
 * faking time isn't permitted (production) — same backend `allowed` gate as the
 * old tab. Setting/clearing reloads the app (handled by the context) so every
 * clock.now() call site picks up the new offset.
 */
export default function TimeOverrideControl() {
  const {
    allowed,
    enabled,
    targetISO,
    setAtISO,
    setBy,
    setOverride,
    clearOverride,
  } = useTimeOverride();
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(() => toLocalInput(clockNow()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Never available in production (and the offset is inert there anyway), and
  // only for users who hold the time-override permission.
  if (!allowed || !can("system.timeOverride")) return null;

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
  function shifted(mutate: (d: Date) => void): Date {
    const d = clockNow();
    mutate(d);
    return d;
  }
  const quick: { label: string; get: () => Date }[] = [
    { label: "+1 den", get: () => shifted((d) => d.setDate(d.getDate() + 1)) },
    { label: "+1 týden", get: () => shifted((d) => d.setDate(d.getDate() + 7)) },
    { label: "+1 měsíc", get: () => shifted((d) => d.setMonth(d.getMonth() + 1)) },
    { label: "+1 rok", get: () => shifted((d) => d.setFullYear(d.getFullYear() + 1)) },
  ];

  return (
    <>
      <button
        data-tour="tour-timeclock"
        type="button"
        className={`${styles.footerBtn} ${enabled ? styles.footerBtnActive : ""}`}
        onClick={() => {
          setValue(toLocalInput(clockNow()));
          setOpen(true);
        }}
        title={enabled ? "Testovací čas je aktivní — kliknutím upravit" : "Nastavit testovací čas"}
      >
        <span className={styles.footerBtnGlyph}>🕒</span>
        {enabled && targetISO ? fmtShort(new Date(targetISO)) : "Čas (test)"}
      </button>

      {open && (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <div className={styles.header}>
              <h2 className={styles.title}>Testovací čas</h2>
              <IconButton onClick={() => setOpen(false)} aria-label="Zavřít">✕</IconButton>
            </div>

            <div className={styles.body}>
              <p className={styles.note}>
                Nastaví „aktuální čas“ aplikace pro testování časově závislého
                chování (zkušební doby, expirace dokladů, Multisport, přechody
                plánů směn). Čas běží dál od zvoleného okamžiku. Po nastavení se
                aplikace znovu načte. Dostupné jen v testovacím prostředí.
              </p>

              <div className={`${styles.status} ${enabled ? styles.statusActive : ""}`}>
                {enabled ? (
                  <>
                    <div className={styles.statusTitle}>🕒 Testovací čas je aktivní</div>
                    <div>
                      Nastaveno na:{" "}
                      <strong>{targetISO ? fmtCZ(new Date(targetISO)) : "—"}</strong>
                    </div>
                    <div className={styles.statusMeta}>
                      Aktuálně: {fmtCZ(clockNow())}
                      {setAtISO && ` · nastaveno ${fmtCZ(new Date(setAtISO))}`}
                      {setBy && ` · ${setBy}`}
                    </div>
                  </>
                ) : (
                  <div>Testovací čas není aktivní — aplikace používá reálný čas.</div>
                )}
              </div>

              <div className={styles.quickRow}>
                {quick.map((q) => (
                  <Button
                    key={q.label}
                    variant="ghost"
                    size="sm"
                    onClick={() => jumpTo(q.get())}
                    disabled={busy}
                  >
                    {q.label}
                  </Button>
                ))}
              </div>

              <label className={styles.inputLabel} htmlFor="time-override-input">
                Skočit na konkrétní datum a čas
              </label>
              <div className={styles.inputRow}>
                <input
                  id="time-override-input"
                  type="datetime-local"
                  className={styles.input}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => jumpTo(new Date(value))}
                  disabled={busy || !value}
                >
                  Nastavit
                </Button>
              </div>
            </div>

            <div className={styles.footer}>
              {enabled && (
                <Button variant="secondary" onClick={handleClear} disabled={busy}>
                  Vrátit na reálný čas
                </Button>
              )}
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Zavřít
              </Button>
            </div>
          </div>
        </div>
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
    </>
  );
}
