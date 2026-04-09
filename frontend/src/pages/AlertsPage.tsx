import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import styles from "./AlertsPage.module.css";

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

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("cs-CZ");
}

function DaysBadge({ days }: { days: number }) {
  if (days < 0) {
    return <span className={styles.badgeExpired}>Prošlé o {Math.abs(days)} dní</span>;
  }
  if (days === 0) {
    return <span className={styles.badgeExpired}>Vyprší dnes</span>;
  }
  return <span className={styles.badgeExpiring}>Za {days} dní</span>;
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Alert[]>("/alerts")
      .then(setAlerts)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className={styles.state}>Načítám…</div>;

  return (
    <div>
      <h1 className={styles.title}>Upozornění na expiraci dokladů</h1>

      {alerts.length === 0 ? (
        <div className={styles.empty}>Žádná upozornění. Všechny doklady jsou platné.</div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Zaměstnanec</th>
                <th>Doklad</th>
                <th>Datum expirace</th>
                <th>Zbývá</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((alert) => (
                <tr key={alert.id} className={alert.status === "expired" ? styles.rowExpired : styles.rowExpiring}>
                  <td>
                    <Link to={`/zamestnanci/${alert.employeeId}`} className={styles.empLink}>
                      {alert.employeeLastName} {alert.employeeFirstName}
                    </Link>
                  </td>
                  <td>{alert.fieldLabel}</td>
                  <td>{formatDate(alert.expiryDate)}</td>
                  <td><DaysBadge days={alert.daysUntilExpiry} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
