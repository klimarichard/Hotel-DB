import { useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useAlertsContext } from "@/context/AlertsContext";
import { useVacationContext } from "@/context/VacationContext";
import { useShiftOverridesContext } from "@/context/ShiftOverridesContext";
import { useShiftChangeRequestsContext } from "@/context/ShiftChangeRequestsContext";
import { useEmployeeChangeRequestsContext } from "@/context/EmployeeChangeRequestsContext";
import IconButton from "@/components/IconButton";
import ConfirmModal from "@/components/ConfirmModal";
import DocumentExpiryTab from "./upozorneni/DocumentExpiryTab";
import ProbationTab from "./upozorneni/ProbationTab";
import PendingVacationTab from "./upozorneni/PendingVacationTab";
import PendingShiftOverridesTab from "./upozorneni/PendingShiftOverridesTab";
import PendingShiftChangeRequestsTab from "./upozorneni/PendingShiftChangeRequestsTab";
import EmployeeDataChangeRequestsTab from "./upozorneni/EmployeeDataChangeRequestsTab";
import HandoverWarningsTab from "./upozorneni/HandoverWarningsTab";
import styles from "./AlertsPage.module.css";

type Tab = "doklady" | "zkusebni" | "dovolena" | "vyjimky" | "zmeny" | "uprava" | "predani";

export default function AlertsPage() {
  const { can } = useAuth();
  const { unreadCount, unreadProbationCount, refresh } = useAlertsContext();
  const { pendingCount: vacationCount } = useVacationContext();
  const { pendingCount: overridesCount } = useShiftOverridesContext();
  const { pendingCount: changesCount } = useShiftChangeRequestsContext();
  const { pendingCount: dataChangesCount } = useEmployeeChangeRequestsContext();

  // Per-tab visibility. "Doklady"/"Zkušební doba" ride on the route's alerts.view
  // gate; the review-queue tabs each require their own review permission.
  const canVacation = can("vacation.review");
  const canOverrides = can("shifts.override.review");
  const canChanges = can("shifts.changeRequest.review");
  const canDataChanges = can("changeRequests.review");

  // Default to the first tab the user can actually see (Doklady/Zkušební are
  // always visible here, so this is effectively always "doklady", but it keeps
  // the selection valid if those ever become gated too).
  const visibleTabs: Tab[] = [
    "doklady",
    "zkusebni",
    ...(canVacation ? (["dovolena"] as Tab[]) : []),
    ...(canOverrides ? (["vyjimky"] as Tab[]) : []),
    ...(canChanges ? (["zmeny"] as Tab[]) : []),
    ...(canDataChanges ? (["uprava"] as Tab[]) : []),
    ...(canDataChanges ? (["predani"] as Tab[]) : []),
  ];
  const [tab, setTab] = useState<Tab>(visibleTabs[0] ?? "doklady");

  // If the active tab becomes unavailable (e.g. permission set changes), fall
  // back to the first visible tab.
  if (!visibleTabs.includes(tab) && visibleTabs.length > 0 && tab !== visibleTabs[0]) {
    setTab(visibleTabs[0]);
  }

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
          {can("system.triggers") && (
            <IconButton
              data-tour="alerts-refresh"
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

      <div data-tour="alerts-tabs" className={styles.tabs}>
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
        {canVacation && (
          <button
            className={tab === "dovolena" ? styles.tabActive : styles.tabBtn}
            onClick={() => setTab("dovolena")}
          >
            {tabLabel("Dovolená", vacationCount)}
          </button>
        )}
        {canOverrides && (
          <button
            className={tab === "vyjimky" ? styles.tabActive : styles.tabBtn}
            onClick={() => setTab("vyjimky")}
          >
            {tabLabel("Výjimky", overridesCount)}
          </button>
        )}
        {canChanges && (
          <button
            className={tab === "zmeny" ? styles.tabActive : styles.tabBtn}
            onClick={() => setTab("zmeny")}
          >
            {tabLabel("Žádosti o změny", changesCount)}
          </button>
        )}
        {canDataChanges && (
          <button
            data-tour="alerts-tab-uprava"
            className={tab === "uprava" ? styles.tabActive : styles.tabBtn}
            onClick={() => setTab("uprava")}
          >
            {tabLabel("Žádosti o úpravu údajů", dataChangesCount)}
          </button>
        )}
        {canDataChanges && (
          <button
            className={tab === "predani" ? styles.tabActive : styles.tabBtn}
            onClick={() => setTab("predani")}
          >
            Předávací protokol
          </button>
        )}
      </div>

      {tab === "doklady" && <DocumentExpiryTab key={refreshKey} />}
      {tab === "zkusebni" && <ProbationTab key={refreshKey} />}
      {tab === "dovolena" && canVacation && <PendingVacationTab />}
      {tab === "vyjimky" && canOverrides && <PendingShiftOverridesTab />}
      {tab === "zmeny" && canChanges && <PendingShiftChangeRequestsTab />}
      {tab === "uprava" && canDataChanges && <EmployeeDataChangeRequestsTab />}
      {tab === "predani" && canDataChanges && <HandoverWarningsTab />}

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
