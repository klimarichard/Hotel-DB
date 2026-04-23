import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../hooks/useAuth";
import { useVacationContext } from "@/context/VacationContext";
import { formatDateCZ, formatDatetimeCZ } from "../lib/dateFormat";
import styles from "./VacationPage.module.css";
import VacationCollisionInfoModal, {
  type ShiftCollision,
} from "../components/VacationCollisionInfoModal";
import VacationCollisionResolutionModal from "../components/VacationCollisionResolutionModal";
import Button from "../components/Button";

function extractCollisions(e: unknown): ShiftCollision[] | null {
  // Preferred path — ApiError with structured body
  if (e instanceof ApiError && e.status === 409) {
    const body = e.body as { error?: string; collisions?: ShiftCollision[] } | null;
    if (body && body.error === "shift_collision" && Array.isArray(body.collisions)) {
      return body.collisions;
    }
  }
  // Fallback — duck-typed for cases where instanceof fails across HMR/bundle
  // boundaries (the error class identity may differ but the shape is stable).
  const anyE = e as { status?: number; body?: { error?: string; collisions?: ShiftCollision[] } };
  if (anyE && anyE.status === 409 && anyE.body && anyE.body.error === "shift_collision" && Array.isArray(anyE.body.collisions)) {
    return anyE.body.collisions;
  }
  return null;
}

interface PendingEdit {
  startDate: string;
  endDate: string;
  reason: string;
}

interface VacationRequest {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  uid: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: { seconds: number } | null;
  rejectionReason: string | null;
  pendingEdit: PendingEdit | null;
}

interface ApprovedUpcoming {
  employeeId: string;
  firstName: string;
  lastName: string;
  startDate: string;
  endDate: string;
}

function StatusBadge({ status }: { status: VacationRequest["status"] }) {
  const labels = { pending: "Čeká", approved: "Schváleno", rejected: "Zamítnuto" };
  return (
    <span className={`${styles.badge} ${styles[`badge_${status}`]}`}>
      {labels[status]}
    </span>
  );
}

export default function VacationPage() {
  const { user, role, employeeId } = useAuth();
  const { refresh: refreshVacationBadge } = useVacationContext();
  const canApprove = role === "admin" || role === "director";

  const [requests, setRequests] = useState<VacationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [approvedUpcoming, setApprovedUpcoming] = useState<ApprovedUpcoming[] | null>(null);

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState(false);

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [actionSaving, setActionSaving] = useState(false);

  // Inline edit state (used in "Moje žádosti")
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // Collision modals
  const [infoCollisions, setInfoCollisions] = useState<ShiftCollision[] | null>(null);
  const [resolution, setResolution] = useState<{
    requestId: string;
    employeeName: string;
    collisions: ShiftCollision[];
  } | null>(null);

  useEffect(() => {
    api
      .get<VacationRequest[]>("/vacation")
      .then((data) => setRequests(data))
      .catch(() => setRequests([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (canApprove) return;
    let cancelled = false;
    api
      .get<ApprovedUpcoming[]>("/vacation/approved-upcoming")
      .then((data) => { if (!cancelled) setApprovedUpcoming(data); })
      .catch(() => { if (!cancelled) setApprovedUpcoming([]); });
    return () => { cancelled = true; };
  }, [canApprove]);

  const myRequests = requests.filter((r) => r.uid === user?.uid);
  const allRequests = requests; // admin/director already gets all from backend

  async function handleSubmit() {
    setFormError(null);
    setFormSuccess(false);
    if (!startDate || !endDate) {
      setFormError("Vyplňte datum začátku a konce");
      return;
    }
    if (startDate > endDate) {
      setFormError("Datum začátku musí být před datem konce");
      return;
    }
    if (!employeeId) {
      setFormError("Váš účet není spojen se záznamem zaměstnance");
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.post<{ id: string; firstName: string; lastName: string }>(
        "/vacation",
        { startDate, endDate, reason },
      );
      const newRequest: VacationRequest = {
        id: result.id,
        employeeId: employeeId,
        firstName: result.firstName,
        lastName: result.lastName,
        uid: user!.uid,
        startDate,
        endDate,
        reason,
        status: "pending",
        requestedAt: null,
        rejectionReason: null,
        pendingEdit: null,
      };
      setRequests((prev) => [newRequest, ...prev]);
      setStartDate("");
      setEndDate("");
      setReason("");
      setFormSuccess(true);
      refreshVacationBadge();
    } catch (e) {
      const collisions = extractCollisions(e);
      if (collisions) {
        setInfoCollisions(collisions);
      } else {
        setFormError(e instanceof Error ? e.message : "Chyba při odesílání");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function persistApproval(id: string, excludeDates: string[]) {
    await api.patch(`/vacation/${id}`, { status: "approved", excludeDates });
    setRequests((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        if (r.pendingEdit) {
          // Approving an edit — apply new dates and clear pendingEdit
          return {
            ...r,
            startDate: r.pendingEdit.startDate,
            endDate: r.pendingEdit.endDate,
            reason: r.pendingEdit.reason,
            pendingEdit: null,
          };
        }
        return { ...r, status: "approved" as const };
      })
    );
    refreshVacationBadge();
  }

  async function handleApprove(id: string) {
    const req = requests.find((r) => r.id === id);
    if (!req) return;

    // Pre-check against the dates that will actually be approved (pendingEdit
    // wins if present). 409 from the backend is also handled defensively.
    const startDate = req.pendingEdit?.startDate ?? req.startDate;
    const endDate = req.pendingEdit?.endDate ?? req.endDate;

    setActionSaving(true);
    try {
      const { collisions } = await api.get<{ collisions: ShiftCollision[] }>(
        `/vacation/check-collisions?employeeId=${encodeURIComponent(req.employeeId)}` +
        `&startDate=${startDate}&endDate=${endDate}`
      );
      if (collisions.length === 0) {
        await persistApproval(id, []);
      } else {
        setResolution({
          requestId: id,
          employeeName: `${req.lastName} ${req.firstName}`.trim(),
          collisions,
        });
      }
    } finally {
      setActionSaving(false);
    }
  }

  async function handleReject(id: string) {
    setActionSaving(true);
    try {
      await api.patch(`/vacation/${id}`, { status: "rejected", rejectionReason });
      setRequests((prev) =>
        prev.map((r) => {
          if (r.id !== id) return r;
          if (r.pendingEdit) {
            // Rejecting an edit — just clear pendingEdit, keep approved status
            return { ...r, pendingEdit: null };
          }
          return { ...r, status: "rejected" as const, rejectionReason };
        })
      );
      setRejectingId(null);
      setRejectionReason("");
      refreshVacationBadge();
    } finally {
      setActionSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setActionSaving(true);
    try {
      await api.delete(`/vacation/${id}`);
      setRequests((prev) => prev.filter((r) => r.id !== id));
      refreshVacationBadge();
    } finally {
      setActionSaving(false);
    }
  }

  function openEdit(req: VacationRequest) {
    setEditingId(req.id);
    setEditStart(req.startDate);
    setEditEnd(req.endDate);
    setEditReason(req.reason);
  }

  async function handleSubmitEdit(id: string) {
    if (!editStart || !editEnd) return;
    setEditSaving(true);
    try {
      await api.patch(`/vacation/${id}`, { startDate: editStart, endDate: editEnd, reason: editReason });
      setRequests((prev) =>
        prev.map((r) => {
          if (r.id !== id) return r;
          if (r.status === "pending") {
            return { ...r, startDate: editStart, endDate: editEnd, reason: editReason };
          } else {
            return { ...r, pendingEdit: { startDate: editStart, endDate: editEnd, reason: editReason } };
          }
        })
      );
      setEditingId(null);
      refreshVacationBadge();
    } catch (e) {
      const collisions = extractCollisions(e);
      if (collisions) setInfoCollisions(collisions);
      // Other errors silently fail — user can retry
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <div>
      <h1 className={styles.title}>Dovolená</h1>

      {/* New request form */}
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Nová žádost o dovolenou</h2>

        {!employeeId && !loading ? (
          <p className={styles.noEmployee}>
            Váš účet není spojen se záznamem zaměstnance. Požádejte správce o propojení.
          </p>
        ) : (
          <>
            <div className={styles.formRow}>
              <div className={styles.formField}>
                <label className={styles.label}>Od</label>
                <input
                  type="date"
                  className={styles.input}
                  value={startDate}
                  onChange={(e) => { setStartDate(e.target.value); setFormSuccess(false); }}
                />
              </div>
              <div className={styles.formField}>
                <label className={styles.label}>Do</label>
                <input
                  type="date"
                  className={styles.input}
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(e) => { setEndDate(e.target.value); setFormSuccess(false); }}
                />
              </div>
              <div className={styles.formField}>
                <label className={styles.label}>Poznámka (volitelná)</label>
                <input
                  type="text"
                  className={`${styles.input} ${styles.reasonInput}`}
                  placeholder="Důvod, poznámka…"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
              <Button
                variant="primary"
                onClick={handleSubmit}
                disabled={submitting || !startDate || !endDate}
              >
                {submitting ? "Odesílám…" : "Odeslat žádost"}
              </Button>
            </div>
            {formError && <p className={styles.error}>{formError}</p>}
            {formSuccess && (
              <p className={styles.error} style={{ color: "#15803d" }}>
                Žádost byla odeslána.
              </p>
            )}
          </>
        )}
      </div>

      {/* My requests */}
      <div className={styles.tableWrapper}>
        <div className={styles.sectionTitle}>Moje žádosti</div>
        {loading ? (
          <div className={styles.empty}>Načítám…</div>
        ) : myRequests.length === 0 ? (
          <div className={styles.empty}>Žádné žádosti.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Od</th>
                <th>Do</th>
                <th>Poznámka</th>
                <th>Stav</th>
                <th>Akce</th>
              </tr>
            </thead>
            <tbody>
              {myRequests.map((req) => (
                <>
                  <tr key={req.id} className={req.status === "approved" && !req.pendingEdit ? styles.rowDone : ""}>
                    <td>{formatDateCZ(req.startDate)}</td>
                    <td>{formatDateCZ(req.endDate)}</td>
                    <td>{req.reason || "—"}</td>
                    <td>
                      <StatusBadge status={req.status} />
                      {req.pendingEdit && (
                        <span className={styles.badgePendingEdit}>Čeká na schválení úpravy</span>
                      )}
                      {req.status === "rejected" && req.rejectionReason && (
                        <div className={styles.rejectionNote}>{req.rejectionReason}</div>
                      )}
                    </td>
                    <td>
                      {!req.pendingEdit && req.status !== "rejected" && (
                        <div className={styles.actions}>
                          <button
                            className={styles.editBtn}
                            onClick={() => openEdit(req)}
                            disabled={actionSaving || editingId === req.id}
                          >
                            Upravit
                          </button>
                          <button
                            className={styles.deleteBtn}
                            onClick={() => handleDelete(req.id)}
                            disabled={actionSaving}
                          >
                            Zrušit
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {editingId === req.id && (
                    <tr key={`edit-${req.id}`} className={styles.editRow}>
                      <td colSpan={5}>
                        <div className={styles.editRowInner}>
                          {req.status === "approved" && (
                            <span className={styles.editNote}>Změna bude odeslána ke schválení</span>
                          )}
                          <input
                            type="date"
                            className={styles.rejectInput}
                            value={editStart}
                            onChange={(e) => setEditStart(e.target.value)}
                          />
                          <span className={styles.editSep}>–</span>
                          <input
                            type="date"
                            className={styles.rejectInput}
                            value={editEnd}
                            min={editStart || undefined}
                            onChange={(e) => setEditEnd(e.target.value)}
                          />
                          <input
                            type="text"
                            className={`${styles.rejectInput} ${styles.editReasonInput}`}
                            placeholder="Poznámka…"
                            value={editReason}
                            onChange={(e) => setEditReason(e.target.value)}
                          />
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => handleSubmitEdit(req.id)}
                            disabled={editSaving || !editStart || !editEnd}
                          >
                            {editSaving ? "Ukládám…" : "Uložit"}
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setEditingId(null)}
                          >
                            Zrušit
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Approved upcoming vacations — employees & managers */}
      {!canApprove && (
        <div className={styles.tableWrapper}>
          <div className={styles.sectionTitle}>Schválené dovolené (všichni zaměstnanci)</div>
          {approvedUpcoming === null ? (
            <div className={styles.empty}>Načítám…</div>
          ) : approvedUpcoming.length === 0 ? (
            <div className={styles.empty}>Žádné schválené dovolené.</div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Zaměstnanec</th>
                  <th>Od</th>
                  <th>Do</th>
                </tr>
              </thead>
              <tbody>
                {approvedUpcoming.map((v, i) => (
                  <tr key={`${v.employeeId}-${v.startDate}-${i}`}>
                    <td>{v.lastName} {v.firstName}</td>
                    <td>{formatDateCZ(v.startDate)}</td>
                    <td>{formatDateCZ(v.endDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Collision modals */}
      {infoCollisions && (
        <VacationCollisionInfoModal
          collisions={infoCollisions}
          onClose={() => setInfoCollisions(null)}
        />
      )}
      {resolution && (
        <VacationCollisionResolutionModal
          employeeName={resolution.employeeName}
          collisions={resolution.collisions}
          onCancel={() => setResolution(null)}
          onSubmit={async (excludeDates) => {
            await persistApproval(resolution.requestId, excludeDates);
            setResolution(null);
          }}
        />
      )}

      {/* All requests — admin/director only */}
      {canApprove && (
        <div className={styles.tableWrapper}>
          <div className={styles.sectionTitle}>Všechny žádosti</div>
          {loading ? (
            <div className={styles.empty}>Načítám…</div>
          ) : allRequests.length === 0 ? (
            <div className={styles.empty}>Žádné žádosti.</div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Zaměstnanec</th>
                  <th>Žádáno</th>
                  <th>Od</th>
                  <th>Do</th>
                  <th>Poznámka</th>
                  <th>Stav</th>
                  <th>Akce</th>
                </tr>
              </thead>
              <tbody>
                {allRequests.map((req) => (
                  <>
                    <tr
                      key={req.id}
                      className={req.status === "approved" && !req.pendingEdit ? styles.rowDone : ""}
                    >
                      <td>
                        {req.lastName} {req.firstName}
                      </td>
                      <td>{formatDatetimeCZ(req.requestedAt)}</td>
                      <td>{formatDateCZ(req.startDate)}</td>
                      <td>{formatDateCZ(req.endDate)}</td>
                      <td>{req.reason || "—"}</td>
                      <td>
                        <StatusBadge status={req.status} />
                        {req.pendingEdit && (
                          <span className={styles.badgeEdited}>Upraveno</span>
                        )}
                        {req.status === "rejected" && req.rejectionReason && (
                          <div className={styles.rejectionNote}>{req.rejectionReason}</div>
                        )}
                      </td>
                      <td>
                        {req.status === "pending" && !req.pendingEdit && (
                          <div className={styles.actions}>
                            <button
                              className={styles.approveBtn}
                              onClick={() => handleApprove(req.id)}
                              disabled={actionSaving}
                            >
                              Schválit
                            </button>
                            <button
                              className={styles.rejectBtn}
                              onClick={() => {
                                setRejectingId(req.id);
                                setRejectionReason("");
                              }}
                              disabled={actionSaving}
                            >
                              Zamítnout
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                    {req.pendingEdit && (
                      <tr key={`pendingedit-${req.id}`} className={styles.pendingEditRow}>
                        <td colSpan={7}>
                          <span className={styles.pendingEditLabel}>Navrhovaná změna:</span>
                          <span className={styles.pendingEditDates}>
                            {formatDateCZ(req.pendingEdit.startDate)}
                            {" – "}
                            {formatDateCZ(req.pendingEdit.endDate)}
                            {req.pendingEdit.reason && <> &middot; {req.pendingEdit.reason}</>}
                          </span>
                          <button
                            className={styles.approveBtn}
                            onClick={() => handleApprove(req.id)}
                            disabled={actionSaving}
                          >
                            Schválit úpravu
                          </button>
                          <button
                            className={styles.rejectBtn}
                            style={{ marginLeft: "0.5rem" }}
                            onClick={() => handleReject(req.id)}
                            disabled={actionSaving}
                          >
                            Zamítnout úpravu
                          </button>
                        </td>
                      </tr>
                    )}
                    {rejectingId === req.id && (
                      <tr key={`reject-${req.id}`} className={styles.rejectRow}>
                        <td colSpan={7}>
                          <input
                            className={styles.rejectInput}
                            placeholder="Důvod zamítnutí (volitelné)…"
                            value={rejectionReason}
                            onChange={(e) => setRejectionReason(e.target.value)}
                          />
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => handleReject(req.id)}
                            disabled={actionSaving}
                          >
                            Potvrdit zamítnutí
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setRejectingId(null)}
                          >
                            Zrušit
                          </Button>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
