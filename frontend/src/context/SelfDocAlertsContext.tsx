import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import type { DocumentExpiryAlert } from "@/components/DocumentExpiryBar";

/**
 * The logged-in user's OWN document-expiry alerts. Same `alerts` data the
 * Upozornění feature shows to alerts.view users (identical 30-day expiring/
 * expired logic), but self-scoped via GET /me/employee/alerts. Drives the
 * "Můj profil" sidebar badge and the document-expiry bar on the dashboard +
 * self profile page. Fetched only for users linked to an employee record; the
 * endpoint returns [] otherwise, so non-linked users see nothing.
 */
interface SelfDocAlertsContextValue {
  alerts: DocumentExpiryAlert[];
  count: number;
  refresh: () => void;
}

const SelfDocAlertsContext = createContext<SelfDocAlertsContextValue>({
  alerts: [],
  count: 0,
  refresh: () => {},
});

export function SelfDocAlertsProvider({ children }: { children: ReactNode }) {
  const { employeeId } = useAuth();
  const [alerts, setAlerts] = useState<DocumentExpiryAlert[]>([]);

  const fetch = useCallback(() => {
    if (!employeeId) {
      setAlerts([]);
      return;
    }
    api
      .get<DocumentExpiryAlert[]>("/me/employee/alerts")
      .then(setAlerts)
      .catch(() => {});
  }, [employeeId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return (
    <SelfDocAlertsContext.Provider value={{ alerts, count: alerts.length, refresh: fetch }}>
      {children}
    </SelfDocAlertsContext.Provider>
  );
}

export function useSelfDocAlertsContext() {
  return useContext(SelfDocAlertsContext);
}
