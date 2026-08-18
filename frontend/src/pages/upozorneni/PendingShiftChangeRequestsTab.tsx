import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "@/lib/api";
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<ChangeRequest[]>("/shifts/changeRequests/pending"),
      // The employee lists only decorate rows with a name. Reviewing change
      // requests is gated on shifts.override.review, which does NOT imply
      // employees.view.* – so a 403 here must degrade to the raw employeeId
      // (see the JSX fallback below), never hide the pending list itself.
      //
      // All THREE lifecycle statuses are needed, not just active + terminated:
      // a future hire is stamped "before-start" until their Nástup date
      // arrives, and /employees/plan-options staffs plans from the whole
      // roster with no status filter — so a request can legitimately exist
      // against someone who has not started yet. Omitting them dropped the
      // row to the raw-employeeId fallback, which is meant to signal a 403,
      // not a routine gap in the map.
      api.get<EmployeeMini[]>("/employees?status=active").catch(() => [] as EmployeeMini[]),
      api.get<EmployeeMini[]>("/employees?status=before-start").catch(() => [] as EmployeeMini[]),
      api.get<EmployeeMini[]>("/employees?status=terminated").catch(() => [] as EmployeeMini[]),
    ])
      .then(([reqs, active, beforeStart, terminated]) => {
        setItems(reqs);
        const m = new Map<string, EmployeeMini>();
        [...active, ...beforeStart, ...terminated].forEach((e) => m.set(e.id, e));
        setEmpMap(m);
      })
      .catch((err) =>
        setError(
          `Čekající žádosti o změnu se nepodařilo načíst. ${errorMessage(err, "Zkuste to prosím znovu.")}`
        )
      )
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className={styles.state}>Načítám…</div>;
  if (error) {
    return (
      <div className={styles.empty} style={{ color: "var(--color-danger-text)" }}>
        {error}
      </div>
    );
  }
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
