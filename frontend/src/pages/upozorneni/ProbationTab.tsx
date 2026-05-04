import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAlertsContext } from "@/context/AlertsContext";
import { formatDateCZ } from "@/lib/dateFormat";
import Button from "@/components/Button";
import styles from "../AlertsPage.module.css";

interface ProbationAlert {
  id: string;
  employeeId: string;
  employeeFirstName: string;
  employeeLastName: string;
  probationStartDate: string;
  probationEndDate: string;
  probationPeriodRaw: string;
  daysUntilEnd: number;
  status: "ending" | "ended";
}

function DaysBadge({ days }: { days: number }) {
  if (days < 0) return <span className={styles.badgeExpired}>Skončila před {Math.abs(days)} dny</span>;
  if (days === 0) return <span className={styles.badgeExpired}>Končí dnes</span>;
  return <span className={styles.badgeExpiring}>Za {days} dní</span>;
}

interface ProbationTableProps {
  alerts: ProbationAlert[];
  showAction?: boolean;
  onMarkRead?: (id: string) => void;
  muted?: boolean;
}

function ProbationTable({ alerts, showAction, onMarkRead, muted }: ProbationTableProps) {
  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Zaměstnanec</th>
            <th>Začátek</th>
            <th>Konec zkušební</th>
            <th>Délka</th>
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
                  : alert.status === "ended"
                  ? styles.rowExpired
                  : styles.rowExpiring
              }
            >
              <td>
                <Link to={`/zamestnanci/${alert.employeeId}`} className={styles.empLink}>
                  {alert.employeeLastName} {alert.employeeFirstName}
                </Link>
              </td>
              <td>{formatDateCZ(alert.probationStartDate)}</td>
              <td>{formatDateCZ(alert.probationEndDate)}</td>
              <td>{alert.probationPeriodRaw}</td>
              <td><DaysBadge days={alert.daysUntilEnd} /></td>
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

export default function ProbationTab() {
  const [alerts, setAlerts] = useState<ProbationAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const { readProbationIds, markProbationRead, markAllProbationRead } = useAlertsContext();

  useEffect(() => {
    api.get<ProbationAlert[]>("/alerts/probation")
      .then(setAlerts)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className={styles.state}>Načítám…</div>;

  const unread = alerts.filter((a) => !readProbationIds.has(a.id));
  const read   = alerts.filter((a) =>  readProbationIds.has(a.id));

  return (
    <div>
      {unread.length > 0 && (
        <div className={styles.tabHeader}>
          <Button variant="secondary" onClick={markAllProbationRead}>
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
          <div className={styles.empty}>Žádné nepřečtené konce zkušební doby.</div>
        ) : (
          <ProbationTable alerts={unread} showAction onMarkRead={(id) => markProbationRead([id])} />
        )}
      </div>

      {read.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Přečtené</div>
          <ProbationTable alerts={read} muted />
        </div>
      )}

      {alerts.length === 0 && (
        <div className={styles.empty}>Žádné nadcházející konce zkušební doby.</div>
      )}
    </div>
  );
}
