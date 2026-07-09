import { useState } from "react";
import Button from "./Button";
import IconButton from "./IconButton";
import styles from "./PhoneFormatModal.module.css";

/**
 * Shown at save time when a non-+420 phone number is entered (the +420 case is
 * auto-formatted on display). Lets the user choose how the number should be
 * displayed; the chosen string is stored verbatim and shown as-is everywhere.
 * Dismissal follows the project rule – ✕ / Zrušit / Uložit only, never backdrop.
 */
interface Props {
  phone: string;
  onConfirm: (display: string) => void;
  onCancel: () => void;
}

export default function PhoneFormatModal({ phone, onConfirm, onCancel }: Props) {
  const [display, setDisplay] = useState(phone);

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Formát telefonního čísla</h2>
          <IconButton onClick={onCancel} aria-label="Zavřít">✕</IconButton>
        </div>

        <div className={styles.body}>
          <p className={styles.note}>
            Toto číslo není české (+420). Zadejte, jak se má zobrazovat (např.
            s mezerami pro čitelnost) – uloží se a zobrazí přesně takto.
          </p>
          <div className={styles.fieldLabel}>Zadané číslo</div>
          <div className={styles.raw}>{phone}</div>
          <label className={styles.fieldLabel} htmlFor="phone-display">
            Zobrazit jako
          </label>
          <input
            id="phone-display"
            className={styles.input}
            value={display}
            onChange={(e) => setDisplay(e.target.value)}
            autoFocus
          />
        </div>

        <div className={styles.footer}>
          <Button variant="secondary" onClick={onCancel}>
            Zrušit
          </Button>
          <Button
            variant="primary"
            onClick={() => onConfirm(display.trim() || phone.trim())}
          >
            Uložit
          </Button>
        </div>
      </div>
    </div>
  );
}
