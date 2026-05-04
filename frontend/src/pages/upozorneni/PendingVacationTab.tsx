import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { formatDateCZ } from "@/lib/dateFormat";
import styles from "../AlertsPage.module.css";

interface VacationRequest {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: string;
  pendingEdit?: { startDate: string; endDate: string; reason: string } | null;
}

export default function PendingVacationTab() {
  const [items, setItems] = useState<VacationRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<VacationRequest[]>("/vacation")
      .then((all) => {
        const pending = all.filter(
          (v) => v.status === "pending" || (v.status === "approved" && v.pendingEdit)
        );
        setItems(pending);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className={styles.state}>Načítám…</div>;

  if (items.length === 0) {
    return <div className={styles.empty}>Žádné čekající žádosti o dovolenou.</div>;
  }

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Zaměstnanec</th>
            <th>Od</th>
            <th>Do</th>
            <th>Důvod</th>
            <th>Stav</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((v) => {
            const start = v.pendingEdit?.startDate ?? v.startDate;
            const end = v.pendingEdit?.endDate ?? v.endDate;
            const reason = v.pendingEdit?.reason ?? v.reason;
            return (
              <tr key={v.id}>
                <td>
                  <Link to={`/zamestnanci/${v.employeeId}`} className={styles.empLink}>
                    {v.lastName} {v.firstName}
                  </Link>
                </td>
                <td>{formatDateCZ(start)}</td>
                <td>{formatDateCZ(end)}</td>
                <td>{reason || "—"}</td>
                <td>
                  {v.pendingEdit ? (
                    <span className={styles.badgeExpiring}>Úprava ke schválení</span>
                  ) : (
                    <span className={styles.badgeExpiring}>Čeká</span>
                  )}
                </td>
                <td>
                  <Link to="/dovolena" className={styles.markReadBtn}>
                    Otevřít →
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
