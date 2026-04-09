import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import styles from "./EmployeeDetailPage.module.css";

// ─── Icons ────────────────────────────────────────────────────────────────────

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

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
    <polyline points="6 9 12 15 18 9"/>
  </svg>
);

// ─── SensitiveField ───────────────────────────────────────────────────────────
// apiValue: the raw value from the API response.
//   "••••••••" → data exists, show redacted + reveal button
//   falsy      → no data stored, show "—"

function SensitiveField({
  employeeId,
  field,
  label,
  apiValue,
}: {
  employeeId: string;
  field: string;
  label: string;
  apiValue?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const [displayValue, setDisplayValue] = useState("••••••••");
  const [loading, setLoading] = useState(false);

  async function handleReveal() {
    if (revealed) {
      setDisplayValue("••••••••");
      setRevealed(false);
      return;
    }
    setLoading(true);
    try {
      const res = await api.post<{ value: string }>(`/employees/${employeeId}/reveal`, { field });
      setDisplayValue(res.value);
      setRevealed(true);
    } catch {
      setDisplayValue("Chyba při načítání");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {!apiValue ? (
        <span className={styles.fieldValue}>—</span>
      ) : (
        <span className={styles.fieldValue}>
          {displayValue}
          <button className={styles.revealBtn} onClick={handleReveal} disabled={loading} title={revealed ? "Skrýt" : "Zobrazit"}>
            {revealed ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </span>
      )}
    </div>
  );
}

// ─── Collapsible section ──────────────────────────────────────────────────────

function Section({
  title,
  sectionKey,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  sectionKey: string;
  expanded: boolean;
  onToggle: (key: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.section}>
      <button className={styles.sectionHeader} onClick={() => onToggle(sectionKey)}>
        <span className={styles.sectionTitle}>{title}</span>
        <ChevronIcon open={expanded} />
      </button>
      {expanded && <div className={styles.sectionBody}>{children}</div>}
    </div>
  );
}

// ─── Data interfaces ──────────────────────────────────────────────────────────

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  birthSurname: string;
  birthNumber?: string;
  maritalStatus: string;
  education: string;
  nationality: string;
  placeOfBirth: string;
  status: string;
  currentJobTitle: string;
  currentDepartment: string;
  currentContractType: string;
  currentCompanyId: string | null;
}

interface EmploymentRow {
  id: string;
  companyId: string;
  contractType: string;
  jobTitle: string;
  department: string;
  startDate: string;
  endDate: string | null;
  changeType: string;
  salary?: number;
}

const CHANGE_TYPES = ["nástup", "přeřazení", "změna smlouvy", "ukončení"] as const;
const CONTRACT_TYPES = ["HPP", "DPP", "DPČ"] as const;

interface EmploymentForm {
  changeType: string;
  jobTitle: string;
  department: string;
  contractType: string;
  companyId: string;
  startDate: string;
  endDate: string;
  salary: string;
}

const emptyForm: EmploymentForm = {
  changeType: "nástup",
  jobTitle: "",
  department: "",
  contractType: "",
  companyId: "",
  startDate: "",
  endDate: "",
  salary: "",
};

// ─── Add employment modal ─────────────────────────────────────────────────────

function AddEntryModal({
  onClose,
  onSaved,
  employeeId,
}: {
  onClose: () => void;
  onSaved: (row: EmploymentRow) => void;
  employeeId: string;
}) {
  const [form, setForm] = useState<EmploymentForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(field: keyof EmploymentForm, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.startDate) { setError("Datum nástupu je povinné."); return; }
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        changeType: form.changeType,
        jobTitle: form.jobTitle,
        department: form.department,
        contractType: form.contractType,
        companyId: form.companyId,
        startDate: form.startDate,
        endDate: form.endDate || null,
        salary: form.salary ? Number(form.salary) : null,
        status: form.changeType === "ukončení" ? "inactive" : "active",
      };
      const res = await api.post<{ id: string }>(`/employees/${employeeId}/employment`, payload);
      onSaved({ id: res.id, ...(payload as Omit<EmploymentRow, "id">) } as EmploymentRow);
    } catch (err: unknown) {
      setError((err as Error).message ?? "Chyba při ukládání.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <span className={styles.modalTitle}>Přidat záznam do historie</span>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className={styles.modalBody}>
            <div className={styles.modalGrid}>
              <div className={styles.modalField}>
                <label className={styles.modalLabel}>Typ změny *</label>
                <select className={styles.modalInput} value={form.changeType} onChange={(e) => set("changeType", e.target.value)}>
                  {CHANGE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className={styles.modalField}>
                <label className={styles.modalLabel}>Datum *</label>
                <input className={styles.modalInput} type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} required />
              </div>
              <div className={styles.modalField}>
                <label className={styles.modalLabel}>Pracovní pozice</label>
                <input className={styles.modalInput} value={form.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} />
              </div>
              <div className={styles.modalField}>
                <label className={styles.modalLabel}>Oddělení</label>
                <input className={styles.modalInput} value={form.department} onChange={(e) => set("department", e.target.value)} />
              </div>
              <div className={styles.modalField}>
                <label className={styles.modalLabel}>Typ smlouvy</label>
                <select className={styles.modalInput} value={form.contractType} onChange={(e) => set("contractType", e.target.value)}>
                  <option value="">— vyberte —</option>
                  {CONTRACT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className={styles.modalField}>
                <label className={styles.modalLabel}>Společnost (ID)</label>
                <input className={styles.modalInput} value={form.companyId} onChange={(e) => set("companyId", e.target.value)} placeholder="stp / hpm" />
              </div>
              <div className={styles.modalField}>
                <label className={styles.modalLabel}>Datum ukončení</label>
                <input className={styles.modalInput} type="date" value={form.endDate} onChange={(e) => set("endDate", e.target.value)} />
              </div>
              <div className={styles.modalField}>
                <label className={styles.modalLabel}>Mzda (Kč)</label>
                <input className={styles.modalInput} type="number" value={form.salary} onChange={(e) => set("salary", e.target.value)} placeholder="0" />
              </div>
            </div>
            {error && <p className={styles.modalError}>{error}</p>}
          </div>
          <div className={styles.modalActions}>
            <button type="button" className={styles.modalCancelBtn} onClick={onClose}>Zrušit</button>
            <button type="submit" className={styles.modalSaveBtn} disabled={saving}>
              {saving ? "Ukládám…" : "Uložit"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface ContactData {
  phone?: string;
  email?: string;
  permanentAddress?: string;
  contactAddressSameAsPermanent?: boolean;
  contactAddress?: string;
}

interface DocumentsData {
  idCardNumber?: string;
  idCardExpiry?: string;
  passportNumber?: string;
  passportIssueDate?: string;
  passportExpiry?: string;
  visaNumber?: string;
  visaType?: string;
  visaIssueDate?: string;
  visaExpiry?: string;
}

interface AdditionalData {
  insuranceNumber?: string;
  insuranceCompany?: string;
  bankAccount?: string;
}

interface AlertItem {
  id: string;
  fieldLabel: string;
  expiryDate: string;
  daysUntilExpiry: number;
  status: "expiring" | "expired";
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [employment, setEmployment] = useState<EmploymentRow[]>([]);
  const [contact, setContact] = useState<ContactData | null>(null);
  const [documents, setDocuments] = useState<DocumentsData | null>(null);
  const [additional, setAdditional] = useState<AdditionalData | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<"detail" | "history">("detail");
  const [showModal, setShowModal] = useState(false);

  // Track which sub-sections have been loaded
  const [loadedSections, setLoadedSections] = useState<Set<string>>(new Set());

  // All sections start expanded
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(["personal", "employment", "contact", "documents", "additional"])
  );

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  useEffect(() => {
    if (!id) return;
    Promise.all([
      api.get<Employee>(`/employees/${id}`),
      api.get<EmploymentRow[]>(`/employees/${id}/employment`),
      api.get<AlertItem[]>(`/employees/${id}/alerts`),
    ])
      .then(([emp, history, empAlerts]) => {
        setEmployee(emp);
        setEmployment(history);
        setAlerts(empAlerts);
      })
      .finally(() => setLoading(false));
  }, [id]);

  // Lazy-load sub-sections when first expanded
  useEffect(() => {
    if (!id) return;

    if (expanded.has("contact") && !loadedSections.has("contact")) {
      setLoadedSections((s) => new Set(s).add("contact"));
      api.get<ContactData | null>(`/employees/${id}/contact`).then(setContact).catch(() => {});
    }
    if (expanded.has("documents") && !loadedSections.has("documents")) {
      setLoadedSections((s) => new Set(s).add("documents"));
      api.get<DocumentsData | null>(`/employees/${id}/documents`).then(setDocuments).catch(() => {});
    }
    if (expanded.has("additional") && !loadedSections.has("additional")) {
      setLoadedSections((s) => new Set(s).add("additional"));
      api.get<AdditionalData | null>(`/employees/${id}/benefits`).then(setAdditional).catch(() => {});
    }
  }, [expanded, id, loadedSections]);

  if (loading) return <div className={styles.state}>Načítám…</div>;
  if (!employee) return <div className={styles.state}>Zaměstnanec nenalezen.</div>;

  const val = (v?: string | null) => v || "—";

  return (
    <div>
      <div className={styles.breadcrumb}>
        <Link to="/zamestnanci">Zaměstnanci</Link>
        <span> / </span>
        <span>{employee.lastName} {employee.firstName}</span>
      </div>

      <div className={styles.hero}>
        <div className={styles.heroLeft}>
          <div className={styles.heroName}>{employee.lastName} {employee.firstName}</div>
          <div className={styles.heroMeta}>
            {employee.currentJobTitle || "—"} · {employee.currentDepartment || "—"} ·{" "}
            <span className={employee.status === "active" ? styles.badgeActive : styles.badgeTerminated}>
              {employee.status === "active" ? "Aktivní" : "Ukončen"}
            </span>
          </div>
        </div>
        <button className={styles.editBtn} onClick={() => navigate(`/zamestnanci/${id}/upravit`)}>
          Upravit
        </button>
      </div>

      {alerts.length > 0 && (
        <div className={styles.alertBanner}>
          {alerts.map((a) => (
            <div key={a.id} className={a.status === "expired" ? styles.alertItemExpired : styles.alertItemExpiring}>
              <strong>{a.fieldLabel}</strong>
              {" — "}
              {a.daysUntilExpiry < 0
                ? `Prošlé o ${Math.abs(a.daysUntilExpiry)} dní (${a.expiryDate})`
                : a.daysUntilExpiry === 0
                ? `Vyprší dnes (${a.expiryDate})`
                : `Vyprší za ${a.daysUntilExpiry} dní (${a.expiryDate})`}
            </div>
          ))}
        </div>
      )}

      <div className={styles.tabs}>
        <button className={page === "detail" ? styles.tabActive : styles.tabBtn} onClick={() => setPage("detail")}>Detail</button>
        <button className={page === "history" ? styles.tabActive : styles.tabBtn} onClick={() => setPage("history")}>Historie pracovního poměru</button>
      </div>

      {page === "history" && (
        <>
          <div className={styles.historyHeader}>
            <span className={styles.historyTitle}>Historie pracovního poměru</span>
            <button className={styles.addBtn} onClick={() => setShowModal(true)}>+ Přidat záznam</button>
          </div>
          <div className={styles.section}>
            <div className={styles.sectionBody}>
              {employment.length === 0 ? (
                <p className={styles.loading} style={{ padding: "1rem 0" }}>Žádné záznamy.</p>
              ) : (
                <div className={styles.timeline} style={{ paddingTop: "1rem" }}>
                  {employment.map((row) => (
                    <div key={row.id} className={styles.timelineRow}>
                      <div className={styles.timelineDot} />
                      <div className={styles.timelineContent}>
                        <div className={styles.timelineTitle}>
                          {row.jobTitle || "—"}{row.contractType ? ` · ${row.contractType}` : ""}
                        </div>
                        <div className={styles.timelineMeta}>
                          {row.startDate} — {row.endDate ?? "dosud"}
                          {row.department ? ` · ${row.department}` : ""}
                          {row.salary ? ` · ${row.salary.toLocaleString("cs-CZ")} Kč` : ""}
                        </div>
                        <div className={styles.timelineBottom}>
                          <span className={styles.timelineChange}>{row.changeType}</span>
                          <button className={styles.generateBtn} disabled title="Dostupné ve fázi 4">
                            Generovat smlouvu
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          {showModal && (
            <AddEntryModal
              employeeId={id!}
              onClose={() => setShowModal(false)}
              onSaved={(row) => {
                setEmployment((prev) => [row, ...prev]);
                setShowModal(false);
              }}
            />
          )}
        </>
      )}

      {page === "detail" && (
      <>
      {/* ── Osobní údaje ────────────────────────────────────────────────────── */}
      <Section title="Osobní údaje" sectionKey="personal" expanded={expanded.has("personal")} onToggle={toggle}>
        <div className={styles.fields}>
          <div className={styles.field}><span className={styles.fieldLabel}>Jméno</span><span className={styles.fieldValue}>{employee.firstName} {employee.lastName}</span></div>
          <div className={styles.field}><span className={styles.fieldLabel}>Datum narození</span><span className={styles.fieldValue}>{val(employee.dateOfBirth)}</span></div>
          <div className={styles.field}><span className={styles.fieldLabel}>Pohlaví</span><span className={styles.fieldValue}>{employee.gender === "m" ? "Muž" : employee.gender === "f" ? "Žena" : "—"}</span></div>
          <div className={styles.field}><span className={styles.fieldLabel}>Rodné příjmení</span><span className={styles.fieldValue}>{val(employee.birthSurname)}</span></div>
          <SensitiveField employeeId={id!} field="birthNumber" label="Rodné číslo" apiValue={employee.birthNumber} />
          <div className={styles.field}><span className={styles.fieldLabel}>Rodinný stav</span><span className={styles.fieldValue}>{val(employee.maritalStatus)}</span></div>
          <div className={styles.field}><span className={styles.fieldLabel}>Vzdělání</span><span className={styles.fieldValue}>{val(employee.education)}</span></div>
          <div className={styles.field}><span className={styles.fieldLabel}>Státní příslušnost</span><span className={styles.fieldValue}>{val(employee.nationality)}</span></div>
          <div className={styles.field}><span className={styles.fieldLabel}>Místo narození</span><span className={styles.fieldValue}>{val(employee.placeOfBirth)}</span></div>
        </div>
      </Section>

      {/* ── Pracovní zařazení ────────────────────────────────────────────────── */}
      <Section title="Pracovní zařazení" sectionKey="employment" expanded={expanded.has("employment")} onToggle={toggle}>
        <div className={styles.fields}>
          <div className={styles.field}><span className={styles.fieldLabel}>Pracovní pozice</span><span className={styles.fieldValue}>{val(employee.currentJobTitle)}</span></div>
          <div className={styles.field}><span className={styles.fieldLabel}>Oddělení</span><span className={styles.fieldValue}>{val(employee.currentDepartment)}</span></div>
          <div className={styles.field}><span className={styles.fieldLabel}>Typ smlouvy</span><span className={styles.fieldValue}>{val(employee.currentContractType)}</span></div>
          <div className={styles.field}><span className={styles.fieldLabel}>Společnost</span><span className={styles.fieldValue}>{val(employee.currentCompanyId)}</span></div>
        </div>
      </Section>

      {/* ── Kontakt ─────────────────────────────────────────────────────────── */}
      <Section title="Kontakt" sectionKey="contact" expanded={expanded.has("contact")} onToggle={toggle}>
        {!loadedSections.has("contact") ? (
          <div className={styles.loading}>Načítám…</div>
        ) : (
          <div className={styles.fields}>
            <div className={styles.field}><span className={styles.fieldLabel}>Telefon</span><span className={styles.fieldValue}>{val(contact?.phone)}</span></div>
            <div className={styles.field}><span className={styles.fieldLabel}>E-mail</span><span className={styles.fieldValue}>{val(contact?.email)}</span></div>
            <div className={styles.fieldFull}><span className={styles.fieldLabel}>Trvalá adresa</span><span className={styles.fieldValue}>{val(contact?.permanentAddress)}</span></div>
            <div className={styles.fieldFull}>
              <span className={styles.fieldLabel}>Kontaktní adresa</span>
              <span className={styles.fieldValue}>
                {contact?.contactAddressSameAsPermanent ? "Stejná jako trvalá adresa" : val(contact?.contactAddress)}
              </span>
            </div>
          </div>
        )}
      </Section>

      {/* ── Doklady ─────────────────────────────────────────────────────────── */}
      <Section title="Doklady" sectionKey="documents" expanded={expanded.has("documents")} onToggle={toggle}>
        {!loadedSections.has("documents") ? (
          <div className={styles.loading}>Načítám…</div>
        ) : (
          <>
            <div className={styles.docGroup}>
              <p className={styles.docGroupLabel}>Občanský průkaz</p>
              <div className={styles.fields}>
                <SensitiveField employeeId={id!} field="idCardNumber" label="Číslo OP" apiValue={documents?.idCardNumber} />
                <SensitiveField employeeId={id!} field="idCardExpiry" label="Platnost OP" apiValue={documents?.idCardExpiry} />
              </div>
            </div>
            <div className={styles.docGroup}>
              <p className={styles.docGroupLabel}>Cestovní pas</p>
              <div className={styles.fields}>
                <div className={styles.field}><span className={styles.fieldLabel}>Číslo pasu</span><span className={styles.fieldValue}>{val(documents?.passportNumber)}</span></div>
                <div className={styles.field}><span className={styles.fieldLabel}>Datum vydání</span><span className={styles.fieldValue}>{val(documents?.passportIssueDate)}</span></div>
                <div className={styles.field}><span className={styles.fieldLabel}>Platnost pasu</span><span className={styles.fieldValue}>{val(documents?.passportExpiry)}</span></div>
              </div>
            </div>
            <div className={styles.docGroup}>
              <p className={styles.docGroupLabel}>Povolení k pobytu</p>
              <div className={styles.fields}>
                <div className={styles.field}><span className={styles.fieldLabel}>Číslo povolení</span><span className={styles.fieldValue}>{val(documents?.visaNumber)}</span></div>
                <div className={styles.field}><span className={styles.fieldLabel}>Typ povolení</span><span className={styles.fieldValue}>{val(documents?.visaType)}</span></div>
                <div className={styles.field}><span className={styles.fieldLabel}>Datum vydání</span><span className={styles.fieldValue}>{val(documents?.visaIssueDate)}</span></div>
                <div className={styles.field}><span className={styles.fieldLabel}>Platnost povolení</span><span className={styles.fieldValue}>{val(documents?.visaExpiry)}</span></div>
              </div>
            </div>
          </>
        )}
      </Section>

      {/* ── Doplňující informace ─────────────────────────────────────────────── */}
      <Section title="Doplňující informace" sectionKey="additional" expanded={expanded.has("additional")} onToggle={toggle}>
        {!loadedSections.has("additional") ? (
          <div className={styles.loading}>Načítám…</div>
        ) : (
          <div className={styles.fields}>
            <SensitiveField employeeId={id!} field="insuranceNumber" label="Číslo pojištění" apiValue={additional?.insuranceNumber} />
            <div className={styles.field}><span className={styles.fieldLabel}>Pojišťovna</span><span className={styles.fieldValue}>{val(additional?.insuranceCompany)}</span></div>
            <SensitiveField employeeId={id!} field="bankAccount" label="Číslo bankovního účtu" apiValue={additional?.bankAccount} />
          </div>
        )}
      </Section>
      </>
      )}
    </div>
  );
}
