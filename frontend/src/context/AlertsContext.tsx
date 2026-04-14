import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

interface Alert {
  id: string;
}

interface AlertsContextValue {
  unreadCount: number;
  markAllRead: (ids?: string[]) => void;
  refresh: () => void;
}

const AlertsContext = createContext<AlertsContextValue>({
  unreadCount: 0,
  markAllRead: (_ids?: string[]) => {},
  refresh: () => {},
});

const STORAGE_KEY = "hotel_hr_seen_alert_ids";

export function AlertsProvider({ children }: { children: ReactNode }) {
  const { role } = useAuth();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [seenIds, setSeenIds] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });

  function refresh() {
    if (role !== "admin" && role !== "director") return;
    api.get<Alert[]>("/alerts").then(setAlerts).catch(() => {});
  }

  useEffect(() => {
    refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const unreadCount = alerts.filter((a) => !seenIds.has(a.id)).length;

  // ids can be passed explicitly (from AlertsPage's own fetch) to avoid timing issues
  function markAllRead(ids?: string[]) {
    const allIds = ids ?? alerts.map((a) => a.id);
    setSeenIds(new Set(allIds));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(allIds));
  }

  return (
    <AlertsContext.Provider value={{ unreadCount, markAllRead, refresh }}>
      {children}
    </AlertsContext.Provider>
  );
}

export function useAlertsContext() {
  return useContext(AlertsContext);
}
