import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

/**
 * Unread-count badge for Předávací protokol warnings (Nenavazující předání +
 * Pozdní příchody combined), shown on the Upozornění tab and summed into the
 * sidebar "Upozornění" badge. Mirrors EmployeeChangeRequestsContext; only the
 * changeRequests.review reviewers fetch it.
 */
interface HandoverWarningsContextValue {
  unreadCount: number;
  refresh: () => void;
}

const HandoverWarningsContext = createContext<HandoverWarningsContextValue>({
  unreadCount: 0,
  refresh: () => {},
});

export function HandoverWarningsProvider({ children }: { children: ReactNode }) {
  const { can } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  const fetch = useCallback(() => {
    if (!can("changeRequests.review")) return;
    api
      .get<{ count: number }>("/handover-warnings/unread-count")
      .then((data) => setUnreadCount(data.count))
      .catch(() => {});
  }, [can]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return (
    <HandoverWarningsContext.Provider value={{ unreadCount, refresh: fetch }}>
      {children}
    </HandoverWarningsContext.Provider>
  );
}

export function useHandoverWarningsContext() {
  return useContext(HandoverWarningsContext);
}
