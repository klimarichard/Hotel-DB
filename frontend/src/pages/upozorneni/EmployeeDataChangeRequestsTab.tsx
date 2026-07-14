import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { formatDatetimeCZ } from "@/lib/dateFormat";
import { employeeDisplayName } from "@/lib/employeeName";
import { useEmployeeChangeRequestsContext } from "@/context/EmployeeChangeRequestsContext";
import Button from "@/components/Button";
import card from "../EmployeeSelfPage.module.css";
import styles from "../AlertsPage.module.css";

const MASK = "••••••••";

interface PendingChange {
  field: string;
  section: string;
  sensitive: boolean;
  label: string;
  newValue: string | null;
  oldValue?: string | null;
}
interface PendingRequest {
  id: string;
  employeeId: string;
  employeeFirstName: string;
  employeeLastName: string;
  employeeDisplayName?: string;
  requestedByName: string;
  requestedAt: { seconds?: number; _seconds?: number } | null;
  changes: PendingChange[];
}

export default function EmployeeDataChangeRequestsTab() {
  const { refresh } = useEmployeeChangeRequestsContext();
  const { can } = useAuth();
  const canReview = can("changeRequests.review");
  const canReveal = can("sensitive.reveal");
  const [items, setItems] = useState<PendingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<PendingRequest[]>("/employee-change-requests/pending")
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  async function handleReveal(id: string, field: string) {
    try {
      const res = await api.post<{ value: string }>(`/employee-change-requests/${id}/reveal`, { field });
      setRevealed((p) => ({ ...p, [`${id}:${field}`]: res.value }));
    } catch {
      /* ignore – value stays masked */
    }
  }

  async function resolve(id: string, status: "approved" | "rejected") {
    setSaving(true);
    try {
      await api.patch(`/employee-change-requests/${id}`, {
        status,
        rejectionReason: status === "rejected" ? rejectionReason : undefined,
      });
      setItems((prev) => prev.filter((r) => r.id !== id));
      setRejectingId(null);
      setRejectionReason("");
      refresh();
    } finally {
      setSaving(false);
    }
  }

  function renderNew(req: PendingRequest, c: PendingChange) {
    if (c.sensitive) {
      const key = `${req.id}:${c.field}`;
      if (revealed[key] !== undefined) return <span>{revealed[key]}</span>;
      if (c.newValue === null) return <span className={card.muted}>(smazat hodnotu)</span>;
      return (
        <span>
          {MASK}
          {canReveal && (
            <button type="button" className={card.revealBtn} onClick={() => handleReveal(req.id, c.field)}>
              Zobrazit
            </button>
          )}
        </span>
      );
    }
    return <span>{c.newValue || <span className={card.muted}>(smazat)</span>}</span>;
  }

  if (loading) return <div className={styles.state}>Načítám…</div>;
  if (items.length === 0) {
    return <div className={styles.empty}>Žádné čekající žádosti o úpravu údajů.</div>;
  }

  return (
    <div>
      {items.map((req) => (
        <div className={card.requestCard} key={req.id}>
          <div className={card.reqHeader}>
            <Link to={`/zamestnanci/${req.employeeId}`} className={styles.empLink}>
              {employeeDisplayName({
                displayName: req.employeeDisplayName,
                firstName: req.employeeFirstName,
                lastName: req.employeeLastName,
              })}
            </Link>
            <span className={card.reqMeta}>
              {req.requestedByName ? `${req.requestedByName} · ` : ""}
              {formatDatetimeCZ(req.requestedAt)}
            </span>
          </div>

          <div className={card.changeList}>
            {req.changes.map((c, i) => (
              <div className={card.changeItem} key={i}>
                <span className={card.changeFieldLabel}>{c.label}:</span>
                {c.oldValue ? (
                  <>
                    <span className={card.muted}>{c.oldValue}</span>
                    <span className={card.changeArrow}>→</span>
                  </>
                ) : null}
                {renderNew(req, c)}
              </div>
            ))}
          </div>

          {canReview && (
            <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.75rem" }}>
              <Button variant="primary" size="sm" onClick={() => resolve(req.id, "approved")} disabled={saving}>
                Schválit
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  setRejectingId(req.id);
                  setRejectionReason("");
                }}
                disabled={saving}
              >
                Zamítnout
              </Button>
            </div>
          )}

          {rejectingId === req.id && (
            <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.6rem", alignItems: "center" }}>
              <input
                className={card.input}
                placeholder="Důvod zamítnutí (volitelné)…"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                style={{ flex: 1 }}
              />
              <Button variant="danger" size="sm" onClick={() => resolve(req.id, "rejected")} disabled={saving}>
                Potvrdit
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setRejectingId(null)} disabled={saving}>
                Zpět
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
