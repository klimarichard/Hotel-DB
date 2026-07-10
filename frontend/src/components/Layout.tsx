import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { useAlertsContext } from "@/context/AlertsContext";
import { useShiftOverridesContext } from "@/context/ShiftOverridesContext";
import { useShiftChangeRequestsContext } from "@/context/ShiftChangeRequestsContext";
import { useEmployeeChangeRequestsContext } from "@/context/EmployeeChangeRequestsContext";
import { useSelfDocAlertsContext } from "@/context/SelfDocAlertsContext";
import { useVacationContext } from "@/context/VacationContext";
import { useTheme } from "@/context/ThemeContext";
import { api } from "@/lib/api";
import { resolveOrderByPermission } from "@/lib/menuItems";
import TimeOverrideBanner from "@/components/TimeOverrideBanner";
import TimeOverrideControl from "@/components/TimeOverrideControl";
import BottomNav from "@/components/BottomNav";
import ChangelogModal from "@/components/ChangelogModal";
import logoMark from "@/assets/logo.svg";
import styles from "./Layout.module.css";

const SunIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="1" x2="12" y2="3"/>
    <line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1" y1="12" x2="3" y2="12"/>
    <line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>
);

const MoonIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
);

export default function Layout() {
  const { user, role, name, roleTypeName, can } = useAuth();
  const { unreadCount, unreadProbationCount, refresh: refreshAlerts } = useAlertsContext();
  const { pendingCount: pendingOverrideCount, refresh: refreshOverrides } = useShiftOverridesContext();
  const { pendingCount: pendingChangeRequestCount, refresh: refreshChangeRequests } = useShiftChangeRequestsContext();
  const { pendingCount: pendingDataChangeCount, refresh: refreshDataChanges } = useEmployeeChangeRequestsContext();
  const { count: selfDocAlertCount, refresh: refreshSelfDocAlerts } = useSelfDocAlertsContext();
  const { pendingCount: pendingVacationCount, refresh: refreshVacation } = useVacationContext();
  // The "Upozornění" sidebar badge mirrors the Upozornění page total: it sums
  // ALL six review queues shown there, each gated by the same permission that
  // gates that page's tab. (Documents/probation are already 0 without
  // alerts.view, since AlertsContext only fetches them then.) Vacation + shift
  // queues ALSO keep their own dedicated badges below – the dedicated badge
  // says WHERE, this total says overall outstanding load.
  const upozorneniBadge =
    unreadCount +
    unreadProbationCount +
    (can("vacation.review") ? pendingVacationCount : 0) +
    (can("shifts.override.review") ? pendingOverrideCount : 0) +
    (can("shifts.changeRequest.review") ? pendingChangeRequestCount : 0) +
    (can("changeRequests.review") ? pendingDataChangeCount : 0);
  const shiftsBadgeCount =
    (can("shifts.override.review") ? pendingOverrideCount : 0) +
    (can("shifts.changeRequest.review") ? pendingChangeRequestCount : 0);
  const showVacationBadge = can("vacation.review") && pendingVacationCount > 0;
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  // Badge counts are otherwise fetched once on mount, so a request submitted by
  // ANOTHER user never appears until a full reload. Re-pull all review-queue
  // counts on every navigation (cheap) and on a 60s interval (covers a tab left
  // open on one page). Each context's refresh() is a no-op without the relevant
  // permission. A reviewer's own approve/reject still refreshes locally too.
  useEffect(() => {
    function refreshAll() {
      refreshAlerts();
      refreshOverrides();
      refreshChangeRequests();
      refreshDataChanges();
      refreshSelfDocAlerts();
      refreshVacation();
    }
    refreshAll();
    const id = window.setInterval(refreshAll, 60_000);
    return () => window.clearInterval(id);
    // location.pathname change triggers a re-pull on navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Per-type saved menu order (admin-configurable in Settings → Menu); the
  // endpoint keys by the user's type. null = default order from menuItems.ts.
  const [savedOrder, setSavedOrder] = useState<string[] | null>(null);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const canViewVersion = can("system.version.view");
  const canChangelog = canViewVersion && can("system.version.changelog");

  useEffect(() => {
    if (!user) return;
    api
      .get<{ order: string[] | null }>("/settings/menu-order/me")
      .then((res) => setSavedOrder(res.order))
      .catch(() => setSavedOrder(null));
  }, [user]);

  const items = resolveOrderByPermission(can, savedOrder);

  function badgeFor(id: string): number {
    if (id === "smeny") return shiftsBadgeCount;
    if (id === "dovolena") return showVacationBadge ? pendingVacationCount : 0;
    if (id === "upozorneni") return upozorneniBadge;
    // "Můj profil" badge = the user's own expired / soon-to-expire documents.
    if (id === "mujProfil") return selfDocAlertCount;
    return 0;
  }

  async function handleLogout() {
    await signOut(auth);
    navigate("/login");
  }

  return (
    <div className={styles.shell}>
      <nav className={styles.sidebar}>
        <Link to="/prehled" className={styles.logo} title="Přehled" aria-label="Přehled">
          <img src={logoMark} alt="" className={styles.logoMark} />
          <span>HPM Intranet</span>
        </Link>
        <ul className={styles.nav}>
          {items.map((item) => {
            const badge = badgeFor(item.id);
            return (
              <li key={item.id}>
                <NavLink
                  to={item.path}
                  data-tour={`nav-${item.id}`}
                  className={({ isActive }) =>
                    [styles.navLink, isActive ? styles.active : ""].join(" ")
                  }
                >
                  {badge > 0 ? (
                    <span className={styles.navLinkInner}>
                      {item.label}
                      <span className={styles.badge}>{badge}</span>
                    </span>
                  ) : (
                    item.label
                  )}
                </NavLink>
              </li>
            );
          })}
        </ul>
        <div className={styles.userBar} data-tour="menu-footer">
          <span className={styles.userEmail}>{name?.trim() || user?.email}</span>
          <span className={styles.userRole}>{roleTypeName ?? role}</span>
          <button
            className={styles.themeToggle}
            data-tour="theme-toggle"
            onClick={toggleTheme}
            title={theme === "dark" ? "Světlý režim" : "Tmavý režim"}
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            {theme === "dark" ? "Světlý" : "Tmavý"}
          </button>
          <button
            className={styles.themeToggle}
            data-tour="help-button"
            onClick={() => navigate("/napoveda")}
            title="Nápověda"
            aria-label="Nápověda"
          >
            ? Nápověda
          </button>
          <button className={styles.logoutBtn} onClick={handleLogout}>
            Odhlásit
          </button>
          {/* Test-clock control – renders only where faking time is allowed
              (staging / emulator), never in production. */}
          <TimeOverrideControl />
          {/* App version (vX.Y.Z) – always the last footer element so it pins to
              the very bottom (below the test-clock control in staging). Gated by
              system.version.view; admins see it by default (system.admin). */}
          {canViewVersion &&
            (canChangelog ? (
              <button
                type="button"
                className={`${styles.version} ${styles.versionButton}`}
                onClick={() => setChangelogOpen(true)}
                title="Zobrazit změny verzí"
              >
                v{__APP_VERSION__}
              </button>
            ) : (
              <span className={styles.version}>v{__APP_VERSION__}</span>
            ))}
        </div>
      </nav>
      <main className={styles.main}>
        <TimeOverrideBanner />
        <Outlet />
      </main>
      {/* Phone-only bottom tab bar (hidden ≥560px via CSS). Reuses the same
          permission-gated `items` + `badgeFor` as the sidebar – single source of
          truth. Footer utilities are passed as values/handlers (not the dark
          sidebar JSX) so BottomNav can render them in theme-aware sheet styling. */}
      <BottomNav
        items={items.filter((m) => !m.hideOnMobile && (!m.mobilePermission || can(m.mobilePermission)))}
        badgeFor={badgeFor}
        theme={theme}
        onToggleTheme={toggleTheme}
        onLogout={handleLogout}
        versionLabel={canViewVersion ? `v${__APP_VERSION__}` : null}
        onVersionClick={canChangelog ? () => setChangelogOpen(true) : undefined}
        timeControl={<TimeOverrideControl />}
        userLabel={name?.trim() || user?.email}
        userRole={roleTypeName ?? role}
      />
      {changelogOpen && <ChangelogModal onClose={() => setChangelogOpen(false)} />}
    </div>
  );
}
