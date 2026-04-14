import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import ConfirmModal from "@/components/ConfirmModal";
import { formatDateCZ } from "@/lib/dateFormat";
import ContractsTab from "@/components/ContractsTab";
import GenerateContractModal from "@/components/GenerateContractModal";
import {
  ContractType as SmlouvaContractType,
  CONTRACT_TYPE_LABELS,
  CHANGE_TYPE_TO_CONTRACTS,
  CompanyData,
} from "@/lib/contractVariables";
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

interface ChangeRow {
  changeKind: string;
  value: string;
  contractText: string;
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
  workLocation?: string;
  probationPeriod?: string;
  agreedWorkScope?: string;
  agreedReward?: number;
  signingDate?: string;
  changes?: ChangeRow[];
}

const TODAY = new Date().toISOString().split("T")[0];
const END_OF_YEAR = `${new Date().getFullYear()}-12-31`;

const CHANGE_TYPES = ["nástup", "ukončení", "změna smlouvy"] as const;
type ChangeType = typeof CHANGE_TYPES[number];

const CONTRACT_TYPES_NASTUP = ["HPP", "PPP", "DPP"] as const;
type ContractType = typeof CONTRACT_TYPES_NASTUP[number] | "";

const CHANGE_KINDS = ["mzda", "pracovní pozice", "úvazek", "délka smlouvy"] as const;
const UVAZEK_OPTIONS = [
  "plný pracovní úvazek, tj. 40 hod./týdně",
  "poloviční pracovní úvazek, tj. 20 hod./týdně",
] as const;

const emptyChangeRow: ChangeRow = { changeKind: "", value: "", contractText: "" };

interface EmploymentForm {
  changeType: ChangeType;
  startDate: string;
  jobTitle: string;
  contractType: ContractType;
  // HPP / PPP fields
  workLocation: string;
  salary: string;
  probationPeriod: string;
  endDate: string;
  signingDate: string;
  companyId: string;
  // DPP fields
  agreedWorkScope: string;
  agreedReward: string;
  // změna smlouvy fields
  changes: ChangeRow[];
}

const emptyForm: EmploymentForm = {
  changeType: "nástup",
  startDate: "",
  jobTitle: "",
  contractType: "",
  workLocation: "Praha",
  salary: "",
  probationPeriod: "2 měsíce",
  endDate: "",
  signingDate: TODAY,
  companyId: "HPM",
  agreedWorkScope: "max. 300 hodin ročně",
  agreedReward: "",
  changes: [{ ...emptyChangeRow }],
};

// ─── Form initialiser (used for edit pre-fill) ───────────────────────────────

function rowToForm(row: EmploymentRow): EmploymentForm {
  return {
    changeType: (row.changeType as ChangeType) ?? "nástup",
    startDate: row.startDate ?? "",
    jobTitle: row.jobTitle ?? "",
    contractType: (row.contractType as ContractType) ?? "",
    workLocation: row.workLocation ?? "Praha",
    salary: row.salary?.toString() ?? "",
    probationPeriod: row.probationPeriod ?? "2 měsíce",
    endDate: row.endDate ?? "",
    signingDate: row.signingDate ?? TODAY,
    companyId: row.companyId ?? "HPM",
    agreedWorkScope: row.agreedWorkScope ?? "max. 300 hodin ročně",
    agreedReward: row.agreedReward?.toString() ?? "",
    changes: row.changes?.length ? row.changes : [{ ...emptyChangeRow }],
  };
}

// ─── ChangeRowInput ───────────────────────────────────────────────────────────

function ChangeRowInput({
  row,
  index,
  onChange,
  onRemove,
  canRemove,
}: {
  row: ChangeRow;
  index: number;
  onChange: (i: number, field: keyof ChangeRow, value: string) => void;
  onRemove: (i: number) => void;
  canRemove: boolean;
}) {
  return (
    <div className={styles.changeEntry}>
      <div className={styles.changeEntryFields}>
        <select
          className={styles.modalInput}
          value={row.changeKind}
          onChange={(e) => onChange(index, "changeKind", e.target.value)}
        >
          <option value="">— typ změny —</option>
          {CHANGE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>

        {row.changeKind === "mzda" && (
          <input
            className={styles.modalInput}
            type="number"
            placeholder="Nová mzda (Kč)"
            value={row.value}
            onChange={(e) => onChange(index, "value", e.target.value)}
          />
        )}
        {row.changeKind === "pracovní pozice" && (
          <input
            className={styles.modalInput}
            placeholder="Nová pozice"
            value={row.value}
            onChange={(e) => onChange(index, "value", e.target.value)}
          />
        )}
        {row.changeKind === "úvazek" && (
          <select
            className={styles.modalInput}
            value={row.value}
            onChange={(e) => onChange(index, "value", e.target.value)}
          >
            <option value="">— vyberte —</option>
            {UVAZEK_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        )}
        {row.changeKind === "délka smlouvy" && (
          <input
            className={styles.modalInput}
            type="date"
            value={row.value}
            onChange={(e) => onChange(index, "value", e.target.value)}
          />
        )}
        {!row.changeKind && <div style={{ flex: 1 }} />}

        {canRemove && (
          <button type="button" className={styles.removeChangeBtn} onClick={() => onRemove(index)}>✕</button>
        )}
      </div>
      {row.changeKind === "délka smlouvy" && !row.value && (
        <p className={styles.tenureNote}>Prázdné datum = změna na dobu neurčitou</p>
      )}
      <input
        className={styles.modalInput}
        placeholder="Text pro smlouvu"
        value={row.contractText}
        onChange={(e) => onChange(index, "contractText", e.target.value)}
        style={{ marginTop: "0.5rem" }}
      />
    </div>
  );
}

// ─── Add / Edit employment modal ──────────────────────────────────────────────

function AddEntryModal({
  onClose,
  onSaved,
  employeeId,
  employee,
  employment,
  initialRow,
}: {
  onClose: () => void;
  onSaved: (row: EmploymentRow) => void;
  employeeId: string;
  employee: Employee;
  employment: EmploymentRow[];
  initialRow?: EmploymentRow;
}) {
  const isEdit = !!initialRow;
  const [form, setForm] = useState<EmploymentForm>(() =>
    initialRow ? rowToForm(initialRow) : emptyForm
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setField<K extends keyof EmploymentForm>(field: K, value: EmploymentForm[K]) {
    setForm((f) => {
      const next = { ...f, [field]: value };
      if (field === "changeType") {
        next.contractType = "";
        next.startDate = "";
        next.signingDate = TODAY;
        next.changes = [{ ...emptyChangeRow }];
      }
      if (field === "contractType") {
        next.endDate = value === "DPP" ? END_OF_YEAR : "";
      }
      return next;
    });
  }

  function updateChange(i: number, field: keyof ChangeRow, value: string) {
    setForm((f) => ({
      ...f,
      changes: f.changes.map((c, idx) => idx === i ? { ...c, [field]: value } : c),
    }));
  }
  function addChange() {
    setForm((f) => ({ ...f, changes: [...f.changes, { ...emptyChangeRow }] }));
  }
  function removeChange(i: number) {
    setForm((f) => ({ ...f, changes: f.changes.filter((_, idx) => idx !== i) }));
  }

  const hasActiveRow = employment.some(
    (r) => r.changeType !== "ukončení" && r.endDate === null
  );
  const noActiveContract = employee.status !== "active" || !hasActiveRow;
  const showUkonceniWarning = form.changeType === "ukončení" && noActiveContract;
  const showZmenaWarning = form.changeType === "změna smlouvy" && noActiveContract;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.startDate) { setError("Datum je povinné."); return; }
    if (form.changeType === "nástup" && !form.contractType) {
      setError("Vyberte typ smlouvy."); return;
    }
    setSaving(true);
    setError(null);
    try {
      let payload: Record<string, unknown>;
      if (form.changeType === "nástup") {
        const base = {
          changeType: "nástup",
          startDate: form.startDate,
          status: "active",
          jobTitle: form.jobTitle,
          contractType: form.contractType,
          companyId: form.companyId,
          department: "",
          endDate: form.endDate || null,
          signingDate: form.signingDate || null,
        };
        if (form.contractType === "DPP") {
          payload = {
            ...base,
            agreedWorkScope: form.agreedWorkScope,
            agreedReward: form.agreedReward ? Number(form.agreedReward) : null,
          };
        } else {
          payload = {
            ...base,
            workLocation: form.workLocation,
            salary: form.salary ? Number(form.salary) : null,
            probationPeriod: form.probationPeriod,
          };
        }
      } else if (form.changeType === "ukončení") {
        payload = {
          changeType: "ukončení",
          startDate: form.startDate,
          status: "inactive",
          signingDate: form.signingDate || null,
        };
      } else {
        payload = {
          changeType: "změna smlouvy",
          startDate: form.startDate,
          status: "active",
          signingDate: form.signingDate || null,
          changes: form.changes.filter((c) => c.changeKind),
        };
      }
      if (isEdit && initialRow) {
        await api.patch(`/employees/${employeeId}/employment/${initialRow.id}`, payload);
        onSaved({ ...initialRow, ...(payload as Partial<EmploymentRow>) });
      } else {
        const res = await api.post<{ id: string }>(`/employees/${employeeId}/employment`, payload);
        onSaved({ id: res.id, ...(payload as Omit<EmploymentRow, "id">) } as EmploymentRow);
      }
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
          <span className={styles.modalTitle}>{isEdit ? "Upravit záznam" : "Přidat záznam do historie"}</span>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className={styles.modalBody}>

            {/* ── Always visible: typ změny + datum ── */}
            <div className={styles.modalGrid}>
              <div className={styles.modalField}>
                <label className={styles.modalLabel}>Typ změny *</label>
                <select className={styles.modalInput} value={form.changeType} onChange={(e) => setField("changeType", e.target.value as ChangeType)}>
                  {CHANGE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className={styles.modalField}>
                <label className={styles.modalLabel}>Datum *</label>
                <input className={styles.modalInput} type="date" value={form.startDate} onChange={(e) => setField("startDate", e.target.value)} required />
              </div>
            </div>

            {/* ── nástup branch ── */}
            {form.changeType === "nástup" && (
              <>
                <div className={styles.modalGrid} style={{ marginTop: "0.875rem" }}>
                  <div className={styles.modalField}>
                    <label className={styles.modalLabel}>Pracovní pozice</label>
                    <input className={styles.modalInput} value={form.jobTitle} onChange={(e) => setField("jobTitle", e.target.value)} />
                  </div>
                  <div className={styles.modalField}>
                    <label className={styles.modalLabel}>Typ smlouvy *</label>
                    <select className={styles.modalInput} value={form.contractType} onChange={(e) => setField("contractType", e.target.value as ContractType)}>
                      <option value="">— vyberte —</option>
                      {CONTRACT_TYPES_NASTUP.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>

                {/* HPP / PPP sub-branch */}
                {(form.contractType === "HPP" || form.contractType === "PPP") && (
                  <div className={styles.modalGrid} style={{ marginTop: "0.875rem" }}>
                    <div className={styles.modalField}>
                      <label className={styles.modalLabel}>Místo výkonu</label>
                      <input className={styles.modalInput} value={form.workLocation} onChange={(e) => setField("workLocation", e.target.value)} />
                    </div>
                    <div className={styles.modalField}>
                      <label className={styles.modalLabel}>Mzda (Kč)</label>
                      <input className={styles.modalInput} type="number" value={form.salary} onChange={(e) => setField("salary", e.target.value)} placeholder="0" />
                    </div>
                    <div className={styles.modalField}>
                      <label className={styles.modalLabel}>Zkušební doba</label>
                      <input className={styles.modalInput} value={form.probationPeriod} onChange={(e) => setField("probationPeriod", e.target.value)} />
                    </div>
                    <div className={styles.modalField}>
                      <label className={styles.modalLabel}>Konec smlouvy</label>
                      <input className={styles.modalInput} type="date" value={form.endDate} onChange={(e) => setField("endDate", e.target.value)} />
                    </div>
                    <div className={styles.modalField}>
                      <label className={styles.modalLabel}>Datum podpisu</label>
                      <input className={styles.modalInput} type="date" value={form.signingDate} onChange={(e) => setField("signingDate", e.target.value)} />
                    </div>
                    <div className={styles.modalField}>
                      <label className={styles.modalLabel}>Firma</label>
                      <input className={styles.modalInput} value={form.companyId} onChange={(e) => setField("companyId", e.target.value)} />
                    </div>
                  </div>
                )}

                {/* DPP sub-branch */}
                {form.contractType === "DPP" && (
                  <div className={styles.modalGrid} style={{ marginTop: "0.875rem" }}>
                    <div className={styles.modalFieldFull}>
                      <label className={styles.modalLabel}>Sjednaný rozsah práce</label>
                      <input className={styles.modalInput} value={form.agreedWorkScope} onChange={(e) => setField("agreedWorkScope", e.target.value)} />
                    </div>
                    <div className={styles.modalField}>
                      <label className={styles.modalLabel}>Konec smlouvy</label>
                      <input className={styles.modalInput} type="date" value={form.endDate} onChange={(e) => setField("endDate", e.target.value)} />
                    </div>
                    <div className={styles.modalField}>
                      <label className={styles.modalLabel}>Sjednaná odměna (Kč)</label>
                      <input className={styles.modalInput} type="number" value={form.agreedReward} onChange={(e) => setField("agreedReward", e.target.value)} placeholder="0" />
                    </div>
                    <div className={styles.modalField}>
                      <label className={styles.modalLabel}>Datum podpisu</label>
                      <input className={styles.modalInput} type="date" value={form.signingDate} onChange={(e) => setField("signingDate", e.target.value)} />
                    </div>
                    <div className={styles.modalField}>
                      <label className={styles.modalLabel}>Firma</label>
                      <input className={styles.modalInput} value={form.companyId} onChange={(e) => setField("companyId", e.target.value)} />
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── ukončení branch ── */}
            {form.changeType === "ukončení" && (
              <div className={styles.modalGrid} style={{ marginTop: "0.875rem" }}>
                <div className={styles.modalField}>
                  <label className={styles.modalLabel}>Datum podpisu</label>
                  <input className={styles.modalInput} type="date" value={form.signingDate} onChange={(e) => setField("signingDate", e.target.value)} />
                </div>
                {showUkonceniWarning && (
                  <div className={styles.modalFieldFull}>
                    <div className={styles.modalWarning}>
                      Upozornění: zaměstnanec nemá aktivní pracovní poměr, nebo již byl poměr ukončen.
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── změna smlouvy branch ── */}
            {form.changeType === "změna smlouvy" && (
              <>
                <div className={styles.modalGrid} style={{ marginTop: "0.875rem" }}>
                  <div className={styles.modalField}>
                    <label className={styles.modalLabel}>Datum podpisu</label>
                    <input className={styles.modalInput} type="date" value={form.signingDate} onChange={(e) => setField("signingDate", e.target.value)} />
                  </div>
                  {showZmenaWarning && (
                    <div className={styles.modalFieldFull}>
                      <div className={styles.modalWarning}>
                        Upozornění: zaměstnanec nemá aktivní pracovní poměr.
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ marginTop: "0.875rem" }}>
                  <label className={styles.modalLabel}>Změny</label>
                  {form.changes.map((row, i) => (
                    <ChangeRowInput
                      key={i}
                      row={row}
                      index={i}
                      onChange={updateChange}
                      onRemove={removeChange}
                      canRemove={form.changes.length > 1}
                    />
                  ))}
                  {form.changes.length < 5 && (
                    <button type="button" className={styles.addChangeBtn} onClick={addChange}>
                      + Přidat změnu
                    </button>
                  )}
                </div>
              </>
            )}

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

// ─── SalaryDisplay ───────────────────────────────────────────────────────────

function SalaryDisplay({ value }: { value: number }) {
  const [visible, setVisible] = useState(false);
  return (
    <span className={styles.salaryField}>
      {" · "}
      {visible ? `${value.toLocaleString("cs-CZ")} Kč` : "•••••"}
      <button
        className={styles.revealBtn}
        onClick={() => setVisible((v) => !v)}
        title={visible ? "Skrýt mzdu" : "Zobrazit mzdu"}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </span>
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
  passportNumber?: string;
  passportIssueDate?: string;
  passportExpiry?: string;
  passportAuthority?: string;
  visaNumber?: string;
  visaType?: string;
  visaIssueDate?: string;
  visaExpiry?: string;
}

interface AdditionalData {
  insuranceNumber?: string;
  insuranceCompany?: string;
  bankAccount?: string;
  multisport?: boolean;
  homeOffice?: number | null;
  allowances?: boolean;
}

interface AlertItem {
  id: string;
  fieldLabel: string;
  expiryDate: string;
  daysUntilExpiry: number;
  status: "expiring" | "expired";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getContractTypesForRow(row: EmploymentRow): SmlouvaContractType[] {
  if (row.changeType === "nástup") {
    const map: Record<string, SmlouvaContractType> = {
      HPP: "nastup_hpp",
      PPP: "nastup_ppp",
      DPP: "nastup_dpp",
    };
    return row.contractType && map[row.contractType] ? [map[row.contractType]] : [];
  }
  return (CHANGE_TYPE_TO_CONTRACTS[row.changeType] ?? []) as SmlouvaContractType[];
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { role } = useAuth();
  const canDelete = role === "admin" || role === "director";

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [employment, setEmployment] = useState<EmploymentRow[]>([]);
  const [contact, setContact] = useState<ContactData | null>(null);
  const [documents, setDocuments] = useState<DocumentsData | null>(null);
  const [additional, setAdditional] = useState<AdditionalData | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<"detail" | "history" | "smlouvy">("detail");
  const [showModal, setShowModal] = useState(false);
  const [editingRow, setEditingRow] = useState<EmploymentRow | null>(null);
  const [generateModal, setGenerateModal] = useState<{
    row: EmploymentRow;
    contractType: SmlouvaContractType;
  } | null>(null);
  const [postSaveBanner, setPostSaveBanner] = useState<{
    row: EmploymentRow;
    types: SmlouvaContractType[];
  } | null>(null);
  const [generateDropdownRowId, setGenerateDropdownRowId] = useState<string | null>(null);
  const [company, setCompany] = useState<CompanyData | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
    onCancel?: () => void;
  } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Track which sub-sections have been loaded
  const [loadedSections, setLoadedSections] = useState<Set<string>>(new Set());

  // All sections start expanded
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(["personal", "employment", "contact", "documents", "additional", "benefity"])
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
    if ((expanded.has("additional") || expanded.has("benefity")) && !loadedSections.has("additional")) {
      setLoadedSections((s) => new Set(s).add("additional"));
      api.get<AdditionalData | null>(`/employees/${id}/benefits`).then(setAdditional).catch(() => {});
    }
  }, [expanded, id, loadedSections]);

  // Load contact, documents, and company when smlouvy tab is opened
  useEffect(() => {
    if (page !== "smlouvy" || !id) return;
    if (!loadedSections.has("contact")) {
      setLoadedSections((s) => new Set(s).add("contact"));
      api.get<ContactData | null>(`/employees/${id}/contact`).then(setContact).catch(() => {});
    }
    if (!loadedSections.has("documents")) {
      setLoadedSections((s) => new Set(s).add("documents"));
      api.get<DocumentsData | null>(`/employees/${id}/documents`).then(setDocuments).catch(() => {});
    }
    if (!loadedSections.has("company") && employee?.currentCompanyId) {
      setLoadedSections((s) => new Set(s).add("company"));
      api.get<CompanyData>(`/companies/${employee.currentCompanyId}`).then(setCompany).catch(() => {});
    }
  }, [page, id, loadedSections, employee]);

  async function handleDeleteEmployee() {
    if (!employee || !id) return;
    setDeleteLoading(true);
    type LinkedUser = { uid: string; email: string; name: string };
    let linkedUser: LinkedUser | null = null;
    try {
      linkedUser = await api.get<LinkedUser | null>(`/employees/${id}/linked-user`);
    } catch { /* ignore */ }
    setDeleteLoading(false);

    const executeDelete = (deleteUser: boolean) => {
      api.delete(`/employees/${id}?deleteUser=${deleteUser}`)
        .then(() => navigate("/zamestnanci"))
        .catch((e: Error) => alert(e.message));
    };

    // Step 1: confirm employee deletion
    setConfirmModal({
      title: "Smazat zaměstnance",
      message: `Opravdu chcete smazat ${employee.lastName} ${employee.firstName}? Tato akce je nevratná.`,
      confirmLabel: "Smazat zaměstnance",
      danger: true,
      onConfirm: () => {
        setConfirmModal(null);
        if (linkedUser) {
          // Step 2: ask about linked user account
          setConfirmModal({
            title: "Propojený uživatelský účet",
            message: `Zaměstnanec je propojen s účtem ${linkedUser.email}. Smazat i tento uživatelský účet? Kliknutím na „Ponechat" účet zachováte a pouze ho odpojíte.`,
            confirmLabel: "Smazat i účet",
            cancelLabel: "Ponechat účet",
            danger: true,
            onConfirm: () => { setConfirmModal(null); executeDelete(true); },
            onCancel:  () => { setConfirmModal(null); executeDelete(false); },
          });
        } else {
          executeDelete(false);
        }
      },
    });
  }

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
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className={styles.editBtn} onClick={() => navigate(`/zamestnanci/${id}/upravit`)}>
            Upravit
          </button>
          {canDelete && (
            <button
              className={styles.deleteBtn}
              onClick={handleDeleteEmployee}
              disabled={deleteLoading}
            >
              {deleteLoading ? "…" : "Smazat"}
            </button>
          )}
        </div>
      </div>

      {alerts.length > 0 && (
        <div className={styles.alertBanner}>
          {alerts.map((a) => (
            <div key={a.id} className={a.status === "expired" ? styles.alertItemExpired : styles.alertItemExpiring}>
              <strong>{a.fieldLabel}</strong>
              {" — "}
              {a.daysUntilExpiry < 0
                ? `Prošlé o ${Math.abs(a.daysUntilExpiry)} dní (${formatDateCZ(a.expiryDate)})`
                : a.daysUntilExpiry === 0
                ? `Vyprší dnes (${formatDateCZ(a.expiryDate)})`
                : `Vyprší za ${a.daysUntilExpiry} dní (${formatDateCZ(a.expiryDate)})`}
            </div>
          ))}
        </div>
      )}

      <div className={styles.tabs}>
        <button className={page === "detail" ? styles.tabActive : styles.tabBtn} onClick={() => setPage("detail")}>Detail</button>
        <button className={page === "history" ? styles.tabActive : styles.tabBtn} onClick={() => setPage("history")}>Historie pracovního poměru</button>
        <button className={page === "smlouvy" ? styles.tabActive : styles.tabBtn} onClick={() => setPage("smlouvy")}>Smlouvy</button>
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
                          {formatDateCZ(row.startDate)} — {row.endDate ? formatDateCZ(row.endDate) : "dosud"}
                          {row.department ? ` · ${row.department}` : ""}
                          {(row.salary ?? row.agreedReward) != null && (
                            <SalaryDisplay value={(row.salary ?? row.agreedReward)!} />
                          )}
                        </div>
                        <div className={styles.timelineBottom}>
                          <span className={styles.timelineChange}>{row.changeType}</span>
                          <div className={styles.timelineActions}>
                            <button className={styles.editRowBtn} onClick={() => setEditingRow(row)}>
                              Upravit
                            </button>
                            {(() => {
                              const types = getContractTypesForRow(row);
                              if (types.length === 0) return null;
                              if (types.length === 1) {
                                return (
                                  <button
                                    className={styles.generateBtn}
                                    onClick={() => setGenerateModal({ row, contractType: types[0] })}
                                  >
                                    Generovat smlouvu
                                  </button>
                                );
                              }
                              return (
                                <div className={styles.generateDropdown}>
                                  <button
                                    className={styles.generateBtn}
                                    onClick={() => setGenerateDropdownRowId(
                                      generateDropdownRowId === row.id ? null : row.id
                                    )}
                                  >
                                    Generovat smlouvu ▾
                                  </button>
                                  {generateDropdownRowId === row.id && (
                                    <div className={styles.generateDropdownMenu}>
                                      {types.map((t) => (
                                        <button
                                          key={t}
                                          className={styles.generateDropdownItem}
                                          onClick={() => {
                                            setGenerateDropdownRowId(null);
                                            setGenerateModal({ row, contractType: t });
                                          }}
                                        >
                                          {CONTRACT_TYPE_LABELS[t]}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
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
              employee={employee}
              employment={employment}
              onClose={() => setShowModal(false)}
              onSaved={(row) => {
                setEmployment((prev) => [row, ...prev]);
                setShowModal(false);
                const types = getContractTypesForRow(row);
                if (types.length > 0) setPostSaveBanner({ row, types });
              }}
            />
          )}
          {editingRow && (
            <AddEntryModal
              employeeId={id!}
              employee={employee}
              employment={employment}
              initialRow={editingRow}
              onClose={() => setEditingRow(null)}
              onSaved={(updated) => {
                setEmployment((prev) =>
                  prev.map((r) => (r.id === updated.id ? updated : r))
                );
                setEditingRow(null);
              }}
            />
          )}
        </>
      )}

      {page === "smlouvy" && (
        <ContractsTab
          employeeId={id!}
          employeeData={{
            id: employee.id,
            firstName: employee.firstName,
            lastName: employee.lastName,
            currentJobTitle: employee.currentJobTitle,
            currentDepartment: employee.currentDepartment,
            currentCompanyId: employee.currentCompanyId ?? undefined,
            address: contact?.permanentAddress,
          }}
          companyData={company ?? {}}
        />
      )}

      {page === "detail" && (
      <>
      {/* ── Osobní údaje ────────────────────────────────────────────────────── */}
      <Section title="Osobní údaje" sectionKey="personal" expanded={expanded.has("personal")} onToggle={toggle}>
        <div className={styles.fields}>
          <div className={styles.field}><span className={styles.fieldLabel}>Jméno</span><span className={styles.fieldValue}>{employee.firstName} {employee.lastName}</span></div>
          <div className={styles.field}><span className={styles.fieldLabel}>Datum narození</span><span className={styles.fieldValue}>{val(formatDateCZ(employee.dateOfBirth))}</span></div>
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
            {!contact?.contactAddressSameAsPermanent && (
              <div className={styles.fieldFull}>
                <span className={styles.fieldLabel}>Kontaktní adresa</span>
                <span className={styles.fieldValue}>{val(contact?.contactAddress)}</span>
              </div>
            )}
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
              </div>
            </div>
            <div className={styles.docGroup}>
              <p className={styles.docGroupLabel}>Cestovní pas</p>
              <div className={styles.fields}>
                <div className={styles.field}><span className={styles.fieldLabel}>Číslo pasu</span><span className={styles.fieldValue}>{val(documents?.passportNumber)}</span></div>
                <div className={styles.field}><span className={styles.fieldLabel}>Datum vydání</span><span className={styles.fieldValue}>{val(formatDateCZ(documents?.passportIssueDate))}</span></div>
                <div className={styles.field}><span className={styles.fieldLabel}>Platnost pasu</span><span className={styles.fieldValue}>{val(formatDateCZ(documents?.passportExpiry))}</span></div>
                <div className={styles.field}><span className={styles.fieldLabel}>Vydal</span><span className={styles.fieldValue}>{val(documents?.passportAuthority)}</span></div>
              </div>
            </div>
            <div className={styles.docGroup}>
              <p className={styles.docGroupLabel}>Povolení k pobytu</p>
              <div className={styles.fields}>
                <div className={styles.field}><span className={styles.fieldLabel}>Číslo povolení</span><span className={styles.fieldValue}>{val(documents?.visaNumber)}</span></div>
                <div className={styles.field}><span className={styles.fieldLabel}>Typ povolení</span><span className={styles.fieldValue}>{val(documents?.visaType)}</span></div>
                <div className={styles.field}><span className={styles.fieldLabel}>Datum vydání</span><span className={styles.fieldValue}>{val(formatDateCZ(documents?.visaIssueDate))}</span></div>
                <div className={styles.field}><span className={styles.fieldLabel}>Platnost povolení</span><span className={styles.fieldValue}>{val(formatDateCZ(documents?.visaExpiry))}</span></div>
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

      {/* ── Benefity ─────────────────────────────────────────────────────────── */}
      <Section title="Benefity" sectionKey="benefity" expanded={expanded.has("benefity")} onToggle={toggle}>
        {!loadedSections.has("additional") ? (
          <div className={styles.loading}>Načítám…</div>
        ) : (
          <div className={styles.fields}>
            <div className={styles.field}><span className={styles.fieldLabel}>Multisport</span><span className={styles.fieldValue}>{additional?.multisport === true ? "Ano" : additional?.multisport === false ? "Ne" : "—"}</span></div>
            <div className={styles.field}><span className={styles.fieldLabel}>Home office</span><span className={styles.fieldValue}>{additional?.homeOffice != null ? String(additional.homeOffice) : "—"}</span></div>
            <div className={styles.field}><span className={styles.fieldLabel}>Náhrady</span><span className={styles.fieldValue}>{additional?.allowances === true ? "Ano" : additional?.allowances === false ? "Ne" : "—"}</span></div>
          </div>
        )}
      </Section>
      </>
      )}

      {postSaveBanner && (
        <div className={styles.postSaveBanner}>
          <span>Záznam byl uložen. Chcete vygenerovat smlouvu?</span>
          <div className={styles.postSaveBannerActions}>
            {postSaveBanner.types.map((t) => (
              <button
                key={t}
                className={styles.postSaveBannerBtn}
                onClick={() => {
                  setGenerateModal({ row: postSaveBanner.row, contractType: t });
                  setPostSaveBanner(null);
                }}
              >
                {CONTRACT_TYPE_LABELS[t]}
              </button>
            ))}
            <button className={styles.postSaveBannerDismiss} onClick={() => setPostSaveBanner(null)}>✕</button>
          </div>
        </div>
      )}

      {generateModal && (
        <GenerateContractModal
          employeeId={id!}
          contractType={generateModal.contractType}
          employmentRowId={generateModal.row.id}
          employeeData={{
            id: employee.id,
            firstName: employee.firstName,
            lastName: employee.lastName,
            currentJobTitle: generateModal.row.jobTitle || employee.currentJobTitle,
            currentDepartment: employee.currentDepartment,
            currentCompanyId: employee.currentCompanyId ?? undefined,
            address: contact?.permanentAddress,
            contractType: generateModal.row.contractType,
            salary: generateModal.row.salary,
            startDate: generateModal.row.startDate,
            endDate: generateModal.row.endDate ?? undefined,
          }}
          companyData={company ?? {}}
          onClose={() => setGenerateModal(null)}
          onGenerated={() => {
            setGenerateModal(null);
            setPage("smlouvy");
          }}
        />
      )}

      {confirmModal && (
        <ConfirmModal
          title={confirmModal.title}
          message={confirmModal.message}
          confirmLabel={confirmModal.confirmLabel}
          cancelLabel={confirmModal.cancelLabel}
          danger={confirmModal.danger}
          onConfirm={confirmModal.onConfirm}
          onCancel={confirmModal.onCancel ?? (() => setConfirmModal(null))}
        />
      )}
    </div>
  );
}
