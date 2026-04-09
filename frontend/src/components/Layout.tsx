import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import styles from "./Layout.module.css";

const navItems = [
  { to: "/zamestnanci", label: "Zaměstnanci" },
  { to: "/smlouvy", label: "Smlouvy" },
  { to: "/smeny", label: "Směny" },
  { to: "/mzdy", label: "Mzdy" },
];

const adminItems = [
  { to: "/upozorneni", label: "Upozornění" },
  { to: "/nastaveni", label: "Nastavení" },
];

export default function Layout() {
  const { user, role } = useAuth();
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
                {item.label}
              </NavLink>
            </li>
          ))}
          {(role === "admin" || role === "director") &&
            adminItems.map((item) => (
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
