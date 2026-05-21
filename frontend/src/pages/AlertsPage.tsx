import { useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useAlertsContext } from "@/context/AlertsContext";
import { useVacationContext } from "@/context/VacationContext";
import { useShiftOverridesContext } from "@/context/ShiftOverridesContext";
import { useShiftChangeRequestsContext } from "@/context/ShiftChangeRequestsContext";
import IconButton from "@/components/IconButton";
import ConfirmModal from "@/components/ConfirmModal";
import DocumentExpiryTab from "./upozorneni/DocumentExpiryTab";
import ProbationTab from "./upozorneni/ProbationTab";
import PendingVacationTab from "./upozorneni/PendingVacationTab";
import PendingShiftOverridesTab from "./upozorneni/PendingShiftOverridesTab";
import PendingShiftChangeRequestsTab from "./upozorneni/PendingShiftChangeRequestsTab";
import styles from "./AlertsPage.module.css";

type Tab = "doklady" | "zkusebni" | "dovolena" | "vyjimky" | "zmeny";

export default function AlertsPage() {
  const [tab, setTab] = useState<Tab>("doklady");
  const { role } = useAuth();
  const { unreadCount, unreadProbationCount, refresh } = useAlertsContext();
  const { pendingCount: vacationCount } = useVacationContext();
  const { pendingCount: overridesCount } = useShiftOverridesContext();
  const { pendingCount: changesCount } = useShiftChangeRequestsContext();

  // Manual re-trigger of the document + probation alert refreshers. Admin-only
  // (the trigger endpoints require the admin role and write a manual-trigger
  // audit entry). Bumping refreshKey remounts the active tab so it re-fetches
  // the regenerated alerts; refresh() updates the badge counts.
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([
        api.post("/employees/trigger-alert-refresh", {}),
        api.post("/employees/trigger-probation-refresh", {}),
      ]);
      refresh();
      setRefreshKey((k) => k + 1);
    } catch {
      setError("Obnovení upozornění se nezdařilo. Zkuste to prosím znovu.");
    } finally {
      setRefreshing(false);
    }
  }

  function tabLabel(label: string, count: number) {
    if (count <= 0) return label;
    return (
      <span className={styles.tabInner}>
        {label}
        <span className={styles.tabCount}>{count}</span>
      </span>
    );
  }

  return (
    <div>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>Upozornění</h1>
          {role === "admin" && (
            <IconButton
              variant="refresh"
              aria-label="Obnovit upozornění"
              title="Obnovit upozornění"
              onClick={handleRefresh}
              disabled={refreshing}
              className={refreshing ? styles.spinning : undefined}
            >
              ↻
            </IconButton>
          )}
        </div>
      </div>

      <div className={styles.tabs}>
        <button
          className={tab === "doklady" ? styles.tabActive : styles.tabBtn}
          onClick={() => setTab("doklady")}
        >
          {tabLabel("Doklady", unreadCount)}
        </button>
        <button
          className={tab === "zkusebni" ? styles.tabActive : styles.tabBtn}
          onClick={() => setTab("zkusebni")}
        >
          {tabLabel("Zkušební doba", unreadProbationCount)}
        </button>
        <button
          className={tab === "dovolena" ? styles.tabActive : styles.tabBtn}
          onClick={() => setTab("dovolena")}
        >
          {tabLabel("Dovolená", vacationCount)}
        </button>
        <button
          className={tab === "vyjimky" ? styles.tabActive : styles.tabBtn}
          onClick={() => setTab("vyjimky")}
        >
          {tabLabel("Výjimky", overridesCount)}
        </button>
        <button
          className={tab === "zmeny" ? styles.tabActive : styles.tabBtn}
          onClick={() => setTab("zmeny")}
        >
          {tabLabel("Žádosti o změny", changesCount)}
        </button>
      </div>

      {tab === "doklady" && <DocumentExpiryTab key={refreshKey} />}
      {tab === "zkusebni" && <ProbationTab key={refreshKey} />}
      {tab === "dovolena" && <PendingVacationTab />}
      {tab === "vyjimky" && <PendingShiftOverridesTab />}
      {tab === "zmeny" && <PendingShiftChangeRequestsTab />}

      {error && (
        <ConfirmModal
          title="Chyba"
          message={error}
          confirmLabel="OK"
          showCancel={false}
          onConfirm={() => setError(null)}
          onCancel={() => setError(null)}
        />
      )}
    </div>
  );
}
