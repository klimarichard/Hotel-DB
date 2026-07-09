import { useState } from "react";
import Button from "./Button";
import IconButton from "./IconButton";
import { UserProfile } from "../lib/api";
import styles from "./DeactivateUserModal.module.css";

interface Props {
  user: UserProfile;
  /** True while the parent's API call is in flight. */
  saving: boolean;
  /** Server-side error to surface (e.g. rejected schedule time). */
  error: string | null;
  onCancel: () => void;
  onConfirm: (opts: { mode: "now" | "schedule"; at?: string }) => void;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Choose whether to deactivate a user immediately or schedule it for a future
 * date/time. Scheduling stores an instant on the user; a Cloud Function fires
 * the deactivation within ~5 min of that time.
 *
 * Date/time is assembled from numeric parts into a LOCAL Date – never
 * `new Date("YYYY-MM-DD")`, which parses as UTC midnight and drifts a day in
 * UTC+2 (see CLAUDE.md). `.toISOString()` on a local-parts Date is correct.
 */
export default function DeactivateUserModal({ user, saving, error, onCancel, onConfirm }: Props) {
  // Default the picker to an hour from now, so a scheduled time is valid without
  // any editing.
  const soon = new Date(Date.now() + 60 * 60 * 1000);
  const [mode, setMode] = useState<"now" | "schedule">("now");
  const [date, setDate] = useState(
    `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}`
  );
  const [time, setTime] = useState(`${pad(soon.getHours())}:${pad(soon.getMinutes())}`);
  const [localError, setLocalError] = useState<string | null>(null);

  function handleConfirm() {
    if (mode === "now") {
      onConfirm({ mode: "now" });
      return;
    }
    setLocalError(null);
    if (!date || !time) {
      setLocalError("Vyberte datum i čas.");
      return;
    }
    const [y, m, d] = date.split("-").map(Number);
    const [hh, mm] = time.split(":").map(Number);
    const when = new Date(y, m - 1, d, hh, mm); // local time – see note above
    if (isNaN(when.getTime())) {
      setLocalError("Neplatné datum a čas.");
      return;
    }
    if (when.getTime() <= Date.now()) {
      setLocalError("Naplánovaný čas musí být v budoucnosti.");
      return;
    }
    onConfirm({ mode: "schedule", at: when.toISOString() });
  }

  const shownError = error ?? localError;

  return (
    <div className={styles.modal}>
      <div className={styles.modalBox}>
        <div className={styles.header}>
          <h2 className={styles.modalTitle}>Deaktivovat uživatele</h2>
          <IconButton onClick={onCancel} aria-label="Zavřít">✕</IconButton>
        </div>
        <p className={styles.subject}>
          {user.name} <span className={styles.subjectEmail}>({user.email})</span>
        </p>

        <div className={styles.options}>
          <label className={styles.option}>
            <input
              type="radio"
              name="deactivate-mode"
              checked={mode === "now"}
              onChange={() => setMode("now")}
            />
            <span className={styles.optionText}>
              <strong>Deaktivovat ihned</strong>
              <span className={styles.optionHint}>
                Účet se okamžitě zablokuje a uživatel bude odhlášen.
              </span>
            </span>
          </label>
          <label className={styles.option}>
            <input
              type="radio"
              name="deactivate-mode"
              checked={mode === "schedule"}
              onChange={() => setMode("schedule")}
            />
            <span className={styles.optionText}>
              <strong>Naplánovat deaktivaci</strong>
              <span className={styles.optionHint}>
                Účet zůstane aktivní až do zvoleného data a času.
              </span>
            </span>
          </label>
        </div>

        {mode === "schedule" && (
          <div className={styles.datetimeRow}>
            <div className={styles.field}>
              <label className={styles.label}>Datum</label>
              <input
                className={styles.input}
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Čas</label>
              <input
                className={styles.input}
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
          </div>
        )}

        {shownError && <p className={styles.formError}>{shownError}</p>}

        <div className={styles.formActions}>
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            Zrušit
          </Button>
          <Button variant="danger" onClick={handleConfirm} disabled={saving}>
            {saving ? "…" : mode === "now" ? "Deaktivovat" : "Naplánovat"}
          </Button>
        </div>
      </div>
    </div>
  );
}
