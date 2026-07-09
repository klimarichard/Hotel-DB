import { useState, FormEvent } from "react";
import Button from "@/components/Button";
import IconButton from "@/components/IconButton";
import styles from "./SignModal.module.css";

export interface Signer {
  uid: string;
  /** username – drives the `${name}@hotel.local` login email. */
  name: string;
  /** friendly display label for the dropdown. */
  label: string;
}

interface Props {
  title: string;
  /** Optional line under the title (e.g. whose signature is being removed). */
  subtitle?: string;
  confirmLabel: string;
  signers: readonly Signer[];
  /** Pre-select this signer (e.g. the stamp owner when self-unsigning). */
  defaultSignerUid?: string;
  busy?: boolean;
  errorText?: string | null;
  onSubmit: (signer: Signer, password: string) => void;
  onCancel: () => void;
}

/**
 * Credential prompt shared by Předat / Převzít / Un-sign: pick a name from the
 * dropdown (the pool of people who may sign) and enter that person's password.
 * The parent verifies it on a secondary Firebase app so the live session is
 * untouched. Closes only via its buttons (never backdrop click).
 */
export default function SignModal({
  title,
  subtitle,
  confirmLabel,
  signers,
  defaultSignerUid,
  busy = false,
  errorText,
  onSubmit,
  onCancel,
}: Props) {
  const [uid, setUid] = useState<string>(defaultSignerUid ?? "");
  const [password, setPassword] = useState("");

  const selected = signers.find((s) => s.uid === uid) ?? null;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || !selected || password === "") return;
    onSubmit(selected, password);
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>{title}</h2>
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
          <IconButton variant="close" aria-label="Zavřít" onClick={onCancel} />
        </div>
        <form onSubmit={handleSubmit}>
          <div className={styles.body}>
            <label className={styles.label}>
              Jméno
              <select
                className={styles.select}
                value={uid}
                onChange={(e) => setUid(e.target.value)}
                disabled={busy}
                autoFocus={!defaultSignerUid}
                required
              >
                <option value="" disabled>
                  {signers.length === 0 ? "Žádní uživatelé k dispozici" : "Vyberte jméno…"}
                </option>
                {signers.map((s) => (
                  <option key={s.uid} value={s.uid}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.label}>
              Heslo
              <input
                type="password"
                className={styles.input}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus={!!defaultSignerUid}
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
            <Button type="submit" disabled={busy || !selected || password === ""}>
              {busy ? "Ověřuji…" : confirmLabel}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
