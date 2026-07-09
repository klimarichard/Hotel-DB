import { useState } from "react";
import { api } from "@/lib/api";
import { formatDatetimeCZ } from "@/lib/dateFormat";
import Button from "@/components/Button";
import ConfirmModal from "@/components/ConfirmModal";
import styles from "./PayrollNotesModal.module.css";
import type { PayrollNote } from "./PayrollPage";

interface Props {
  periodId: string;
  periodYear: number;
  periodMonth: number;
  employeeId: string;
  employeeLabel: string;
  notes: PayrollNote[];
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}

export default function PayrollNotesModal({
  periodId,
  periodYear,
  periodMonth,
  employeeId,
  employeeLabel,
  notes,
  canEdit,
  onClose,
  onChanged,
}: Props) {
  const [newText, setNewText] = useState("");
  const [oneMonthOnly, setOneMonthOnly] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editOneMonth, setEditOneMonth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PayrollNote | null>(null);
  const [readTarget, setReadTarget] = useState<PayrollNote | null>(null);

  // A note can be marked read only in months strictly after its origin month.
  function afterOrigin(n: PayrollNote): boolean {
    if (n.sourceYear == null || n.sourceMonth == null) return false;
    return periodYear > n.sourceYear || (periodYear === n.sourceYear && periodMonth > n.sourceMonth);
  }

  // The carry-forward / one-month toggle is offered only in the note's origin
  // month (where flipping it cleanly adds/removes its copies across months).
  function isOrigin(n: PayrollNote): boolean {
    return n.sourceYear === periodYear && n.sourceMonth === periodMonth;
  }

  async function addNote() {
    if (!newText.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/payroll/periods/${periodId}/entries/${employeeId}/notes`, {
        text: newText.trim(),
        carryForward: !oneMonthOnly,
      });
      setNewText("");
      setOneMonthOnly(false);
      onChanged();
    } catch (e) {
      setError((e as Error).message ?? "Chyba při ukládání.");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(n: PayrollNote) {
    setEditingId(n.id);
    setEditText(n.text);
    setEditOneMonth(n.carryForward === false);
  }

  async function saveEdit(noteId: string) {
    if (!editText.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const n = notes.find((x) => x.id === noteId);
      const payload: { text: string; carryForward?: boolean } = { text: editText.trim() };
      // The toggle is meaningful only in the origin month; elsewhere edit text only.
      if (n && isOrigin(n)) payload.carryForward = !editOneMonth;
      await api.patch(
        `/payroll/periods/${periodId}/entries/${employeeId}/notes/${noteId}`,
        payload
      );
      setEditingId(null);
      onChanged();
    } catch (e) {
      setError((e as Error).message ?? "Chyba při ukládání.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(
        `/payroll/periods/${periodId}/entries/${employeeId}/notes/${deleteTarget.id}`
      );
      setDeleteTarget(null);
      onChanged();
    } catch (e) {
      setError((e as Error).message ?? "Chyba při mazání.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmRead() {
    if (!readTarget) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(
        `/payroll/periods/${periodId}/entries/${employeeId}/notes/${readTarget.id}/read`,
        {}
      );
      setReadTarget(null);
      onChanged();
    } catch (e) {
      setError((e as Error).message ?? "Chyba při označování.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.title}>Poznámky – {employeeLabel}</span>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>

        <div className={styles.body}>
          {notes.length === 0 && <div className={styles.empty}>Žádné poznámky.</div>}
          {notes.length > 0 && (
            <div className={styles.noteList}>
              {notes.map((n) => {
                const isEditing = editingId === n.id;
                const metaDate = formatDatetimeCZ(n.createdAt);
                const editedDate = n.editedAt ? formatDatetimeCZ(n.editedAt) : null;
                const readDate = n.read && n.readAt ? formatDatetimeCZ(n.readAt) : null;
                return (
                  <div key={n.id} className={styles.noteItem}>
                    {isEditing ? (
                      <div className={styles.editArea}>
                        <textarea
                          className={styles.textarea}
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          autoFocus
                        />
                        {isOrigin(n) && (
                          <label className={styles.checkRow}>
                            <input
                              type="checkbox"
                              checked={editOneMonth}
                              onChange={(e) => setEditOneMonth(e.target.checked)}
                            />
                            Poznámka pouze pro tento měsíc (nepřenášet dál)
                          </label>
                        )}
                        <div className={styles.noteActions}>
                          <button
                            className={styles.iconBtn}
                            onClick={() => setEditingId(null)}
                            disabled={busy}
                          >
                            Zrušit
                          </button>
                          <button
                            className={styles.iconBtn}
                            onClick={() => saveEdit(n.id)}
                            disabled={busy || !editText.trim()}
                          >
                            Uložit
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className={`${styles.noteText} ${n.read ? styles.noteRead : ""}`}>{n.text}</p>
                        <div className={styles.noteMeta}>
                          – {n.createdByName || "?"}, {metaDate}
                          {editedDate && <> · upraveno {editedDate}{n.editedByName ? ` (${n.editedByName})` : ""}</>}
                          {readDate && <> · přečteno {readDate}{n.readByName ? ` (${n.readByName})` : ""}</>}
                        </div>
                        <div className={styles.noteFooter}>
                          {n.auto ? (
                            <span className={styles.carryLabel}>Automatická poznámka (jen toto období)</span>
                          ) : n.read ? (
                            <span className={styles.carryLabel}>Přečteno – skryto v dalších měsících</span>
                          ) : n.carryForward === false ? (
                            <span className={styles.carryLabel}>Jen pro tento měsíc</span>
                          ) : (
                            <span className={styles.carryLabel}>Zobrazuje se i v budoucích výplatách</span>
                          )}
                          {canEdit && !n.auto && (
                            <span className={styles.noteActions}>
                              {!n.read && afterOrigin(n) && (
                                <button
                                  className={styles.iconBtn}
                                  onClick={() => setReadTarget(n)}
                                  disabled={busy}
                                  title="Označit jako přečteno – zmizí z dalších měsíců"
                                >
                                  Označit přečteno
                                </button>
                              )}
                              {/* System-generated notes (e.g. pre-contract worked
                                  hours) are read-only – only "mark read" applies. */}
                              {n.createdBy !== "system" && (
                                <>
                                  <button
                                    className={styles.iconBtn}
                                    onClick={() => startEdit(n)}
                                    disabled={busy}
                                  >
                                    Upravit
                                  </button>
                                  <button
                                    className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                                    onClick={() => setDeleteTarget(n)}
                                    disabled={busy}
                                  >
                                    Smazat
                                  </button>
                                </>
                              )}
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {canEdit && (
            <div className={styles.addSection}>
              <textarea
                className={styles.textarea}
                placeholder={oneMonthOnly
                  ? "Nová poznámka… (jen pro tento měsíc)"
                  : "Nová poznámka… (zobrazí se i v dalších měsících)"}
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
              />
              <label className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={oneMonthOnly}
                  onChange={(e) => setOneMonthOnly(e.target.checked)}
                />
                Poznámka pouze pro tento měsíc (nepřenášet dál)
              </label>
              {error && <div className={styles.error}>{error}</div>}
            </div>
          )}
        </div>

        <div className={styles.actions}>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Zavřít
          </Button>
          {canEdit && (
            <Button
              variant="primary"
              onClick={addNote}
              disabled={busy || !newText.trim()}
            >
              {busy ? "Ukládám…" : "Přidat poznámku"}
            </Button>
          )}
        </div>
      </div>

      {deleteTarget && (
        <ConfirmModal
          title="Smazat poznámku?"
          message="Poznámka bude odstraněna pouze v tomto mzdovém období."
          confirmLabel="Smazat"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {readTarget && (
        <ConfirmModal
          title="Označit jako přečteno?"
          message="Poznámka bude v tomto měsíci přeškrtnutá a zmizí ze všech následujících měsíců. V dřívějších měsících zůstane beze změny."
          confirmLabel="Označit přečteno"
          onConfirm={confirmRead}
          onCancel={() => setReadTarget(null)}
        />
      )}
    </div>
  );
}
