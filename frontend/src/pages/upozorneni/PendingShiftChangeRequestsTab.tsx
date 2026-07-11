import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { formatDateCZ } from "@/lib/dateFormat";
import { employeeDisplayName } from "@/lib/employeeName";
import { formatRequestedChange, type RequestedChange } from "@/lib/shiftChangeRequest";
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
  requestedChange?: RequestedChange;
  /** Present when filed at a shared terminal — the real person who requested. */
  requestedByEmployeeId?: string;
}

interface EmployeeMini {
  id: string;
  firstName: string;
  lastName: string;
  displayName?: string;
}

function fmtMonth(year: number | null, month: number | null): string {
  if (year == null || month == null) return "–";
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
            <th>Požadovaná změna</th>
            <th>Důvod</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => {
            const e = empMap.get(r.employeeId);
            const requester = r.requestedByEmployeeId ? empMap.get(r.requestedByEmployeeId) : undefined;
            return (
              <tr key={r.id}>
                <td>
                  {e ? (
                    <Link to={`/zamestnanci/${r.employeeId}`} className={styles.empLink}>
                      {employeeDisplayName(e)}
                    </Link>
                  ) : (
                    r.employeeId
                  )}
                  {r.requestedByEmployeeId && (
                    <div style={{ fontSize: "0.78rem", opacity: 0.7, marginTop: 2 }}>
                      Přes recepci: {requester ? employeeDisplayName(requester) : r.requestedByEmployeeId}
                    </div>
                  )}
                </td>
                <td data-label="Plán">{fmtMonth(r.planYear, r.planMonth)}</td>
                <td data-label="Datum">{formatDateCZ(r.date)}</td>
                <td data-label="Aktuální směna"><code>{r.currentRawInput || "–"}</code></td>
                <td data-label="Požadovaná změna">{formatRequestedChange(r.requestedChange)}</td>
                <td data-label="Důvod">{r.reason || "–"}</td>
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
