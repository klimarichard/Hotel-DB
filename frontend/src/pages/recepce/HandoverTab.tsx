import type { Hotel } from "@/lib/hotels";
import styles from "../RecepcePage.module.css";

interface Props {
  hotel: Hotel;
}

// P1 placeholder — the functional Předávací protokol (cash reconciliation +
// den/noc handover with Předal/Převzal signing) lands in P2, replacing this body.
export default function HandoverTab({ hotel }: Props) {
  return (
    <div className={styles.placeholder}>
      <p className={styles.placeholderTitle}>Připravujeme</p>
      <p className={styles.placeholderHint}>
        Předávací protokol pro hotel {hotel.label} bude brzy k dispozici.
      </p>
    </div>
  );
}
