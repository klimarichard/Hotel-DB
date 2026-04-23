import styles from "./ConfirmModal.module.css";

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  showCancel?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  title,
  message,
  confirmLabel = "Potvrdit",
  cancelLabel = "Zrušit",
  showCancel = true,
  danger = false,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
        </div>
        <div className={styles.body}>{message}</div>
        <div className={styles.footer}>
          {showCancel && (
            <button className={styles.cancelBtn} onClick={onCancel}>
              {cancelLabel}
            </button>
          )}
          <button
            className={`${styles.confirmBtn} ${danger ? styles.danger : ""}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
