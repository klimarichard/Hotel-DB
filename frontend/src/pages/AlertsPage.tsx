import { useState } from "react";
import { useAlertsContext } from "@/context/AlertsContext";
import { useVacationContext } from "@/context/VacationContext";
import { useShiftOverridesContext } from "@/context/ShiftOverridesContext";
import { useShiftChangeRequestsContext } from "@/context/ShiftChangeRequestsContext";
import DocumentExpiryTab from "./upozorneni/DocumentExpiryTab";
import ProbationTab from "./upozorneni/ProbationTab";
import PendingVacationTab from "./upozorneni/PendingVacationTab";
import PendingShiftOverridesTab from "./upozorneni/PendingShiftOverridesTab";
import PendingShiftChangeRequestsTab from "./upozorneni/PendingShiftChangeRequestsTab";
import styles from "./AlertsPage.module.css";

type Tab = "doklady" | "zkusebni" | "dovolena" | "vyjimky" | "zmeny";

export default function AlertsPage() {
  const [tab, setTab] = useState<Tab>("doklady");
  const { unreadCount, unreadProbationCount } = useAlertsContext();
  const { pendingCount: vacationCount } = useVacationContext();
  const { pendingCount: overridesCount } = useShiftOverridesContext();
  const { pendingCount: changesCount } = useShiftChangeRequestsContext();

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
        <h1 className={styles.title}>Upozornění</h1>
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

      {tab === "doklady" && <DocumentExpiryTab />}
      {tab === "zkusebni" && <ProbationTab />}
      {tab === "dovolena" && <PendingVacationTab />}
      {tab === "vyjimky" && <PendingShiftOverridesTab />}
      {tab === "zmeny" && <PendingShiftChangeRequestsTab />}
    </div>
  );
}
