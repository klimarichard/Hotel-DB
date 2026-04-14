import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { PlanEmployee } from "../pages/ShiftPlannerPage";
import styles from "./ShiftOverridePanel.module.css";

interface ChangeRequest {
  id: string;
  employeeId: string;
  date: string;
  currentRawInput: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: { seconds: number } | null;
  rejectionReason: string | null;
}

interface Props {
  planId: string;
  employees: PlanEmployee[];
  onResolved: () => void;
  canReview?: boolean;  // show approve/deny controls (admin/director only)
}

function StatusBadge({ status }: { status: ChangeRequest["status"] }) {
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

export default function ShiftChangeRequestPanel({ planId, employees, onResolved, canReview = true }: Props) {
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<ChangeRequest[]>(`/shifts/plans/${planId}/shiftChangeRequests`)
      .then((data) => setRequests(data))
      .catch(() => setRequests([]))
      .finally(() => setLoading(false));
  }, [planId]);

  function resolveEmployeeName(employeeId: string): string {
    const emp = employees.find((e) => e.employeeId === employeeId);
    return emp ? `${emp.lastName} ${emp.firstName}` : employeeId;
  }

  async function handleApprove(req: ChangeRequest) {
    setSaving(true);
    try {
      await api.patch(`/shifts/plans/${planId}/shiftChangeRequests/${req.id}`, {
        status: "approved",
      });
      setRequests((prev) =>
        prev.map((r) => (r.id === req.id ? { ...r, status: "approved" as const } : r))
      );
      onResolved();
    } finally {
      setSaving(false);
    }
  }

  async function handleReject(reqId: string) {
    setSaving(true);
    try {
      await api.patch(`/shifts/plans/${planId}/shiftChangeRequests/${reqId}`, {
        status: "rejected",
        rejectionReason,
      });
      setRequests((prev) =>
        prev.map((r) =>
          r.id === reqId ? { ...r, status: "rejected" as const, rejectionReason } : r
        )
      );
      setRejectingId(null);
      setRejectionReason("");
      onResolved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.panel}>
      <h3 className={styles.panelTitle}>Žádosti o změnu směny</h3>

      {loading && <div className={styles.state}>Načítám…</div>}

      {!loading && requests.length === 0 && (
        <div className={styles.empty}>Žádné žádosti o změnu směny.</div>
      )}

      {!loading && requests.length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Zaměstnanec</th>
              <th>Datum</th>
              <th>Aktuální směna</th>
              <th>Důvod</th>
              <th>Odesláno</th>
              <th>Stav</th>
              <th>Akce</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((req) => (
              <>
                <tr key={req.id} className={req.status !== "pending" ? styles.rowDone : ""}>
                  <td>{resolveEmployeeName(req.employeeId)}</td>
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
                  <td>
                    {canReview && req.status === "pending" && (
                      <div className={styles.actions}>
                        <button
                          className={styles.approveBtn}
                          onClick={() => handleApprove(req)}
                          disabled={saving}
                        >
                          Schválit
                        </button>
                        <button
                          className={styles.rejectBtn}
                          onClick={() => {
                            setRejectingId(req.id);
                            setRejectionReason("");
                          }}
                          disabled={saving}
                        >
                          Zamítnout
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
                {canReview && rejectingId === req.id && (
                  <tr key={`reject-${req.id}`}>
                    <td colSpan={7} className={styles.rejectRow}>
                      <input
                        className={styles.rejectInput}
                        placeholder="Důvod zamítnutí (volitelné)…"
                        value={rejectionReason}
                        onChange={(e) => setRejectionReason(e.target.value)}
                      />
                      <button
                        className={styles.confirmRejectBtn}
                        onClick={() => handleReject(req.id)}
                        disabled={saving}
                      >
                        Potvrdit zamítnutí
                      </button>
                      <button
                        className={styles.cancelBtn}
                        onClick={() => setRejectingId(null)}
                      >
                        Zrušit
                      </button>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
