import { useState, FormEvent } from "react";
import { signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";
import { auth } from "@/lib/firebase";
import styles from "./LoginPage.module.css";

export default function LoginPage() {
  const [view, setView] = useState<"login" | "forgot">("login");

  // Login state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Forgot password state
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotSuccess, setForgotSuccess] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      // App.tsx redirect handles navigation
    } catch {
      setError("Nesprávný e-mail nebo heslo.");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot(e: FormEvent) {
    e.preventDefault();
    setForgotError(null);
    setForgotLoading(true);
    try {
      await sendPasswordResetEmail(auth, forgotEmail);
      setForgotSuccess(true);
    } catch {
      setForgotError("Nepodařilo se odeslat e-mail. Zkontrolujte adresu a zkuste to znovu.");
    } finally {
      setForgotLoading(false);
    }
  }

  function openForgot() {
    setForgotEmail(email); // pre-fill from login form if typed
    setForgotError(null);
    setForgotSuccess(false);
    setView("forgot");
  }

  if (view === "forgot") {
    return (
      <div className={styles.page}>
        <form className={styles.card} onSubmit={handleForgot}>
          <h1 className={styles.title}>Hotel HR</h1>
          <p className={styles.subtitle}>Obnova hesla</p>

          {forgotSuccess ? (
            <>
              <div className={styles.success}>
                E-mail s odkazem pro obnovu hesla byl odeslán na <strong>{forgotEmail}</strong>.
              </div>
              <button type="button" className={styles.btn} onClick={() => setView("login")}>
                Zpět na přihlášení
              </button>
            </>
          ) : (
            <>
              {forgotError && <div className={styles.error}>{forgotError}</div>}

              <label className={styles.label}>
                E-mail
                <input
                  className={styles.input}
                  type="email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  required
                  autoFocus
                />
              </label>

              <button className={styles.btn} type="submit" disabled={forgotLoading}>
                {forgotLoading ? "Odesílám…" : "Odeslat odkaz pro obnovu hesla"}
              </button>
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => setView("login")}
              >
                Zpět na přihlášení
              </button>
            </>
          )}
        </form>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={handleSubmit}>
        <h1 className={styles.title}>Hotel HR</h1>
        <p className={styles.subtitle}>Přihlaste se do systému</p>

        {error && <div className={styles.error}>{error}</div>}

        <label className={styles.label}>
          E-mail
          <input
            className={styles.input}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </label>

        <label className={styles.label}>
          Heslo
          <input
            className={styles.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        <button className={styles.btn} type="submit" disabled={loading}>
          {loading ? "Přihlašuji..." : "Přihlásit se"}
        </button>
        <button type="button" className={styles.linkBtn} onClick={openForgot}>
          Zapomenuté heslo?
        </button>
      </form>
    </div>
  );
}
