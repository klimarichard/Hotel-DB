import { useState, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth, UserRole } from "@/hooks/useAuth";
import { authApi, UserProfile, api, ApiError } from "@/lib/api";
import { employeeSurnameFirst } from "@/lib/employeeName";
import Button from "@/components/Button";
import ConfirmModal from "@/components/ConfirmModal";
import MenuOrderTab from "./settings/MenuOrderTab";
import UserTypesTab from "./settings/UserTypesTab";
import UserPermissionsModal from "@/components/UserPermissionsModal";
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

function SalaryCell({ value, suffix = "Kč" }: { value: number | null | undefined; suffix?: string }) {
  const [visible, setVisible] = useState(false);
  if (value == null) return <>—</>;
  return (
    <span className={styles.salaryCell}>
      {visible ? `${value.toLocaleString("cs-CZ")} ${suffix}` : "•••••"}
      <button
        type="button"
        className={styles.revealBtn}
        onClick={() => setVisible((v) => !v)}
        title={visible ? "Skrýt hodnotu" : "Zobrazit hodnotu"}
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
  displayName?: string;
}

interface CompanyRecord {
  id: string;
  abbreviation: string;
  name: string;
  address: string;
  ic: string;
  dic: string;
  fileNo: string;
  displayOrder?: number;
}

interface DepartmentRecord {
  id: string;
  name: string;
  displayOrder: number;
}

interface EducationLevelRecord {
  id: string;
  name: string;
  code: string;
  displayOrder: number;
}

interface JobPositionRecord {
  id: string;
  name: string;
  departmentId: string;
  defaultSalary: number;
  hourlyRate?: number | null;
  clothingAllowance?: number | null;
  homeOfficeAllowance?: number | null;
  displayOrder: number;
}

interface PosCascadePreview {
  fieldChange: { hourlyRate: { from: number | null; to: number | null } };
  affectedEmployees: Array<{
    id: string;
    firstName: string;
    lastName: string;
    displayName?: string;
    currentHourlyRate: number | null;
    isManualOverride: boolean;
  }>;
  affectedUnlockedPayrolls: Array<{ id: string; year: number; month: number }>;
}

const DEFAULT_COMPANY_IDS = ["HPM", "STP"];

const ROLES: UserRole[] = ["admin", "director", "manager", "employee", "accountant", "hr"];

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  director: "Ředitel",
  manager: "FOM",
  employee: "Zaměstnanec",
  accountant: "Účetní",
  hr: "Personalista",
};

const emptyForm = { name: "", email: "", password: "", role: "employee" as UserRole, employeeId: "" };

export default function SettingsPage() {
  const { can, loading: authLoading } = useAuth();

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

  // Edit-user (name/email) state
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [permsUser, setPermsUser] = useState<UserProfile | null>(null);
  const [editForm, setEditForm] = useState({ name: "", email: "" });
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [confirmEmailChange, setConfirmEmailChange] = useState(false);

  // Create-without-password: reset link to surface after creation
  const [resetLinkInfo, setResetLinkInfo] = useState<{ email: string; link: string | null } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Reactivation prompt when a new user's email belongs to an inactive account
  const [reactivatePrompt, setReactivatePrompt] = useState<UserProfile | null>(null);

  // Employee link state
  const [employees, setEmployees] = useState<EmployeeSummary[]>([]);
  const [linkingUid, setLinkingUid] = useState<string | null>(null);
  const [linkEmployeeId, setLinkEmployeeId] = useState<string>("");
  const [linkSaving, setLinkSaving] = useState(false);

  const [settingsTab, setSettingsTab] = useState<"users" | "companies" | "departments" | "jobPositions" | "education" | "payroll" | "menu" | "userTypes">("users");

  // Departments
  const [departments, setDepartments] = useState<DepartmentRecord[]>([]);
  const [depEditId, setDepEditId] = useState<string | null>(null);
  const [depEditName, setDepEditName] = useState("");
  const [depNewName, setDepNewName] = useState("");
  const [showDepCreate, setShowDepCreate] = useState(false);
  const [depError, setDepError] = useState<string | null>(null);
  const [depDeleteId, setDepDeleteId] = useState<string | null>(null);
  const [depSort, setDepSort] = useState<{ col: "name"; dir: "asc" | "desc" }>({ col: "name", dir: "asc" });

  // Education levels
  const [educationLevels, setEducationLevels] = useState<EducationLevelRecord[]>([]);
  const [eduEditId, setEduEditId] = useState<string | null>(null);
  const [eduEditName, setEduEditName] = useState("");
  const [eduEditCode, setEduEditCode] = useState("");
  const [eduNewName, setEduNewName] = useState("");
  const [eduNewCode, setEduNewCode] = useState("");
  const [showEduCreate, setShowEduCreate] = useState(false);
  const [eduError, setEduError] = useState<string | null>(null);
  const [eduDeleteId, setEduDeleteId] = useState<string | null>(null);
  const [eduSort, setEduSort] = useState<{ col: "name" | "code"; dir: "asc" | "desc" }>({ col: "name", dir: "asc" });

  // Job positions
  const [positions, setPositions] = useState<JobPositionRecord[]>([]);
  const [posSort, setPosSort] = useState<{ col: "name" | "department"; dir: "asc" | "desc" }>({ col: "name", dir: "asc" });
  const [posEditId, setPosEditId] = useState<string | null>(null);
  const [posForm, setPosForm] = useState<{ name: string; departmentId: string; defaultSalary: string; hourlyRate: string; clothingAllowance: string; homeOfficeAllowance: string }>({ name: "", departmentId: "", defaultSalary: "", hourlyRate: "", clothingAllowance: "", homeOfficeAllowance: "" });
  const [posCascade, setPosCascade] = useState<PosCascadePreview | null>(null);
  const [posCascadeSaving, setPosCascadeSaving] = useState(false);
  const [posDeleteId, setPosDeleteId] = useState<string | null>(null);

  // Payroll settings
  const [foodVoucherRate, setFoodVoucherRate] = useState<number>(129.5);
  const [foodVoucherRateDraft, setFoodVoucherRateDraft] = useState<string>("");
  const [showVoucherConfirm, setShowVoucherConfirm] = useState(false);
  const [voucherSaving, setVoucherSaving] = useState(false);
  const [dppMaxMonthlyReward, setDppMaxMonthlyReward] = useState<number>(11999);
  const [dppMaxMonthlyRewardDraft, setDppMaxMonthlyRewardDraft] = useState<string>("");
  const [showDppMaxConfirm, setShowDppMaxConfirm] = useState(false);
  const [dppMaxSaving, setDppMaxSaving] = useState(false);
  const [minimumWage, setMinimumWage] = useState<number>(22400);
  const [minimumWageDraft, setMinimumWageDraft] = useState<string>("");
  const [showMinWageConfirm, setShowMinWageConfirm] = useState(false);
  const [minWageSaving, setMinWageSaving] = useState(false);
  const [multisportBasePrice, setMultisportBasePrice] = useState<number>(470);
  const [multisportBasePriceDraft, setMultisportBasePriceDraft] = useState<string>("");
  const [showMultisportConfirm, setShowMultisportConfirm] = useState(false);
  const [multisportSaving, setMultisportSaving] = useState(false);
  const [showPosCreate, setShowPosCreate] = useState(false);

  // Companies
  const [companyForms, setCompanyForms] = useState<Record<string, CompanyRecord>>({});
  const [companyEditId, setCompanyEditId] = useState<string | null>(null);
  const [companySaving, setCompanySaving] = useState<Record<string, boolean>>({});
  const [companySaveMsg, setCompanySaveMsg] = useState<Record<string, string>>({});
  const [companyCreateOpen, setCompanyCreateOpen] = useState(false);
  const [companyCreateForm, setCompanyCreateForm] = useState<{ abbreviation: string; name: string; address: string; ic: string; dic: string; fileNo: string }>({ abbreviation: "", name: "", address: "", ic: "", dic: "", fileNo: "" });
  const [companyDeleteId, setCompanyDeleteId] = useState<string | null>(null);
  const [companyError, setCompanyError] = useState<string | null>(null);

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

  const loadCompanies = useCallback(async () => {
    const fallback = () => {
      const map: Record<string, CompanyRecord> = {};
      for (const id of DEFAULT_COMPANY_IDS) map[id] = { id, abbreviation: id, name: "", address: "", ic: "", dic: "", fileNo: "" };
      setCompanyForms(map);
    };
    try {
      const list = await api.get<CompanyRecord[]>("/companies");
      // Seed safety net: only when the collection is completely empty do we show
      // the two default companies as unsaved placeholders, so a fresh DB isn't
      // blank. When companies exist, deletes stick — we never resurrect them.
      if (list.length === 0) { fallback(); return; }
      const map: Record<string, CompanyRecord> = {};
      for (const c of list) map[c.id] = { ...c, abbreviation: c.abbreviation || c.id };
      setCompanyForms(map);
    } catch {
      fallback();
    }
  }, []);

  useEffect(() => { loadCompanies(); }, [loadCompanies]);

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

  const loadEducationLevels = useCallback(async () => {
    try {
      const list = await api.get<EducationLevelRecord[]>("/educationLevels");
      setEducationLevels(list);
    } catch {
      setEducationLevels([]);
    }
  }, []);

  useEffect(() => { loadDepartments(); loadPositions(); loadEducationLevels(); }, [loadDepartments, loadPositions, loadEducationLevels]);

  useEffect(() => {
    api.get<{ foodVoucherRate: number; dppMaxMonthlyReward: number; minimumWage: number; multisportBasePrice: number }>("/payroll/settings")
      .then((s) => {
        setFoodVoucherRate(s.foodVoucherRate);
        setFoodVoucherRateDraft(String(s.foodVoucherRate));
        setDppMaxMonthlyReward(s.dppMaxMonthlyReward);
        setDppMaxMonthlyRewardDraft(String(s.dppMaxMonthlyReward));
        setMinimumWage(s.minimumWage);
        setMinimumWageDraft(String(s.minimumWage));
        setMultisportBasePrice(s.multisportBasePrice);
        setMultisportBasePriceDraft(String(s.multisportBasePrice));
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
      setShowDepCreate(false);
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

  async function confirmDeleteDepartment() {
    if (!depDeleteId) return;
    const id = depDeleteId;
    setDepDeleteId(null);
    setDepError(null);
    try {
      await api.delete(`/departments/${id}`);
      await loadDepartments();
    } catch (e: unknown) {
      setDepError((e as Error).message ?? "Nelze smazat oddělení.");
    }
  }

  async function handleCreateEducation() {
    const name = eduNewName.trim();
    const code = eduNewCode.trim();
    if (!name || !code) return;
    setEduError(null);
    try {
      await api.post("/educationLevels", { name, code, displayOrder: educationLevels.length });
      setEduNewName("");
      setEduNewCode("");
      setShowEduCreate(false);
      await loadEducationLevels();
    } catch (e: unknown) {
      setEduError((e as Error).message ?? "Chyba při vytváření.");
    }
  }

  async function handleSaveEducation(id: string) {
    const name = eduEditName.trim();
    const code = eduEditCode.trim();
    if (!name || !code) return;
    setEduError(null);
    try {
      await api.patch(`/educationLevels/${id}`, { name, code });
      setEduEditId(null);
      setEduEditName("");
      setEduEditCode("");
      await loadEducationLevels();
    } catch (e: unknown) {
      setEduError((e as Error).message ?? "Chyba při ukládání.");
    }
  }

  async function confirmDeleteEducation() {
    if (!eduDeleteId) return;
    const id = eduDeleteId;
    setEduDeleteId(null);
    setEduError(null);
    try {
      await api.delete(`/educationLevels/${id}`);
      await loadEducationLevels();
    } catch (e: unknown) {
      setEduError((e as Error).message ?? "Nelze smazat.");
    }
  }

  function openCreatePosition() {
    setPosEditId(null);
    setPosForm({ name: "", departmentId: departments[0]?.id ?? "", defaultSalary: "", hourlyRate: "", clothingAllowance: "", homeOfficeAllowance: "" });
    setShowPosCreate(true);
  }

  function openEditPosition(p: JobPositionRecord) {
    setPosEditId(p.id);
    setPosForm({
      name: p.name,
      departmentId: p.departmentId,
      defaultSalary: String(p.defaultSalary ?? ""),
      hourlyRate: p.hourlyRate != null ? String(p.hourlyRate) : "",
      clothingAllowance: p.clothingAllowance != null ? String(p.clothingAllowance) : "",
      homeOfficeAllowance: p.homeOfficeAllowance != null ? String(p.homeOfficeAllowance) : "",
    });
    setShowPosCreate(true);
  }

  async function handleSavePosition(confirmCascade = false) {
    if (!posForm.name.trim() || !posForm.departmentId) return;
    const payload = {
      name: posForm.name.trim(),
      departmentId: posForm.departmentId,
      defaultSalary: Number(posForm.defaultSalary) || 0,
      hourlyRate: posForm.hourlyRate.trim() ? Number(posForm.hourlyRate) : null,
      clothingAllowance: posForm.clothingAllowance.trim() ? Number(posForm.clothingAllowance) : null,
      homeOfficeAllowance: posForm.homeOfficeAllowance.trim() ? Number(posForm.homeOfficeAllowance) : null,
    };
    try {
      if (posEditId) {
        await api.patch(`/jobPositions/${posEditId}`, { ...payload, confirmCascade });
      } else {
        await api.post("/jobPositions", { ...payload, displayOrder: positions.length });
      }
      setShowPosCreate(false);
      setPosEditId(null);
      setPosCascade(null);
      await loadPositions();
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 409
        && err.body && typeof err.body === "object"
        && (err.body as { requiresConfirmation?: boolean }).requiresConfirmation) {
        setPosCascade(err.body as PosCascadePreview);
      }
      // else: silent
    }
  }

  async function handleConfirmPosCascade() {
    setPosCascadeSaving(true);
    try {
      await handleSavePosition(true);
    } finally {
      setPosCascadeSaving(false);
    }
  }

  async function confirmDeletePosition() {
    if (!posDeleteId) return;
    const id = posDeleteId;
    setPosDeleteId(null);
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
      const { abbreviation, name, address, ic, dic, fileNo } = companyForms[id];
      if (!abbreviation || !abbreviation.trim()) {
        setCompanySaveMsg((p) => ({ ...p, [id]: "Zkratka je povinná" }));
        return;
      }
      await api.put(`/companies/${id}`, { abbreviation: abbreviation.trim(), name, address, ic, dic, fileNo });
      setCompanyEditId(null);
      await loadCompanies();
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

  async function handleCreateCompany() {
    const abbreviation = companyCreateForm.abbreviation.trim();
    if (!abbreviation) { setCompanyError("Zkratka je povinná."); return; }
    setCompanyError(null);
    try {
      await api.post("/companies", {
        ...companyCreateForm,
        abbreviation,
        displayOrder: Object.keys(companyForms).length,
      });
      setCompanyCreateOpen(false);
      setCompanyCreateForm({ abbreviation: "", name: "", address: "", ic: "", dic: "", fileNo: "" });
      await loadCompanies();
    } catch (e: unknown) {
      setCompanyError((e as Error).message ?? "Chyba při vytváření.");
    }
  }

  async function confirmDeleteCompany() {
    if (!companyDeleteId) return;
    const id = companyDeleteId;
    setCompanyDeleteId(null);
    try {
      await api.delete(`/companies/${id}`);
      await loadCompanies();
    } catch (e: unknown) {
      setCompanyError((e as Error).message ?? "Nelze smazat společnost.");
    }
  }

  if (authLoading) return null;
  if (!can("nav.settings.view")) return <Navigate to="/" replace />;

  function toggleDepSort(col: "name") {
    setDepSort((s) => ({ col, dir: s.col === col && s.dir === "asc" ? "desc" : "asc" }));
  }

  function toggleEduSort(col: "name" | "code") {
    setEduSort((s) => ({ col, dir: s.col === col && s.dir === "asc" ? "desc" : "asc" }));
  }

  function togglePosSort(col: "name" | "department") {
    setPosSort((s) => ({ col, dir: s.col === col && s.dir === "asc" ? "desc" : "asc" }));
  }

  const sortedDepartments = [...departments].sort((a, b) => {
    const cmp = a.name.localeCompare(b.name, "cs");
    return depSort.dir === "asc" ? cmp : -cmp;
  });

  const sortedEducationLevels = [...educationLevels].sort((a, b) => {
    const av = eduSort.col === "code" ? a.code : a.name;
    const bv = eduSort.col === "code" ? b.code : b.name;
    const cmp = (av ?? "").localeCompare(bv ?? "", "cs");
    return eduSort.dir === "asc" ? cmp : -cmp;
  });

  const sortedPositions = [...positions].sort((a, b) => {
    let cmp = 0;
    if (posSort.col === "name") {
      cmp = a.name.localeCompare(b.name, "cs");
    } else {
      const depA = departments.find((d) => d.id === a.departmentId)?.name ?? "";
      const depB = departments.find((d) => d.id === b.departmentId)?.name ?? "";
      cmp = depA.localeCompare(depB, "cs");
    }
    return posSort.dir === "asc" ? cmp : -cmp;
  });

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

    // If the e-mail belongs to an existing INACTIVE account, offer to reactivate
    // it instead of failing on the (Auth-level) duplicate-email conflict.
    const emailLc = form.email.trim().toLowerCase();
    const inactiveMatch = users.find(
      (u) => !u.active && (u.email ?? "").toLowerCase() === emailLc
    );
    if (inactiveMatch) {
      setReactivatePrompt(inactiveMatch);
      return;
    }

    setSaving(true);
    try {
      const createdWithoutPassword = !form.password;
      const email = form.email.trim();
      const res = await authApi.createUser({
        name: form.name,
        email,
        password: form.password || undefined,
        role: form.role,
        employeeId: form.employeeId || undefined,
      });
      setShowCreate(false);
      setForm(emptyForm);
      await loadUsers();
      if (createdWithoutPassword) {
        // Also e-mail the reset link (reusing the existing client mechanism), and
        // surface the link so the admin can copy/send it manually too.
        try { await sendPasswordResetEmail(auth, email); } catch { /* still show link */ }
        setResetLinkInfo({ email, link: res.resetLink });
        setCopiedLink(false);
      }
    } catch (e: unknown) {
      setFormError((e as Error).message ?? "Chyba při vytváření uživatele.");
    } finally {
      setSaving(false);
    }
  }

  // Reactivate an inactive account whose e-mail the admin just re-entered, and
  // apply the name/role/employee they typed into the create form.
  async function handleReactivateExisting() {
    if (!reactivatePrompt) return;
    const target = reactivatePrompt;
    setReactivatePrompt(null);
    setSaving(true);
    setFormError(null);
    try {
      await authApi.reactivateUser(target.uid);
      const ops: Promise<unknown>[] = [];
      if (form.name && form.name !== target.name) ops.push(authApi.updateUser(target.uid, { name: form.name }));
      if (form.role && form.role !== target.role) ops.push(authApi.setRole(target.uid, form.role));
      const newEmp = form.employeeId || null;
      if (newEmp !== (target.employeeId ?? null)) ops.push(authApi.linkEmployee(target.uid, newEmp));
      await Promise.all(ops);
      setShowCreate(false);
      setForm(emptyForm);
      await loadUsers();
    } catch (e: unknown) {
      setFormError((e as Error).message ?? "Chyba při reaktivaci uživatele.");
    } finally {
      setSaving(false);
    }
  }

  function openEditUser(u: UserProfile) {
    setEditingUser(u);
    setEditForm({ name: u.name ?? "", email: u.email ?? "" });
    setEditError(null);
    setConfirmEmailChange(false);
  }

  // "Uložit" in the edit modal: if the e-mail changed, route through a warning
  // ConfirmModal first (it changes the user's login); otherwise save directly.
  function attemptSaveEdit() {
    if (!editingUser) return;
    const emailChanged = !!editForm.email.trim() && editForm.email.trim() !== editingUser.email;
    if (emailChanged) { setConfirmEmailChange(true); return; }
    void doSaveEdit();
  }

  async function doSaveEdit() {
    if (!editingUser) return;
    setConfirmEmailChange(false);
    setEditSaving(true);
    setEditError(null);
    try {
      await authApi.updateUser(editingUser.uid, {
        name: editForm.name.trim() || undefined,
        email: editForm.email.trim() || undefined,
      });
      setEditingUser(null);
      await loadUsers();
    } catch (e: unknown) {
      setEditError((e as Error).message ?? "Chyba při ukládání.");
    } finally {
      setEditSaving(false);
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

  // Active users first (by name), then inactive ones at the bottom (#22).
  const sortedUsers = [...users].sort((a, b) => {
    if (!!a.active !== !!b.active) return a.active ? -1 : 1;
    return (a.name ?? "").localeCompare(b.name ?? "", "cs");
  });

  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.title}>Nastavení</h1>
        {settingsTab === "users" && (
          <Button variant="primary" onClick={() => { setShowCreate(true); setFormError(null); }}>
            + Přidat uživatele
          </Button>
        )}
        {settingsTab === "jobPositions" && (
          <Button variant="primary" onClick={openCreatePosition} disabled={departments.length === 0}>
            + Přidat pozici
          </Button>
        )}
        {settingsTab === "departments" && (
          <Button variant="primary" onClick={() => { setDepNewName(""); setDepError(null); setShowDepCreate(true); }}>
            + Přidat oddělení
          </Button>
        )}
        {settingsTab === "education" && (
          <Button variant="primary" onClick={() => { setEduNewName(""); setEduError(null); setShowEduCreate(true); }}>
            + Přidat vzdělání
          </Button>
        )}
      </div>

      <div className={styles.tabs}>
        <button className={settingsTab === "users" ? styles.tabActive : styles.tabBtn} onClick={() => setSettingsTab("users")}>Uživatelé</button>
        <button className={settingsTab === "companies" ? styles.tabActive : styles.tabBtn} onClick={() => setSettingsTab("companies")}>Společnosti</button>
        <button className={settingsTab === "departments" ? styles.tabActive : styles.tabBtn} onClick={() => setSettingsTab("departments")}>Oddělení</button>
        <button className={settingsTab === "jobPositions" ? styles.tabActive : styles.tabBtn} onClick={() => setSettingsTab("jobPositions")}>Pracovní pozice</button>
        <button className={settingsTab === "education" ? styles.tabActive : styles.tabBtn} onClick={() => setSettingsTab("education")}>Vzdělání</button>
        <button className={settingsTab === "payroll" ? styles.tabActive : styles.tabBtn} onClick={() => setSettingsTab("payroll")}>Mzdy</button>
        <button className={settingsTab === "menu" ? styles.tabActive : styles.tabBtn} onClick={() => setSettingsTab("menu")}>Menu</button>
        {can("userTypes.manage") && (
          <button className={settingsTab === "userTypes" ? styles.tabActive : styles.tabBtn} onClick={() => setSettingsTab("userTypes")}>Uživatelské typy</button>
        )}
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
                <label className={styles.label}>Heslo (volitelné)</label>
                <input
                  className={styles.input}
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  minLength={8}
                  autoComplete="new-password"
                />
                <p className={styles.fieldHint}>
                  Alespoň 8 znaků, malé i velké písmeno a číslici. Nechte prázdné —
                  uživateli se odešle odkaz pro nastavení vlastního hesla.
                </p>
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
                      {employeeSurnameFirst(emp)}
                    </option>
                  ))}
                </select>
              </div>
              {formError && <p className={styles.formError}>{formError}</p>}
              <div className={styles.formActions}>
                <Button
                  variant="secondary"
                  onClick={() => { setShowCreate(false); setForm(emptyForm); }}
                >
                  Zrušit
                </Button>
                <Button type="submit" variant="primary" disabled={saving}>
                  {saving ? "Ukládám…" : "Vytvořit"}
                </Button>
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
                    {employeeSurnameFirst(emp)}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.formActions}>
              <Button variant="secondary" onClick={() => setLinkingUid(null)}>
                Zrušit
              </Button>
              <Button variant="primary" onClick={handleLinkEmployee} disabled={linkSaving}>
                {linkSaving ? "Ukládám…" : "Uložit"}
              </Button>
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
                {sortedUsers.length === 0 && (
                  <tr><td colSpan={6} className={styles.empty}>Žádní uživatelé</td></tr>
                )}
                {sortedUsers.map((u) => {
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
                          {linkedEmp ? employeeSurnameFirst(linkedEmp) : "—"}
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
                          className={styles.linkBtn}
                          onClick={() => openEditUser(u)}
                          title="Upravit jméno a e-mail"
                        >
                          Upravit
                        </button>
                        {" "}
                        {(can("users.permissions.manage") || can("users.setType")) && (
                          <>
                            <button
                              className={styles.linkBtn}
                              onClick={() => setPermsUser(u)}
                              title="Typ uživatele a individuální oprávnění"
                            >
                              Oprávnění
                            </button>
                            {" "}
                          </>
                        )}
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
        <>
          {companyError && <p className={styles.errorState}>{companyError}</p>}
          <div style={{ marginBottom: "1rem" }}>
            <Button
              variant="primary"
              onClick={() => {
                setCompanyError(null);
                setCompanyCreateForm({ abbreviation: "", name: "", address: "", ic: "", dic: "", fileNo: "" });
                setCompanyCreateOpen(true);
              }}
            >
              + Nová společnost
            </Button>
          </div>
          <div className={styles.companyList}>
          {Object.values(companyForms).map((c) => {
            const isEditing = companyEditId === c.id;
            return (
              <div key={c.id} className={styles.companyCard}>
                <div className={styles.companyId}>
                  {isEditing
                    ? <input className={styles.input} value={c.abbreviation} onChange={(e) => setCompanyField(c.id, "abbreviation", e.target.value)} placeholder="Zkratka" />
                    : (c.abbreviation || c.id)}
                </div>
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
                  <div className={styles.field}>
                    <label className={styles.label}>Spisová značka</label>
                    {isEditing
                      ? <input className={styles.input} value={c.fileNo} onChange={(e) => setCompanyField(c.id, "fileNo", e.target.value)} placeholder="např. C 12345 vedená u MS v Praze" />
                      : <span className={styles.companyValue}>{c.fileNo || "—"}</span>}
                  </div>
                </div>
                <div className={styles.companyActions}>
                  {companySaveMsg[c.id] && (
                    <span className={styles.saveMsgErr}>{companySaveMsg[c.id]}</span>
                  )}
                  {isEditing ? (
                    <>
                      <Button variant="secondary" onClick={() => { setCompanyEditId(null); loadCompanies(); }} disabled={companySaving[c.id]}>
                        Zrušit
                      </Button>
                      <Button variant="primary" onClick={() => handleSaveCompany(c.id)} disabled={companySaving[c.id]}>
                        {companySaving[c.id] ? "Ukládám…" : "Uložit"}
                      </Button>
                    </>
                  ) : (
                    <>
                      <button className={styles.editBtn} onClick={() => setCompanyEditId(c.id)}>
                        Upravit
                      </button>
                      <button className={styles.deactivateBtn} onClick={() => setCompanyDeleteId(c.id)}>
                        Smazat
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          </div>
          {companyCreateOpen && (
            <div className={styles.modal}>
              <div className={styles.modalBox}>
                <h2 className={styles.modalTitle}>Nová společnost</h2>
                <div className={styles.field}>
                  <label className={styles.label}>Zkratka</label>
                  <input className={styles.input} value={companyCreateForm.abbreviation} onChange={(e) => setCompanyCreateForm({ ...companyCreateForm, abbreviation: e.target.value })} autoFocus />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Název</label>
                  <input className={styles.input} value={companyCreateForm.name} onChange={(e) => setCompanyCreateForm({ ...companyCreateForm, name: e.target.value })} />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Adresa</label>
                  <input className={styles.input} value={companyCreateForm.address} onChange={(e) => setCompanyCreateForm({ ...companyCreateForm, address: e.target.value })} />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>IČO</label>
                  <input className={styles.input} value={companyCreateForm.ic} onChange={(e) => setCompanyCreateForm({ ...companyCreateForm, ic: e.target.value })} />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>DIČ</label>
                  <input className={styles.input} value={companyCreateForm.dic} onChange={(e) => setCompanyCreateForm({ ...companyCreateForm, dic: e.target.value })} />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Spisová značka</label>
                  <input className={styles.input} value={companyCreateForm.fileNo} onChange={(e) => setCompanyCreateForm({ ...companyCreateForm, fileNo: e.target.value })} placeholder="např. C 12345 vedená u MS v Praze" />
                </div>
                <div className={styles.formActions}>
                  <Button variant="secondary" onClick={() => setCompanyCreateOpen(false)}>Zrušit</Button>
                  <Button variant="primary" onClick={handleCreateCompany}>Vytvořit</Button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {settingsTab === "departments" && (
        <>
          {depError && <p className={styles.errorState}>{depError}</p>}
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.sortableHeader} onClick={() => toggleDepSort("name")}>
                  Název {depSort.col === "name" ? (depSort.dir === "asc" ? "▲" : "▼") : "⇅"}
                </th>
                <th>Akce</th>
              </tr>
            </thead>
            <tbody>
              {sortedDepartments.length === 0 && (
                <tr><td colSpan={2} className={styles.empty}>Žádná oddělení</td></tr>
              )}
              {sortedDepartments.map((d) => (
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
                    <div className={styles.rowActions}>
                      {depEditId === d.id ? (
                        <>
                          <Button variant="primary" size="sm" onClick={() => handleSaveDepartment(d.id)}>Uložit</Button>
                          <Button variant="secondary" size="sm" onClick={() => { setDepEditId(null); setDepEditName(""); }}>Zrušit</Button>
                        </>
                      ) : (
                        <>
                          <button className={styles.linkBtn} onClick={() => { setDepEditId(d.id); setDepEditName(d.name); }}>Upravit</button>
                          <button className={styles.deactivateBtn} onClick={() => setDepDeleteId(d.id)}>Smazat</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {showDepCreate && (
            <div className={styles.modal}>
              <div className={styles.modalBox}>
                <h2 className={styles.modalTitle}>Nové oddělení</h2>
                <div className={styles.field}>
                  <label className={styles.label}>Název</label>
                  <input
                    className={styles.input}
                    value={depNewName}
                    onChange={(e) => setDepNewName(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter") handleCreateDepartment(); }}
                  />
                </div>
                {depError && <p className={styles.formError}>{depError}</p>}
                <div className={styles.formActions}>
                  <Button variant="secondary" onClick={() => { setShowDepCreate(false); setDepNewName(""); }}>
                    Zrušit
                  </Button>
                  <Button variant="primary" onClick={handleCreateDepartment} disabled={!depNewName.trim()}>
                    Uložit
                  </Button>
                </div>
              </div>
            </div>
          )}
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
                <div className={styles.field}>
                  <label className={styles.label}>Náhrady - oblečení (Kč/hod, nepovinné)</label>
                  <input
                    className={styles.input}
                    type="number"
                    value={posForm.clothingAllowance}
                    onChange={(e) => setPosForm({ ...posForm, clothingAllowance: e.target.value })}
                    placeholder="—"
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Náhrady - HO (Kč/hod, nepovinné)</label>
                  <input
                    className={styles.input}
                    type="number"
                    value={posForm.homeOfficeAllowance}
                    onChange={(e) => setPosForm({ ...posForm, homeOfficeAllowance: e.target.value })}
                    placeholder="—"
                  />
                </div>
                <div className={styles.formActions}>
                  <Button variant="secondary" onClick={() => { setShowPosCreate(false); setPosEditId(null); }}>Zrušit</Button>
                  <Button variant="primary" onClick={() => handleSavePosition(false)}>Uložit</Button>
                </div>
              </div>
            </div>
          )}
          {posCascade && (
            <div className={styles.modal}>
              <div className={styles.modalBox} style={{ maxWidth: "640px" }}>
                <h2 className={styles.modalTitle}>Změna hodinové sazby</h2>
                <p style={{ margin: "0 0 0.75rem", fontSize: "0.875rem" }}>
                  Hodinová sazba pozice se mění z{" "}
                  <strong>{posCascade.fieldChange.hourlyRate.from ?? "—"}</strong>{" "}
                  na <strong>{posCascade.fieldChange.hourlyRate.to ?? "—"}</strong> Kč/hod.
                  Tato změna se promítne do aktivních pracovních záznamů následujících zaměstnanců:
                </p>
                <div style={{ maxHeight: "240px", overflowY: "auto", marginBottom: "0.75rem", border: "1px solid #e5e7eb", borderRadius: "4px" }}>
                  <table className={styles.table} style={{ margin: 0 }}>
                    <thead>
                      <tr>
                        <th>Zaměstnanec</th>
                        <th>Aktuální sazba</th>
                        <th>Upozornění</th>
                      </tr>
                    </thead>
                    <tbody>
                      {posCascade.affectedEmployees.map((e) => (
                        <tr key={e.id}>
                          <td>{employeeSurnameFirst(e)}</td>
                          <td>{e.currentHourlyRate ?? "—"}</td>
                          <td>
                            {e.isManualOverride && (
                              <span style={{ display: "inline-block", padding: "0 6px", background: "#fef3c7", color: "#92400e", borderRadius: "3px", fontSize: "0.75rem", fontWeight: 600 }}>
                                ručně upraveno
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {posCascade.affectedUnlockedPayrolls.length > 0 && (
                  <div style={{ padding: "0.5rem 0.75rem", background: "#fef9c3", border: "1px solid #fde047", borderRadius: "4px", marginBottom: "0.75rem", fontSize: "0.8125rem", color: "#713f12" }}>
                    <strong>Pozor:</strong> Tato změna ovlivní následující neuzamčené mzdové období(a). Po uložení spusťte v daném období „Přepočítat":
                    <ul style={{ margin: "0.25rem 0 0", paddingLeft: "1.25rem" }}>
                      {posCascade.affectedUnlockedPayrolls.map((p) => (
                        <li key={p.id}>{String(p.month).padStart(2, "0")}/{p.year}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className={styles.formActions}>
                  <Button variant="secondary" disabled={posCascadeSaving} onClick={() => setPosCascade(null)}>Zrušit</Button>
                  <Button variant="primary" disabled={posCascadeSaving} onClick={handleConfirmPosCascade}>
                    {posCascadeSaving ? "Ukládám…" : "Potvrdit a přepsat"}
                  </Button>
                </div>
              </div>
            </div>
          )}
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.sortableHeader} onClick={() => togglePosSort("name")}>
                  Název {posSort.col === "name" ? (posSort.dir === "asc" ? "▲" : "▼") : "⇅"}
                </th>
                <th className={styles.sortableHeader} onClick={() => togglePosSort("department")}>
                  Oddělení {posSort.col === "department" ? (posSort.dir === "asc" ? "▲" : "▼") : "⇅"}
                </th>
                <th>Výchozí mzda</th>
                <th>Hodinová sazba</th>
                <th>Náhrady - oblečení</th>
                <th>Náhrady - HO</th>
                <th>Akce</th>
              </tr>
            </thead>
            <tbody>
              {sortedPositions.length === 0 && (
                <tr><td colSpan={7} className={styles.empty}>Žádné pozice</td></tr>
              )}
              {sortedPositions.map((p) => {
                const dep = departments.find((d) => d.id === p.departmentId);
                return (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{dep?.name ?? "—"}</td>
                    <td><SalaryCell value={p.defaultSalary} /></td>
                    <td><SalaryCell value={p.hourlyRate ?? null} /></td>
                    <td><SalaryCell value={p.clothingAllowance ?? null} suffix="Kč/h" /></td>
                    <td><SalaryCell value={p.homeOfficeAllowance ?? null} suffix="Kč/h" /></td>
                    <td>
                      <div className={styles.rowActions}>
                        <button className={styles.linkBtn} onClick={() => openEditPosition(p)}>Upravit</button>
                        <button className={styles.deactivateBtn} onClick={() => setPosDeleteId(p.id)}>Smazat</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {settingsTab === "education" && (
        <>
          {eduError && <p className={styles.errorState}>{eduError}</p>}
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.sortableHeader} onClick={() => toggleEduSort("name")}>
                  Název {eduSort.col === "name" ? (eduSort.dir === "asc" ? "▲" : "▼") : "⇅"}
                </th>
                <th className={styles.sortableHeader} onClick={() => toggleEduSort("code")}>
                  Kód {eduSort.col === "code" ? (eduSort.dir === "asc" ? "▲" : "▼") : "⇅"}
                </th>
                <th>Akce</th>
              </tr>
            </thead>
            <tbody>
              {sortedEducationLevels.length === 0 && (
                <tr><td colSpan={3} className={styles.empty}>Žádná vzdělání</td></tr>
              )}
              {sortedEducationLevels.map((e) => (
                <tr key={e.id}>
                  <td>
                    {eduEditId === e.id ? (
                      <input
                        className={styles.input}
                        value={eduEditName}
                        onChange={(ev) => setEduEditName(ev.target.value)}
                      />
                    ) : (
                      e.name
                    )}
                  </td>
                  <td>
                    {eduEditId === e.id ? (
                      <input
                        className={styles.input}
                        value={eduEditCode}
                        onChange={(ev) => setEduEditCode(ev.target.value)}
                        style={{ maxWidth: 80 }}
                      />
                    ) : (
                      e.code ?? ""
                    )}
                  </td>
                  <td>
                    <div className={styles.rowActions}>
                      {eduEditId === e.id ? (
                        <>
                          <Button variant="primary" size="sm" onClick={() => handleSaveEducation(e.id)}>Uložit</Button>
                          <Button variant="secondary" size="sm" onClick={() => { setEduEditId(null); setEduEditName(""); setEduEditCode(""); }}>Zrušit</Button>
                        </>
                      ) : (
                        <>
                          <button className={styles.linkBtn} onClick={() => { setEduEditId(e.id); setEduEditName(e.name); setEduEditCode(e.code ?? ""); }}>Upravit</button>
                          <button className={styles.deactivateBtn} onClick={() => setEduDeleteId(e.id)}>Smazat</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {showEduCreate && (
            <div className={styles.modal}>
              <div className={styles.modalBox}>
                <h2 className={styles.modalTitle}>Nové vzdělání</h2>
                <div className={styles.field}>
                  <label className={styles.label}>Kód</label>
                  <input
                    className={styles.input}
                    value={eduNewCode}
                    onChange={(e) => setEduNewCode(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Název</label>
                  <input
                    className={styles.input}
                    value={eduNewName}
                    onChange={(e) => setEduNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleCreateEducation(); }}
                  />
                </div>
                {eduError && <p className={styles.formError}>{eduError}</p>}
                <div className={styles.formActions}>
                  <Button variant="secondary" onClick={() => { setShowEduCreate(false); setEduNewName(""); setEduNewCode(""); }}>
                    Zrušit
                  </Button>
                  <Button variant="primary" onClick={handleCreateEducation} disabled={!eduNewName.trim() || !eduNewCode.trim()}>
                    Uložit
                  </Button>
                </div>
              </div>
            </div>
          )}
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

          <h2 style={{ fontSize: "0.95rem", fontWeight: 600, color: "var(--color-text-heading)", marginTop: "2rem", marginBottom: "1rem" }}>
            Maximální měsíční odměna DPP
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "0.5rem" }}>
            <span style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--color-text)" }}>
              {dppMaxMonthlyReward.toLocaleString("cs-CZ")} Kč / měsíc
            </span>
            <button className={styles.linkBtn} onClick={() => { setDppMaxMonthlyRewardDraft(String(dppMaxMonthlyReward)); setShowDppMaxConfirm(true); }}>
              Upravit
            </button>
          </div>
          <p style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
            Limit pro automatický výpočet sjednané odměny u DPP smluv. Výchozí hodnota: 11 999 Kč/měsíc.
          </p>

          <h2 style={{ fontSize: "0.95rem", fontWeight: 600, color: "var(--color-text-heading)", marginTop: "2rem", marginBottom: "1rem" }}>
            Minimální mzda
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "0.5rem" }}>
            <span style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--color-text)" }}>
              {minimumWage.toLocaleString("cs-CZ")} Kč / měsíc
            </span>
            <button className={styles.linkBtn} onClick={() => { setMinimumWageDraft(String(minimumWage)); setShowMinWageConfirm(true); }}>
              Upravit
            </button>
          </div>
          <p style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
            Aktuální zákonná minimální měsíční mzda. Výchozí hodnota: 22 400 Kč/měsíc.
          </p>

          {showMinWageConfirm && (
            <div className={styles.modal}>
              <div className={styles.modalBox} style={{ maxWidth: 400 }}>
                <h2 className={styles.modalTitle}>Změnit minimální mzdu</h2>
                <div className={styles.field}>
                  <label className={styles.label}>Nová hodnota (Kč/měsíc)</label>
                  <input
                    className={styles.input}
                    type="number"
                    step="100"
                    value={minimumWageDraft}
                    onChange={(e) => setMinimumWageDraft(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className={styles.formActions}>
                  <Button variant="secondary" onClick={() => setShowMinWageConfirm(false)} disabled={minWageSaving}>
                    Zrušit
                  </Button>
                  <Button
                    variant="primary"
                    disabled={minWageSaving || !minimumWageDraft || Number(minimumWageDraft) <= 0}
                    onClick={async () => {
                      setMinWageSaving(true);
                      try {
                        await api.patch("/payroll/settings", { minimumWage: Number(minimumWageDraft) });
                        setMinimumWage(Number(minimumWageDraft));
                        setShowMinWageConfirm(false);
                      } catch {
                        // silent
                      } finally {
                        setMinWageSaving(false);
                      }
                    }}
                  >
                    {minWageSaving ? "Ukládám…" : "Uložit"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          <h2 style={{ fontSize: "0.95rem", fontWeight: 600, color: "var(--color-text-heading)", marginTop: "2rem", marginBottom: "1rem" }}>
            Základní cena Multisport
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "0.5rem" }}>
            <span style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--color-text)" }}>
              {multisportBasePrice.toLocaleString("cs-CZ")} Kč / měsíc
            </span>
            <button className={styles.linkBtn} onClick={() => { setMultisportBasePriceDraft(String(multisportBasePrice)); setShowMultisportConfirm(true); }}>
              Upravit
            </button>
          </div>
          <p style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
            Základní měsíční cena Multisport karty. Výchozí hodnota: 470 Kč/měsíc.
          </p>

          {showMultisportConfirm && (
            <div className={styles.modal}>
              <div className={styles.modalBox} style={{ maxWidth: 400 }}>
                <h2 className={styles.modalTitle}>Změnit základní cenu Multisport</h2>
                <div className={styles.field}>
                  <label className={styles.label}>Základní cena Multisport (Kč/měsíc)</label>
                  <input
                    className={styles.input}
                    type="number"
                    step="10"
                    value={multisportBasePriceDraft}
                    onChange={(e) => setMultisportBasePriceDraft(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className={styles.formActions}>
                  <Button variant="secondary" onClick={() => setShowMultisportConfirm(false)} disabled={multisportSaving}>
                    Zrušit
                  </Button>
                  <Button
                    variant="primary"
                    disabled={multisportSaving || !multisportBasePriceDraft || Number(multisportBasePriceDraft) <= 0}
                    onClick={async () => {
                      setMultisportSaving(true);
                      try {
                        await api.patch("/payroll/settings", { multisportBasePrice: Number(multisportBasePriceDraft) });
                        setMultisportBasePrice(Number(multisportBasePriceDraft));
                        setShowMultisportConfirm(false);
                      } catch {
                        // silent
                      } finally {
                        setMultisportSaving(false);
                      }
                    }}
                  >
                    {multisportSaving ? "Ukládám…" : "Uložit"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {showDppMaxConfirm && (
            <div className={styles.modal}>
              <div className={styles.modalBox} style={{ maxWidth: 400 }}>
                <h2 className={styles.modalTitle}>Změnit maximální měsíční odměnu DPP</h2>
                <div className={styles.field}>
                  <label className={styles.label}>Nová hodnota (Kč/měsíc)</label>
                  <input
                    className={styles.input}
                    type="number"
                    step="100"
                    value={dppMaxMonthlyRewardDraft}
                    onChange={(e) => setDppMaxMonthlyRewardDraft(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className={styles.formActions}>
                  <Button variant="secondary" onClick={() => setShowDppMaxConfirm(false)} disabled={dppMaxSaving}>
                    Zrušit
                  </Button>
                  <Button
                    variant="primary"
                    disabled={dppMaxSaving || !dppMaxMonthlyRewardDraft || Number(dppMaxMonthlyRewardDraft) <= 0}
                    onClick={async () => {
                      setDppMaxSaving(true);
                      try {
                        await api.patch("/payroll/settings", { dppMaxMonthlyReward: Number(dppMaxMonthlyRewardDraft) });
                        setDppMaxMonthlyReward(Number(dppMaxMonthlyRewardDraft));
                        setShowDppMaxConfirm(false);
                      } catch {
                        // silent
                      } finally {
                        setDppMaxSaving(false);
                      }
                    }}
                  >
                    {dppMaxSaving ? "Ukládám…" : "Uložit"}
                  </Button>
                </div>
              </div>
            </div>
          )}

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
                <p style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)", background: "var(--color-surface-3)", padding: "0.5rem 0.75rem", borderRadius: 4, marginBottom: "0.75rem" }}>
                  Nová sazba se použije pouze pro nově vytvořená mzdová období. Dříve vypočtená období si ponechají svou původní sazbu.
                </p>
                <div className={styles.formActions}>
                  <Button variant="secondary" onClick={() => setShowVoucherConfirm(false)} disabled={voucherSaving}>
                    Zrušit
                  </Button>
                  <Button
                    variant="primary"
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
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {settingsTab === "menu" && <MenuOrderTab />}
      {settingsTab === "userTypes" && <UserTypesTab />}

      {depDeleteId && (
        <ConfirmModal
          title="Smazat oddělení"
          message="Opravdu smazat toto oddělení? Tato akce je nevratná."
          confirmLabel="Smazat"
          danger
          onConfirm={confirmDeleteDepartment}
          onCancel={() => setDepDeleteId(null)}
        />
      )}

      {posDeleteId && (
        <ConfirmModal
          title="Smazat pozici"
          message="Opravdu smazat tuto pozici? Tato akce je nevratná."
          confirmLabel="Smazat"
          danger
          onConfirm={confirmDeletePosition}
          onCancel={() => setPosDeleteId(null)}
        />
      )}

      {eduDeleteId && (
        <ConfirmModal
          title="Smazat vzdělání"
          message="Opravdu smazat tuto úroveň vzdělání? Tato akce je nevratná."
          confirmLabel="Smazat"
          danger
          onConfirm={confirmDeleteEducation}
          onCancel={() => setEduDeleteId(null)}
        />
      )}

      {companyDeleteId && (
        <ConfirmModal
          title="Smazat společnost"
          message="Opravdu smazat tuto společnost? Tato akce je nevratná. Již vygenerované smlouvy zůstanou nezměněné."
          confirmLabel="Smazat"
          danger
          onConfirm={confirmDeleteCompany}
          onCancel={() => setCompanyDeleteId(null)}
        />
      )}

      {editingUser && (
        <div className={styles.modal}>
          <div className={styles.modalBox}>
            <h2 className={styles.modalTitle}>Upravit uživatele</h2>
            <div className={styles.field}>
              <label className={styles.label}>Jméno</label>
              <input
                className={styles.input}
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                autoFocus
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>E-mail</label>
              <input
                className={styles.input}
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
              />
              {!!editForm.email.trim() && editForm.email.trim() !== editingUser.email && (
                <p className={styles.fieldHint}>
                  ⚠ Změna e-mailu změní přihlašovací údaje uživatele — bude se přihlašovat novým e-mailem.
                </p>
              )}
            </div>
            {editError && <p className={styles.formError}>{editError}</p>}
            <div className={styles.formActions}>
              <Button variant="secondary" onClick={() => setEditingUser(null)} disabled={editSaving}>
                Zrušit
              </Button>
              <Button
                variant="primary"
                onClick={attemptSaveEdit}
                disabled={editSaving || (!editForm.name.trim() && !editForm.email.trim())}
              >
                {editSaving ? "Ukládám…" : "Uložit"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {resetLinkInfo && (
        <div className={styles.modal}>
          <div className={styles.modalBox}>
            <h2 className={styles.modalTitle}>Uživatel vytvořen bez hesla</h2>
            <p className={styles.fieldHint}>
              Uživateli {resetLinkInfo.email} byl odeslán e-mail s odkazem pro nastavení hesla.
              {resetLinkInfo.link ? " Odkaz můžete také zkopírovat a poslat ručně:" : ""}
            </p>
            {resetLinkInfo.link && (
              <div className={styles.field}>
                <input
                  className={styles.input}
                  readOnly
                  value={resetLinkInfo.link}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button
                  variant="secondary"
                  onClick={async () => {
                    try { await navigator.clipboard.writeText(resetLinkInfo.link!); setCopiedLink(true); } catch { /* clipboard unavailable */ }
                  }}
                >
                  {copiedLink ? "Zkopírováno ✓" : "Kopírovat odkaz"}
                </Button>
              </div>
            )}
            <div className={styles.formActions}>
              <Button variant="primary" onClick={() => setResetLinkInfo(null)}>Zavřít</Button>
            </div>
          </div>
        </div>
      )}

      {reactivatePrompt && (
        <ConfirmModal
          title="Reaktivovat uživatele?"
          message={`E-mail ${reactivatePrompt.email} patří deaktivovanému uživateli „${reactivatePrompt.name}". Chcete tento účet znovu aktivovat a použít zadané jméno, roli a propojení se zaměstnancem?`}
          confirmLabel="Reaktivovat"
          onConfirm={handleReactivateExisting}
          onCancel={() => setReactivatePrompt(null)}
        />
      )}

      {confirmEmailChange && (
        <ConfirmModal
          title="Změnit e-mail?"
          message="Změnou e-mailu se změní přihlašovací údaje uživatele — od této chvíle se přihlašuje novým e-mailem. Pokračovat?"
          confirmLabel="Změnit e-mail"
          danger
          onConfirm={doSaveEdit}
          onCancel={() => setConfirmEmailChange(false)}
        />
      )}

      {permsUser && (
        <UserPermissionsModal
          user={permsUser}
          onClose={() => setPermsUser(null)}
          onSaved={loadUsers}
        />
      )}
    </div>
  );
}
