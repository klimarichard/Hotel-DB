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
  /** Finish or skip – both mark the tour as seen so it won't auto-fire again. */
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
 * a real app page (see dismiss) – otherwise they'd be stranded on a sandbox URL.
 * `/zamestnanci/tour-demo` is the sentinel employee-detail demo (no wrapper).
 */
function isDemoRoute(pathname: string): boolean {
  return pathname.startsWith("/napoveda/ukazka") || pathname === "/zamestnanci/tour-demo";
}

/**
 * Phone (bottom-nav) layout test – mirrors the exact media query Layout uses to
 * swap the sidebar for the bottom tab bar. When true, the tour retargets its
 * sidebar-anchored steps onto the bottom nav (see buildAppTour → ctx.isPhone).
 * Read at tour-start time; rotating mid-tour is a rare edge we don't re-resolve.
 */
const PHONE_MEDIA_QUERY =
  "(max-width: 559.98px), (orientation: landscape) and (max-height: 480px)";
function isPhoneViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia(PHONE_MEDIA_QUERY).matches;
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

  // Persist the user's last-seen tour version (localStorage flash cache + backend).
  const recordSeenVersion = useCallback(
    (version: number) => {
      const map = { ...(toursSeen ?? {}), [APP_TOUR_ID]: version };
      setToursSeen(map);
      if (cacheKey) localStorage.setItem(cacheKey, JSON.stringify(map));
      authApi.markTourSeen(APP_TOUR_ID, version).catch((e) => console.error("Failed to save tour:", e));
    },
    [toursSeen, cacheKey]
  );

  // Manual replay (from Nápověda) – ALWAYS the full tour filtered to this user's
  // permissions, regardless of what they've already seen.
  const startTour = useCallback(() => {
    setStepIndex(0);
    setActiveTour(buildAppTour(can, { hasEmployee: !!employeeId, isPhone: isPhoneViewport() }));
  }, [can, employeeId]);

  // Auto-start once per session, after the landing redirect resolves to a real
  // page. Gated on `loading` so it never fires before /auth/me resolves (see
  // useAuth per-component race). Three cases:
  //   - never seen     → full tour
  //   - seen older ver → only what's new since then ("what's new" delta); if
  //                      nothing new applies to this user, silently record the
  //                      latest version instead of firing
  //   - up to date     → nothing
  useEffect(() => {
    if (loading || !user || toursSeen === null) return;
    if (autoStartedRef.current || activeTour) return;
    if (location.pathname === "/" || location.pathname === "/login") return;

    const seenVersion = toursSeen[APP_TOUR_ID];
    if (typeof seenVersion === "number" && seenVersion >= APP_TOUR_VERSION) return;

    autoStartedRef.current = true;
    const ctx = { hasEmployee: !!employeeId, isPhone: isPhoneViewport() };

    if (typeof seenVersion !== "number") {
      setStepIndex(0);
      setActiveTour(buildAppTour(can, ctx));
      return;
    }
    const delta = buildAppTour(can, ctx, { sinceVersion: seenVersion });
    if (delta.steps.length > 0) {
      setStepIndex(0);
      setActiveTour(delta);
    } else {
      recordSeenVersion(APP_TOUR_VERSION);
    }
  }, [loading, user, toursSeen, location.pathname, activeTour, can, employeeId, recordSeenVersion]);

  const dismiss = useCallback(() => {
    // Finishing or skipping either the full tour OR a delta marks the user as
    // current – both spread appTour.version, so this lands on APP_TOUR_VERSION.
    if (activeTour) recordSeenVersion(activeTour.version);
    setActiveTour(null);
    setStepIndex(0);
    // If skipped/closed while parked on a tour-only demo route, return the user
    // to a real page. "/" resolves to their default landing page (DefaultRedirect).
    if (isDemoRoute(location.pathname)) navigate("/", { replace: true });
  }, [activeTour, recordSeenVersion, location.pathname, navigate]);

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
