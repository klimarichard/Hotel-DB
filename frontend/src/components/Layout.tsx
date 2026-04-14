import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { useAlertsContext } from "@/context/AlertsContext";
import { useShiftOverridesContext } from "@/context/ShiftOverridesContext";
import styles from "./Layout.module.css";

const navItems = [
  { to: "/smeny", label: "Směny" },
  { to: "/dovolena", label: "Dovolená" },
];

const staffItems = [
  { to: "/zamestnanci", label: "Zaměstnanci" },
  { to: "/mzdy", label: "Mzdy" },
];

const adminItems = [
  { to: "/upozorneni", label: "Upozornění" },
  { to: "/smlouvy", label: "Šablony smluv" },
  { to: "/nastaveni", label: "Nastavení" },
];

export default function Layout() {
  const { user, role } = useAuth();
  const { unreadCount } = useAlertsContext();
  const { pendingCount: pendingOverrideCount } = useShiftOverridesContext();
  const navigate = useNavigate();

  async function handleLogout() {
    await signOut(auth);
    navigate("/login");
  }

  return (
    <div className={styles.shell}>
      <nav className={styles.sidebar}>
        <div className={styles.logo}>Hotel HR</div>
        <ul className={styles.nav}>
          {navItems.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  [styles.navLink, isActive ? styles.active : ""].join(" ")
                }
              >
                {item.to === "/smeny" && pendingOverrideCount > 0 ? (
                  <span className={styles.navLinkInner}>
                    {item.label}
                    <span className={styles.badge}>{pendingOverrideCount}</span>
                  </span>
                ) : (
                  item.label
                )}
              </NavLink>
            </li>
          ))}
          {role !== "employee" &&
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
        </div>
      </nav>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
