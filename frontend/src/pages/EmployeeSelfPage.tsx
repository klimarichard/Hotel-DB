import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import Button from "@/components/Button";
import ConfirmModal from "@/components/ConfirmModal";
import { formatDateCZ, formatDatetimeCZ } from "@/lib/dateFormat";
import {
  SELF_EDIT_FIELDS,
  SELF_EDIT_SECTIONS,
  SELF_EDIT_SECTION_LABELS,
  type SelfEditSection,
  type SelfEditField,
} from "@/lib/selfEditFields";
import styles from "./EmployeeSelfPage.module.css";

const MASK = "••••••••";

interface EmployeeRoot {
  id: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  gender?: string;
  currentJobTitle?: string;
  currentDepartment?: string;
  currentContractType?: string;
  [k: string]: unknown;
}
type SubDoc = Record<string, unknown> | null;
interface EmploymentRow {
  id: string;
  startDate?: string;
  endDate?: string | null;
  jobTitle?: string;
  contractType?: string;
  changeType?: string;
}
interface ReqChange {
  field: string;
  label: string;
  sensitive: boolean;
  newValue: string | null;
  oldValue?: string | null;
}
interface ChangeRequest {
  id: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: { seconds?: number; _seconds?: number } | null;
  rejectionReason: string | null;
  changes: ReqChange[];
}

interface Dialog {
  title: string;
  message: string;
  danger?: boolean;
  confirmLabel?: string;
  showCancel?: boolean;
}

export default function EmployeeSelfPage() {
  const { employeeId, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [emp, setEmp] = useState<EmployeeRoot | null>(null);
  const [contact, setContact] = useState<SubDoc>(null);
  const [documents, setDocuments] = useState<SubDoc>(null);
  const [benefits, setBenefits] = useState<SubDoc>(null);
  const [employment, setEmployment] = useState<EmploymentRow[]>([]);
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [editMode, setEditMode] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);

  function sectionObj(section: SelfEditSection): Record<string, unknown> | null {
    if (section === "root") return emp;
    if (section === "contact") return contact;
    if (section === "documents") return documents;
    return benefits;
  }

  async function loadRequests() {
    const reqs = await api.get<ChangeRequest[]>("/me/change-requests").catch(() => []);
    setRequests(reqs);
  }

  useEffect(() => {
    if (authLoading) return;
    if (!employeeId) {
      setLoading(false);
      return;
    }
    Promise.all([
      api.get<EmployeeRoot | null>("/me/employee"),
      api.get<SubDoc>("/me/employee/contact"),
      api.get<SubDoc>("/me/employee/documents"),
      api.get<SubDoc>("/me/employee/benefits"),
      api.get<EmploymentRow[]>("/me/employee/employment"),
      api.get<ChangeRequest[]>("/me/change-requests"),
    ])
      .then(([e, c, d, b, hist, reqs]) => {
        setEmp(e);
        setContact(c);
        setDocuments(d);
        setBenefits(b);
        setEmployment(hist);
        setRequests(reqs);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [authLoading, employeeId]);

  async function handleReveal(field: string) {
    try {
      const res = await api.post<{ value: string }>("/me/employee/reveal", { field });
      setRevealed((p) => ({ ...p, [field]: res.value }));
    } catch {
      setDialog({ title: "Chyba", message: "Hodnotu se nepodařilo načíst.", showCancel: false });
    }
  }

  function enterEdit() {
    const init: Record<string, string> = {};
    for (const f of SELF_EDIT_FIELDS) {
      if (f.sensitive) {
        init[f.key] = "";
        continue;
      }
      const obj = sectionObj(f.section);
      const v = obj ? obj[f.key] : undefined;
      init[f.key] = v == null ? "" : String(v);
    }
    setEditValues(init);
    setEditMode(true);
  }

  function buildChanges() {
    const changes: { field: string; label: string; newValue: string; oldValue?: string }[] = [];
    for (const f of SELF_EDIT_FIELDS) {
      const next = (editValues[f.key] ?? "").trim();
      if (f.sensitive) {
        // Current value is masked, so any entered value is a proposed change.
        if (next !== "") changes.push({ field: f.key, label: f.label, newValue: next });
      } else {
        const obj = sectionObj(f.section);
        const cur = obj && obj[f.key] != null ? String(obj[f.key]) : "";
        if (next !== cur) changes.push({ field: f.key, label: f.label, newValue: next, oldValue: cur });
      }
    }
    return changes;
  }

  async function handleSubmit() {
    const changes = buildChanges();
    if (!changes.length) {
      setDialog({ title: "Žádné změny", message: "Neprovedli jste žádné změny k odeslání.", showCancel: false });
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/me/change-requests", { changes });
      setEditMode(false);
      setRevealed({});
      await loadRequests();
      setDialog({
        title: "Odesláno",
        message: "Vaše žádost o úpravu byla odeslána ke schválení administrátorovi.",
        showCancel: false,
      });
    } catch (e) {
      setDialog({ title: "Chyba", message: (e as Error).message || "Odeslání se nezdařilo.", showCancel: false });
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmCancel(id: string) {
    setCancelId(null);
    try {
      await api.delete(`/me/change-requests/${id}`);
      await loadRequests();
    } catch {
      setDialog({ title: "Chyba", message: "Žádost se nepodařilo zrušit.", showCancel: false });
    }
  }

  // ── render helpers ──────────────────────────────────────────────────────────

  function renderReadValue(f: SelfEditField) {
    const obj = sectionObj(f.section);
    const raw = obj ? obj[f.key] : undefined;
    if (f.sensitive) {
      if (revealed[f.key] !== undefined) return <span>{revealed[f.key]}</span>;
      if (raw === MASK) {
        return (
          <span>
            {MASK}
            <button type="button" className={styles.revealBtn} onClick={() => handleReveal(f.key)}>
              Zobrazit
            </button>
          </span>
        );
      }
      return <span className={styles.muted}>—</span>;
    }
    if (raw == null || raw === "") return <span className={styles.muted}>—</span>;
    if (f.kind === "date") return <span>{formatDateCZ(String(raw))}</span>;
    return <span>{String(raw)}</span>;
  }

  function statusLabel(s: ChangeRequest["status"]) {
    return s === "pending" ? "Čeká na schválení" : s === "approved" ? "Schváleno" : "Zamítnuto";
  }

  // ── states ───────────────────────────────────────────────────────────────────

  if (authLoading || loading) return <div className={styles.state}>Načítám…</div>;

  if (!employeeId) {
    return (
      <div>
        <h1 className={styles.title}>Můj profil</h1>
        <div className={styles.notLinked} style={{ marginTop: "1rem" }}>
          Váš účet zatím není propojen se zaměstnaneckým záznamem. Obraťte se prosím na administrátora.
        </div>
      </div>
    );
  }

  const hasPending = requests.some((r) => r.status === "pending");

  return (
    <div>
      <div className={styles.headerRow}>
        <h1 className={styles.title}>Můj profil</h1>
        {!editMode && (
          <Button variant="primary" onClick={enterEdit}>
            Navrhnout úpravu
          </Button>
        )}
      </div>
      <p className={styles.subtitle}>
        Změny osobních údajů odešlete ke schválení — projeví se až po schválení administrátorem.
      </p>

      {hasPending && !editMode && (
        <div className={styles.pendingHint}>Máte čekající žádost o úpravu údajů.</div>
      )}

      {editMode ? (
        <>
          {SELF_EDIT_SECTIONS.map((section) => (
            <div className={styles.section} key={section}>
              <div className={styles.sectionTitle}>{SELF_EDIT_SECTION_LABELS[section]}</div>
              <div className={styles.grid}>
                {SELF_EDIT_FIELDS.filter((f) => f.section === section).map((f) => (
                  <div className={styles.field} key={f.key}>
                    <label className={styles.fieldLabel}>{f.label}</label>
                    <input
                      className={styles.input}
                      type={f.kind === "date" ? "date" : "text"}
                      value={editValues[f.key] ?? ""}
                      onChange={(e) => setEditValues((p) => ({ ...p, [f.key]: e.target.value }))}
                      placeholder={f.sensitive ? "Nová hodnota — prázdné = beze změny" : undefined}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className={styles.actionsRow}>
            <Button variant="primary" onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Odesílám…" : "Odeslat ke schválení"}
            </Button>
            <Button variant="secondary" onClick={() => setEditMode(false)} disabled={submitting}>
              Zrušit
            </Button>
          </div>
        </>
      ) : (
        <>
          {SELF_EDIT_SECTIONS.map((section) => (
            <div className={styles.section} key={section}>
              <div className={styles.sectionTitle}>{SELF_EDIT_SECTION_LABELS[section]}</div>
              <div className={styles.grid}>
                {section === "root" && (
                  <>
                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>Jméno</span>
                      <span className={styles.fieldValue}>{emp?.firstName || "—"}</span>
                    </div>
                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>Příjmení</span>
                      <span className={styles.fieldValue}>{emp?.lastName || "—"}</span>
                    </div>
                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>Datum narození</span>
                      <span className={styles.fieldValue}>{emp?.dateOfBirth ? formatDateCZ(emp.dateOfBirth) : "—"}</span>
                    </div>
                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>Pohlaví</span>
                      <span className={styles.fieldValue}>{emp?.gender || "—"}</span>
                    </div>
                  </>
                )}
                {SELF_EDIT_FIELDS.filter((f) => f.section === section).map((f) => (
                  <div className={f.key === "permanentAddress" || f.key === "contactAddress" ? styles.fieldFull : styles.field} key={f.key}>
                    <span className={styles.fieldLabel}>{f.label}</span>
                    <span className={styles.fieldValue}>{renderReadValue(f)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className={styles.section}>
            <div className={styles.sectionTitle}>Pracovní poměr</div>
            <div className={styles.grid}>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Pozice</span>
                <span className={styles.fieldValue}>{emp?.currentJobTitle || "—"}</span>
              </div>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Oddělení</span>
                <span className={styles.fieldValue}>{emp?.currentDepartment || "—"}</span>
              </div>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Typ smlouvy</span>
                <span className={styles.fieldValue}>{emp?.currentContractType || "—"}</span>
              </div>
            </div>
            {employment.length > 0 && (
              <div className={styles.histList} style={{ marginTop: "1rem" }}>
                {employment.map((row) => (
                  <div className={styles.histRow} key={row.id}>
                    <span className={styles.histDates}>
                      {formatDateCZ(row.startDate) || "—"}
                      {row.endDate ? ` – ${formatDateCZ(row.endDate)}` : ""}
                    </span>
                    <span>{row.jobTitle || "—"}</span>
                    <span className={styles.muted}>{row.contractType || ""}</span>
                    <span className={styles.muted}>{row.changeType || ""}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Own change requests ── */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Moje žádosti o úpravu</div>
        {requests.length === 0 ? (
          <div className={styles.empty}>Zatím jste nepodali žádnou žádost.</div>
        ) : (
          requests.map((r) => (
            <div className={styles.requestCard} key={r.id}>
              <div className={styles.reqHeader}>
                <span className={`${styles.badge} ${styles[`badge_${r.status}`]}`}>{statusLabel(r.status)}</span>
                <span className={styles.reqMeta}>{formatDatetimeCZ(r.requestedAt)}</span>
              </div>
              <div className={styles.changeList}>
                {r.changes.map((c, i) => (
                  <div className={styles.changeItem} key={i}>
                    <span className={styles.changeFieldLabel}>{c.label}:</span>
                    {c.oldValue ? (
                      <>
                        <span className={styles.muted}>{c.oldValue}</span>
                        <span className={styles.changeArrow}>→</span>
                      </>
                    ) : null}
                    <span>{c.newValue ?? "—"}</span>
                  </div>
                ))}
              </div>
              {r.status === "rejected" && r.rejectionReason && (
                <div className={styles.rejectionNote}>Důvod zamítnutí: {r.rejectionReason}</div>
              )}
              {r.status === "pending" && (
                <div style={{ marginTop: "0.5rem" }}>
                  <Button variant="ghost" size="sm" onClick={() => setCancelId(r.id)}>
                    Zrušit žádost
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {cancelId && (
        <ConfirmModal
          title="Zrušit žádost"
          message="Opravdu chcete tuto čekající žádost o úpravu zrušit?"
          danger
          confirmLabel="Zrušit žádost"
          cancelLabel="Zpět"
          onConfirm={() => confirmCancel(cancelId)}
          onCancel={() => setCancelId(null)}
        />
      )}
      {dialog && (
        <ConfirmModal
          title={dialog.title}
          message={dialog.message}
          danger={dialog.danger}
          confirmLabel={dialog.confirmLabel ?? "OK"}
          showCancel={dialog.showCancel ?? false}
          onConfirm={() => setDialog(null)}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
}
