import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../hooks/useAuth";
import { formatDateCZ } from "../lib/dateFormat";
import styles from "./VacationPage.module.css";

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
  const canApprove = role === "admin" || role === "director";

  const [requests, setRequests] = useState<VacationRequest[]>([]);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    api
      .get<VacationRequest[]>("/vacation")
      .then((data) => setRequests(data))
      .catch(() => setRequests([]))
      .finally(() => setLoading(false));
  }, []);

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
      const result = await api.post<{ id: string }>("/vacation", { startDate, endDate, reason });
      const newRequest: VacationRequest = {
        id: result.id,
        employeeId: employeeId,
        firstName: "",
        lastName: "",
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
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Chyba při odesílání");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleApprove(id: string) {
    setActionSaving(true);
    try {
      await api.patch(`/vacation/${id}`, { status: "approved" });
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
    } finally {
      setActionSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setActionSaving(true);
    try {
      await api.delete(`/vacation/${id}`);
      setRequests((prev) => prev.filter((r) => r.id !== id));
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
    } catch (e) {
      // Silently fail — user can retry
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
              <button
                className={styles.submitBtn}
                onClick={handleSubmit}
                disabled={submitting || !startDate || !endDate}
              >
                {submitting ? "Odesílám…" : "Odeslat žádost"}
              </button>
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
                          <button
                            className={styles.confirmRejectBtn}
                            onClick={() => handleSubmitEdit(req.id)}
                            disabled={editSaving || !editStart || !editEnd}
                          >
                            {editSaving ? "Ukládám…" : "Uložit"}
                          </button>
                          <button
                            className={styles.cancelBtn}
                            onClick={() => setEditingId(null)}
                          >
                            Zrušit
                          </button>
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
                        <td colSpan={6}>
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
                        <td colSpan={6}>
                          <input
                            className={styles.rejectInput}
                            placeholder="Důvod zamítnutí (volitelné)…"
                            value={rejectionReason}
                            onChange={(e) => setRejectionReason(e.target.value)}
                          />
                          <button
                            className={styles.confirmRejectBtn}
                            onClick={() => handleReject(req.id)}
                            disabled={actionSaving}
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
      )}
    </div>
  );
}
