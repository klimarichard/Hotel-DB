import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

interface ShiftChangeRequestsContextValue {
  pendingCount: number;
  refresh: () => void;
}

const ShiftChangeRequestsContext = createContext<ShiftChangeRequestsContextValue>({
  pendingCount: 0,
  refresh: () => {},
});

export function ShiftChangeRequestsProvider({ children }: { children: ReactNode }) {
  const { can } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);

  const fetch = useCallback(() => {
    if (!can("shifts.changeRequest.review")) return;
    api
      .get<{ count: number }>("/shifts/changeRequests/pending-count")
      .then((data) => setPendingCount(data.count))
      .catch(() => {});
  }, [can]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return (
    <ShiftChangeRequestsContext.Provider value={{ pendingCount, refresh: fetch }}>
      {children}
    </ShiftChangeRequestsContext.Provider>
  );
}

export function useShiftChangeRequestsContext() {
  return useContext(ShiftChangeRequestsContext);
}
