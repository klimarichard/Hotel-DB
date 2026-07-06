import { useState, FormEvent } from "react";
import Button from "@/components/Button";
import IconButton from "@/components/IconButton";
import styles from "./PredalPrevzalModal.module.css";

interface Props {
  title: string;
  // Pre-fills the email input. For "Předal" we pass the current user's email
  // so they don't have to retype it; for "Převzal" we leave it blank so the
  // incoming receptionist enters their own.
  initialEmail?: string;
  // Confirm button label — different copy for the two slots.
  confirmLabel: string;
  busy?: boolean;
  errorText?: string | null;
  onSubmit: (email: string, password: string) => void;
  onCancel: () => void;
}

export default function PredalPrevzalModal({
  title,
  initialEmail = "",
  confirmLabel,
  busy = false,
  errorText,
  onSubmit,
  onCancel,
}: Props) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (email.trim() === "" || password === "") return;
    onSubmit(email.trim(), password);
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          <IconButton variant="close" aria-label="Zavřít" onClick={onCancel} />
        </div>
        <form onSubmit={handleSubmit}>
          <div className={styles.body}>
            <label className={styles.label}>
              E-mail
              <input
                type="email"
                className={styles.input}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus={!initialEmail}
                disabled={busy}
                autoComplete="username"
                required
              />
            </label>
            <label className={styles.label}>
              Heslo
              <input
                type="password"
                className={styles.input}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus={!!initialEmail}
                disabled={busy}
                autoComplete="current-password"
                required
              />
            </label>
            {errorText && <div className={styles.error}>{errorText}</div>}
          </div>
          <div className={styles.footer}>
            <Button variant="secondary" type="button" onClick={onCancel} disabled={busy}>
              Zrušit
            </Button>
            <Button type="submit" disabled={busy || email.trim() === "" || password === ""}>
              {busy ? "Ověřuji…" : confirmLabel}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
