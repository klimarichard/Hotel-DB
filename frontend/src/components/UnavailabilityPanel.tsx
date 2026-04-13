import { useEffect, useState } from "react";
import { api } from "../lib/api";
import styles from "./UnavailabilityPanel.module.css";

interface UnavailabilityRequest {
  id: string;
  employeeId: string;
  date: string;
  reason: string;
  isException: boolean;
  status: "pending" | "approved" | "rejected" | "cancelled";
  requestedAt: { seconds: number } | null;
  reviewedBy: string | null;
  rejectionReason: string | null;
}

interface Props {
  planId: string;
}

function StatusBadge({ status }: { status: UnavailabilityRequest["status"] }) {
  const labelMap: Record<UnavailabilityRequest["status"], string> = {
    pending: "Čeká",
    approved: "Schváleno",
    rejected: "Zamítnuto",
    cancelled: "Zrušeno",
  };
  return (
    <span className={`${styles.badge} ${styles[`badge_${status}`]}`}>
      {labelMap[status]}
    </span>
  );
}

export default function UnavailabilityPanel({ planId }: Props) {
  const [requests, setRequests] = useState<UnavailabilityRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<UnavailabilityRequest[]>(`/shifts/plans/${planId}/unavailability`)
      .then((data) => setRequests(data))
      .catch(() => setRequests([]))
      .finally(() => setLoading(false));
  }, [planId]);

  async function handleApprove(reqId: string) {
    setSaving(true);
    try {
      await api.patch(`/shifts/plans/${planId}/unavailability/${reqId}`, {
        status: "approved",
      });
      setRequests((prev) =>
        prev.map((r) => (r.id === reqId ? { ...r, status: "approved" as const } : r))
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleReject(reqId: string) {
    setSaving(true);
    try {
      await api.patch(`/shifts/plans/${planId}/unavailability/${reqId}`, {
        status: "rejected",
        rejectionReason,
      });
      setRequests((prev) =>
        prev.map((r) =>
          r.id === reqId
            ? { ...r, status: "rejected" as const, rejectionReason }
            : r
        )
      );
      setRejectingId(null);
      setRejectionReason("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.panel}>
      <h3 className={styles.panelTitle}>Žádosti o volno</h3>

      {loading && <div className={styles.state}>Načítám…</div>}

      {!loading && requests.length === 0 && (
        <div className={styles.empty}>Žádné žádosti.</div>
      )}

      {!loading && requests.length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>ID zaměstnance</th>
              <th>Datum</th>
              <th>Důvod</th>
              <th>Výjimka</th>
              <th>Stav</th>
              <th>Akce</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((req) => (
              <>
                <tr
                  key={req.id}
                  className={req.status !== "pending" ? styles.rowDone : ""}
                >
                  <td>{req.employeeId}</td>
                  <td>{req.date}</td>
                  <td>{req.reason || "—"}</td>
                  <td>{req.isException ? "Ano" : "Ne"}</td>
                  <td>
                    <StatusBadge status={req.status} />
                  </td>
                  <td>
                    {req.status === "pending" && (
                      <div className={styles.actions}>
                        <button
                          className={styles.approveBtn}
                          onClick={() => handleApprove(req.id)}
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
