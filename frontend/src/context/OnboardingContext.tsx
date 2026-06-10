import { createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { authApi } from "@/lib/api";
import { buildAppTour, APP_TOUR_ID, APP_TOUR_VERSION } from "@/lib/tours";
import type { TourDefinition } from "@/lib/tours/types";
import TourOverlay from "@/components/TourOverlay";

interface OnboardingContextValue {
  activeTour: TourDefinition | null;
  stepIndex: number;
  /** Start (or replay) the permission-filtered tour, ignoring the seen flag. */
  startTour: () => void;
  next: () => void;
  prev: () => void;
  /** Jump directly to a step index (clamped). Used by the section-jump buttons. */
  goToStep: (index: number) => void;
  /** Finish or skip — both mark the tour as seen so it won't auto-fire again. */
  dismiss: () => void;
}

const OnboardingContext = createContext<OnboardingContextValue>({
  activeTour: null,
  stepIndex: 0,
  startTour: () => {},
  next: () => {},
  prev: () => {},
  goToStep: () => {},
  dismiss: () => {},
});

/**
 * Tour-only demo routes (App.tsx): the REAL pages rendered on mock data. When a
 * user skips/closes the tour while parked on one of these, we bounce them back to
 * a real app page (see dismiss) — otherwise they'd be stranded on a sandbox URL.
 * `/zamestnanci/tour-demo` is the sentinel employee-detail demo (no wrapper).
 */
function isDemoRoute(pathname: string): boolean {
  return pathname.startsWith("/napoveda/ukazka") || pathname === "/zamestnanci/tour-demo";
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { user, can, employeeId, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [toursSeen, setToursSeen] = useState<Record<string, number> | null>(null);
  const [activeTour, setActiveTour] = useState<TourDefinition | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const autoStartedRef = useRef(false);

  const cacheKey = user ? `hotel_hr_tours_${user.uid}` : null;

  // Load the completed-tours map on login: seed from the localStorage flash
  // cache, then fetch the authoritative map from the backend (Firestore via CF).
  useEffect(() => {
    if (!user || !cacheKey) {
      setToursSeen(null);
      setActiveTour(null);
      autoStartedRef.current = false;
      return;
    }
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        setToursSeen(JSON.parse(cached));
      } catch {
        /* ignore corrupt cache */
      }
    }
    let cancelled = false;
    authApi
      .getTours()
      .then(({ toursSeen: remote }) => {
        if (cancelled) return;
        const map = remote ?? {};
        setToursSeen(map);
        localStorage.setItem(cacheKey, JSON.stringify(map));
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("Failed to load tours:", e);
        setToursSeen({});
      });
    return () => {
      cancelled = true;
    };
  }, [user, cacheKey]);

  // Build the tour from the master step list filtered by the user's effective
  // permissions (`can`), then start at step 0. Same source for auto-start and
  // replay, so each user always sees exactly the steps they hold.
  const startTour = useCallback(() => {
    setStepIndex(0);
    setActiveTour(buildAppTour(can, { hasEmployee: !!employeeId }));
  }, [can, employeeId]);

  // Auto-start once per session for a first-time (or version-bumped) user, after
  // the landing redirect has resolved to a real page. Gated on `loading` so it
  // never fires before /auth/me resolves (see useAuth per-component race).
  useEffect(() => {
    if (loading || !user || toursSeen === null) return;
    if (autoStartedRef.current || activeTour) return;
    if (location.pathname === "/" || location.pathname === "/login") return;

    const seenVersion = toursSeen[APP_TOUR_ID];
    if (typeof seenVersion === "number" && seenVersion >= APP_TOUR_VERSION) return;

    autoStartedRef.current = true;
    startTour();
  }, [loading, user, toursSeen, location.pathname, activeTour, startTour]);

  const markSeen = useCallback(
    (tour: TourDefinition) => {
      const map = { ...(toursSeen ?? {}), [tour.id]: tour.version };
      setToursSeen(map);
      if (cacheKey) localStorage.setItem(cacheKey, JSON.stringify(map));
      authApi.markTourSeen(tour.id, tour.version).catch((e) => console.error("Failed to save tour:", e));
    },
    [toursSeen, cacheKey]
  );

  const dismiss = useCallback(() => {
    if (activeTour) markSeen(activeTour);
    setActiveTour(null);
    setStepIndex(0);
    // If skipped/closed while parked on a tour-only demo route, return the user
    // to a real page. "/" resolves to their default landing page (DefaultRedirect).
    if (isDemoRoute(location.pathname)) navigate("/", { replace: true });
  }, [activeTour, markSeen, location.pathname, navigate]);

  const next = useCallback(() => {
    if (!activeTour) return;
    if (stepIndex >= activeTour.steps.length - 1) {
      dismiss();
    } else {
      setStepIndex((i) => i + 1);
    }
  }, [activeTour, stepIndex, dismiss]);

  const prev = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  const goToStep = useCallback(
    (index: number) => {
      if (!activeTour) return;
      setStepIndex(Math.max(0, Math.min(index, activeTour.steps.length - 1)));
    },
    [activeTour]
  );

  return (
    <OnboardingContext.Provider value={{ activeTour, stepIndex, startTour, next, prev, goToStep, dismiss }}>
      {children}
      <TourOverlay />
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  return useContext(OnboardingContext);
}
