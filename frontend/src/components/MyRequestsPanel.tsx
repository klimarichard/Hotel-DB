/**
 * Combined read-only panel for employee/manager users showing their own
 * X exception requests and shift change requests for the current plan.
 */

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import styles from "./ShiftOverridePanel.module.css";

interface OverrideRequest {
  id: string;
  date: string;
  requestedInput: string;
  reason: string;
  violationTypes: string[];
  status: "pending" | "approved" | "rejected";
  requestedAt: { seconds: number } | null;
  rejectionReason: string | null;
}

interface ChangeRequest {
  id: string;
  date: string;
  currentRawInput: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: { seconds: number } | null;
  rejectionReason: string | null;
}

interface Props {
  planId: string;
}

function StatusBadge({ status }: { status: "pending" | "approved" | "rejected" }) {
  const labels = { pending: "Čeká", approved: "Schváleno", rejected: "Zamítnuto" };
  return (
    <span className={`${styles.badge} ${styles[`badge_${status}`]}`}>
      {labels[status]}
    </span>
  );
}

function formatDatetime(ts: { seconds: number } | null): string {
  if (!ts) return "—";
  const d = new Date(ts.seconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

export default function MyRequestsPanel({ planId }: Props) {
  const [overrides, setOverrides] = useState<OverrideRequest[]>([]);
  const [changes, setChanges] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<OverrideRequest[]>(`/shifts/plans/${planId}/shiftOverrides`).catch(() => []),
      api.get<ChangeRequest[]>(`/shifts/plans/${planId}/shiftChangeRequests`).catch(() => []),
    ]).then(([ov, ch]) => {
      setOverrides(ov);
      setChanges(ch);
    }).finally(() => setLoading(false));
  }, [planId]);

  const VIOLATION_LABELS: Record<string, string> = {
    employee_x_limit: "Limit X zaměstnance",
    day_coverage:     "Denní pokrytí",
    night_coverage:   "Noční pokrytí",
  };

  return (
    <div className={styles.panel}>
      <h3 className={styles.panelTitle}>Moje žádosti</h3>

      {loading && <div className={styles.state}>Načítám…</div>}

      {!loading && (
        <>
          {/* X exception requests */}
          <div style={{ marginBottom: "1.25rem" }}>
            <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem" }}>
              Žádosti o výjimku X
            </div>
            {overrides.length === 0 ? (
              <div className={styles.empty}>Žádné žádosti o výjimku X.</div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Datum</th>
                    <th>Požadovaná směna</th>
                    <th>Důvod porušení</th>
                    <th>Důvod žádosti</th>
                    <th>Odesláno</th>
                    <th>Stav</th>
                  </tr>
                </thead>
                <tbody>
                  {overrides.map((req) => (
                    <tr key={req.id} className={req.status !== "pending" ? styles.rowDone : ""}>
                      <td>{formatDate(req.date)}</td>
                      <td>{req.requestedInput || "—"}</td>
                      <td>{(req.violationTypes ?? []).map((v) => VIOLATION_LABELS[v] ?? v).join(", ") || "—"}</td>
                      <td>{req.reason || "—"}</td>
                      <td>{formatDatetime(req.requestedAt)}</td>
                      <td>
                        <StatusBadge status={req.status} />
                        {req.status === "rejected" && req.rejectionReason && (
                          <div className={styles.rejectionNote}>{req.rejectionReason}</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Shift change requests */}
          <div>
            <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem" }}>
              Žádosti o změnu směny
            </div>
            {changes.length === 0 ? (
              <div className={styles.empty}>Žádné žádosti o změnu směny.</div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Datum</th>
                    <th>Aktuální směna</th>
                    <th>Důvod žádosti</th>
                    <th>Odesláno</th>
                    <th>Stav</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map((req) => (
                    <tr key={req.id} className={req.status !== "pending" ? styles.rowDone : ""}>
                      <td>{formatDate(req.date)}</td>
                      <td>{req.currentRawInput || "—"}</td>
                      <td>{req.reason || "—"}</td>
                      <td>{formatDatetime(req.requestedAt)}</td>
                      <td>
                        <StatusBadge status={req.status} />
                        {req.status === "rejected" && req.rejectionReason && (
                          <div className={styles.rejectionNote}>{req.rejectionReason}</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
