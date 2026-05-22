import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

/**
 * Pending-count badge for employee self-service data-edit requests, shown on
 * the Upozornění "Žádosti o úpravu údajů" tab. Mirrors ShiftChangeRequestsContext.
 * Only admin/director review these, so only they fetch the count.
 */
interface EmployeeChangeRequestsContextValue {
  pendingCount: number;
  refresh: () => void;
}

const EmployeeChangeRequestsContext = createContext<EmployeeChangeRequestsContextValue>({
  pendingCount: 0,
  refresh: () => {},
});

export function EmployeeChangeRequestsProvider({ children }: { children: ReactNode }) {
  const { role } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);

  const fetch = useCallback(() => {
    if (role !== "admin" && role !== "director") return;
    api
      .get<{ count: number }>("/employee-change-requests/pending-count")
      .then((data) => setPendingCount(data.count))
      .catch(() => {});
  }, [role]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return (
    <EmployeeChangeRequestsContext.Provider value={{ pendingCount, refresh: fetch }}>
      {children}
    </EmployeeChangeRequestsContext.Provider>
  );
}

export function useEmployeeChangeRequestsContext() {
  return useContext(EmployeeChangeRequestsContext);
}
