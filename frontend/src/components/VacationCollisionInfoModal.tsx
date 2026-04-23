import styles from "./AddEmployeeToPlanModal.module.css";

export interface ShiftCollision {
  date: string;
  rawInput: string;
  planId: string;
  planMonth: number;
  planYear: number;
}

interface Props {
  collisions: ShiftCollision[];
  onClose: () => void;
}

function formatDate(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${Number(d)}.${Number(m)}.${y}`;
}

export default function VacationCollisionInfoModal({ collisions, onClose }: Props) {
  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Tyto dny už mají naplánovanou směnu</h2>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div className={styles.body}>
          <div
            style={{
              background: "#fef9c3",
              border: "1px solid #fde047",
              borderRadius: "6px",
              padding: "0.6rem 0.75rem",
              marginBottom: "1rem",
            }}
          >
            <p style={{ margin: 0, fontSize: "0.8125rem", color: "#854d0e" }}>
              Pro tyto dny v žádaném období jsou už zapsané směny v plánu.
              Změňte termín dovolené, nebo požádejte vedoucího o úpravu plánu.
            </p>
          </div>

          <ul style={{ margin: 0, padding: "0 0 0 1.1rem", fontSize: "0.875rem", color: "var(--color-text)" }}>
            {collisions.map((c) => (
              <li key={c.date} style={{ marginBottom: "0.25rem" }}>
                <strong>{formatDate(c.date)}</strong> — {c.rawInput}
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.footer}>
          <button className={styles.saveBtn} onClick={onClose}>Zavřít</button>
        </div>
      </div>
    </div>
  );
}
