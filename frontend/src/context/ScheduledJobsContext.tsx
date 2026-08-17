import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

/**
 * Alert-count badge for the scheduled maintenance jobs (failing + overdue),
 * shown on the Upozornění → Úlohy tab and summed into the sidebar "Upozornění"
 * badge. Mirrors HandoverWarningsContext; only system.triggers holders fetch it.
 *
 * The badge is the point of the feature: a job that fails silently is exactly
 * what this was built to surface, so the count has to reach the sidebar rather
 * than waiting for somebody to open the tab.
 */
interface ScheduledJobsContextValue {
  alertCount: number;
  refresh: () => void;
}

const ScheduledJobsContext = createContext<ScheduledJobsContextValue>({
  alertCount: 0,
  refresh: () => {},
});

export function ScheduledJobsProvider({ children }: { children: ReactNode }) {
  const { can } = useAuth();
  const [alertCount, setAlertCount] = useState(0);

  const fetch = useCallback(() => {
    if (!can("system.triggers")) return;
    api
      .get<{ count: number }>("/jobs/alert-count")
      .then((data) => setAlertCount(data.count))
      .catch(() => {});
  }, [can]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return (
    <ScheduledJobsContext.Provider value={{ alertCount, refresh: fetch }}>
      {children}
    </ScheduledJobsContext.Provider>
  );
}

export function useScheduledJobsContext() {
  return useContext(ScheduledJobsContext);
}
