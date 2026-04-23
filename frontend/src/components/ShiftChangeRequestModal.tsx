import { useState } from "react";
import { formatDateCZ } from "../lib/dateFormat";
import styles from "./AddEmployeeToPlanModal.module.css";

interface Props {
  employeeName: string;
  date: string;          // YYYY-MM-DD
  currentShift: string;  // current rawInput shown for context
  onSubmit: (reason: string) => Promise<void>;
  onClose: () => void;
}

export default function ShiftChangeRequestModal({
  employeeName,
  date,
  currentShift,
  onSubmit,
  onClose,
}: Props) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!reason.trim()) {
      setError("Důvod je povinný");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(reason.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba při odesílání");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Žádost o změnu směny</h2>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div className={styles.body}>
          <p style={{ fontSize: "0.875rem", color: "#374151", margin: "0 0 1rem" }}>
            <strong>{employeeName}</strong> — {formatDateCZ(date)} — aktuálně:{" "}
            <strong>{currentShift || "—"}</strong>
          </p>

          <label className={styles.label}>Důvod žádosti *</label>
          <textarea
            className={styles.input}
            style={{ minHeight: "80px", resize: "vertical" }}
            placeholder="Uveďte důvod žádosti o změnu směny…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />

          {error && <p className={styles.error}>{error}</p>}
        </div>
        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose}>Zrušit</button>
          <button
            className={styles.saveBtn}
            onClick={handleSubmit}
            disabled={saving || !reason.trim()}
          >
            {saving ? "Odesílám…" : "Odeslat žádost"}
          </button>
        </div>
      </div>
    </div>
  );
}
