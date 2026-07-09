import { useEffect, useState } from "react";

/**
 * Phone (bottom-nav) layout test – mirrors the EXACT media query Layout uses to
 * swap the sidebar for the bottom tab bar, including the landscape short-screen
 * case. Kept byte-identical to the inline `matchMedia` blocks in
 * ShiftPlannerPage / ContractTemplatesPage and to OnboardingContext's
 * PHONE_MEDIA_QUERY so every "are we on a phone?" check agrees.
 *
 * Reactive: re-renders on viewport change (rotation, resize). SSR-safe guard so
 * it degrades to desktop (false) when `window` is absent.
 */
export const PHONE_MEDIA_QUERY =
  "(max-width: 559.98px), (orientation: landscape) and (max-height: 480px)";

export function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(
    () => typeof window !== "undefined" && window.matchMedia(PHONE_MEDIA_QUERY).matches
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(PHONE_MEDIA_QUERY);
    const update = () => setIsPhone(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isPhone;
}
