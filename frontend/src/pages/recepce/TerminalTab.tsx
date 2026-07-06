import styles from "../RecepcePage.module.css";

export default function TerminalTab() {
  return (
    <div className={styles.placeholder}>
      <p className={styles.placeholderTitle}>Připravujeme</p>
      <p className={styles.placeholderHint}>
        Evidence plateb z platebního terminálu (pouze Amigo &amp; Alqush).
      </p>
    </div>
  );
}
