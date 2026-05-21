import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAlertsContext } from "@/context/AlertsContext";
import { formatDateCZ } from "@/lib/dateFormat";
import Button from "@/components/Button";
import ConfirmModal from "@/components/ConfirmModal";
import styles from "../AlertsPage.module.css";

interface Alert {
  id: string;
  employeeId: string;
  employeeFirstName: string;
  employeeLastName: string;
  fieldLabel: string;
  expiryDate: string;
  daysUntilExpiry: number;
  status: "expiring" | "expired";
  read?: boolean;
}

function DaysBadge({ days }: { days: number }) {
  if (days < 0) return <span className={styles.badgeExpired}>Prošlé o {Math.abs(days)} dní</span>;
  if (days === 0) return <span className={styles.badgeExpired}>Vyprší dnes</span>;
  return <span className={styles.badgeExpiring}>Za {days} dní</span>;
}

interface AlertTableProps {
  alerts: Alert[];
  actionLabel?: string;
  onAction?: (id: string) => void;
  muted?: boolean;
}

function AlertTable({ alerts, actionLabel, onAction, muted }: AlertTableProps) {
  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Zaměstnanec</th>
            <th>Doklad</th>
            <th>Datum expirace</th>
            <th>Zbývá</th>
            {actionLabel && <th></th>}
          </tr>
        </thead>
        <tbody>
          {alerts.map((alert) => (
            <tr
              key={alert.id}
              className={
                muted
                  ? styles.rowRead
                  : alert.status === "expired"
                  ? styles.rowExpired
                  : styles.rowExpiring
              }
            >
              <td>
                <Link to={`/zamestnanci/${alert.employeeId}`} className={styles.empLink}>
                  {alert.employeeLastName} {alert.employeeFirstName}
                </Link>
              </td>
              <td>{alert.fieldLabel}</td>
              <td>{formatDateCZ(alert.expiryDate)}</td>
              <td><DaysBadge days={alert.daysUntilExpiry} /></td>
              {actionLabel && (
                <td>
                  <button
                    className={styles.markReadBtn}
                    onClick={() => onAction?.(alert.id)}
                  >
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

export default function DocumentExpiryTab() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { markRead } = useAlertsContext();

  useEffect(() => {
    api.get<Alert[]>("/alerts")
      .then(setAlerts)
      .finally(() => setLoading(false));
  }, []);

  // Optimistically flip read-state, persist server-side, and on failure
  // re-sync from the server and surface the error (no native dialogs).
  async function setRead(ids: string[], read: boolean) {
    if (ids.length === 0) return;
    setAlerts((prev) => prev.map((a) => (ids.includes(a.id) ? { ...a, read } : a)));
    try {
      await markRead(ids, read);
    } catch {
      api.get<Alert[]>("/alerts").then(setAlerts).catch(() => {});
      setError("Změnu se nepodařilo uložit. Zkuste to prosím znovu.");
    }
  }

  if (loading) return <div className={styles.state}>Načítám…</div>;

  const unread = alerts.filter((a) => !a.read);
  const read   = alerts.filter((a) =>  a.read);

  return (
    <div>
      {unread.length > 0 && (
        <div className={styles.tabHeader}>
          <Button
            variant="secondary"
            onClick={() => setRead(unread.map((a) => a.id), true)}
          >
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
          <div className={styles.empty}>Žádná nepřečtená upozornění.</div>
        ) : (
          <AlertTable
            alerts={unread}
            actionLabel="Přečteno"
            onAction={(id) => setRead([id], true)}
          />
        )}
      </div>

      {read.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Přečtené</div>
          <AlertTable
            alerts={read}
            muted
            actionLabel="Označit jako nepřečtené"
            onAction={(id) => setRead([id], false)}
          />
        </div>
      )}

      {alerts.length === 0 && (
        <div className={styles.empty}>Žádná upozornění. Všechny doklady jsou platné.</div>
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
