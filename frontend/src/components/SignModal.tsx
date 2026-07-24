import { useState, FormEvent, ReactNode } from "react";
import Button from "./Button";
import IconButton from "./IconButton";
import styles from "./SignModal.module.css";

export interface Signer {
  uid: string;
  /** account username (metadata only – no longer used for the credential). */
  name: string;
  /** the account's real login email – drives the password check. */
  email: string;
  /** friendly display label for the dropdown. */
  label: string;
}

interface Props {
  title: string;
  /** Optional line under the title (e.g. whose signature is being removed). */
  subtitle?: string;
  confirmLabel: string;
  /** Optional explanatory note above the picker (e.g. why this prompt appeared). */
  note?: ReactNode;
  signers: readonly Signer[];
  /** Pre-select this signer (e.g. the stamp owner when self-unsigning). */
  defaultSignerUid?: string;
  busy?: boolean;
  errorText?: string | null;
  onSubmit: (signer: Signer, password: string) => void;
  onCancel: () => void;
}

/**
 * Credential prompt: pick a name from the dropdown (the pool of people who may
 * act) and enter that person's password. The parent verifies it on a secondary
 * Firebase app so the live session is untouched, then posts the resulting
 * idToken for the server to re-verify. Closes only via its buttons (never
 * backdrop click).
 *
 * Shared by the Recepce protokol signatures (Předat / Převzít / Un-sign) and the
 * shared-terminal logout authorization in Layout. Deliberately knows nothing
 * about either: it takes `signers` and reports back via `onSubmit`, and every
 * caller does its own verification.
 */
export default function SignModal({
  title,
  subtitle,
  confirmLabel,
  note,
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
        {/* Classed so the modal's height cap can pass through the form to the
            scrolling body – see .form in SignModal.module.css. */}
        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.body}>
            {note && <div className={styles.note}>{note}</div>}
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
