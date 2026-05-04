import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAlertsContext } from "@/context/AlertsContext";
import { formatDateCZ } from "@/lib/dateFormat";
import Button from "@/components/Button";
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
}

function DaysBadge({ days }: { days: number }) {
  if (days < 0) return <span className={styles.badgeExpired}>Prošlé o {Math.abs(days)} dní</span>;
  if (days === 0) return <span className={styles.badgeExpired}>Vyprší dnes</span>;
  return <span className={styles.badgeExpiring}>Za {days} dní</span>;
}

interface AlertTableProps {
  alerts: Alert[];
  showAction?: boolean;
  onMarkRead?: (id: string) => void;
  muted?: boolean;
}

function AlertTable({ alerts, showAction, onMarkRead, muted }: AlertTableProps) {
  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Zaměstnanec</th>
            <th>Doklad</th>
            <th>Datum expirace</th>
            <th>Zbývá</th>
            {showAction && <th></th>}
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
              {showAction && (
                <td>
                  <button
                    className={styles.markReadBtn}
                    onClick={() => onMarkRead?.(alert.id)}
                  >
                    Přečteno
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
  const { readIds, markRead, markAllRead } = useAlertsContext();

  useEffect(() => {
    api.get<Alert[]>("/alerts")
      .then(setAlerts)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className={styles.state}>Načítám…</div>;

  const unread = alerts.filter((a) => !readIds.has(a.id));
  const read   = alerts.filter((a) =>  readIds.has(a.id));

  return (
    <div>
      {unread.length > 0 && (
        <div className={styles.tabHeader}>
          <Button
            variant="secondary"
            onClick={() => markAllRead(alerts.map((a) => a.id))}
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
          <AlertTable alerts={unread} showAction onMarkRead={(id) => markRead([id])} />
        )}
      </div>

      {read.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Přečtené</div>
          <AlertTable alerts={read} muted />
        </div>
      )}

      {alerts.length === 0 && (
        <div className={styles.empty}>Žádná upozornění. Všechny doklady jsou platné.</div>
      )}
    </div>
  );
}
