import { useState, useEffect, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import ConfirmModal from "@/components/ConfirmModal";
import { formatDateCZ } from "@/lib/dateFormat";
import { displayGendered } from "@/lib/genderDisplay";
import GenerateContractModal from "@/components/GenerateContractModal";
import Button from "@/components/Button";
import EmploymentSessionCard from "@/components/EmploymentSession";
import AdhocContractsSection from "@/components/AdhocContractsSection";
import {
  ContractType as SmlouvaContractType,
  CONTRACT_TYPE_LABELS,
  STANDALONE_TYPES,
} from "@/lib/contractVariables";
import { buildContractName } from "@/lib/contractNaming";
import {
  groupBySession,
  mapContractsToRows,
  expectedContractTypesForRow,
} from "@/lib/employmentSessions";
import modalStyles from "@/components/ConfirmModal.module.css";
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

// ─── Employee history (audit log) ─────────────────────────────────────────────

interface AuditEntryMini {
  id: string;
  action: string;
  collection: string;
  fieldPath?: string;
  redacted?: boolean;
  oldValue?: unknown;
  newValue?: unknown;
  userEmail?: string;
  timestamp?: { _seconds?: number; seconds?: number } | string | null;
}

function tsToDate(ts: AuditEntryMini["timestamp"]): Date | null {
  if (!ts) return null;
  if (typeof ts === "string") {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  }
  const seconds = ts._seconds ?? ts.seconds;
  if (typeof seconds === "number") return new Date(seconds * 1000);
  return null;
}

function formatAuditTs(ts: AuditEntryMini["timestamp"]): string {
  const d = tsToDate(ts);
  if (!d) return "—";
  return d.toLocaleString("cs-CZ", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function compactValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v.length > 40 ? v.slice(0, 37) + "…" : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    const s = JSON.stringify(v);
    return s.length > 40 ? s.slice(0, 37) + "…" : s;
  } catch {
    return "[object]";
  }
}

function EmployeeAuditHistory({ employeeId }: { employeeId: string }) {
  const [entries, setEntries] = useState<AuditEntryMini[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ entries: AuditEntryMini[] }>(
        `/audit?employeeId=${encodeURIComponent(employeeId)}&limit=10`
      )
      .then((res) => setEntries(res.entries))
      .catch((e: Error) => setError(e.message));
  }, [employeeId]);

  if (error) return <div className={styles.loading}>{error}</div>;
  if (!entries) return <div className={styles.loading}>Načítám…</div>;
  if (entries.length === 0) {
    return <div className={styles.loading}>Žádné zaznamenané změny.</div>;
  }

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table className={styles.fields} style={{ display: "table", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "0.4rem 0.6rem", fontSize: "0.72rem", textTransform: "uppercase", color: "var(--color-text-muted)" }}>Čas</th>
              <th style={{ textAlign: "left", padding: "0.4rem 0.6rem", fontSize: "0.72rem", textTransform: "uppercase", color: "var(--color-text-muted)" }}>Autor</th>
              <th style={{ textAlign: "left", padding: "0.4rem 0.6rem", fontSize: "0.72rem", textTransform: "uppercase", color: "var(--color-text-muted)" }}>Akce</th>
              <th style={{ textAlign: "left", padding: "0.4rem 0.6rem", fontSize: "0.72rem", textTransform: "uppercase", color: "var(--color-text-muted)" }}>Pole</th>
              <th style={{ textAlign: "left", padding: "0.4rem 0.6rem", fontSize: "0.72rem", textTransform: "uppercase", color: "var(--color-text-muted)" }}>Změna</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td style={{ padding: "0.4rem 0.6rem", fontSize: "0.8rem", whiteSpace: "nowrap", color: "var(--color-text-muted)" }}>{formatAuditTs(e.timestamp)}</td>
                <td style={{ padding: "0.4rem 0.6rem", fontSize: "0.8rem" }}>{e.userEmail ?? "—"}</td>
                <td style={{ padding: "0.4rem 0.6rem", fontSize: "0.8rem" }}>{e.action}</td>
                <td style={{ padding: "0.4rem 0.6rem", fontSize: "0.8rem" }}>
                  {e.fieldPath ? <code>{e.fieldPath}</code> : "—"}
                </td>
                <td style={{ padding: "0.4rem 0.6rem", fontSize: "0.8rem" }}>
                  {e.redacted ? (
                    <span style={{ fontStyle: "italic", color: "var(--color-text-muted)" }}>citlivé pole změněno</span>
                  ) : e.action === "update" ? (
                    <>
                      <span style={{ textDecoration: "line-through", color: "var(--color-danger-text)" }}>{compactValue(e.oldValue)}</span>
                      <span style={{ color: "var(--color-text-muted)" }}> → </span>
                      <span style={{ color: "var(--color-active-text)" }}>{compactValue(e.newValue)}</span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: "0.75rem" }}>
        <Link to={`/audit?employeeId=${encodeURIComponent(employeeId)}`}>
          Zobrazit všechny změny →
        </Link>
      </div>
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
  hourlyRate?: number | null;
  workLocation?: string;
  probationPeriod?: string;
  agreedWorkScope?: string;
  agreedReward?: number;
  signingDate?: string;
  changes?: ChangeRow[];
}

interface ContractRecord {
  id: string;
  type: SmlouvaContractType;
  status: "unsigned" | "signed" | "archived";
  employmentRowId?: string;
  rowSnapshot?: Record<string, unknown>;
}

// Fields included in the row snapshot used to detect "this contract still
// matches the row". Any change to one of these will cause the Generovat
// button to reappear for that row.
const SNAPSHOT_FIELDS: (keyof EmploymentRow)[] = [
  "companyId",
  "contractType",
  "jobTitle",
  "department",
  "startDate",
  "endDate",
  "salary",
  "hourlyRate",
  "agreedReward",
  "workLocation",
  "probationPeriod",
  "agreedWorkScope",
  "signingDate",
];

function buildRowSnapshot(row: EmploymentRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of SNAPSHOT_FIELDS) {
    const v = row[k];
    out[k] = v === undefined ? null : v;
  }
  return out;
}

const TODAY = new Date().toISOString().split("T")[0];

/**
 * Signing date of the most recent prior "nástup" row that the given row
 * sits on top of. Used as `{{originalSigningDate}}` for amendments and
 * terminations whose body references "smlouva ze dne …" — that date is the
 * underlying nástup's signingDate, not the dodatek/ukončení's own.
 *
 * Picks the latest nástup with `startDate <= row.startDate` (excluding
 * the row itself). Successive amendments still resolve to the original
 * nástup, which is the Czech-practice referent.
 */
function findOriginalSigningDate(
  row: EmploymentRow,
  all: EmploymentRow[]
): string | undefined {
  const candidates = all
    .filter((r) => r.id !== row.id && r.changeType === "nástup" && r.startDate <= row.startDate)
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  return candidates[0]?.signingDate ?? undefined;
}

/**
 * Salary in force immediately before `row` takes effect. Walks the history
 * in chronological order: a `nástup` row's `salary` sets the baseline; a
 * `změna smlouvy` row's "mzda" change overrides it. Returns the latest
 * value applied before `row.startDate` (or before `row` itself if dates
 * tie). Used as `{{oldSalary}}` so resolveVariables can pick the
 * "zvyšuje"/"mění" verb on a salary dodatek.
 */
function findOldSalary(
  row: EmploymentRow,
  all: EmploymentRow[]
): number | undefined {
  const sorted = [...all]
    .filter((r) => r.id !== row.id && (r.startDate < row.startDate || (r.startDate === row.startDate)))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  let current: number | undefined;
  for (const r of sorted) {
    if (r.changeType === "nástup" && r.salary != null) {
      current = r.salary;
    } else if (r.changeType === "změna smlouvy") {
      const mzda = r.changes?.find((c) => c.changeKind === "mzda")?.value;
      const n = Number(mzda);
      if (Number.isFinite(n)) current = n;
    }
  }
  return current;
}

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

interface DepartmentRec {
  id: string;
  name: string;
}

interface JobPositionRec {
  id: string;
  name: string;
  departmentId: string;
  defaultSalary: number;
  hourlyRate?: number | null;
}

interface EmploymentForm {
  changeType: ChangeType;
  startDate: string;
  jobTitle: string;
  departmentId: string;
  contractType: ContractType;
  // HPP / PPP fields
  workLocation: string;
  salary: string;
  hourlyRate: string;
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
  departmentId: "",
  contractType: "",
  workLocation: "Praha",
  salary: "",
  hourlyRate: "",
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
    departmentId: "",
    contractType: (row.contractType as ContractType) ?? "",
    workLocation: row.workLocation ?? "Praha",
    salary: row.salary?.toString() ?? "",
    hourlyRate: row.hourlyRate != null ? String(row.hourlyRate) : "",
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
  lockedChangeType,
}: {
  onClose: () => void;
  onSaved: (row: EmploymentRow) => void;
  employeeId: string;
  employee: Employee;
  employment: EmploymentRow[];
  initialRow?: EmploymentRow;
  /**
   * When set, the changeType selector is hidden and the form is pre-filled
   * with this value. Used by the per-session "Přidat dodatek" / "Ukončit
   * smlouvu" buttons and the page-level "+ Nástup" button so each entry
   * point produces a single, well-known kind of row.
   */
  lockedChangeType?: ChangeType;
}) {
  const isEdit = !!initialRow;
  const [form, setForm] = useState<EmploymentForm>(() => {
    if (initialRow) return rowToForm(initialRow);
    if (lockedChangeType) return { ...emptyForm, changeType: lockedChangeType };
    return emptyForm;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [departments, setDepartments] = useState<DepartmentRec[]>([]);
  const [positions, setPositions] = useState<JobPositionRec[]>([]);
  const [dppMaxMonthlyReward, setDppMaxMonthlyReward] = useState<number | null>(null);
  // Manual override for DPP "Sjednaná odměna" — when true, auto-compute is suppressed.
  // Pre-existing rows start in manual mode so saved values aren't overwritten on edit.
  const [agreedRewardManual, setAgreedRewardManual] = useState<boolean>(
    !!initialRow?.agreedReward
  );

  useEffect(() => {
    api.get<{ dppMaxMonthlyReward: number }>("/payroll/settings")
      .then((s) => setDppMaxMonthlyReward(s.dppMaxMonthlyReward))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (form.contractType !== "DPP") return;
    if (agreedRewardManual) return;
    if (dppMaxMonthlyReward == null) return;
    let months: number;
    if (!form.endDate) {
      months = 12;
    } else {
      if (!form.startDate) return;
      const [sy, sm] = form.startDate.split("-").map(Number);
      const [ey, em] = form.endDate.split("-").map(Number);
      if (!sy || !sm || !ey || !em) return;
      months = (ey - sy) * 12 + (em - sm) + 1;
      if (months <= 0) return;
    }
    const computed = Math.ceil((dppMaxMonthlyReward * months) / 10000) * 10000;
    setForm((f) =>
      f.agreedReward === String(computed) ? f : { ...f, agreedReward: String(computed) }
    );
  }, [form.contractType, form.startDate, form.endDate, dppMaxMonthlyReward, agreedRewardManual]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<DepartmentRec[]>("/departments").catch(() => [] as DepartmentRec[]),
      api.get<JobPositionRec[]>("/jobPositions").catch(() => [] as JobPositionRec[]),
    ]).then(([deps, poss]) => {
      if (cancelled) return;
      setDepartments(deps);
      setPositions(poss);
      // Pre-select dropdowns from existing row on edit
      if (initialRow) {
        const depByName = deps.find(
          (d) => d.name.toLowerCase() === (initialRow.department ?? "").toLowerCase()
        );
        let depId = depByName?.id ?? "";
        const posMatch = poss.find(
          (p) => p.name.toLowerCase() === (initialRow.jobTitle ?? "").toLowerCase()
        );
        if (!depId && posMatch) depId = posMatch.departmentId;
        if (depId) setForm((f) => ({ ...f, departmentId: depId }));
      }
    });
    return () => { cancelled = true; };
  }, [initialRow]);

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
        next.endDate = "";
        next.agreedReward = "";
      }
      return next;
    });
    if (field === "contractType") setAgreedRewardManual(false);
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
          department: departments.find((d) => d.id === form.departmentId)?.name ?? "",
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
            hourlyRate: form.hourlyRate ? Number(form.hourlyRate) : null,
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

  const title = isEdit
    ? "Upravit záznam"
    : lockedChangeType === "nástup"
      ? "Nový nástup"
      : lockedChangeType === "změna smlouvy"
        ? "Nový dodatek"
        : lockedChangeType === "ukončení"
          ? "Ukončit smlouvu"
          : "Přidat záznam do historie";

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <span className={styles.modalTitle}>{title}</span>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className={styles.modalBody}>

            {/* ── Always visible: typ změny + datum (selector hidden when locked) ── */}
            <div className={styles.modalGrid}>
              {!lockedChangeType && (
                <div className={styles.modalField}>
                  <label className={styles.modalLabel}>Typ změny *</label>
                  <select className={styles.modalInput} value={form.changeType} onChange={(e) => setField("changeType", e.target.value as ChangeType)}>
                    {CHANGE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              )}
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
                    <label className={styles.modalLabel}>Oddělení</label>
                    <select
                      className={styles.modalInput}
                      value={form.departmentId}
                      onChange={(e) => {
                        const newDepId = e.target.value;
                        setForm((f) => ({ ...f, departmentId: newDepId, jobTitle: "" }));
                      }}
                    >
                      <option value="">— vyberte —</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.modalField}>
                    <label className={styles.modalLabel}>Pracovní pozice</label>
                    <select
                      className={styles.modalInput}
                      value={form.jobTitle}
                      disabled={!form.departmentId}
                      onChange={(e) => {
                        const posName = e.target.value;
                        const pos = positions.find((p) => p.name === posName && p.departmentId === form.departmentId);
                        setForm((f) => ({
                          ...f,
                          jobTitle: posName,
                          salary: pos && pos.defaultSalary ? String(pos.defaultSalary) : f.salary,
                          hourlyRate: pos?.hourlyRate != null ? String(pos.hourlyRate) : f.hourlyRate,
                        }));
                      }}
                    >
                      <option value="">— vyberte —</option>
                      {positions
                        .filter((p) => p.departmentId === form.departmentId)
                        .map((p) => (
                          <option key={p.id} value={p.name}>{p.name}</option>
                        ))}
                    </select>
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
                      <label className={styles.modalLabel}>
                        Sjednaná odměna (Kč)
                        {agreedRewardManual && (
                          <button
                            type="button"
                            onClick={() => setAgreedRewardManual(false)}
                            style={{ marginLeft: "0.5rem", fontSize: "0.75rem", background: "none", border: "none", color: "var(--color-link, var(--color-accent))", cursor: "pointer", padding: 0 }}
                            title="Vypočítat automaticky podle nastavení"
                          >
                            ↻ auto
                          </button>
                        )}
                      </label>
                      <input
                        className={styles.modalInput}
                        type="number"
                        value={form.agreedReward}
                        onChange={(e) => { setAgreedRewardManual(true); setField("agreedReward", e.target.value); }}
                        placeholder="0"
                      />
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
            <Button variant="secondary" onClick={onClose}>Zrušit</Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "Ukládám…" : "Uložit"}
            </Button>
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
  multisportFrom?: string | null;
  multisportTo?: string | null;
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { role } = useAuth();
  const canDelete = role === "admin" || role === "director";

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [employment, setEmployment] = useState<EmploymentRow[]>([]);
  const [contracts, setContracts] = useState<ContractRecord[]>([]);
  const [contact, setContact] = useState<ContactData | null>(null);
  const [documents, setDocuments] = useState<DocumentsData | null>(null);
  const [additional, setAdditional] = useState<AdditionalData | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<"detail" | "history">("detail");
  const [newEntryMode, setNewEntryMode] = useState<{
    lockedChangeType: ChangeType;
    parentRowId?: string;
  } | null>(null);
  const [editingRow, setEditingRow] = useState<EmploymentRow | null>(null);
  // Generation flow has two distinct modes — row-tied (employment row contract)
  // and standalone (ad-hoc Multisport / Hmotná odpovědnost / custom). Both
  // feed the same GenerateContractModal but compose `employeeData` differently.
  const [generateModal, setGenerateModal] = useState<
    | { kind: "row"; row: EmploymentRow; contractType: SmlouvaContractType }
    | {
        kind: "adhoc";
        contractType: SmlouvaContractType;
        signingDate: string;
        requestedAt?: string;
        validFrom?: string;
      }
    | null
  >(null);
  // Adhoc-dropdown state — listing built-in standalone types + custom ones,
  // and the small signing-date prompt that appears between dropdown click
  // and GenerateContractModal opening.
  const [adhocDropdownOpen, setAdhocDropdownOpen] = useState(false);
  const [signingDatePrompt, setSigningDatePrompt] = useState<SmlouvaContractType | null>(null);
  const [signingDateDraft, setSigningDateDraft] = useState<string>("");
  const [requestedAtDraft, setRequestedAtDraft] = useState<string>("");
  const [validFromDraft, setValidFromDraft] = useState<string>("");
  const [customStandalone, setCustomStandalone] = useState<{ id: string; name: string }[]>([]);
  const adhocDropdownRef = useRef<HTMLDivElement | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel?: string;
    showCancel?: boolean;
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
      api.get<ContractRecord[]>(`/employees/${id}/contracts`).catch(() => [] as ContractRecord[]),
    ])
      .then(([emp, history, empAlerts, contractsList]) => {
        setEmployee(emp);
        setEmployment(history);
        setAlerts(empAlerts);
        setContracts(contractsList);
      })
      .finally(() => setLoading(false));
  }, [id]);

  async function refetchContracts() {
    if (!id) return;
    try {
      const list = await api.get<ContractRecord[]>(`/employees/${id}/contracts`);
      setContracts(list);
    } catch {
      // ignore — list stays as-is until next refetch
    }
  }

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

  // Load contact + documents when the History tab is opened — they feed
  // the GenerateContractModal so the user can generate a PDF without
  // having to first visit the Detail tab to populate the cache.
  useEffect(() => {
    if (page !== "history" || !id) return;
    if (!loadedSections.has("contact")) {
      setLoadedSections((s) => new Set(s).add("contact"));
      api.get<ContactData | null>(`/employees/${id}/contact`).then(setContact).catch(() => {});
    }
    if (!loadedSections.has("documents")) {
      setLoadedSections((s) => new Set(s).add("documents"));
      api.get<DocumentsData | null>(`/employees/${id}/documents`).then(setDocuments).catch(() => {});
    }
  }, [page, id, loadedSections]);

  // Fetch user-created custom standalone templates for the "+ Adhoc dokument"
  // dropdown. Built-in standalone types are listed in STANDALONE_TYPES.
  useEffect(() => {
    if (!id || (role !== "admin" && role !== "director")) return;
    api
      .get<{ id: string; name: string; kind?: string | null }[]>("/contractTemplates")
      .then((list) =>
        setCustomStandalone(
          list.filter((t) => t.kind === "standalone").map((t) => ({ id: t.id, name: t.name }))
        )
      )
      .catch(() => {});
  }, [id, role]);

  // Close adhoc dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        adhocDropdownRef.current &&
        !adhocDropdownRef.current.contains(e.target as Node)
      ) {
        setAdhocDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

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
        .catch((e: Error) => {
          setConfirmModal({
            title: "Chyba",
            message: e.message,
            confirmLabel: "OK",
            showCancel: false,
            onConfirm: () => setConfirmModal(null),
          });
        });
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
          <Button variant="secondary" onClick={() => navigate(`/zamestnanci/${id}/upravit`)}>
            Upravit
          </Button>
          {canDelete && (
            <Button
              variant="danger"
              onClick={handleDeleteEmployee}
              disabled={deleteLoading}
            >
              {deleteLoading ? "…" : "Smazat"}
            </Button>
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
      </div>

      {page === "history" && (
        <>
          <div className={styles.historyHeader}>
            <span className={styles.historyTitle}>Historie pracovního poměru</span>
            {canDelete && (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setNewEntryMode({ lockedChangeType: "nástup" })}
                >
                  + Nástup
                </Button>
                <div ref={adhocDropdownRef} style={{ position: "relative" }}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setAdhocDropdownOpen((v) => !v)}
                  >
                    + Adhoc dokument ▾
                  </Button>
                  {adhocDropdownOpen && (
                    <div className={styles.generateDropdownMenu}>
                      {[
                        ...STANDALONE_TYPES.map((t) => ({ id: t, label: CONTRACT_TYPE_LABELS[t] })),
                        ...customStandalone.map((t) => ({ id: t.id, label: t.name })),
                      ].map((entry) => (
                        <button
                          key={entry.id}
                          className={styles.generateDropdownItem}
                          onClick={() => {
                            const today = new Date().toISOString().split("T")[0];
                            setSigningDatePrompt(entry.id);
                            setSigningDateDraft(today);
                            setRequestedAtDraft(today);
                            setValidFromDraft(today);
                            setAdhocDropdownOpen(false);
                          }}
                        >
                          {entry.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {employment.length === 0 ? (
            <p className={styles.loading} style={{ padding: "1rem 0" }}>Žádné záznamy.</p>
          ) : (
            [...groupBySession(employment)].reverse().map((session) => (
              <EmploymentSessionCard
                key={session.nastup.id}
                session={session}
                contractsByRow={mapContractsToRows(session.rows, contracts)}
                defaultExpanded={!session.terminated}
                companies={{}}
                employeeId={id!}
                canEdit={canDelete}
                resolveDefaultType={(row) => {
                  if (row.changeType === "nástup") {
                    if (row.contractType === "HPP") return "nastup_hpp";
                    if (row.contractType === "PPP") return "nastup_ppp";
                    if (row.contractType === "DPP") return "nastup_dpp";
                    return "";
                  }
                  if (row.changeType === "ukončení") {
                    return session.effective.contractType === "DPP"
                      ? "ukonceni_dpp"
                      : "ukonceni_hpp_ppp";
                  }
                  return "zmena_smlouvy";
                }}
                resolveDisplayName={(row) =>
                  buildContractName(
                    expectedContractTypesForRow(row)[0] ?? "",
                    {
                      contractType: row.contractType,
                      startDate: row.startDate,
                      changes: row.changes,
                    },
                    `${employee.firstName ?? ""} ${employee.lastName ?? ""}`.trim()
                  )
                }
                resolveRowSnapshot={(row) => buildRowSnapshot(row)}
                onGenerate={(row) => {
                  const types = expectedContractTypesForRow(row);
                  if (types.length > 0) {
                    setGenerateModal({
                      kind: "row",
                      row,
                      contractType: types[0] as SmlouvaContractType,
                    });
                  }
                }}
                onAddDodatek={() =>
                  setNewEntryMode({
                    lockedChangeType: "změna smlouvy",
                    parentRowId: session.nastup.id,
                  })
                }
                onTerminate={() =>
                  setNewEntryMode({
                    lockedChangeType: "ukončení",
                    parentRowId: session.nastup.id,
                  })
                }
                onContractsChanged={refetchContracts}
              />
            ))
          )}

          <AdhocContractsSection
            contracts={contracts.filter((c) => !c.employmentRowId)}
            customTemplates={customStandalone}
            employeeId={id!}
            canEdit={canDelete}
            onContractsChanged={refetchContracts}
          />

          {newEntryMode && (
            <AddEntryModal
              employeeId={id!}
              employee={employee}
              employment={employment}
              lockedChangeType={newEntryMode.lockedChangeType}
              onClose={() => setNewEntryMode(null)}
              onSaved={(row) => {
                setEmployment((prev) => [row, ...prev]);
                setNewEntryMode(null);
                // Dodatek may have changed root denormalized fields server-side
                // (currentJobTitle etc.) — re-fetch the employee to keep the
                // Detail tab in sync without a full page reload.
                if (row.changeType === "změna smlouvy" && id) {
                  api.get<Employee>(`/employees/${id}`).then(setEmployee).catch(() => {});
                }
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

          {signingDatePrompt && (() => {
            const isMultisport = signingDatePrompt === "multisport";
            const promptLabel =
              CONTRACT_TYPE_LABELS[signingDatePrompt] ??
              customStandalone.find((t) => t.id === signingDatePrompt)?.name ??
              signingDatePrompt;
            const dateInputStyle: React.CSSProperties = {
              width: "100%",
              padding: "8px 10px",
              fontSize: "0.875rem",
              border: "1px solid var(--color-border)",
              borderRadius: "6px",
              background: "var(--color-surface)",
              color: "var(--color-text)",
            };
            const labelStyle: React.CSSProperties = {
              display: "block",
              fontSize: "0.8125rem",
              fontWeight: 500,
              color: "var(--color-text-secondary)",
              marginBottom: "4px",
            };
            const fieldStyle: React.CSSProperties = { marginBottom: "12px" };
            const canContinue =
              !!signingDateDraft && (!isMultisport || (!!requestedAtDraft && !!validFromDraft));
            return (
              <div className={modalStyles.overlay}>
                <div className={modalStyles.modal}>
                  <div className={modalStyles.header}>
                    <h2 className={modalStyles.title}>{promptLabel}</h2>
                  </div>
                  <div className={modalStyles.body}>
                    <div style={fieldStyle}>
                      <label style={labelStyle}>Datum podpisu</label>
                      <input
                        type="date"
                        value={signingDateDraft}
                        onChange={(e) => setSigningDateDraft(e.target.value)}
                        autoFocus
                        style={dateInputStyle}
                      />
                    </div>
                    {isMultisport && (
                      <>
                        <div style={fieldStyle}>
                          <label style={labelStyle}>Datum žádosti</label>
                          <input
                            type="date"
                            value={requestedAtDraft}
                            onChange={(e) => setRequestedAtDraft(e.target.value)}
                            style={dateInputStyle}
                          />
                        </div>
                        <div style={{ ...fieldStyle, marginBottom: 0 }}>
                          <label style={labelStyle}>Platnost od</label>
                          <input
                            type="date"
                            value={validFromDraft}
                            onChange={(e) => setValidFromDraft(e.target.value)}
                            style={dateInputStyle}
                          />
                        </div>
                      </>
                    )}
                  </div>
                  <div className={modalStyles.footer}>
                    <Button variant="secondary" onClick={() => setSigningDatePrompt(null)}>
                      Zrušit
                    </Button>
                    <Button
                      variant="primary"
                      disabled={!canContinue}
                      onClick={() => {
                        setGenerateModal({
                          kind: "adhoc",
                          contractType: signingDatePrompt,
                          signingDate: signingDateDraft,
                          requestedAt: isMultisport ? requestedAtDraft : undefined,
                          validFrom: isMultisport ? validFromDraft : undefined,
                        });
                        setSigningDatePrompt(null);
                      }}
                    >
                      Pokračovat
                    </Button>
                  </div>
                </div>
              </div>
            );
          })()}
        </>
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
          <div className={styles.field}><span className={styles.fieldLabel}>Rodinný stav</span><span className={styles.fieldValue}>{val(displayGendered(employee.maritalStatus, employee.gender as "m" | "f"))}</span></div>
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
            <div className={styles.field}><span className={styles.fieldLabel}>Multisport</span><span className={styles.fieldValue}>{(() => {
              const base = additional?.multisport === true ? "Ano" : additional?.multisport === false ? "Ne" : "—";
              if (additional?.multisport !== true) return base;
              const from = additional?.multisportFrom;
              const to = additional?.multisportTo;
              if (!from && !to) return base;
              const range = `${from ? formatDateCZ(from) : "…"} – ${to ? formatDateCZ(to) : "…"}`;
              return `${base} · ${range}`;
            })()}</span></div>
            <div className={styles.field}><span className={styles.fieldLabel}>Home office</span><span className={styles.fieldValue}>{additional?.homeOffice != null ? String(additional.homeOffice) : "—"}</span></div>
            <div className={styles.field}><span className={styles.fieldLabel}>Náhrady</span><span className={styles.fieldValue}>{additional?.allowances === true ? "Ano" : additional?.allowances === false ? "Ne" : "—"}</span></div>
          </div>
        )}
      </Section>

      {(role === "admin" || role === "director") && id && (
        <Section title="Historie změn" sectionKey="audit" expanded={expanded.has("audit")} onToggle={toggle}>
          {expanded.has("audit") ? <EmployeeAuditHistory employeeId={id} /> : null}
        </Section>
      )}
      </>
      )}

      {generateModal?.kind === "row" && (
        <GenerateContractModal
          employeeId={id!}
          contractType={generateModal.contractType}
          employmentRowId={generateModal.row.id}
          companyId={generateModal.row.companyId ?? null}
          employeeData={{
            id: employee.id,
            firstName: employee.firstName,
            lastName: employee.lastName,
            currentJobTitle: generateModal.row.jobTitle || employee.currentJobTitle,
            currentCompanyId: employee.currentCompanyId ?? undefined,
            address: contact?.contactAddress || contact?.permanentAddress,
            birthDate: employee.dateOfBirth ?? undefined,
            nationality: employee.nationality,
            passportNumber: documents?.passportNumber,
            visaNumber: documents?.visaNumber,
            visaType: documents?.visaType,
            contractType: generateModal.row.contractType,
            salary: generateModal.row.salary,
            startDate: generateModal.row.startDate,
            endDate: generateModal.row.endDate ?? undefined,
            workLocation: generateModal.row.workLocation,
            probationPeriod: generateModal.row.probationPeriod,
            signingDate: generateModal.row.signingDate ?? undefined,
            originalSigningDate: findOriginalSigningDate(generateModal.row, employment),
            agreedWorkScope: generateModal.row.agreedWorkScope,
            agreedReward: generateModal.row.agreedReward ?? undefined,
            dodatekEffectiveDate:
              generateModal.row.changeType === "změna smlouvy"
                ? generateModal.row.startDate
                : undefined,
            dodatekChanges: generateModal.row.changes?.map((c) => ({
              changeKind: c.changeKind,
              value: c.value,
            })),
            oldSalary: findOldSalary(generateModal.row, employment),
          }}
          rowSnapshot={buildRowSnapshot(generateModal.row)}
          displayName={buildContractName(
            generateModal.contractType,
            {
              contractType: generateModal.row.contractType,
              startDate: generateModal.row.startDate,
              changes: generateModal.row.changes,
            },
            `${employee.firstName ?? ""} ${employee.lastName ?? ""}`.trim()
          )}
          onClose={() => setGenerateModal(null)}
          onGenerated={() => {
            setGenerateModal(null);
            refetchContracts();
          }}
        />
      )}

      {generateModal?.kind === "adhoc" && (
        <GenerateContractModal
          employeeId={id!}
          contractType={generateModal.contractType}
          companyId={employee.currentCompanyId ?? null}
          employeeData={{
            id: employee.id,
            firstName: employee.firstName,
            lastName: employee.lastName,
            currentJobTitle: employee.currentJobTitle,
            currentCompanyId: employee.currentCompanyId ?? undefined,
            address: contact?.contactAddress || contact?.permanentAddress,
            birthDate: employee.dateOfBirth ?? undefined,
            nationality: employee.nationality,
            passportNumber: documents?.passportNumber,
            visaNumber: documents?.visaNumber,
            visaType: documents?.visaType,
            signingDate: generateModal.signingDate,
            requestedAt: generateModal.requestedAt,
            validFrom: generateModal.validFrom,
          }}
          displayName={buildContractName(
            generateModal.contractType,
            undefined,
            `${employee.firstName ?? ""} ${employee.lastName ?? ""}`.trim(),
            customStandalone.find((t) => t.id === generateModal.contractType)?.name
          )}
          onClose={() => setGenerateModal(null)}
          onGenerated={() => {
            setGenerateModal(null);
            refetchContracts();
          }}
        />
      )}

      {confirmModal && (
        <ConfirmModal
          title={confirmModal.title}
          message={confirmModal.message}
          confirmLabel={confirmModal.confirmLabel}
          cancelLabel={confirmModal.cancelLabel}
          showCancel={confirmModal.showCancel}
          danger={confirmModal.danger}
          onConfirm={confirmModal.onConfirm}
          onCancel={confirmModal.onCancel ?? (() => setConfirmModal(null))}
        />
      )}
    </div>
  );
}
