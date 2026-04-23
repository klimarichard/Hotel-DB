import { useState } from "react";
import type { ViolationInfo } from "../pages/ShiftPlannerPage";
import Button from "./Button";
import IconButton from "./IconButton";
import styles from "./AddEmployeeToPlanModal.module.css";

interface Props {
  employeeName: string;
  date: string;
  violations: ViolationInfo[];
  onSubmit: (reason: string) => Promise<void>;
  onCancel: () => void;
}

function violationText(v: ViolationInfo): string {
  switch (v.type) {
    case "employee_x_limit":
      return `Zaměstnanec má ${v.current} z ${v.limit} možných X tento měsíc.`;
    case "day_coverage":
      return `Denní pokrytí by kleslo na ${v.available} dostupných recepčních (minimum 5).`;
    case "night_coverage":
      return `Noční pokrytí by kleslo na ${v.available} dostupných recepčních (minimum 5).`;
  }
}

export default function XOverrideModal({ employeeName, date, violations, onSubmit, onCancel }: Props) {
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
          <h2 className={styles.title}>Překročení limitu X</h2>
          <IconButton onClick={onCancel} aria-label="Zavřít">✕</IconButton>
        </div>
        <div className={styles.body}>
          <p style={{ fontSize: "0.875rem", color: "#374151", margin: "0 0 0.75rem" }}>
            <strong>{employeeName}</strong> — {date}
          </p>

          <div style={{ background: "#fef9c3", border: "1px solid #fde047", borderRadius: "6px", padding: "0.6rem 0.75rem", marginBottom: "1rem" }}>
            <ul style={{ margin: 0, padding: "0 0 0 1.1rem", fontSize: "0.8125rem", color: "#854d0e" }}>
              {violations.map((v, i) => (
                <li key={i}>{violationText(v)}</li>
              ))}
            </ul>
          </div>

          <label className={styles.label}>Důvod žádosti o výjimku</label>
          <textarea
            className={styles.input}
            style={{ minHeight: "80px", resize: "vertical" }}
            placeholder="Uveďte důvod…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />

          {error && <p className={styles.error}>{error}</p>}
        </div>
        <div className={styles.footer}>
          <Button variant="secondary" onClick={onCancel}>Zrušit</Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={saving || !reason.trim()}
          >
            {saving ? "Odesílám…" : "Odeslat žádost o X"}
          </Button>
        </div>
      </div>
    </div>
  );
}
