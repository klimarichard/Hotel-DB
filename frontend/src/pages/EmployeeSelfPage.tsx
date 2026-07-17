import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { tourDemo } from "@/lib/tours/demoData";
import { useAuth } from "@/hooks/useAuth";
import Button from "@/components/Button";
import ConfirmModal from "@/components/ConfirmModal";
import { formatDateCZ, formatDatetimeCZ } from "@/lib/dateFormat";
import { displayGendered } from "@/lib/genderDisplay";
import { nationalityName } from "@/lib/nationalities";
import { formatPhoneDisplay, needsPhoneFormatPrompt } from "@/lib/phoneFormat";
import PhoneFormatModal from "@/components/PhoneFormatModal";
import { isCzechNationality } from "@/lib/contractVariables";
import { groupBySession, mapContractsToRows, type ContractRecord } from "@/lib/employmentSessions";
import EmploymentSessionCard from "@/components/EmploymentSession";
import DocumentExpiryBar from "@/components/DocumentExpiryBar";
import VacationLedgerSection from "@/components/VacationLedgerSection";
import { useSelfDocAlertsContext } from "@/context/SelfDocAlertsContext";
import {
  SELF_EDIT_FIELDS,
  SELF_EDIT_SECTIONS,
  SELF_EDIT_SECTION_LABELS,
  type SelfEditSection,
  type SelfEditField,
} from "@/lib/selfEditFields";
import styles from "./EmployeeSelfPage.module.css";

const MASK = "••••••••";

// First sensitive field key – used solely to anchor the onboarding tour's reveal
// step on a single (the first) reveal button. Inert: drives no behaviour.
const FIRST_SENSITIVE_KEY = SELF_EDIT_FIELDS.find((f) => f.sensitive)?.key;

// Mirrors EmployeeFormPage – combined gendered forms; displayGendered() picks
// the variant on read.
const MARITAL_STATUSES = ["svobodný/á", "ženatý/vdaná", "rozvedený/á", "vdovec/vdova"];

const EyeIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeOffIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

interface EmployeeRoot {
  id: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  gender?: string;
  // When true, gendered Czech strings (e.g. maritalStatus) are shown combined
  // ("ženatý/vdaná") instead of resolved to the gender variant.
  genderNeutralDisplay?: boolean;
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
  const { user, employeeId, loading: authLoading, can } = useAuth();
  const { alerts: docAlerts } = useSelfDocAlertsContext();
  const canRequestEdit = can("self.profile.requestEdit");
  const canRevealSelf = can("sensitive.reveal.self");
  const [loading, setLoading] = useState(true);
  const [emp, setEmp] = useState<EmployeeRoot | null>(null);
  const [contact, setContact] = useState<SubDoc>(null);
  const [documents, setDocuments] = useState<SubDoc>(null);
  const [benefits, setBenefits] = useState<SubDoc>(null);
  const [employment, setEmployment] = useState<EmploymentRow[]>([]);
  const [contracts, setContracts] = useState<ContractRecord[]>([]);
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [editMode, setEditMode] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  // Holds the pending change-set while the user picks a non-+420 phone display
  // format; on confirm the phone change's newValue is replaced and submitted.
  const [phonePromptChanges, setPhonePromptChanges] = useState<
    { field: string; label: string; newValue: string; oldValue?: string }[] | null
  >(null);
  // Decrypted values of sensitive fields pre-loaded on entering edit (TODO 41),
  // so buildChanges() only submits a sensitive field that the user actually changed.
  const [sensitiveOriginals, setSensitiveOriginals] = useState<Record<string, string>>({});
  const [contactSameAsPermanent, setContactSameAsPermanent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [educationOptions, setEducationOptions] = useState<string[]>([]);

  function sectionObj(section: SelfEditSection): Record<string, unknown> | null {
    if (section === "root") return emp;
    if (section === "contact") return contact;
    if (section === "documents") return documents;
    return benefits;
  }

  // Document fields shown only for the matching nationality branch (TODO 14):
  // Czech → OP fields, foreign → passport + Povolení k pobytu (visa), empty → all.
  const OP_FIELDS = ["idCardNumber", "idCardExpiry"];
  const FOREIGN_DOC_FIELDS = [
    "passportNumber", "passportIssueDate", "passportExpiry", "passportAuthority",
    "visaNumber", "visaType", "visaIssueDate", "visaExpiry",
  ];
  function isDocFieldVisible(key: string, nationality: string): boolean {
    const nat = (nationality ?? "").trim();
    if (nat === "") return true; // unknown nationality → show all
    const czech = isCzechNationality(nat);
    if (OP_FIELDS.includes(key)) return czech;
    if (FOREIGN_DOC_FIELDS.includes(key)) return !czech;
    return true;
  }
  // In edit mode the nationality the user is currently proposing drives the
  // gating; on read it's the stored value.
  function activeNationality(): string {
    return editMode ? (editValues.nationality ?? "") : ((emp?.nationality as string) ?? "");
  }
  function isFieldVisible(f: SelfEditField): boolean {
    if (f.section !== "documents") return true;
    return isDocFieldVisible(f.key, activeNationality());
  }

  async function loadRequests() {
    const reqs = await api.get<ChangeRequest[]>("/me/change-requests").catch(() => []);
    setRequests(reqs);
  }

  // Download the employee's OWN signed contract for a history entry. Streams
  // from the self endpoint (auth-only, signed-only); the server sets the proper
  // filename in Content-Disposition, which we honour for the saved file.
  async function handleDownloadContract(contractId: string, displayName?: string) {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const resp = await fetch(`/api/me/employee/contracts/${contractId}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        setDialog({ title: "Chyba", message: "Smlouvu se nepodařilo stáhnout.", showCancel: false });
        return;
      }
      const cd = resp.headers.get("Content-Disposition");
      const star = cd?.match(/filename\*=UTF-8''([^;]+)/i);
      const plain = cd?.match(/filename="([^"]+)"/i);
      let filename = `${displayName || "smlouva"}.pdf`;
      if (star) { try { filename = decodeURIComponent(star[1]); } catch { /* malformed */ } }
      else if (plain) filename = plain[1];
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5_000);
    } catch {
      setDialog({ title: "Chyba", message: "Smlouvu se nepodařilo stáhnout.", showCancel: false });
    }
  }

  useEffect(() => {
    if (authLoading) return;
    // Tour demo: load the mock self profile even if the real account has no
    // linked employee (the /me/* calls are intercepted, see lib/tours/demoData).
    if (!employeeId && !tourDemo.active) {
      setLoading(false);
      return;
    }
    Promise.all([
      api.get<EmployeeRoot | null>("/me/employee"),
      api.get<SubDoc>("/me/employee/contact"),
      api.get<SubDoc>("/me/employee/documents"),
      api.get<SubDoc>("/me/employee/benefits"),
      api.get<EmploymentRow[]>("/me/employee/employment"),
      api.get<ContractRecord[]>("/me/employee/contracts").catch(() => []),
      api.get<ChangeRequest[]>("/me/change-requests"),
      api.get<Array<{ name: string; code: string }>>("/educationLevels").catch(() => []),
    ])
      .then(([e, c, d, b, hist, contractList, reqs, edu]) => {
        setEmp(e);
        setContact(c);
        setDocuments(d);
        setBenefits(b);
        setEmployment(hist);
        setContracts(contractList);
        setEducationOptions(edu.map((l) => (l.code ? `${l.code} - ${l.name}` : l.name)));
        setRequests(reqs);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [authLoading, employeeId]);

  async function handleReveal(field: string) {
    // Toggle: if already revealed, hide it again.
    if (revealed[field] !== undefined) {
      setRevealed((p) => {
        const next = { ...p };
        delete next[field];
        return next;
      });
      return;
    }
    try {
      const res = await api.post<{ value: string }>("/me/employee/reveal", { field });
      setRevealed((p) => ({ ...p, [field]: res.value }));
    } catch {
      setDialog({ title: "Chyba", message: "Hodnotu se nepodařilo načíst.", showCancel: false });
    }
  }

  async function enterEdit() {
    const init: Record<string, string> = {};
    const sensitiveKeys: string[] = [];
    for (const f of SELF_EDIT_FIELDS) {
      if (f.sensitive) {
        init[f.key] = "";
        sensitiveKeys.push(f.key);
        continue;
      }
      const obj = sectionObj(f.section);
      const v = obj ? obj[f.key] : undefined;
      init[f.key] = v == null ? "" : String(v);
    }
    // Initialise the "kontaktní adresa = trvalá" checkbox from the stored flag.
    setContactSameAsPermanent(Boolean(contact?.contactAddressSameAsPermanent));
    setEditValues(init);
    setEditMode(true);

    // Auto-reveal editable sensitive fields so the employee sees what they're
    // changing (TODO 41). Each reveal hits POST /me/employee/reveal, which logs
    // a "reveal" audit action. Done in parallel; failures leave the input blank.
    // Gated by sensitive.reveal.self: without it we never decrypt – the inputs
    // stay blank and buildChanges() treats the original as "" (so an untouched
    // sensitive field is simply not submitted).
    if (!canRevealSelf) {
      setSensitiveOriginals({});
      return;
    }
    const revealedValues = await Promise.all(
      sensitiveKeys.map(async (key) => {
        try {
          const res = await api.post<{ value: string }>("/me/employee/reveal", { field: key });
          return [key, res.value] as const;
        } catch {
          return [key, ""] as const;
        }
      })
    );
    setEditValues((prev) => {
      const next = { ...prev };
      for (const [key, value] of revealedValues) {
        if (value) next[key] = value;
      }
      return next;
    });
    const origs: Record<string, string> = {};
    for (const [key, value] of revealedValues) origs[key] = value;
    setSensitiveOriginals(origs);
  }

  function buildChanges() {
    const changes: { field: string; label: string; newValue: string; oldValue?: string }[] = [];
    for (const f of SELF_EDIT_FIELDS) {
      // Document fields hidden for the current nationality are never submitted –
      // their inputs aren't shown, so any leftover value is irrelevant (TODO 14).
      if (!isFieldVisible(f)) continue;

      // Kontaktní adresa = trvalá (TODO 39): when ticked the field is hidden and
      // the proposed contact address mirrors the (edited) permanent address. The
      // backend whitelist has no same-as-permanent flag, so we submit the value.
      let raw = editValues[f.key] ?? "";
      if (f.key === "contactAddress" && contactSameAsPermanent) {
        raw = editValues.permanentAddress ?? "";
      }
      const next = raw.trim();

      if (f.sensitive) {
        // Sensitive fields are pre-loaded with the decrypted current value on
        // entering edit (TODO 41); only submit when the user actually changed it.
        const orig = (sensitiveOriginals[f.key] ?? "").trim();
        if (next !== orig) changes.push({ field: f.key, label: f.label, newValue: next });
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
    // A changed non-+420 phone gets a display-format prompt before submitting.
    const phoneChange = changes.find((c) => c.field === "phone");
    if (phoneChange && needsPhoneFormatPrompt(phoneChange.newValue, phoneChange.oldValue ?? "")) {
      setPhonePromptChanges(changes);
      return;
    }
    await submitChanges(changes);
  }

  async function submitChanges(changes: ReturnType<typeof buildChanges>) {
    setSubmitting(true);
    try {
      await api.post("/me/change-requests", { changes });
      setEditMode(false);
      setRevealed({});
      setSensitiveOriginals({});
      setContactSameAsPermanent(false);
      await loadRequests();
      setDialog({
        title: "Odesláno",
        message: "Vaše žádost o úpravu byla odeslána ke schválení administrátorovi.",
        showCancel: false,
      });
    } catch (e) {
      setDialog({ title: "Chyba", message: errorMessage(e, "Odeslání se nezdařilo."), showCancel: false });
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
      const isRevealed = revealed[f.key] !== undefined;
      if (raw !== MASK && !isRevealed) return <span className={styles.muted}>–</span>;
      return (
        <span>
          {isRevealed ? revealed[f.key] : MASK}
          {canRevealSelf && (
            <button
              type="button"
              className={styles.revealBtn}
              onClick={() => handleReveal(f.key)}
              title={isRevealed ? "Skrýt" : "Zobrazit"}
              aria-label={isRevealed ? "Skrýt" : "Zobrazit"}
              data-tour={f.key === FIRST_SENSITIVE_KEY ? "selfpage-reveal" : undefined}
            >
              {isRevealed ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          )}
        </span>
      );
    }
    if (raw == null || raw === "") return <span className={styles.muted}>–</span>;
    if (f.kind === "date") return <span>{formatDateCZ(String(raw))}</span>;
    // maritalStatus is stored combined ("ženatý/vdaná"); show the gender variant.
    if (f.key === "maritalStatus") {
      return <span>{displayGendered(String(raw), emp?.genderNeutralDisplay ? null : ((emp?.gender as "m" | "f" | null) ?? null))}</span>;
    }
    // nationality is stored as an ISO code; show the Czech country name (TODO 63).
    if (f.key === "nationality") {
      return <span>{nationalityName(String(raw)) || String(raw)}</span>;
    }
    if (f.key === "phone") {
      return <span>{formatPhoneDisplay(String(raw))}</span>;
    }
    return <span>{String(raw)}</span>;
  }

  // Edit control per field. Rodinný stav and Vzdělání use the same dropdowns as
  // the employee form (maritalStatus a fixed list, education from the catalogue).
  function renderEditControl(f: SelfEditField) {
    const value = editValues[f.key] ?? "";
    const set = (v: string) => setEditValues((p) => ({ ...p, [f.key]: v }));

    if (f.key === "maritalStatus") {
      return (
        <select className={styles.input} value={value} onChange={(e) => set(e.target.value)}>
          <option value="">– vyberte –</option>
          {MARITAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      );
    }
    if (f.key === "education") {
      return (
        <select className={styles.input} value={value} onChange={(e) => set(e.target.value)}>
          <option value="">– vyberte –</option>
          {educationOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          {value && !educationOptions.includes(value) && <option value={value}>{value}</option>}
        </select>
      );
    }
    return (
      <input
        className={styles.input}
        type={f.kind === "date" ? "date" : "text"}
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={f.sensitive ? "Nová hodnota – prázdné = beze změny" : undefined}
      />
    );
  }

  function statusLabel(s: ChangeRequest["status"]) {
    return s === "pending" ? "Čeká na schválení" : s === "approved" ? "Schváleno" : "Zamítnuto";
  }

  // ── states ───────────────────────────────────────────────────────────────────

  if (authLoading || loading) return <div className={styles.state}>Načítám…</div>;

  if (!employeeId && !tourDemo.active) {
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

  // Employment-history overview shows an entry ONLY when it has a matching
  // SIGNED contract – an employee should see only finalised history. Entries
  // whose contract is still unsigned (being prepared for signing) AND entries
  // with no contract generated yet are both hidden, since to the employee both
  // are "not finalised". (A Nástup with no signed contract hides its whole
  // session via groupBySession's orphan-drop; the effective state then reflects
  // only the signed rows.)
  const contractByRow = mapContractsToRows(
    employment as unknown as Parameters<typeof mapContractsToRows>[0],
    contracts
  );
  const visibleEmployment = employment.filter((row) => {
    const c = contractByRow.get(row.id);
    return !!c && c.status === "signed";
  });

  return (
    <div>
      <div className={styles.headerRow}>
        <h1 className={styles.title} data-tour="selfpage-title">Můj profil</h1>
        {!editMode && canRequestEdit && (
          <Button variant="primary" onClick={enterEdit} data-tour="selfpage-edit-btn">
            Navrhnout úpravu
          </Button>
        )}
      </div>
      <p className={styles.subtitle}>
        Změny osobních údajů odešlete ke schválení – projeví se až po schválení administrátorem.
      </p>

      <DocumentExpiryBar alerts={docAlerts} />

      {hasPending && !editMode && (
        <div className={styles.pendingHint}>Máte čekající žádost o úpravu údajů.</div>
      )}

      {editMode ? (
        <>
          {SELF_EDIT_SECTIONS.map((section) => (
            <div className={styles.section} key={section}>
              <div className={styles.sectionTitle}>{SELF_EDIT_SECTION_LABELS[section]}</div>
              <div className={styles.editGrid}>
                {SELF_EDIT_FIELDS.filter((f) => f.section === section).map((f) => {
                  // Document fields gated by nationality (TODO 14).
                  if (!isFieldVisible(f)) return null;
                  // Kontaktní adresa hidden when "stejná jako trvalá" is ticked (TODO 39).
                  if (f.key === "contactAddress" && contactSameAsPermanent) return null;
                  return (
                    <div className={styles.field} key={f.key}>
                      <label className={styles.fieldLabel}>{f.label}</label>
                      {renderEditControl(f)}
                      {f.key === "permanentAddress" && (
                        <label className={styles.fieldLabel} style={{ marginTop: "0.5rem", flexDirection: "row", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={contactSameAsPermanent}
                            onChange={(e) => setContactSameAsPermanent(e.target.checked)}
                          />
                          Kontaktní adresa je stejná jako trvalá
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          <div className={styles.actionsRow}>
            {canRequestEdit && (
              <Button variant="primary" onClick={handleSubmit} disabled={submitting}>
                {submitting ? "Odesílám…" : "Odeslat ke schválení"}
              </Button>
            )}
            <Button variant="secondary" onClick={() => { setEditMode(false); setRevealed({}); setSensitiveOriginals({}); setContactSameAsPermanent(false); }} disabled={submitting}>
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
                      <span className={styles.fieldValue}>{emp?.firstName || "–"}</span>
                    </div>
                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>Příjmení</span>
                      <span className={styles.fieldValue}>{emp?.lastName || "–"}</span>
                    </div>
                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>Datum narození</span>
                      <span className={styles.fieldValue}>{emp?.dateOfBirth ? formatDateCZ(emp.dateOfBirth) : "–"}</span>
                    </div>
                    {/* Pohlaví is intentionally not shown on Můj profil – employees don't need
                        to see their own gender. It remains on the Employee detail page, and
                        emp.gender is still used here to pick the maritalStatus variant. */}
                  </>
                )}
                {SELF_EDIT_FIELDS.filter((f) => f.section === section && isFieldVisible(f)).map((f) => (
                  <div className={`${styles.field}${f.key === "permanentAddress" || f.key === "contactAddress" ? ` ${styles.fieldFull}` : ""}`} key={f.key}>
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
                <span className={styles.fieldValue}>{emp?.currentJobTitle || "–"}</span>
              </div>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Oddělení</span>
                <span className={styles.fieldValue}>{emp?.currentDepartment || "–"}</span>
              </div>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Typ smlouvy</span>
                <span className={styles.fieldValue}>{emp?.currentContractType || "–"}</span>
              </div>
            </div>
            {visibleEmployment.length > 0 && (
              <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {/* Read-only session-card view, identical format to the detail
                    page (TODO 43). The employee can't fetch companies or edit,
                    so companies is empty and all action callbacks are no-ops.
                    Rows with a not-yet-signed contract are filtered out above
                    (visibleEmployment) so "being prepared" entries stay hidden. */}
                {[...groupBySession(visibleEmployment as unknown as Parameters<typeof groupBySession>[0])]
                  .reverse()
                  .map((session, idx) => (
                    <EmploymentSessionCard
                      key={session.nastup.id}
                      session={session}
                      contractsByRow={contractByRow}
                      defaultExpanded={idx === 0}
                      companies={{}}
                      employeeId={employeeId ?? "tour-demo"}
                      resolveDefaultType={() => "nastup_hpp"}
                      resolveDisplayName={() => ""}
                      resolveRowSnapshot={() => ({})}
                      onGenerate={() => {}}
                      onEditRow={() => {}}
                      onDeleteRow={() => {}}
                      onAddDodatek={() => {}}
                      onAddRodicovska={() => {}}
                      onTerminate={() => {}}
                      onContractsChanged={() => {}}
                      onSelfDownload={handleDownloadContract}
                    />
                  ))}
              </div>
            )}
          </div>

          {/* ── Dovolená (zůstatek hodin) ── */}
          {/* Same component the detail page uses, with canManage={false}: every
              editing affordance is already behind that flag. Reads the self-scoped
              endpoint — the admin one is gated on permissions an employee lacks.
              Ungated like this page's other sections; nav.profile.view is the gate. */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Dovolená</div>
            <VacationLedgerSection basePath="/me/employee/vacation-ledger" canManage={false} />
          </div>
        </>
      )}

      {/* ── Own change requests ── */}
      <div className={styles.section} data-tour="selfpage-requests">
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
                    <span>{c.newValue ?? "–"}</span>
                  </div>
                ))}
              </div>
              {r.status === "rejected" && r.rejectionReason && (
                <div className={styles.rejectionNote}>Důvod zamítnutí: {r.rejectionReason}</div>
              )}
              {r.status === "pending" && canRequestEdit && (
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
      {phonePromptChanges && (
        <PhoneFormatModal
          phone={(phonePromptChanges.find((c) => c.field === "phone")?.newValue ?? "").trim()}
          onConfirm={(display) => {
            const updated = phonePromptChanges.map((c) =>
              c.field === "phone" ? { ...c, newValue: display } : c
            );
            setPhonePromptChanges(null);
            void submitChanges(updated);
          }}
          onCancel={() => setPhonePromptChanges(null)}
        />
      )}
    </div>
  );
}
