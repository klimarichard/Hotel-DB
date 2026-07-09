import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatDateCZ } from "@/lib/dateFormat";
import { hotelBySlug } from "@/lib/hotels";
import Button from "@/components/Button";
import ConfirmModal from "@/components/ConfirmModal";
import styles from "../AlertsPage.module.css";

interface HandoverWarning {
  id: string;
  hotel: string;
  shiftDate: string;
  shiftType: "den" | "noc";
  actorName?: string;
  expectedName?: string;
  read?: boolean;
}

const SHIFT_LABELS: Record<string, string> = { den: "Den", noc: "Noc" };

function WarningTable({
  rows,
  actionLabel,
  onAction,
  muted,
}: {
  rows: HandoverWarning[];
  actionLabel?: string;
  onAction?: (id: string) => void;
  muted?: boolean;
}) {
  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Hotel</th>
            <th>Datum</th>
            <th>Směna</th>
            <th>Předal</th>
            <th>Očekáván</th>
            {actionLabel && <th></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((w) => (
            <tr key={w.id} className={muted ? styles.rowRead : styles.rowExpiring}>
              <td data-label="Hotel">{hotelBySlug(w.hotel)?.label ?? w.hotel}</td>
              <td data-label="Datum">{formatDateCZ(w.shiftDate)}</td>
              <td data-label="Směna">{SHIFT_LABELS[w.shiftType] ?? w.shiftType}</td>
              <td data-label="Předal">{w.actorName || "–"}</td>
              <td data-label="Očekáván">{w.expectedName || "–"}</td>
              {actionLabel && (
                <td>
                  <button className={styles.markReadBtn} onClick={() => onAction?.(w.id)}>
                    {actionLabel}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function HandoverWarningsTab() {
  const [warnings, setWarnings] = useState<HandoverWarning[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<HandoverWarning[]>("/handover-warnings")
      .then(setWarnings)
      .catch(() => setError("Upozornění se nepodařilo načíst."))
      .finally(() => setLoading(false));
  }, []);

  async function setRead(ids: string[], read: boolean) {
    if (ids.length === 0) return;
    setWarnings((prev) => prev.map((w) => (ids.includes(w.id) ? { ...w, read } : w)));
    try {
      await api.post("/handover-warnings/read", { ids, read });
    } catch {
      api.get<HandoverWarning[]>("/handover-warnings").then(setWarnings).catch(() => {});
      setError("Změnu se nepodařilo uložit. Zkuste to prosím znovu.");
    }
  }

  if (loading) return <div className={styles.state}>Načítám…</div>;

  const unread = warnings.filter((w) => !w.read);
  const read = warnings.filter((w) => w.read);

  return (
    <div>
      {unread.length > 0 && (
        <div className={styles.tabHeader}>
          <Button variant="secondary" onClick={() => setRead(unread.map((w) => w.id), true)}>
            Označit vše jako přečtené
          </Button>
        </div>
      )}

      <div className={styles.section}>
        <div className={styles.sectionLabel}>
          Nepřečtené
          {unread.length > 0 && <span className={styles.countBadge}>{unread.length}</span>}
        </div>
        {unread.length === 0 ? (
          <div className={styles.empty}>Žádná nenavazující předání.</div>
        ) : (
          <WarningTable rows={unread} actionLabel="Přečteno" onAction={(id) => setRead([id], true)} />
        )}
      </div>

      {read.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Přečtené</div>
          <WarningTable
            rows={read}
            muted
            actionLabel="Označit jako nepřečtené"
            onAction={(id) => setRead([id], false)}
          />
        </div>
      )}

      {error && (
        <ConfirmModal
          title="Chyba"
          message={error}
          confirmLabel="OK"
          showCancel={false}
          onConfirm={() => setError(null)}
          onCancel={() => setError(null)}
        />
      )}
    </div>
  );
}
