import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

interface ShiftChangeRequestsContextValue {
  /** Pending change requests + pending shift requests (both reviewed under
   *  shifts.changeRequest.review) – drives the Směny / Upozornění badges. */
  pendingCount: number;
  /** The shift-request ("žádost o konkrétní směnu") share of pendingCount. */
  shiftRequestCount: number;
  refresh: () => void;
}

const ShiftChangeRequestsContext = createContext<ShiftChangeRequestsContextValue>({
  pendingCount: 0,
  shiftRequestCount: 0,
  refresh: () => {},
});

export function ShiftChangeRequestsProvider({ children }: { children: ReactNode }) {
  const { can } = useAuth();
  const [changeCount, setChangeCount] = useState(0);
  const [shiftRequestCount, setShiftRequestCount] = useState(0);

  const fetch = useCallback(() => {
    if (!can("shifts.changeRequest.review")) return;
    api
      .get<{ count: number }>("/shifts/changeRequests/pending-count")
      .then((data) => setChangeCount(typeof data.count === "number" ? data.count : 0))
      .catch(() => {});
    // Shift requests filed inside request windows share the reviewer permission
    // and the queue (same badge, same Upozornění tab).
    api
      .get<{ count: number }>("/shifts/shiftRequests/pending-count")
      .then((data) => setShiftRequestCount(typeof data.count === "number" ? data.count : 0))
      .catch(() => {});
  }, [can]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return (
    <ShiftChangeRequestsContext.Provider
      value={{ pendingCount: changeCount + shiftRequestCount, shiftRequestCount, refresh: fetch }}
    >
      {children}
    </ShiftChangeRequestsContext.Provider>
  );
}

export function useShiftChangeRequestsContext() {
  return useContext(ShiftChangeRequestsContext);
}
