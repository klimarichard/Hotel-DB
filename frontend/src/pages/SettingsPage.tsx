import { useState, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { useAuth, UserRole } from "@/hooks/useAuth";
import { authApi, UserProfile } from "@/lib/api";
import styles from "./SettingsPage.module.css";

const ROLES: UserRole[] = ["admin", "director", "manager", "employee"];

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  director: "Ředitel",
  manager: "Vedoucí",
  employee: "Zaměstnanec",
};

const emptyForm = { name: "", email: "", password: "", role: "employee" as UserRole };

export default function SettingsPage() {
  const { role, loading: authLoading } = useAuth();

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Per-row role change state: uid → pending role
  const [pendingRole, setPendingRole] = useState<Record<string, UserRole>>({});
  const [roleChanging, setRoleChanging] = useState<Record<string, boolean>>({});

  // Per-row activation toggle state
  const [togglingUid, setTogglingUid] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await authApi.listUsers();
      setUsers(data);
    } catch (e: unknown) {
      setError((e as Error).message ?? "Chyba při načítání uživatelů.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  if (authLoading) return null;
  if (role !== "admin") return <Navigate to="/" replace />;

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      await authApi.createUser(form);
      setShowCreate(false);
      setForm(emptyForm);
      await loadUsers();
    } catch (e: unknown) {
      setFormError((e as Error).message ?? "Chyba při vytváření uživatele.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRoleChange(uid: string, newRole: UserRole) {
    setPendingRole((prev) => ({ ...prev, [uid]: newRole }));
    setRoleChanging((prev) => ({ ...prev, [uid]: true }));
    try {
      await authApi.setRole(uid, newRole);
      setUsers((prev) => prev.map((u) => (u.uid === uid ? { ...u, role: newRole } : u)));
    } catch {
      // Revert on failure
      setPendingRole((prev) => {
        const next = { ...prev };
        delete next[uid];
        return next;
      });
    } finally {
      setRoleChanging((prev) => ({ ...prev, [uid]: false }));
    }
  }

  async function handleToggleActive(user: UserProfile) {
    setTogglingUid(user.uid);
    try {
      if (user.active) {
        await authApi.deactivateUser(user.uid);
      } else {
        await authApi.reactivateUser(user.uid);
      }
      setUsers((prev) =>
        prev.map((u) => (u.uid === user.uid ? { ...u, active: !u.active } : u))
      );
    } catch {
      // Silently fail — user sees no state change, can retry
    } finally {
      setTogglingUid(null);
    }
  }

  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.title}>Správa uživatelů</h1>
        <button className={styles.addBtn} onClick={() => { setShowCreate(true); setFormError(null); }}>
          + Přidat uživatele
        </button>
      </div>

      {showCreate && (
        <div className={styles.modal}>
          <div className={styles.modalBox}>
            <h2 className={styles.modalTitle}>Nový uživatel</h2>
            <form onSubmit={handleCreateUser} className={styles.form}>
              <div className={styles.field}>
                <label className={styles.label}>Jméno</label>
                <input
                  className={styles.input}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  autoFocus
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>E-mail</label>
                <input
                  className={styles.input}
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Heslo</label>
                <input
                  className={styles.input}
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  required
                  minLength={6}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Role</label>
                <select
                  className={styles.input}
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
              </div>
              {formError && <p className={styles.formError}>{formError}</p>}
              <div className={styles.formActions}>
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={() => { setShowCreate(false); setForm(emptyForm); }}
                >
                  Zrušit
                </button>
                <button type="submit" className={styles.saveBtn} disabled={saving}>
                  {saving ? "Ukládám…" : "Vytvořit"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading && <p className={styles.state}>Načítám…</p>}
      {error && <p className={styles.errorState}>{error}</p>}

      {!loading && !error && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Jméno</th>
              <th>E-mail</th>
              <th>Role</th>
              <th>Stav</th>
              <th>Akce</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className={styles.empty}>Žádní uživatelé</td>
              </tr>
            )}
            {users.map((u) => (
              <tr key={u.uid}>
                <td className={styles.name}>{u.name}</td>
                <td className={styles.email}>{u.email}</td>
                <td>
                  <select
                    className={styles.roleSelect}
                    value={pendingRole[u.uid] ?? u.role}
                    disabled={roleChanging[u.uid]}
                    onChange={(e) => handleRoleChange(u.uid, e.target.value as UserRole)}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <span className={u.active ? styles.badgeActive : styles.badgeInactive}>
                    {u.active ? "Aktivní" : "Deaktivován"}
                  </span>
                </td>
                <td>
                  <button
                    className={u.active ? styles.deactivateBtn : styles.activateBtn}
                    disabled={togglingUid === u.uid}
                    onClick={() => handleToggleActive(u)}
                  >
                    {togglingUid === u.uid
                      ? "…"
                      : u.active
                      ? "Deaktivovat"
                      : "Aktivovat"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
