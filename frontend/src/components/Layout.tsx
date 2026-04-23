import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { useAlertsContext } from "@/context/AlertsContext";
import { useShiftOverridesContext } from "@/context/ShiftOverridesContext";
import { useShiftChangeRequestsContext } from "@/context/ShiftChangeRequestsContext";
import { useVacationContext } from "@/context/VacationContext";
import { useTheme } from "@/context/ThemeContext";
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

const navItems = [
  { to: "/prehled", label: "Přehled" },
  { to: "/smeny", label: "Směny" },
  { to: "/dovolena", label: "Dovolená" },
];

const staffItems = [
  { to: "/zamestnanci", label: "Zaměstnanci" },
  { to: "/mzdy", label: "Mzdy" },
];

const adminItems = [
  { to: "/upozorneni", label: "Neplatné doklady" },
  { to: "/smlouvy", label: "Šablony smluv" },
  { to: "/nastaveni", label: "Nastavení" },
];

export default function Layout() {
  const { user, role } = useAuth();
  const { unreadCount } = useAlertsContext();
  const { pendingCount: pendingOverrideCount } = useShiftOverridesContext();
  const { pendingCount: pendingChangeRequestCount } = useShiftChangeRequestsContext();
  const { pendingCount: pendingVacationCount } = useVacationContext();
  const shiftsBadgeCount = pendingOverrideCount + pendingChangeRequestCount;
  const showVacationBadge = (role === "admin" || role === "director") && pendingVacationCount > 0;
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

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
          {navItems.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  [styles.navLink, isActive ? styles.active : ""].join(" ")
                }
              >
                {item.to === "/smeny" && shiftsBadgeCount > 0 ? (
                  <span className={styles.navLinkInner}>
                    {item.label}
                    <span className={styles.badge}>{shiftsBadgeCount}</span>
                  </span>
                ) : item.to === "/dovolena" && showVacationBadge ? (
                  <span className={styles.navLinkInner}>
                    {item.label}
                    <span className={styles.badge}>{pendingVacationCount}</span>
                  </span>
                ) : (
                  item.label
                )}
              </NavLink>
            </li>
          ))}
          {(role === "admin" || role === "director") &&
            staffItems.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    [styles.navLink, isActive ? styles.active : ""].join(" ")
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))
          }
          {(role === "admin" || role === "director") &&
            adminItems.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    [styles.navLink, isActive ? styles.active : ""].join(" ")
                  }
                >
                  <span className={styles.navLinkInner}>
                    {item.label}
                    {item.to === "/upozorneni" && unreadCount > 0 && (
                      <span className={styles.badge}>{unreadCount}</span>
                    )}
                  </span>
                </NavLink>
              </li>
            ))
          }
        </ul>
        <div className={styles.userBar}>
          <span className={styles.userEmail}>{user?.email}</span>
          <span className={styles.userRole}>{role}</span>
          <button className={styles.logoutBtn} onClick={handleLogout}>
            Odhlásit
          </button>
          <button
            className={styles.themeToggle}
            onClick={toggleTheme}
            title={theme === "dark" ? "Světlý režim" : "Tmavý režim"}
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            {theme === "dark" ? "Světlý" : "Tmavý"}
          </button>
        </div>
      </nav>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
