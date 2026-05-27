import { createContext, useContext, useEffect, useState, ReactNode, Dispatch, SetStateAction } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

/**
 * Read-state for alerts lives server-side on the alert document itself
 * (shared across all admins/directors and preserved across the daily/manual
 * refreshes). This context only tracks the unread *counts* for the sidebar /
 * tab badges; the Upozornění tabs fetch the full alert lists themselves and
 * split unread vs. read on each alert's own `read` flag.
 */
interface AlertFlag {
  id: string;
  read?: boolean;
}

interface AlertsContextValue {
  unreadCount: number;
  unreadProbationCount: number;
  /**
   * Persist read-state for document-expiry alerts (pass read=false to
   * un-mark), then refresh the badge counts. Resolves once the server write
   * completes; rejects (ApiError) on failure so callers can revert optimistic
   * UI.
   */
  markRead: (ids: string[], read?: boolean) => Promise<void>;
  /** Same, for probation-end alerts. */
  markProbationRead: (ids: string[], read?: boolean) => Promise<void>;
  refresh: () => void;
}

const AlertsContext = createContext<AlertsContextValue>({
  unreadCount: 0,
  unreadProbationCount: 0,
  markRead: async () => {},
  markProbationRead: async () => {},
  refresh: () => {},
});

export function AlertsProvider({ children }: { children: ReactNode }) {
  const { role } = useAuth();
  const [alerts, setAlerts] = useState<AlertFlag[]>([]);
  const [probationAlerts, setProbationAlerts] = useState<AlertFlag[]>([]);

  function fetchAll() {
    if (role !== "admin" && role !== "director") return;
    api.get<AlertFlag[]>("/alerts").then(setAlerts).catch(() => {});
    api.get<AlertFlag[]>("/alerts/probation").then(setProbationAlerts).catch(() => {});
  }

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const unreadCount = alerts.filter((a) => !a.read).length;
  const unreadProbationCount = probationAlerts.filter((a) => !a.read).length;

  // Flip the `read` flag on the matching cached alerts so the derived counts
  // (and the sidebar badge that reads them) update immediately — without
  // waiting for the persist + refetch round-trip. fetchAll() then reconciles
  // with the server, and a rejected POST re-syncs back to the true state.
  function applyRead(
    setter: Dispatch<SetStateAction<AlertFlag[]>>,
    ids: string[],
    read: boolean
  ) {
    const idSet = new Set(ids);
    setter((prev) => prev.map((a) => (idSet.has(a.id) ? { ...a, read } : a)));
  }

  async function markRead(ids: string[], read = true) {
    if (ids.length === 0) return;
    applyRead(setAlerts, ids, read);
    try {
      await api.post("/alerts/read", { ids, read });
    } finally {
      fetchAll();
    }
  }

  async function markProbationRead(ids: string[], read = true) {
    if (ids.length === 0) return;
    applyRead(setProbationAlerts, ids, read);
    try {
      await api.post("/alerts/probation/read", { ids, read });
    } finally {
      fetchAll();
    }
  }

  function refresh() {
    fetchAll();
  }

  return (
    <AlertsContext.Provider
      value={{
        unreadCount,
        unreadProbationCount,
        markRead,
        markProbationRead,
        refresh,
      }}
    >
      {children}
    </AlertsContext.Provider>
  );
}

export function useAlertsContext() {
  return useContext(AlertsContext);
}
