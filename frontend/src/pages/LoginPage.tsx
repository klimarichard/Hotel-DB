import { useState, FormEvent } from "react";
import { signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useTheme } from "@/context/ThemeContext";
import Button from "@/components/Button";
import styles from "./LoginPage.module.css";

const SunIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="1" x2="12" y2="3"/>
    <line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1" y1="12" x2="3" y2="12"/>
    <line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>
);

const MoonIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
);

export default function LoginPage() {
  const { theme, toggleTheme } = useTheme();
  const [view, setView] = useState<"login" | "forgot">("login");

  // Login state
  const [username, setUsername] = useState("");
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
      const email = username.includes("@") ? username : `${username}@hotel.local`;
      await signInWithEmailAndPassword(auth, email, password);
      // App.tsx redirect handles navigation
    } catch {
      setError("Nesprávné uživatelské jméno nebo heslo.");
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
    setForgotEmail(username.includes("@") ? username : username ? `${username}@hotel.local` : "");
    setForgotError(null);
    setForgotSuccess(false);
    setView("forgot");
  }

  if (view === "forgot") {
    return (
      <div className={styles.page}>
        <form className={styles.card} onSubmit={handleForgot}>
          <div className={styles.cardHeader}>
            <h1 className={styles.title}>HPM Intranet</h1>
          <button
            className={styles.themeToggle}
            onClick={toggleTheme}
            title={theme === "dark" ? "Světlý režim" : "Tmavý režim"}
            type="button"
            >
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            </button>
          </div>
          <p className={styles.subtitle}>Obnova hesla</p>

          {forgotSuccess ? (
            <>
              <div className={styles.success}>
                E-mail s odkazem pro obnovu hesla byl odeslán na <strong>{forgotEmail}</strong>.
              </div>
              <Button variant="primary" block onClick={() => setView("login")}>
                Zpět na přihlášení
              </Button>
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

              <Button variant="primary" block type="submit" disabled={forgotLoading}>
                {forgotLoading ? "Odesílám…" : "Odeslat odkaz pro obnovu hesla"}
              </Button>
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
        <div className={styles.cardHeader}>
          <h1 className={styles.title}>HPM Intranet</h1>
          <button
            className={styles.themeToggle}
            onClick={toggleTheme}
            title={theme === "dark" ? "Světlý režim" : "Tmavý režim"}
            type="button"
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
        <p className={styles.subtitle}>Přihlaste se do systému</p>

        {error && <div className={styles.error}>{error}</div>}

        <label className={styles.label}>
          Uživatelské jméno
          <input
            className={styles.input}
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoFocus
            autoComplete="username"
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

        <Button variant="primary" block type="submit" disabled={loading}>
          {loading ? "Přihlašuji..." : "Přihlásit se"}
        </Button>
        <button type="button" className={styles.linkBtn} onClick={openForgot}>
          Zapomenuté heslo?
        </button>
      </form>
    </div>
  );
}
