import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

interface ShiftOverridesContextValue {
  pendingCount: number;
  refresh: () => void;
}

const ShiftOverridesContext = createContext<ShiftOverridesContextValue>({
  pendingCount: 0,
  refresh: () => {},
});

export function ShiftOverridesProvider({ children }: { children: ReactNode }) {
  const { can } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);

  const fetch = useCallback(() => {
    if (!can("shifts.override.review")) return;
    api
      .get<{ count: number }>("/shifts/overrides/pending-count")
      .then((data) => setPendingCount(data.count))
      .catch(() => {});
  }, [can]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return (
    <ShiftOverridesContext.Provider value={{ pendingCount, refresh: fetch }}>
      {children}
    </ShiftOverridesContext.Provider>
  );
}

export function useShiftOverridesContext() {
  return useContext(ShiftOverridesContext);
}
