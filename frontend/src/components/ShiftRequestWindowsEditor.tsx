import { useEffect, useState } from "react";
import { api } from "../lib/api";
import Button from "./Button";
import IconButton from "./IconButton";
import styles from "./ShiftRequestWindowsEditor.module.css";

export interface ShiftRequestWindow {
  from: string;
  to: string;
}

interface Props {
  planId: string;
  year: number;
  month: number;
  windows: ShiftRequestWindow[];
  /** Called with the server-normalised list after a successful save. */
  onSaved: (windows: ShiftRequestWindow[]) => void;
  /** Called with a Czech error message (the page shows it in ConfirmModal). */
  onError: (message: string) => void;
}

/** Mirrors the server limit in functions/src/routes/shifts.ts. */
const MAX_WINDOWS = 10;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** First / last date the plan displays (December: through its linked 1 January). */
function displayedRange(year: number, month: number): { first: string; last: string } {
  const lastDay = new Date(year, month, 0).getDate();
  return {
    first: `${year}-${pad(month)}-01`,
    last: month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month)}-${pad(lastDay)}`,
  };
}

/**
 * Compact editor for a plan's "Okna pro žádosti o směnu" – the date ranges in
 * which employees may request a specific shift in their own row. Rendered only
 * for holders of shifts.plan.edit; the server enforces the same permission.
 */
export default function ShiftRequestWindowsEditor({ planId, year, month, windows, onSaved, onError }: Props) {
  const [draft, setDraft] = useState<ShiftRequestWindow[]>(windows);
  const [saving, setSaving] = useState(false);
  const range = displayedRange(year, month);

  // Re-sync when the stored windows change (plan switch, reload after save).
  const storedKey = JSON.stringify(windows);
  useEffect(() => {
    setDraft(windows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId, storedKey]);

  const dirty = JSON.stringify(draft) !== storedKey;
  const incomplete = draft.some((w) => !w.from || !w.to);

  function update(i: number, patch: Partial<ShiftRequestWindow>) {
    setDraft((d) => d.map((w, idx) => (idx === i ? { ...w, ...patch } : w)));
  }

  async function save() {
    if (incomplete) {
      onError("Vyplňte u každého okna začátek i konec.");
      return;
    }
    const bad = draft.find((w) => w.from > w.to);
    if (bad) {
      onError("Začátek okna musí být nejpozději v den jeho konce.");
      return;
    }
    setSaving(true);
    try {
      const r = await api.put<{ ok: boolean; shiftRequestWindows: ShiftRequestWindow[] }>(
        `/shifts/plans/${planId}/request-windows`,
        { windows: draft }
      );
      const next = r.shiftRequestWindows ?? draft;
      setDraft(next);
      onSaved(next);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Okna se nepodařilo uložit.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.bar} data-tour="shift-request-windows">
      <span className={styles.label} title="V těchto dnech mohou zaměstnanci ve svém řádku požádat o konkrétní směnu">
        Okna pro žádosti o směnu:
      </span>
      {draft.length === 0 && <span className={styles.none}>žádná</span>}
      {draft.map((w, i) => (
        <span key={i} className={styles.item}>
          <input
            type="date"
            className={styles.input}
            value={w.from}
            min={range.first}
            max={range.last}
            aria-label="Začátek okna"
            onChange={(e) => update(i, { from: e.target.value })}
          />
          <span className={styles.dash}>–</span>
          <input
            type="date"
            className={styles.input}
            value={w.to}
            min={w.from || range.first}
            max={range.last}
            aria-label="Konec okna"
            onChange={(e) => update(i, { to: e.target.value })}
          />
          <IconButton
            aria-label="Odebrat okno"
            title="Odebrat okno"
            onClick={() => setDraft((d) => d.filter((_, idx) => idx !== i))}
          >
            ✕
          </IconButton>
        </span>
      ))}
      {draft.length < MAX_WINDOWS && (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setDraft((d) => [...d, { from: range.first, to: range.first }])}
          title="Přidat okno"
        >
          +
        </Button>
      )}
      {dirty && (
        <Button size="sm" variant="primary" onClick={save} disabled={saving}>
          {saving ? "Ukládám…" : "Uložit"}
        </Button>
      )}
    </div>
  );
}
