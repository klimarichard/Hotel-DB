import { createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { authApi } from "@/lib/api";
import { TOURS, resolveTourIdForRole } from "@/lib/tours";
import type { TourDefinition } from "@/lib/tours/types";
import TourOverlay from "@/components/TourOverlay";

interface OnboardingContextValue {
  activeTour: TourDefinition | null;
  stepIndex: number;
  /** Start (or replay) a tour by id, ignoring whether it was already seen. */
  startTour: (tourId: string) => void;
  next: () => void;
  prev: () => void;
  /** Finish or skip — both mark the tour as seen so it won't auto-fire again. */
  dismiss: () => void;
}

const OnboardingContext = createContext<OnboardingContextValue>({
  activeTour: null,
  stepIndex: 0,
  startTour: () => {},
  next: () => {},
  prev: () => {},
  dismiss: () => {},
});

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { user, role, roleType, loading } = useAuth();
  const location = useLocation();

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

  const startTour = useCallback((tourId: string) => {
    const tour = TOURS[tourId];
    if (!tour) return;
    setStepIndex(0);
    setActiveTour(tour);
  }, []);

  // Auto-start once per session for a first-time (or version-bumped) user, after
  // the landing redirect has resolved to a real page. Resolve by roleType first
  // (type-based users carry no legacy `role` claim), then fall back to role.
  useEffect(() => {
    if (loading || !user || toursSeen === null) return;
    if (autoStartedRef.current || activeTour) return;
    if (location.pathname === "/" || location.pathname === "/login") return;

    const tourId = resolveTourIdForRole(roleType ?? role);
    if (!tourId) return;
    const tour = TOURS[tourId];
    if (!tour) return;

    const seenVersion = toursSeen[tourId];
    if (typeof seenVersion === "number" && seenVersion >= tour.version) return;

    autoStartedRef.current = true;
    startTour(tourId);
  }, [loading, user, role, roleType, toursSeen, location.pathname, activeTour, startTour]);

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
  }, [activeTour, markSeen]);

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

  return (
    <OnboardingContext.Provider value={{ activeTour, stepIndex, startTour, next, prev, dismiss }}>
      {children}
      <TourOverlay />
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  return useContext(OnboardingContext);
}
