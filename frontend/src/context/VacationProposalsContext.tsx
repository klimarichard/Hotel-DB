import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

/**
 * Pending vacation-balance proposals created by the payroll check (Kontrola
 * mezd). A vacation manager accepts or dismisses them on /dovolena; this
 * context only carries the pending COUNT for the sidebar / Upozornění badges.
 * Without employees.vacationBalance.manage it stays 0 and never hits the API.
 */
interface VacationProposalsContextValue {
  pendingCount: number;
  refresh: () => Promise<void>;
}

const VacationProposalsContext = createContext<VacationProposalsContextValue>({
  pendingCount: 0,
  refresh: async () => {},
});

export function VacationProposalsProvider({ children }: { children: ReactNode }) {
  const { can } = useAuth();
  const canManage = can("employees.vacationBalance.manage");
  const [pendingCount, setPendingCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!canManage) {
      setPendingCount(0);
      return;
    }
    try {
      const data = await api.get<{ count: number }>("/vacation-proposals/pending-count");
      setPendingCount(typeof data?.count === "number" ? data.count : 0);
    } catch {
      // Badge is best-effort – keep the last known value on a transient error.
    }
  }, [canManage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <VacationProposalsContext.Provider value={{ pendingCount, refresh }}>
      {children}
    </VacationProposalsContext.Provider>
  );
}

export function useVacationProposals() {
  return useContext(VacationProposalsContext);
}
