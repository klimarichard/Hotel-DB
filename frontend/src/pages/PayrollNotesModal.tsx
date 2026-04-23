import { useState } from "react";
import { api } from "@/lib/api";
import { formatDatetimeCZ } from "@/lib/dateFormat";
import Button from "@/components/Button";
import ConfirmModal from "@/components/ConfirmModal";
import styles from "./PayrollNotesModal.module.css";
import type { PayrollNote } from "./PayrollPage";

interface Props {
  periodId: string;
  employeeId: string;
  employeeLabel: string;
  notes: PayrollNote[];
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}

export default function PayrollNotesModal({
  periodId,
  employeeId,
  employeeLabel,
  notes,
  canEdit,
  onClose,
  onChanged,
}: Props) {
  const [newText, setNewText] = useState("");
  const [newCarry, setNewCarry] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editCarry, setEditCarry] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PayrollNote | null>(null);

  async function addNote() {
    if (!newText.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/payroll/periods/${periodId}/entries/${employeeId}/notes`, {
        text: newText.trim(),
        carryForward: newCarry,
      });
      setNewText("");
      setNewCarry(false);
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
    setEditCarry(n.carryForward);
  }

  async function saveEdit(noteId: string) {
    if (!editText.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(
        `/payroll/periods/${periodId}/entries/${employeeId}/notes/${noteId}`,
        { text: editText.trim(), carryForward: editCarry }
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

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.title}>Poznámky — {employeeLabel}</span>
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
                        <label className={styles.checkRow}>
                          <input
                            type="checkbox"
                            checked={editCarry}
                            onChange={(e) => setEditCarry(e.target.checked)}
                          />
                          Zobrazit i v budoucích výplatách
                        </label>
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
                        <p className={styles.noteText}>{n.text}</p>
                        <div className={styles.noteMeta}>
                          — {n.createdByName || "?"}, {metaDate}
                          {editedDate && <> · upraveno {editedDate}{n.editedByName ? ` (${n.editedByName})` : ""}</>}
                        </div>
                        <div className={styles.noteFooter}>
                          <span className={styles.carryLabel}>
                            <input type="checkbox" checked={n.carryForward} readOnly disabled />
                            {n.carryForward ? "V budoucích výplatách" : "Pouze toto období"}
                          </span>
                          {canEdit && (
                            <span className={styles.noteActions}>
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
                placeholder="Nová poznámka…"
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
              />
              <label className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={newCarry}
                  onChange={(e) => setNewCarry(e.target.checked)}
                />
                Zobrazit i v budoucích výplatách
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
    </div>
  );
}
