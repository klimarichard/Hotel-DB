import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

interface VacationContextValue {
  pendingCount: number;
  refresh: () => void;
}

const VacationContext = createContext<VacationContextValue>({
  pendingCount: 0,
  refresh: () => {},
});

export function VacationProvider({ children }: { children: ReactNode }) {
  const { role } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);

  const fetch = useCallback(() => {
    if (role !== "admin" && role !== "director") return;
    api
      .get<{ count: number }>("/vacation/pending-count")
      .then((data) => setPendingCount(data.count))
      .catch(() => {});
  }, [role]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return (
    <VacationContext.Provider value={{ pendingCount, refresh: fetch }}>
      {children}
    </VacationContext.Provider>
  );
}

export function useVacationContext() {
  return useContext(VacationContext);
}
