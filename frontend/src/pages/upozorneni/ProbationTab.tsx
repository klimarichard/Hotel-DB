import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useAlertsContext } from "@/context/AlertsContext";
import { formatDateCZ } from "@/lib/dateFormat";
import { employeeDisplayName } from "@/lib/employeeName";
import Button from "@/components/Button";
import ConfirmModal from "@/components/ConfirmModal";
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
  read?: boolean;
}

function DaysBadge({ days }: { days: number }) {
  if (days < 0) return <span className={styles.badgeExpired}>Skončila před {Math.abs(days)} dny</span>;
  if (days === 0) return <span className={styles.badgeExpired}>Končí dnes</span>;
  return <span className={styles.badgeExpiring}>Za {days} dní</span>;
}

interface ProbationTableProps {
  alerts: ProbationAlert[];
  actionLabel?: string;
  onAction?: (id: string) => void;
  muted?: boolean;
}

function ProbationTable({ alerts, actionLabel, onAction, muted }: ProbationTableProps) {
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
                  : alert.status === "ended"
                  ? styles.rowExpired
                  : styles.rowExpiring
              }
            >
              <td>
                <Link to={`/zamestnanci/${alert.employeeId}`} className={styles.empLink}>
                  {employeeDisplayName({ firstName: alert.employeeFirstName, lastName: alert.employeeLastName })}
                </Link>
              </td>
              <td data-label="Začátek">{formatDateCZ(alert.probationStartDate)}</td>
              <td data-label="Konec zkušební">{formatDateCZ(alert.probationEndDate)}</td>
              <td data-label="Délka">{alert.probationPeriodRaw}</td>
              <td data-label="Zbývá"><DaysBadge days={alert.daysUntilEnd} /></td>
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

export default function ProbationTab() {
  const [alerts, setAlerts] = useState<ProbationAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { markProbationRead } = useAlertsContext();
  const { can } = useAuth();
  const canRead = can("alerts.read");

  useEffect(() => {
    api.get<ProbationAlert[]>("/alerts/probation")
      .then(setAlerts)
      .finally(() => setLoading(false));
  }, []);

  // Optimistically flip read-state, persist server-side, and on failure
  // re-sync from the server and surface the error (no native dialogs).
  async function setRead(ids: string[], read: boolean) {
    if (ids.length === 0) return;
    setAlerts((prev) => prev.map((a) => (ids.includes(a.id) ? { ...a, read } : a)));
    try {
      await markProbationRead(ids, read);
    } catch {
      api.get<ProbationAlert[]>("/alerts/probation").then(setAlerts).catch(() => {});
      setError("Změnu se nepodařilo uložit. Zkuste to prosím znovu.");
    }
  }

  if (loading) return <div className={styles.state}>Načítám…</div>;

  const unread = alerts.filter((a) => !a.read);
  const read   = alerts.filter((a) =>  a.read);

  return (
    <div>
      {canRead && unread.length > 0 && (
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
          <div className={styles.empty}>Žádné nepřečtené konce zkušební doby.</div>
        ) : (
          <ProbationTable
            alerts={unread}
            actionLabel={canRead ? "Přečteno" : undefined}
            onAction={canRead ? (id) => setRead([id], true) : undefined}
          />
        )}
      </div>

      {read.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Přečtené</div>
          <ProbationTable
            alerts={read}
            muted
            actionLabel={canRead ? "Označit jako nepřečtené" : undefined}
            onAction={canRead ? (id) => setRead([id], false) : undefined}
          />
        </div>
      )}

      {alerts.length === 0 && (
        <div className={styles.empty}>Žádné nadcházející konce zkušební doby.</div>
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
