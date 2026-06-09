import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { useAlertsContext } from "@/context/AlertsContext";
import { useShiftOverridesContext } from "@/context/ShiftOverridesContext";
import { useShiftChangeRequestsContext } from "@/context/ShiftChangeRequestsContext";
import { useVacationContext } from "@/context/VacationContext";
import { useTheme } from "@/context/ThemeContext";
import { api } from "@/lib/api";
import { resolveOrderByPermission } from "@/lib/menuItems";
import TimeOverrideBanner from "@/components/TimeOverrideBanner";
import TimeOverrideControl from "@/components/TimeOverrideControl";
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
  const { unreadCount, unreadProbationCount } = useAlertsContext();
  const upozorneniBadge = unreadCount + unreadProbationCount;
  const { pendingCount: pendingOverrideCount } = useShiftOverridesContext();
  const { pendingCount: pendingChangeRequestCount } = useShiftChangeRequestsContext();
  const { pendingCount: pendingVacationCount } = useVacationContext();
  const shiftsBadgeCount =
    (can("shifts.override.review") ? pendingOverrideCount : 0) +
    (can("shifts.changeRequest.review") ? pendingChangeRequestCount : 0);
  const showVacationBadge = can("vacation.review") && pendingVacationCount > 0;
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  // Per-type saved menu order (admin-configurable in Settings → Menu); the
  // endpoint keys by the user's type. null = default order from menuItems.ts.
  const [savedOrder, setSavedOrder] = useState<string[] | null>(null);

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
    return 0;
  }

  async function handleLogout() {
    await signOut(auth);
    navigate("/login");
  }

  return (
    <div className={styles.shell}>
      <nav className={styles.sidebar}>
        <div className={styles.logo}>
          <img src={logoMark} alt="" className={styles.logoMark} />
          <span>HPM Intranet</span>
        </div>
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
          <button className={styles.logoutBtn} onClick={handleLogout}>
            Odhlásit
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
          <button
            className={styles.themeToggle}
            data-tour="theme-toggle"
            onClick={toggleTheme}
            title={theme === "dark" ? "Světlý režim" : "Tmavý režim"}
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            {theme === "dark" ? "Světlý" : "Tmavý"}
          </button>
          {/* Test-clock control — renders only where faking time is allowed
              (staging / emulator), never in production. */}
          <TimeOverrideControl />
        </div>
      </nav>
      <main className={styles.main}>
        <TimeOverrideBanner />
        <Outlet />
      </main>
    </div>
  );
}
