import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

interface Alert {
  id: string;
}

interface AlertsContextValue {
  unreadCount: number;
  readIds: Set<string>;
  markRead: (ids: string[]) => void;
  markAllRead: () => void;
  refresh: () => void;
}

const AlertsContext = createContext<AlertsContextValue>({
  unreadCount: 0,
  readIds: new Set(),
  markRead: () => {},
  markAllRead: () => {},
  refresh: () => {},
});

const STORAGE_KEY = "hotel_hr_read_alert_ids_v2"; // v2: user-triggered only, not auto-marked

export function AlertsProvider({ children }: { children: ReactNode }) {
  const { role } = useAuth();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });

  function fetchAlerts() {
    if (role !== "admin" && role !== "director") return;
    api.get<Alert[]>("/alerts").then(setAlerts).catch(() => {});
  }

  useEffect(() => {
    fetchAlerts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const unreadCount = alerts.filter((a) => !readIds.has(a.id)).length;

  function markRead(ids: string[]) {
    setReadIds((prev) => {
      const next = new Set([...prev, ...ids]);
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  function markAllRead() {
    const allIds = alerts.map((a) => a.id);
    setReadIds(new Set(allIds));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(allIds));
  }

  function refresh() {
    fetchAlerts();
  }

  return (
    <AlertsContext.Provider value={{ unreadCount, readIds, markRead, markAllRead, refresh }}>
      {children}
    </AlertsContext.Provider>
  );
}

export function useAlertsContext() {
  return useContext(AlertsContext);
}
