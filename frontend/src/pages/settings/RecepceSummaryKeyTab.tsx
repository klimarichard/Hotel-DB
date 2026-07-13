import { useEffect, useState } from "react";
import Button from "@/components/Button";
import { api, ApiError, errorMessage } from "@/lib/api";
import styles from "./RecepceSummaryKeyTab.module.css";

/**
 * Settings → Souhrn recepce: set / change the numeric pass-key that guards the
 * cross-hotel Recepce summary page (/4d). Gated by the same permission as the
 * page itself (`recepce.summary.view`) – no separate permission key.
 *
 * The current key is required whenever one is already configured; the server is
 * the only place the key is verified (`PUT /recepce-summary/key`).
 */
const PIN_RE = /^\d{4,10}$/;

export default function RecepceSummaryKeyTab() {
  // null = status not loaded yet.
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.get<{ configured: boolean }>("/recepce-summary/key-status");
        if (!cancelled) setConfigured(res.configured);
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err, "Stav přístupového klíče se nepodařilo načíst."));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);
    setSuccess(null);

    if (configured && currentPin.trim() === "") {
      setError("Zadejte současný přístupový klíč.");
      return;
    }
    if (!PIN_RE.test(newPin.trim())) {
      setError("Nový přístupový klíč musí mít 4 až 10 číslic (pouze číslice).");
      return;
    }
    if (newPin.trim() !== confirmPin.trim()) {
      setError("Nový klíč a jeho potvrzení se neshodují.");
      return;
    }

    setSaving(true);
    try {
      const body: { newPin: string; currentPin?: string } = { newPin: newPin.trim() };
      if (configured) body.currentPin = currentPin.trim();
      await api.put<{ ok: boolean }>("/recepce-summary/key", body);
      setConfigured(true);
      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
      setSuccess("Přístupový klíč byl uložen.");
    } catch (err) {
      const code =
        err instanceof ApiError && typeof err.body === "object" && err.body !== null
          ? (err.body as { code?: string }).code
          : undefined;
      if (code === "INVALID_PIN") setError("Současný přístupový klíč není správný.");
      else if (code === "WEAK_PIN") setError("Nový přístupový klíč musí mít 4 až 10 číslic (pouze číslice).");
      else setError(errorMessage(err, "Přístupový klíč se nepodařilo uložit."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <p className={styles.intro}>
        Stránka Souhrn recepce je navíc chráněná číselným přístupovým klíčem. Klíč se zadává při každém
        otevření stránky – neukládá se do prohlížeče. Zde jej můžete nastavit nebo změnit.
      </p>

      {loadError && <div className={styles.err}>{loadError}</div>}

      {configured !== null && (
        <form className={styles.card} onSubmit={submit}>
          <span className={styles.status}>
            {configured ? "Přístupový klíč je nastavený." : "Přístupový klíč zatím není nastavený."}
          </span>

          {configured && (
            <label className={styles.field}>
              Současný přístupový klíč
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                className={styles.input}
                value={currentPin}
                onChange={(e) => setCurrentPin(e.target.value)}
                disabled={saving}
              />
            </label>
          )}

          <label className={styles.field}>
            Nový přístupový klíč
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              className={styles.input}
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
              disabled={saving}
            />
          </label>

          <label className={styles.field}>
            Potvrzení nového klíče
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              className={styles.input}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value)}
              disabled={saving}
            />
          </label>

          <p className={styles.hint}>Klíč musí mít 4 až 10 číslic.</p>

          {error && <div className={styles.err}>{error}</div>}
          {success && <div className={styles.ok}>{success}</div>}

          <div className={styles.actions}>
            <Button type="submit" disabled={saving}>
              {saving ? "Ukládám…" : configured ? "Změnit klíč" : "Nastavit klíč"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
