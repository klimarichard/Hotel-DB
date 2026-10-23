import { Fragment, useState } from "react";
import { api } from "../lib/api";
import type { PlanEmployee, ShiftRequest } from "../pages/ShiftPlannerPage";
import { formatDateCZ, formatDatetimeCZ } from "../lib/dateFormat";
import { employeeDisplayName } from "../lib/employeeName";
import Button from "./Button";
import styles from "./ShiftOverridePanel.module.css";

interface Props {
  /** Pending + decided requests of the plan (and of December's linked 1 Jan). */
  requests: ShiftRequest[];
  employees: PlanEmployee[];
  /** Called after a decision so the page reloads the plan + badge counts. */
  onResolved: () => void;
  /** Czech error message → the page's ConfirmModal. */
  onError: (message: string) => void;
}

/**
 * Review panel for "žádosti o konkrétní směnu" (shift requests filed inside a
 * request window). Modelled on ShiftChangeRequestPanel. Approve writes the
 * requested shift into the employee's cell (server-side); reject frees the slot.
 * Each request is addressed to its OWNING plan (`planId` from the GET), which
 * for December's linked 1 January is the January plan.
 */
export default function ShiftRequestPanel({ requests, employees, onResolved, onError }: Props) {
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [saving, setSaving] = useState(false);

  const visible = [...requests]
    .filter((r) => r.status !== "withdrawn")
    .sort((a, b) => {
      // Pending first, then by date.
      if ((a.status === "pending") !== (b.status === "pending")) return a.status === "pending" ? -1 : 1;
      return a.date.localeCompare(b.date);
    });

  function nameOf(employeeId: string): string {
    const emp = employees.find((e) => e.employeeId === employeeId);
    return emp ? employeeDisplayName(emp) : employeeId;
  }

  async function decide(r: ShiftRequest, status: "approved" | "rejected") {
    setSaving(true);
    try {
      await api.patch(`/shifts/plans/${r.planId}/shiftRequests/${r.id}`, {
        status,
        ...(status === "rejected" && reviewNote.trim() ? { reviewNote: reviewNote.trim() } : {}),
      });
      setRejectingId(null);
      setReviewNote("");
      onResolved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Žádost se nepodařilo vyřídit.");
      // A 409 (slot taken meanwhile / already decided) – show the fresh state.
      onResolved();
    } finally {
      setSaving(false);
    }
  }

  const labels: Record<string, string> = { pending: "Čeká", approved: "Schváleno", rejected: "Zamítnuto" };

  return (
    <div className={styles.panel} data-tour="shift-requests-panel">
      <h3 className={styles.panelTitle}>Žádosti o konkrétní směnu</h3>
      {visible.length === 0 && <div className={styles.empty}>Žádné žádosti o konkrétní směnu.</div>}
      {visible.length > 0 && (
        <table className={`${styles.table} ${styles.cardsOnMobile}`}>
          <thead>
            <tr>
              <th>Zaměstnanec</th>
              <th>Datum</th>
              <th>Směna</th>
              <th>Odesláno</th>
              <th>Stav</th>
              <th>Akce</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <Fragment key={r.id}>
                <tr className={r.status !== "pending" ? styles.rowDone : ""}>
                  <td data-label="Zaměstnanec">{nameOf(r.employeeId)}</td>
                  <td data-label="Datum">{formatDateCZ(r.date)}</td>
                  <td data-label="Směna"><code>{r.code}</code></td>
                  <td data-label="Odesláno">{formatDatetimeCZ(r.requestedAt ?? null)}</td>
                  <td data-label="Stav">
                    <span className={`${styles.badge} ${styles[`badge_${r.status}`] ?? ""}`}>
                      {labels[r.status] ?? r.status}
                    </span>
                    {r.status === "rejected" && r.reviewNote && (
                      <div className={styles.rejectionNote}>{r.reviewNote}</div>
                    )}
                  </td>
                  <td className={styles.actionCell}>
                    {r.status === "pending" && (
                      <div className={styles.actions}>
                        <button className={styles.approveBtn} onClick={() => decide(r, "approved")} disabled={saving}>
                          Schválit
                        </button>
                        <button
                          className={styles.rejectBtn}
                          onClick={() => {
                            setRejectingId(r.id);
                            setReviewNote("");
                          }}
                          disabled={saving}
                        >
                          Zamítnout
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
                {rejectingId === r.id && (
                  <tr>
                    <td colSpan={6} className={styles.rejectRow}>
                      <input
                        className={styles.rejectInput}
                        placeholder="Důvod zamítnutí (volitelné)…"
                        value={reviewNote}
                        onChange={(e) => setReviewNote(e.target.value)}
                      />
                      <Button variant="danger" size="sm" onClick={() => decide(r, "rejected")} disabled={saving}>
                        Potvrdit zamítnutí
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => setRejectingId(null)}>
                        Zrušit
                      </Button>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
