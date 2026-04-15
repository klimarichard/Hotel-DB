import { useState, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth, UserRole } from "@/hooks/useAuth";
import { authApi, UserProfile, api } from "@/lib/api";
import styles from "./SettingsPage.module.css";

const EyeIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
);

const EyeOffIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
);

function SalaryCell({ value }: { value: number | null | undefined }) {
  const [visible, setVisible] = useState(false);
  if (value == null) return <>—</>;
  return (
    <span className={styles.salaryCell}>
      {visible ? `${value.toLocaleString("cs-CZ")} Kč` : "•••••"}
      <button
        type="button"
        className={styles.revealBtn}
        onClick={() => setVisible((v) => !v)}
        title={visible ? "Skrýt mzdu" : "Zobrazit mzdu"}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </span>
  );
}

interface EmployeeSummary {
  id: string;
  firstName: string;
  lastName: string;
}

interface CompanyRecord {
  id: string;
  name: string;
  address: string;
  ic: string;
  dic: string;
}

interface DepartmentRecord {
  id: string;
  name: string;
  displayOrder: number;
}

interface JobPositionRecord {
  id: string;
  name: string;
  departmentId: string;
  defaultSalary: number;
  hourlyRate?: number | null;
  displayOrder: number;
}

const DEFAULT_COMPANY_IDS = ["HPM", "STP"];

const ROLES: UserRole[] = ["admin", "director", "manager", "employee"];

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  director: "Ředitel",
  manager: "Vedoucí",
  employee: "Zaměstnanec",
};

const emptyForm = { name: "", email: "", password: "", role: "employee" as UserRole, employeeId: "" };

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

  // Per-row password reset state
  const [resetingUid, setResetingUid] = useState<string | null>(null);
  const [resetMsg, setResetMsg] = useState<{ uid: string; msg: string; isError: boolean } | null>(null);

  // Employee link state
  const [employees, setEmployees] = useState<EmployeeSummary[]>([]);
  const [linkingUid, setLinkingUid] = useState<string | null>(null);
  const [linkEmployeeId, setLinkEmployeeId] = useState<string>("");
  const [linkSaving, setLinkSaving] = useState(false);

  const [settingsTab, setSettingsTab] = useState<"users" | "companies" | "departments" | "jobPositions" | "payroll">("users");

  // Departments
  const [departments, setDepartments] = useState<DepartmentRecord[]>([]);
  const [depEditId, setDepEditId] = useState<string | null>(null);
  const [depEditName, setDepEditName] = useState("");
  const [depNewName, setDepNewName] = useState("");
  const [depError, setDepError] = useState<string | null>(null);

  // Job positions
  const [positions, setPositions] = useState<JobPositionRecord[]>([]);
  const [posEditId, setPosEditId] = useState<string | null>(null);
  const [posForm, setPosForm] = useState<{ name: string; departmentId: string; defaultSalary: string; hourlyRate: string }>({ name: "", departmentId: "", defaultSalary: "", hourlyRate: "" });

  // Payroll settings
  const [foodVoucherRate, setFoodVoucherRate] = useState<number>(129.5);
  const [foodVoucherRateDraft, setFoodVoucherRateDraft] = useState<string>("");
  const [showVoucherConfirm, setShowVoucherConfirm] = useState(false);
  const [voucherSaving, setVoucherSaving] = useState(false);
  const [showPosCreate, setShowPosCreate] = useState(false);

  // Companies
  const [companyForms, setCompanyForms] = useState<Record<string, CompanyRecord>>({});
  const [companyEditId, setCompanyEditId] = useState<string | null>(null);
  const [companySaving, setCompanySaving] = useState<Record<string, boolean>>({});
  const [companySaveMsg, setCompanySaveMsg] = useState<Record<string, string>>({});

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

  useEffect(() => {
    api.get<EmployeeSummary[]>("/employees?status=active")
      .then((list) => setEmployees(list))
      .catch(() => setEmployees([]));
  }, []);

  useEffect(() => {
    api.get<CompanyRecord[]>("/companies").then((list) => {
      const map: Record<string, CompanyRecord> = {};
      for (const c of list) map[c.id] = c;
      // Ensure default company IDs are always shown
      for (const id of DEFAULT_COMPANY_IDS) {
        if (!map[id]) map[id] = { id, name: "", address: "", ic: "", dic: "" };
      }
      setCompanyForms(map);
    }).catch(() => {
      const map: Record<string, CompanyRecord> = {};
      for (const id of DEFAULT_COMPANY_IDS) map[id] = { id, name: "", address: "", ic: "", dic: "" };
      setCompanyForms(map);
    });
  }, []);

  const loadDepartments = useCallback(async () => {
    try {
      const list = await api.get<DepartmentRecord[]>("/departments");
      setDepartments(list);
    } catch {
      setDepartments([]);
    }
  }, []);

  const loadPositions = useCallback(async () => {
    try {
      const list = await api.get<JobPositionRecord[]>("/jobPositions");
      setPositions(list);
    } catch {
      setPositions([]);
    }
  }, []);

  useEffect(() => { loadDepartments(); loadPositions(); }, [loadDepartments, loadPositions]);

  useEffect(() => {
    api.get<{ foodVoucherRate: number }>("/payroll/settings")
      .then((s) => {
        setFoodVoucherRate(s.foodVoucherRate);
        setFoodVoucherRateDraft(String(s.foodVoucherRate));
      })
      .catch(() => {});
  }, []);

  async function handleCreateDepartment() {
    const name = depNewName.trim();
    if (!name) return;
    setDepError(null);
    try {
      await api.post("/departments", { name, displayOrder: departments.length });
      setDepNewName("");
      await loadDepartments();
    } catch (e: unknown) {
      setDepError((e as Error).message ?? "Chyba při vytváření.");
    }
  }

  async function handleSaveDepartment(id: string) {
    const name = depEditName.trim();
    if (!name) return;
    setDepError(null);
    try {
      await api.patch(`/departments/${id}`, { name });
      setDepEditId(null);
      setDepEditName("");
      await loadDepartments();
    } catch (e: unknown) {
      setDepError((e as Error).message ?? "Chyba při ukládání.");
    }
  }

  async function handleDeleteDepartment(id: string) {
    if (!confirm("Opravdu smazat toto oddělení?")) return;
    setDepError(null);
    try {
      await api.delete(`/departments/${id}`);
      await loadDepartments();
    } catch (e: unknown) {
      setDepError((e as Error).message ?? "Nelze smazat oddělení.");
    }
  }

  function openCreatePosition() {
    setPosEditId(null);
    setPosForm({ name: "", departmentId: departments[0]?.id ?? "", defaultSalary: "", hourlyRate: "" });
    setShowPosCreate(true);
  }

  function openEditPosition(p: JobPositionRecord) {
    setPosEditId(p.id);
    setPosForm({ name: p.name, departmentId: p.departmentId, defaultSalary: String(p.defaultSalary ?? ""), hourlyRate: String(p.hourlyRate ?? "") });
    setShowPosCreate(true);
  }

  async function handleSavePosition() {
    if (!posForm.name.trim() || !posForm.departmentId) return;
    const payload = {
      name: posForm.name.trim(),
      departmentId: posForm.departmentId,
      defaultSalary: Number(posForm.defaultSalary) || 0,
      hourlyRate: posForm.hourlyRate.trim() ? Number(posForm.hourlyRate) : null,
    };
    try {
      if (posEditId) {
        await api.patch(`/jobPositions/${posEditId}`, payload);
      } else {
        await api.post("/jobPositions", { ...payload, displayOrder: positions.length });
      }
      setShowPosCreate(false);
      setPosEditId(null);
      await loadPositions();
    } catch {
      // silent
    }
  }

  async function handleDeletePosition(id: string) {
    if (!confirm("Opravdu smazat tuto pozici?")) return;
    try {
      await api.delete(`/jobPositions/${id}`);
      await loadPositions();
    } catch {
      // silent
    }
  }

  async function handleSaveCompany(id: string) {
    setCompanySaving((p) => ({ ...p, [id]: true }));
    setCompanySaveMsg((p) => ({ ...p, [id]: "" }));
    try {
      const { name, address, ic, dic } = companyForms[id];
      await api.put(`/companies/${id}`, { name, address, ic, dic });
      setCompanyEditId(null);
    } catch {
      setCompanySaveMsg((p) => ({ ...p, [id]: "Chyba při ukládání" }));
      setTimeout(() => setCompanySaveMsg((p) => ({ ...p, [id]: "" })), 3000);
    } finally {
      setCompanySaving((p) => ({ ...p, [id]: false }));
    }
  }

  function setCompanyField(id: string, field: keyof CompanyRecord, value: string) {
    setCompanyForms((p) => ({ ...p, [id]: { ...p[id], [field]: value } }));
  }

  if (authLoading) return null;
  if (role !== "admin") return <Navigate to="/" replace />;

  function openLinkModal(uid: string, currentEmployeeId: string | null) {
    setLinkingUid(uid);
    setLinkEmployeeId(currentEmployeeId ?? "");
  }

  async function handleUnlinkEmployee(uid: string) {
    try {
      await authApi.linkEmployee(uid, null);
      setUsers((prev) => prev.map((u) => (u.uid === uid ? { ...u, employeeId: null } : u)));
    } catch {
      // Silently fail
    }
  }

  async function handleLinkEmployee() {
    if (!linkingUid) return;
    setLinkSaving(true);
    try {
      const empId = linkEmployeeId || null;
      await authApi.linkEmployee(linkingUid, empId);
      setUsers((prev) =>
        prev.map((u) => (u.uid === linkingUid ? { ...u, employeeId: empId } : u))
      );
      setLinkingUid(null);
    } catch {
      // Silently fail
    } finally {
      setLinkSaving(false);
    }
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      await authApi.createUser({
        ...form,
        employeeId: form.employeeId || undefined,
      });
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

  async function handleResetPassword(user: UserProfile) {
    if (!user.email) return;
    setResetingUid(user.uid);
    setResetMsg(null);
    try {
      await sendPasswordResetEmail(auth, user.email);
      setResetMsg({ uid: user.uid, msg: "Odkaz odeslán", isError: false });
    } catch {
      setResetMsg({ uid: user.uid, msg: "Chyba při odesílání", isError: true });
    } finally {
      setResetingUid(null);
      setTimeout(() => setResetMsg(null), 4000);
    }
  }

  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.title}>Nastavení</h1>
        {settingsTab === "users" && (
          <button className={styles.addBtn} onClick={() => { setShowCreate(true); setFormError(null); }}>
            + Přidat uživatele
          </button>
        )}
        {settingsTab === "jobPositions" && (
          <button className={styles.addBtn} onClick={openCreatePosition} disabled={departments.length === 0}>
            + Přidat pozici
          </button>
        )}
      </div>

      <div className={styles.tabs}>
        <button className={settingsTab === "users" ? styles.tabActive : styles.tabBtn} onClick={() => setSettingsTab("users")}>Uživatelé</button>
        <button className={settingsTab === "companies" ? styles.tabActive : styles.tabBtn} onClick={() => setSettingsTab("companies")}>Společnosti</button>
        <button className={settingsTab === "departments" ? styles.tabActive : styles.tabBtn} onClick={() => setSettingsTab("departments")}>Oddělení</button>
        <button className={settingsTab === "jobPositions" ? styles.tabActive : styles.tabBtn} onClick={() => setSettingsTab("jobPositions")}>Pracovní pozice</button>
        <button className={settingsTab === "payroll" ? styles.tabActive : styles.tabBtn} onClick={() => setSettingsTab("payroll")}>Mzdy</button>
      </div>

      {showCreate && settingsTab === "users" && (
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
              <div className={styles.field}>
                <label className={styles.label}>Zaměstnanec (volitelné)</label>
                <select
                  className={styles.input}
                  value={form.employeeId}
                  onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
                >
                  <option value="">— Nepropojovat —</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.lastName} {emp.firstName}
                    </option>
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

      {linkingUid && (
        <div className={styles.modal}>
          <div className={styles.modalBox}>
            <h2 className={styles.modalTitle}>Propojit se zaměstnancem</h2>
            <div className={styles.field}>
              <label className={styles.label}>Zaměstnanec</label>
              <select
                className={styles.input}
                value={linkEmployeeId}
                onChange={(e) => setLinkEmployeeId(e.target.value)}
              >
                <option value="">— Zrušit propojení —</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.lastName} {emp.firstName}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.formActions}>
              <button
                type="button"
                className={styles.cancelBtn}
                onClick={() => setLinkingUid(null)}
              >
                Zrušit
              </button>
              <button
                type="button"
                className={styles.saveBtn}
                onClick={handleLinkEmployee}
                disabled={linkSaving}
              >
                {linkSaving ? "Ukládám…" : "Uložit"}
              </button>
            </div>
          </div>
        </div>
      )}

      {settingsTab === "users" && (
        <>
          {loading && <p className={styles.state}>Načítám…</p>}
          {error && <p className={styles.errorState}>{error}</p>}
          {!loading && !error && (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Jméno</th>
                  <th>E-mail</th>
                  <th>Role</th>
                  <th>Zaměstnanec</th>
                  <th>Stav</th>
                  <th>Akce</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 && (
                  <tr><td colSpan={6} className={styles.empty}>Žádní uživatelé</td></tr>
                )}
                {users.map((u) => {
                  const linkedEmp = u.employeeId
                    ? employees.find((e) => e.id === u.employeeId)
                    : null;
                  return (
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
                        <span className={linkedEmp ? styles.employeeLinked : styles.employeeUnlinked}>
                          {linkedEmp ? `${linkedEmp.lastName} ${linkedEmp.firstName}` : "—"}
                        </span>
                        {linkedEmp ? (
                          <button
                            className={styles.linkBtn}
                            onClick={() => handleUnlinkEmployee(u.uid)}
                          >
                            Zrušit propojení
                          </button>
                        ) : (
                          <button
                            className={styles.linkBtn}
                            onClick={() => openLinkModal(u.uid, u.employeeId ?? null)}
                          >
                            Propojit
                          </button>
                        )}
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
                          {togglingUid === u.uid ? "…" : u.active ? "Deaktivovat" : "Aktivovat"}
                        </button>
                        {" "}
                        <button
                          className={styles.resetBtn}
                          disabled={resetingUid === u.uid || !u.email}
                          onClick={() => handleResetPassword(u)}
                          title="Odeslat uživateli odkaz pro obnovu hesla"
                        >
                          {resetingUid === u.uid ? "…" : "Resetovat heslo"}
                        </button>
                        {resetMsg?.uid === u.uid && (
                          <span className={resetMsg.isError ? styles.resetError : styles.resetOk}>
                            {resetMsg.msg}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}

      {settingsTab === "companies" && (
        <div className={styles.companyList}>
          {Object.values(companyForms).map((c) => {
            const isEditing = companyEditId === c.id;
            return (
              <div key={c.id} className={styles.companyCard}>
                <div className={styles.companyId}>{c.id}</div>
                <div className={styles.companyGrid}>
                  <div className={styles.field}>
                    <label className={styles.label}>Název</label>
                    {isEditing
                      ? <input className={styles.input} value={c.name} onChange={(e) => setCompanyField(c.id, "name", e.target.value)} />
                      : <span className={styles.companyValue}>{c.name || "—"}</span>}
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Adresa</label>
                    {isEditing
                      ? <input className={styles.input} value={c.address} onChange={(e) => setCompanyField(c.id, "address", e.target.value)} />
                      : <span className={styles.companyValue}>{c.address || "—"}</span>}
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>IČO</label>
                    {isEditing
                      ? <input className={styles.input} value={c.ic} onChange={(e) => setCompanyField(c.id, "ic", e.target.value)} />
                      : <span className={styles.companyValue}>{c.ic || "—"}</span>}
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>DIČ</label>
                    {isEditing
                      ? <input className={styles.input} value={c.dic} onChange={(e) => setCompanyField(c.id, "dic", e.target.value)} />
                      : <span className={styles.companyValue}>{c.dic || "—"}</span>}
                  </div>
                </div>
                <div className={styles.companyActions}>
                  {companySaveMsg[c.id] && (
                    <span className={styles.saveMsgErr}>{companySaveMsg[c.id]}</span>
                  )}
                  {isEditing ? (
                    <>
                      <button className={styles.cancelBtn} onClick={() => setCompanyEditId(null)} disabled={companySaving[c.id]}>
                        Zrušit
                      </button>
                      <button className={styles.saveBtn} onClick={() => handleSaveCompany(c.id)} disabled={companySaving[c.id]}>
                        {companySaving[c.id] ? "Ukládám…" : "Uložit"}
                      </button>
                    </>
                  ) : (
                    <button className={styles.editBtn} onClick={() => setCompanyEditId(c.id)}>
                      Upravit
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {settingsTab === "departments" && (
        <>
          {depError && <p className={styles.errorState}>{depError}</p>}
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Název</th>
                <th>Akce</th>
              </tr>
            </thead>
            <tbody>
              {departments.length === 0 && (
                <tr><td colSpan={2} className={styles.empty}>Žádná oddělení</td></tr>
              )}
              {departments.map((d) => (
                <tr key={d.id}>
                  <td>
                    {depEditId === d.id ? (
                      <input
                        className={styles.input}
                        value={depEditName}
                        onChange={(e) => setDepEditName(e.target.value)}
                      />
                    ) : (
                      d.name
                    )}
                  </td>
                  <td>
                    {depEditId === d.id ? (
                      <>
                        <button className={styles.saveBtn} onClick={() => handleSaveDepartment(d.id)}>Uložit</button>
                        <button className={styles.cancelBtn} onClick={() => { setDepEditId(null); setDepEditName(""); }}>Zrušit</button>
                      </>
                    ) : (
                      <>
                        <button className={styles.linkBtn} onClick={() => { setDepEditId(d.id); setDepEditName(d.name); }}>Upravit</button>
                        <button className={styles.deactivateBtn} onClick={() => handleDeleteDepartment(d.id)}>Smazat</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              <tr>
                <td>
                  <input
                    className={styles.input}
                    placeholder="Nové oddělení…"
                    value={depNewName}
                    onChange={(e) => setDepNewName(e.target.value)}
                  />
                </td>
                <td>
                  <button className={styles.saveBtn} onClick={handleCreateDepartment}>+ Přidat</button>
                </td>
              </tr>
            </tbody>
          </table>
        </>
      )}

      {settingsTab === "jobPositions" && (
        <>
          {showPosCreate && (
            <div className={styles.modal}>
              <div className={styles.modalBox}>
                <h2 className={styles.modalTitle}>{posEditId ? "Upravit pozici" : "Nová pozice"}</h2>
                <div className={styles.field}>
                  <label className={styles.label}>Název</label>
                  <input
                    className={styles.input}
                    value={posForm.name}
                    onChange={(e) => setPosForm({ ...posForm, name: e.target.value })}
                    autoFocus
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Oddělení</label>
                  <select
                    className={styles.input}
                    value={posForm.departmentId}
                    onChange={(e) => setPosForm({ ...posForm, departmentId: e.target.value })}
                  >
                    <option value="">— vyberte —</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Výchozí mzda (Kč)</label>
                  <input
                    className={styles.input}
                    type="number"
                    value={posForm.defaultSalary}
                    onChange={(e) => setPosForm({ ...posForm, defaultSalary: e.target.value })}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Hodinová sazba pro NAVÍC (Kč/hod, nepovinné)</label>
                  <input
                    className={styles.input}
                    type="number"
                    value={posForm.hourlyRate}
                    onChange={(e) => setPosForm({ ...posForm, hourlyRate: e.target.value })}
                    placeholder="—"
                  />
                </div>
                <div className={styles.formActions}>
                  <button type="button" className={styles.cancelBtn} onClick={() => { setShowPosCreate(false); setPosEditId(null); }}>Zrušit</button>
                  <button type="button" className={styles.saveBtn} onClick={handleSavePosition}>Uložit</button>
                </div>
              </div>
            </div>
          )}
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Název</th>
                <th>Oddělení</th>
                <th>Výchozí mzda</th>
                <th>Hodinová sazba</th>
                <th>Akce</th>
              </tr>
            </thead>
            <tbody>
              {positions.length === 0 && (
                <tr><td colSpan={5} className={styles.empty}>Žádné pozice</td></tr>
              )}
              {positions.map((p) => {
                const dep = departments.find((d) => d.id === p.departmentId);
                return (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{dep?.name ?? "—"}</td>
                    <td><SalaryCell value={p.defaultSalary} /></td>
                    <td><SalaryCell value={p.hourlyRate ?? null} /></td>
                    <td>
                      <button className={styles.linkBtn} onClick={() => openEditPosition(p)}>Upravit</button>
                      <button className={styles.deactivateBtn} onClick={() => handleDeletePosition(p.id)}>Smazat</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {settingsTab === "payroll" && (
        <div style={{ maxWidth: 480 }}>
          <h2 style={{ fontSize: "0.95rem", fontWeight: 600, color: "var(--color-text-heading)", marginBottom: "1rem" }}>
            Sazba stravenek
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "0.5rem" }}>
            <span style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--color-text)" }}>
              {foodVoucherRate.toLocaleString("cs-CZ", { minimumFractionDigits: 1 })} Kč / pracovní den
            </span>
            <button className={styles.linkBtn} onClick={() => { setFoodVoucherRateDraft(String(foodVoucherRate)); setShowVoucherConfirm(true); }}>
              Upravit
            </button>
          </div>
          <p style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
            Tato hodnota se násobí počtem odpracovaných dnů v měsíci. Výchozí hodnota: 129,5 Kč/den.
          </p>

          {showVoucherConfirm && (
            <div className={styles.modal}>
              <div className={styles.modalBox} style={{ maxWidth: 400 }}>
                <h2 className={styles.modalTitle}>Změnit sazbu stravenek</h2>
                <div className={styles.field}>
                  <label className={styles.label}>Nová sazba (Kč/den)</label>
                  <input
                    className={styles.input}
                    type="number"
                    step="0.1"
                    value={foodVoucherRateDraft}
                    onChange={(e) => setFoodVoucherRateDraft(e.target.value)}
                    autoFocus
                  />
                </div>
                <p style={{ fontSize: "0.8125rem", color: "var(--color-warning-text)", background: "var(--color-warning-bg)", padding: "0.5rem 0.75rem", borderRadius: 4, marginBottom: "0.75rem" }}>
                  Upozornění: Tato změna ovlivní výpočty všech mzdových období.
                </p>
                <div className={styles.formActions}>
                  <button type="button" className={styles.cancelBtn} onClick={() => setShowVoucherConfirm(false)} disabled={voucherSaving}>
                    Zrušit
                  </button>
                  <button
                    type="button"
                    className={styles.saveBtn}
                    disabled={voucherSaving || !foodVoucherRateDraft || Number(foodVoucherRateDraft) <= 0}
                    onClick={async () => {
                      setVoucherSaving(true);
                      try {
                        await api.patch("/payroll/settings", { foodVoucherRate: Number(foodVoucherRateDraft) });
                        setFoodVoucherRate(Number(foodVoucherRateDraft));
                        setShowVoucherConfirm(false);
                      } catch {
                        // silent
                      } finally {
                        setVoucherSaving(false);
                      }
                    }}
                  >
                    {voucherSaving ? "Ukládám…" : "Uložit"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
