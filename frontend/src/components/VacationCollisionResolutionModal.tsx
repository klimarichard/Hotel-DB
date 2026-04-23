import { useState } from "react";
import Button from "./Button";
import styles from "./AddEmployeeToPlanModal.module.css";
import type { ShiftCollision } from "./VacationCollisionInfoModal";

interface Props {
  employeeName: string;
  collisions: ShiftCollision[];
  onSubmit: (excludeDates: string[]) => Promise<void>;
  onCancel: () => void;
}

type Choice = "overwrite" | "keep";

function formatDate(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${Number(d)}.${Number(m)}.${y}`;
}

export default function VacationCollisionResolutionModal({
  employeeName,
  collisions,
  onSubmit,
  onCancel,
}: Props) {
  const [choices, setChoices] = useState<Record<string, Choice>>(() => {
    const init: Record<string, Choice> = {};
    for (const c of collisions) init[c.date] = "overwrite";
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    try {
      const excludeDates = collisions
        .filter((c) => choices[c.date] === "keep")
        .map((c) => c.date);
      await onSubmit(excludeDates);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba při schvalování");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay}>
      <div
        className={styles.modal}
        style={{ width: "min(560px, 95vw)" }}
      >
        <div className={styles.header}>
          <h2 className={styles.title}>Kolize s naplánovanými směnami</h2>
          <button className={styles.closeBtn} onClick={onCancel}>✕</button>
        </div>
        <div className={styles.body}>
          <p style={{ fontSize: "0.875rem", color: "var(--color-text-secondary)", margin: "0 0 0.75rem" }}>
            <strong style={{ color: "var(--color-text)" }}>{employeeName}</strong> má v žádaném období dny, kdy už je zapsaná směna.
            Pro každý takový den vyberte, zda směnu přepsat na X, nebo zachovat.
          </p>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem", color: "var(--color-text)" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                <th style={{ textAlign: "left", padding: "6px 8px", color: "var(--color-text-secondary)", fontWeight: 500 }}>Datum</th>
                <th style={{ textAlign: "left", padding: "6px 8px", color: "var(--color-text-secondary)", fontWeight: 500 }}>Aktuální směna</th>
                <th style={{ textAlign: "left", padding: "6px 8px", color: "var(--color-text-secondary)", fontWeight: 500 }}>Volba</th>
              </tr>
            </thead>
            <tbody>
              {collisions.map((c) => (
                <tr key={c.date} style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <td style={{ padding: "8px" }}>{formatDate(c.date)}</td>
                  <td style={{ padding: "8px" }}>{c.rawInput}</td>
                  <td style={{ padding: "8px" }}>
                    <label style={{ marginRight: "0.75rem", cursor: "pointer", color: "var(--color-text)" }}>
                      <input
                        type="radio"
                        name={`choice-${c.date}`}
                        checked={choices[c.date] === "overwrite"}
                        onChange={() =>
                          setChoices((p) => ({ ...p, [c.date]: "overwrite" }))
                        }
                      />{" "}
                      Přepsat na X
                    </label>
                    <label style={{ cursor: "pointer", color: "var(--color-text)" }}>
                      <input
                        type="radio"
                        name={`choice-${c.date}`}
                        checked={choices[c.date] === "keep"}
                        onChange={() =>
                          setChoices((p) => ({ ...p, [c.date]: "keep" }))
                        }
                      />{" "}
                      Zachovat směnu
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {error && <p className={styles.error}>{error}</p>}
        </div>
        <div className={styles.footer}>
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            Zrušit schválení
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={saving}>
            {saving ? "Schvaluji…" : "Schválit s výběrem"}
          </Button>
        </div>
      </div>
    </div>
  );
}
