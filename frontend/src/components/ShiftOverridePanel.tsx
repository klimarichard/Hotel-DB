import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { parseShiftExpression } from "../lib/shiftConstants";
import styles from "./ShiftOverridePanel.module.css";

interface OverrideRequest {
  id: string;
  employeeId: string;
  date: string;
  requestedInput: string;
  reason: string;
  violationTypes: string[];
  status: "pending" | "approved" | "rejected";
  requestedAt: { seconds: number } | null;
  rejectionReason: string | null;
}

interface Props {
  planId: string;
  onOverrideResolved: () => void;
  onShiftApproved: (
    employeeId: string,
    date: string,
    rawInput: string,
    hoursComputed: number,
    isDouble: boolean
  ) => void;
}

const VIOLATION_LABELS: Record<string, string> = {
  employee_x_limit: "Limit X zaměstnance",
  day_coverage:     "Denní pokrytí",
  night_coverage:   "Noční pokrytí",
};

function StatusBadge({ status }: { status: OverrideRequest["status"] }) {
  const labels = { pending: "Čeká", approved: "Schváleno", rejected: "Zamítnuto" };
  return (
    <span className={`${styles.badge} ${styles[`badge_${status}`]}`}>
      {labels[status]}
    </span>
  );
}

export default function ShiftOverridePanel({ planId, onOverrideResolved, onShiftApproved }: Props) {
  const [requests, setRequests] = useState<OverrideRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<OverrideRequest[]>(`/shifts/plans/${planId}/shiftOverrides`)
      .then((data) => setRequests(data))
      .catch(() => setRequests([]))
      .finally(() => setLoading(false));
  }, [planId]);

  async function handleApprove(req: OverrideRequest) {
    setSaving(true);
    try {
      await api.patch(`/shifts/plans/${planId}/shiftOverrides/${req.id}`, {
        status: "approved",
      });
      setRequests((prev) =>
        prev.map((r) => (r.id === req.id ? { ...r, status: "approved" as const } : r))
      );
      // Update the grid immediately
      const parsed = parseShiftExpression(req.requestedInput);
      onShiftApproved(req.employeeId, req.date, req.requestedInput, parsed.hoursComputed, parsed.isDouble);
      onOverrideResolved();
    } finally {
      setSaving(false);
    }
  }

  async function handleReject(reqId: string) {
    setSaving(true);
    try {
      await api.patch(`/shifts/plans/${planId}/shiftOverrides/${reqId}`, {
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
      onOverrideResolved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.panel}>
      <h3 className={styles.panelTitle}>Žádosti o výjimku X</h3>

      {loading && <div className={styles.state}>Načítám…</div>}

      {!loading && requests.length === 0 && (
        <div className={styles.empty}>Žádné žádosti o výjimku.</div>
      )}

      {!loading && requests.length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Zaměstnanec</th>
              <th>Datum</th>
              <th>Typ porušení</th>
              <th>Důvod</th>
              <th>Stav</th>
              <th>Akce</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((req) => (
              <>
                <tr key={req.id} className={req.status !== "pending" ? styles.rowDone : ""}>
                  <td>{req.employeeId}</td>
                  <td>{req.date}</td>
                  <td>
                    {req.violationTypes
                      .map((t) => VIOLATION_LABELS[t] ?? t)
                      .join(", ")}
                  </td>
                  <td>{req.reason || "—"}</td>
                  <td>
                    <StatusBadge status={req.status} />
                    {req.status === "rejected" && req.rejectionReason && (
                      <div className={styles.rejectionNote}>{req.rejectionReason}</div>
                    )}
                  </td>
                  <td>
                    {req.status === "pending" && (
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
                {rejectingId === req.id && (
                  <tr key={`reject-${req.id}`}>
                    <td colSpan={6} className={styles.rejectRow}>
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
