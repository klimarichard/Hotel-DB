import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

interface AlertId {
  id: string;
}

interface AlertsContextValue {
  // Document-expiry alerts
  unreadCount: number;
  readIds: Set<string>;
  markRead: (ids: string[]) => void;
  // Pass the ids of the alerts currently visible on the page; the context
  // unions them into the existing read set. Falls back to the context's
  // own fetched list when called with no argument (used by tests/dev).
  markAllRead: (ids?: string[]) => void;

  // Probation-end alerts
  unreadProbationCount: number;
  readProbationIds: Set<string>;
  markProbationRead: (ids: string[]) => void;
  markAllProbationRead: (ids?: string[]) => void;

  refresh: () => void;
}

const AlertsContext = createContext<AlertsContextValue>({
  unreadCount: 0,
  readIds: new Set(),
  markRead: () => {},
  markAllRead: () => {},
  unreadProbationCount: 0,
  readProbationIds: new Set(),
  markProbationRead: () => {},
  markAllProbationRead: () => {},
  refresh: () => {},
});

const STORAGE_KEY = "hotel_hr_read_alert_ids_v2"; // documents
const PROBATION_STORAGE_KEY = "hotel_hr_read_probation_alert_ids_v1";

function loadIds(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

export function AlertsProvider({ children }: { children: ReactNode }) {
  const { role } = useAuth();
  const [alerts, setAlerts] = useState<AlertId[]>([]);
  const [probationAlerts, setProbationAlerts] = useState<AlertId[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(() => loadIds(STORAGE_KEY));
  const [readProbationIds, setReadProbationIds] = useState<Set<string>>(() =>
    loadIds(PROBATION_STORAGE_KEY)
  );

  function fetchAll() {
    if (role !== "admin" && role !== "director") return;
    api.get<AlertId[]>("/alerts").then(setAlerts).catch(() => {});
    api.get<AlertId[]>("/alerts/probation").then(setProbationAlerts).catch(() => {});
  }

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const unreadCount = alerts.filter((a) => !readIds.has(a.id)).length;
  const unreadProbationCount = probationAlerts.filter((a) => !readProbationIds.has(a.id)).length;

  function markRead(ids: string[]) {
    setReadIds((prev) => {
      const next = new Set([...prev, ...ids]);
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  function markAllRead(ids?: string[]) {
    const idsToAdd = ids ?? alerts.map((a) => a.id);
    setReadIds((prev) => {
      const next = new Set([...prev, ...idsToAdd]);
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  function markProbationRead(ids: string[]) {
    setReadProbationIds((prev) => {
      const next = new Set([...prev, ...ids]);
      localStorage.setItem(PROBATION_STORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  function markAllProbationRead(ids?: string[]) {
    const idsToAdd = ids ?? probationAlerts.map((a) => a.id);
    setReadProbationIds((prev) => {
      const next = new Set([...prev, ...idsToAdd]);
      localStorage.setItem(PROBATION_STORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  function refresh() {
    fetchAll();
  }

  return (
    <AlertsContext.Provider
      value={{
        unreadCount,
        readIds,
        markRead,
        markAllRead,
        unreadProbationCount,
        readProbationIds,
        markProbationRead,
        markAllProbationRead,
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
