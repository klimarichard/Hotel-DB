import { useEffect, useLayoutEffect, useRef, useState, CSSProperties } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Button from "./Button";
import IconButton from "./IconButton";
import { useOnboarding } from "@/context/OnboardingContext";
import { sectionNavTargets } from "@/lib/tours";
import styles from "./TourOverlay.module.css";

const POPOVER_WIDTH = 340;
const GAP = 14;
const ANCHOR_TIMEOUT_MS = 2000;
const POLL_MS = 80;

/**
 * Guided-tour overlay: spotlights a `data-tour` anchor and shows a positioned
 * popover. Cross-page steps navigate first, then bounded-wait for the anchor;
 * if it never appears the step falls back to a centered card (never hangs).
 * Rendered by OnboardingProvider, so it overlays the whole authenticated app.
 */
export default function TourOverlay() {
  const { activeTour, stepIndex, next, prev, goToStep, dismiss } = useOnboarding();
  const navigate = useNavigate();
  const location = useLocation();

  const [el, setEl] = useState<HTMLElement | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [ready, setReady] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popH, setPopH] = useState(0);

  const step = activeTour ? activeTour.steps[stepIndex] : null;

  // Navigate to the step's route before resolving its anchor.
  useEffect(() => {
    if (!step?.route) return;
    if (location.pathname !== step.route) navigate(step.route);
  }, [step, location.pathname, navigate]);

  // Resolve the anchor element (bounded retry); centered if null or not found.
  useEffect(() => {
    if (!activeTour || !step) return;
    if (step.route && location.pathname !== step.route) return; // wait for nav
    setReady(false);
    setEl(null);
    setRect(null);

    if (!step.anchor) {
      setReady(true);
      return;
    }

    let cancelled = false;
    let elapsed = 0;
    const clicked = new Set<string>();
    const timer = setInterval(() => {
      if (cancelled) return;
      // Reveal controls behind tabs/expanders: click each reveal anchor once as
      // it appears (e.g. open the right tab), then wait for the real anchor.
      if (step.reveal) {
        for (const sel of step.reveal) {
          if (clicked.has(sel)) continue;
          const r = document.querySelector<HTMLElement>(`[data-tour="${sel}"]`);
          if (r) {
            r.click();
            clicked.add(sel);
          }
        }
      }
      const found = document.querySelector<HTMLElement>(`[data-tour="${step.anchor}"]`);
      if (found) {
        clearInterval(timer);
        found.scrollIntoView({ block: step.scrollBlock ?? "center", inline: "nearest" });
        setEl(found);
        setReady(true);
      } else {
        elapsed += POLL_MS;
        if (elapsed >= ANCHOR_TIMEOUT_MS) {
          clearInterval(timer);
          setReady(true); // give up gracefully → centered card
        }
      }
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeTour, stepIndex, step, location.pathname]);

  // Keep the spotlight rect in sync with scroll / resize.
  useEffect(() => {
    if (!el) {
      setRect(null);
      return;
    }
    const update = () => setRect(el.getBoundingClientRect());
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [el]);

  // Keyboard: Esc = skip, Enter/→ = next, ← = back.
  useEffect(() => {
    if (!activeTour) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
      } else if (e.key === "Enter" || e.key === "ArrowRight") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTour, next, prev, dismiss]);

  // Measure the popover so we can clamp it fully inside the viewport (its height
  // varies per step). Runs before paint, so there's no visible jump.
  useLayoutEffect(() => {
    if (!ready) return;
    const node = popoverRef.current;
    if (node) setPopH(node.getBoundingClientRect().height);
  }, [ready, stepIndex, rect]);

  if (!activeTour || !step || !ready) return null;

  const total = activeTour.steps.length;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === total - 1;
  const currentSection = activeTour.steps[stepIndex].section;
  const { prev: prevSection, next: nextSection } = sectionNavTargets(activeTour.steps, stepIndex);
  const showSectionNav = prevSection !== null || nextSection !== null;

  // Popover position: below the anchor if there's room, else above — then the
  // top is ALWAYS clamped so the whole popover (incl. its buttons) stays inside
  // the viewport. Horizontal is clamped too. Centered when there's no anchor.
  let popStyle: CSSProperties;
  let centered = false;
  if (rect) {
    const left = Math.max(
      GAP,
      Math.min(rect.left + rect.width / 2 - POPOVER_WIDTH / 2, window.innerWidth - POPOVER_WIDTH - GAP)
    );
    const placeBelow = window.innerHeight - rect.bottom >= popH + GAP || rect.top < popH + GAP;
    let top = placeBelow ? rect.bottom + GAP : rect.top - GAP - popH;
    // Keep the full popover on-screen even if the anchor is at an edge.
    top = Math.max(GAP, Math.min(top, window.innerHeight - popH - GAP));
    popStyle = { top, left, width: POPOVER_WIDTH };
  } else {
    centered = true;
    popStyle = { width: POPOVER_WIDTH };
  }

  return (
    <>
      {/* Transparent full-screen click blocker (under the spotlight). */}
      <div className={styles.blocker} onClick={(e) => e.stopPropagation()} />

      {rect ? (
        <div
          className={styles.spotlight}
          style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }}
        />
      ) : (
        <div className={styles.dim} />
      )}

      <div
        ref={popoverRef}
        className={centered ? `${styles.popover} ${styles.popoverCentered}` : styles.popover}
        style={popStyle}
        role="dialog"
        aria-modal="true"
        aria-label={step.title}
      >
        <div className={styles.popoverHeader}>
          <span className={styles.stepCount}>
            {currentSection ? `${currentSection} · ` : ""}Krok {stepIndex + 1} z {total}
          </span>
          <IconButton aria-label="Zavřít prohlídku" onClick={dismiss}>
            ✕
          </IconButton>
        </div>
        <h3 className={styles.title}>{step.title}</h3>
        <p className={styles.body}>{step.body}</p>
        {showSectionNav && (
          <div className={styles.sectionNav}>
            <button
              className={styles.sectionBtn}
              type="button"
              onClick={() => prevSection !== null && goToStep(prevSection)}
              disabled={prevSection === null}
            >
              ‹ Předchozí sekce
            </button>
            <button
              className={styles.sectionBtn}
              type="button"
              onClick={() => nextSection !== null && goToStep(nextSection)}
              disabled={nextSection === null}
            >
              Další sekce ›
            </button>
          </div>
        )}
        <div className={styles.actions}>
          <button className={styles.skip} type="button" onClick={dismiss}>
            Přeskočit
          </button>
          <div className={styles.navBtns}>
            {!isFirst && (
              <Button variant="secondary" size="sm" onClick={prev}>
                Zpět
              </Button>
            )}
            <Button variant="primary" size="sm" onClick={next}>
              {isLast ? "Hotovo" : "Další"}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
