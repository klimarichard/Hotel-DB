import Button from "./Button";
import styles from "./ConfirmModal.module.css";

interface TertiaryAction {
  label: string;
  onClick: () => void;
  variant?: "primary" | "secondary" | "danger";
}

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  showCancel?: boolean;
  danger?: boolean;
  // Optional middle button — used for three-way dialogs like
  // "Save and continue / Discard / Cancel".
  tertiary?: TertiaryAction;
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
  tertiary,
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
            <Button variant="secondary" onClick={onCancel}>
              {cancelLabel}
            </Button>
          )}
          {tertiary && (
            <Button variant={tertiary.variant ?? "danger"} onClick={tertiary.onClick}>
              {tertiary.label}
            </Button>
          )}
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
