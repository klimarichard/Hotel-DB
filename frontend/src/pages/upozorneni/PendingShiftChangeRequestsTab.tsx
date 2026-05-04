import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { formatDateCZ } from "@/lib/dateFormat";
import styles from "../AlertsPage.module.css";

interface ChangeRequest {
  id: string;
  planId: string;
  planYear: number | null;
  planMonth: number | null;
  employeeId: string;
  date: string;
  currentRawInput: string;
  reason: string;
}

interface EmployeeMini {
  id: string;
  firstName: string;
  lastName: string;
}

function fmtMonth(year: number | null, month: number | null): string {
  if (year == null || month == null) return "—";
  return `${String(month).padStart(2, "0")}/${year}`;
}

export default function PendingShiftChangeRequestsTab() {
  const [items, setItems] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [empMap, setEmpMap] = useState<Map<string, EmployeeMini>>(new Map());

  useEffect(() => {
    Promise.all([
      api.get<ChangeRequest[]>("/shifts/changeRequests/pending"),
      api.get<EmployeeMini[]>("/employees?status=active"),
      api.get<EmployeeMini[]>("/employees?status=terminated"),
    ])
      .then(([reqs, active, terminated]) => {
        setItems(reqs);
        const m = new Map<string, EmployeeMini>();
        [...active, ...terminated].forEach((e) => m.set(e.id, e));
        setEmpMap(m);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className={styles.state}>Načítám…</div>;
  if (items.length === 0) {
    return <div className={styles.empty}>Žádné čekající žádosti o změnu.</div>;
  }

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Zaměstnanec</th>
            <th>Plán</th>
            <th>Datum</th>
            <th>Aktuální směna</th>
            <th>Důvod</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => {
            const e = empMap.get(r.employeeId);
            return (
              <tr key={r.id}>
                <td>
                  {e ? (
                    <Link to={`/zamestnanci/${r.employeeId}`} className={styles.empLink}>
                      {e.lastName} {e.firstName}
                    </Link>
                  ) : (
                    r.employeeId
                  )}
                </td>
                <td>{fmtMonth(r.planYear, r.planMonth)}</td>
                <td>{formatDateCZ(r.date)}</td>
                <td><code>{r.currentRawInput || "—"}</code></td>
                <td>{r.reason || "—"}</td>
                <td>
                  <Link to="/smeny" className={styles.markReadBtn}>
                    Otevřít plán →
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
