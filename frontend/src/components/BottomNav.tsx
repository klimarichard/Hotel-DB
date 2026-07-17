import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import type { MenuItem } from "@/lib/menuItems";
import styles from "./BottomNav.module.css";

/**
 * Phone-only bottom tab bar (hidden ≥560px; the sidebar takes over there).
 *
 * Single source of truth: it consumes the SAME permission-gated, ordered
 * `items` and the SAME `badgeFor` that Layout already computed for the sidebar –
 * it never re-derives permissions. Four fixed anchors map to registry ids; the
 * fifth tab "Více" opens a slide-up sheet with every remaining permitted item
 * plus the footer utilities (theme / help / logout / clock / version) that
 * normally live in the dark sidebar `.userBar` (rendered here in theme-aware
 * styling so they're legible on the light surface).
 */

const ANCHOR_IDS = ["prehled", "smeny", "dovolena", "mujProfil"] as const;

// Bottom-bar display labels only – the registry label stays authoritative for
// the sidebar. "Můj profil" is too wide for a 360px tab slot.
const LABEL_OVERRIDE: Record<string, string> = {
  mujProfil: "Profil",
};

interface BottomNavProps {
  items: MenuItem[];
  badgeFor: (id: string) => number;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onLogout: () => void;
  /** Pre-gated version string (e.g. "v2.3.4") or null when not permitted. On
   *  mobile the version is display-only — the changelog is desktop-only. */
  versionLabel: string | null;
  /** <TimeOverrideControl/> – self-styled; only renders where allowed. */
  timeControl?: ReactNode;
  /** Logged-in user's display name/email – shown in the "Více" sheet (the phone
   *  equivalent of the sidebar footer's logged-in-user line). */
  userLabel?: string | null;
  /** Logged-in user's role/type label, shown under `userLabel`. */
  userRole?: string | null;
}

const ICONS: Record<string, ReactNode> = {
  prehled: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9.5 12 3l9 6.5" />
      <path d="M5 10v10h14V10" />
    </svg>
  ),
  smeny: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4.5" width="18" height="16" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="8" y1="2.5" x2="8" y2="6" />
      <line x1="16" y1="2.5" x2="16" y2="6" />
    </svg>
  ),
  dovolena: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="4.5" />
      <line x1="12" y1="19.5" x2="12" y2="22" />
      <line x1="2" y1="12" x2="4.5" y2="12" />
      <line x1="19.5" y1="12" x2="22" y2="12" />
      <line x1="4.9" y1="4.9" x2="6.7" y2="6.7" />
      <line x1="17.3" y1="17.3" x2="19.1" y2="19.1" />
      <line x1="4.9" y1="19.1" x2="6.7" y2="17.3" />
      <line x1="17.3" y1="6.7" x2="19.1" y2="4.9" />
    </svg>
  ),
  mujProfil: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.5-6 8-6s8 2 8 6" />
    </svg>
  ),
  more: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  ),
};

export default function BottomNav({
  items,
  badgeFor,
  theme,
  onToggleTheme,
  onLogout,
  versionLabel,
  timeControl,
  userLabel,
  userRole,
}: BottomNavProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const byId = new Map(items.map((i) => [i.id, i] as const));
  const anchors = ANCHOR_IDS.map((id) => byId.get(id)).filter(
    (i): i is MenuItem => Boolean(i)
  );
  const anchorIds = new Set(anchors.map((a) => a.id));
  const moreItems = items.filter((i) => !anchorIds.has(i.id));
  // The "Více" sheet always carries the footer utilities (theme / Nápověda /
  // Odhlásit) – the ONLY place logout is reachable on phones. So the tab must
  // always render, even when a user's permitted pages are all four anchors
  // (the common case for a regular employee: Přehled/Směny/Dovolená/Profil).
  // Previously gated on `moreItems.length > 0`, which hid logout entirely for
  // those users.
  const showMore = true;

  // "Více" is the active tab whenever the current route belongs to a non-anchor
  // page (incl. nested routes like /zamestnanci/:id).
  const moreActive = moreItems.some(
    (m) =>
      location.pathname === m.path ||
      location.pathname.startsWith(m.path + "/")
  );
  const moreBadgeTotal = moreItems.reduce((sum, m) => sum + badgeFor(m.id), 0);

  // Body-scroll lock while the sheet is open; restore cleanly on close/unmount.
  useEffect(() => {
    if (!moreOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [moreOpen]);

  // Keep the fixed bar pinned to the bottom of the VISUAL viewport during
  // pinch / double-tap zoom. A plain `position: fixed` element is anchored to the
  // LAYOUT viewport, so it scales and slides off-screen when the page is zoomed.
  // We track window.visualViewport and translate the bar to the visual viewport's
  // bottom-left, countering the zoom scale so it keeps its on-screen size.
  const barRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const bar = barRef.current;
      if (!bar) return;
      if (vv.scale <= 1.0001) {
        // Not pinch-zoomed: keep the default fixed positioning. (This also avoids
        // fighting the on-screen keyboard, which shrinks the visual viewport
        // without zooming – we don't want the bar floating above the keyboard.)
        bar.style.transform = "";
        return;
      }
      // Anchor delta = (visual-viewport bottom in layout coords) − (layout-viewport
      // bottom). The bar is `position: fixed; bottom: 0`, so its natural bottom sits
      // at the LAYOUT viewport bottom = the layout-viewport height. Use
      // documentElement.clientHeight for that height – NOT window.innerHeight: on iOS
      // WebKit (Safari + Chrome) window.innerHeight tracks the VISUAL viewport and
      // shrinks as you pinch-zoom in, which collapsed this delta and pushed the bar
      // off-screen. clientHeight is the layout-viewport height and stays constant
      // through pinch-zoom, so the bar tracks the visual-viewport bottom correctly.
      const layoutHeight = document.documentElement.clientHeight;
      const offsetY = vv.offsetTop + vv.height - layoutHeight;
      bar.style.transform = `translate(${vv.offsetLeft}px, ${offsetY}px) scale(${1 / vv.scale})`;
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return (
    <>
      <nav ref={barRef} className={styles.bar} aria-label="Hlavní navigace (mobil)">
        {anchors.map((item) => {
          const badge = badgeFor(item.id);
          return (
            <NavLink
              key={item.id}
              to={item.path}
              data-tour={`bottomnav-${item.id}`}
              className={({ isActive }) =>
                [styles.tab, isActive ? styles.tabActive : ""].join(" ")
              }
            >
              <span className={styles.tabIcon}>
                {ICONS[item.id]}
                {badge > 0 && <span className={styles.dot} />}
              </span>
              <span className={styles.tabLabel}>
                {LABEL_OVERRIDE[item.id] ?? item.label}
              </span>
            </NavLink>
          );
        })}
        {showMore && (
          <button
            type="button"
            data-tour="bottomnav-more"
            className={[styles.tab, moreActive ? styles.tabActive : ""].join(" ")}
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
          >
            <span className={styles.tabIcon}>
              {ICONS.more}
              {moreBadgeTotal > 0 && <span className={styles.dot} />}
            </span>
            <span className={styles.tabLabel}>Více</span>
          </button>
        )}
      </nav>

      {moreOpen && (
        <div
          className={styles.sheetOverlay}
          role="dialog"
          aria-modal="true"
          aria-label="Více"
          onKeyDown={(e) => {
            if (e.key === "Escape") setMoreOpen(false);
          }}
          // Backdrop click closes – a DELIBERATE exception to the project's
          // "modals dismiss only via explicit buttons" rule (see CLAUDE.md).
          // That rule exists because a stray backdrop click threw away
          // half-edited FORMS. This sheet is pure navigation: links, a theme
          // toggle and logout, no draft state, so there is nothing to lose and
          // tapping away is what a menu is expected to do.
          // `e.target === e.currentTarget` keeps it to the backdrop itself, so
          // clicks bubbling out of the sheet don't close it.
          onClick={(e) => {
            if (e.target === e.currentTarget) setMoreOpen(false);
          }}
        >
          <div className={styles.sheet}>
            <div className={styles.sheetHeader}>
              <span className={styles.sheetTitle}>Více</span>
              <button
                type="button"
                className={styles.sheetClose}
                onClick={() => setMoreOpen(false)}
                aria-label="Zavřít"
              >
                ✕
              </button>
            </div>

            {moreItems.length > 0 && (
              <div className={styles.sheetList}>
                {moreItems.map((item) => {
                  const badge = badgeFor(item.id);
                  return (
                    <NavLink
                      key={item.id}
                      to={item.path}
                      className={({ isActive }) =>
                        [styles.sheetItem, isActive ? styles.sheetItemActive : ""].join(" ")
                      }
                      onClick={() => setMoreOpen(false)}
                    >
                      <span>{item.label}</span>
                      {badge > 0 && <span className={styles.sheetBadge}>{badge}</span>}
                    </NavLink>
                  );
                })}
              </div>
            )}

            <div className={styles.sheetFooter}>
              <button
                type="button"
                className={styles.footerBtn}
                onClick={onToggleTheme}
              >
                {theme === "dark" ? "Světlý režim" : "Tmavý režim"}
              </button>
              <button
                type="button"
                className={styles.footerBtn}
                onClick={() => {
                  setMoreOpen(false);
                  navigate("/napoveda");
                }}
              >
                Nápověda
              </button>
              <button
                type="button"
                className={`${styles.footerBtn} ${styles.footerLogout}`}
                onClick={() => {
                  // Close the sheet first: for a no-self-logout account onLogout
                  // opens the authorization modal, and the sheet shares its
                  // z-index (1000) — leaving it up would stack over the prompt.
                  setMoreOpen(false);
                  onLogout();
                }}
              >
                Odhlásit
              </button>
              {userLabel && (
                <div className={styles.sheetUser}>
                  <span className={styles.sheetUserName}>{userLabel}</span>
                  {userRole && <span className={styles.sheetUserRole}>{userRole}</span>}
                </div>
              )}
              {timeControl}
              {versionLabel && (
                <span className={styles.sheetVersion}>{versionLabel}</span>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
