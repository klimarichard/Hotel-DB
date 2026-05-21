import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { setOffsetMs } from "@/lib/clock";

export interface TimeOverrideState {
  enabled: boolean;
  offsetMs: number;
  targetISO: string | null;
  setAtISO: string | null;
  setBy: string | null;
  /** Backend-computed: is faking time permitted in this environment? */
  allowed: boolean;
}

interface Ctx extends TimeOverrideState {
  refresh: () => Promise<void>;
  setOverride: (targetISO: string) => Promise<void>;
  clearOverride: () => Promise<void>;
}

const DEFAULT: TimeOverrideState = {
  enabled: false,
  offsetMs: 0,
  targetISO: null,
  setAtISO: null,
  setBy: null,
  allowed: false,
};

const TimeOverrideContext = createContext<Ctx>({
  ...DEFAULT,
  refresh: async () => {},
  setOverride: async () => {},
  clearOverride: async () => {},
});

export function TimeOverrideProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [state, setState] = useState<TimeOverrideState>(DEFAULT);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const res = await api.get<TimeOverrideState>("/settings/time-override");
      setState({
        enabled: res.enabled,
        offsetMs: res.offsetMs,
        targetISO: res.targetISO,
        setAtISO: res.setAtISO,
        setBy: res.setBy,
        allowed: res.allowed,
      });
      setOffsetMs(res.enabled ? res.offsetMs : 0);
    } catch {
      // Network/permission hiccup: keep the cached offset, don't crash the app.
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // After a change, reload so every clock.now() call site (many are computed
  // once per mount) picks up the new offset consistently across the app.
  const setOverride = useCallback(
    async (targetISO: string) => {
      await api.put("/settings/time-override", { targetISO });
      await refresh();
      window.location.reload();
    },
    [refresh]
  );

  const clearOverride = useCallback(async () => {
    await api.delete("/settings/time-override");
    await refresh();
    window.location.reload();
  }, [refresh]);

  return (
    <TimeOverrideContext.Provider
      value={{ ...state, refresh, setOverride, clearOverride }}
    >
      {children}
    </TimeOverrideContext.Provider>
  );
}

export function useTimeOverride() {
  return useContext(TimeOverrideContext);
}
