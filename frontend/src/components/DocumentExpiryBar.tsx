import { formatDateCZ } from "@/lib/dateFormat";
import styles from "./DocumentExpiryBar.module.css";

export interface DocumentExpiryAlert {
  id: string;
  fieldLabel: string;
  expiryDate: string;
  daysUntilExpiry: number;
  status: "expiring" | "expired";
}

/**
 * Banner listing one employee's expired / soon-to-expire documents. Pure
 * display: it renders whatever alerts it is given – the classification
 * (30-day window, status "expired" once past) is computed server-side in the
 * shared `alerts` collection. Shown on the employee detail page, the self
 * profile page and the dashboard, all from that same data.
 */
export default function DocumentExpiryBar({
  alerts,
}: {
  alerts: DocumentExpiryAlert[];
}) {
  if (alerts.length === 0) return null;
  return (
    <div className={styles.alertBanner}>
      {alerts.map((a) => (
        <div
          key={a.id}
          className={
            a.status === "expired" ? styles.alertItemExpired : styles.alertItemExpiring
          }
        >
          <strong>{a.fieldLabel}</strong>
          {" – "}
          {a.daysUntilExpiry < 0
            ? `Prošlé o ${Math.abs(a.daysUntilExpiry)} dní (${formatDateCZ(a.expiryDate)})`
            : a.daysUntilExpiry === 0
            ? `Vyprší dnes (${formatDateCZ(a.expiryDate)})`
            : `Vyprší za ${a.daysUntilExpiry} dní (${formatDateCZ(a.expiryDate)})`}
        </div>
      ))}
    </div>
  );
}
