import { useState, useEffect, useRef, FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import Button from "@/components/Button";
import ConfirmModal from "@/components/ConfirmModal";
import PhoneFormatModal from "@/components/PhoneFormatModal";
import { needsPhoneFormatPrompt } from "@/lib/phoneFormat";
import { NATIONALITIES, nationalityName } from "@/lib/nationalities";
import { employeeDisplayName } from "@/lib/employeeName";
import { isCzechNationality } from "@/lib/contractVariables";
import * as clock from "@/lib/clock";
import styles from "./EmployeeFormPage.module.css";

// Nationality is a free-text searchable field (datalist) storing the alpha-3 code.
function natLabel(code: string): string {
  return NATIONALITIES.some((n) => n.code === code) ? `${code} – ${nationalityName(code)}` : code;
}
function resolveNationalityCode(v: string): string {
  const t = v.trim();
  if (!t) return "";
  const byLabel = NATIONALITIES.find((n) => `${n.code} – ${n.name}` === t);
  if (byLabel) return byLabel.code;
  const byCode = NATIONALITIES.find((n) => n.code === t.toUpperCase());
  if (byCode) return byCode.code;
  const byName = NATIONALITIES.find((n) => n.name.toLowerCase() === t.toLowerCase());
  if (byName) return byName.code;
  return "";
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MARITAL_STATUSES = ["svobodný/á", "ženatý/vdaná", "rozvedený/á", "vdovec/vdova"];

// ─── State shapes ────────────────────────────────────────────────────────────

interface PersonalForm {
  firstName: string;
  lastName: string;
  displayName: string;
  dateOfBirth: string;
  gender: string;
  // When true, gendered Czech strings (e.g. rodinný stav "ženatý/vdaná") are
  // shown in their combined/unresolved form everywhere this employee is
  // displayed, instead of being resolved to the gender variant.
  genderNeutralDisplay: boolean;
  birthSurname: string;
  birthNumber: string;
  maritalStatus: string;
  education: string;
  nationality: string;
  placeOfBirth: string;
}

interface ContactForm {
  phone: string;
  email: string;
  permanentAddress: string;
  contactAddressSameAsPermanent: boolean;
  contactAddress: string;
}

interface DocumentsForm {
  idCardNumber: string;
  passportNumber: string;
  passportIssueDate: string;
  passportExpiry: string;
  passportAuthority: string;
  visaNumber: string;
  visaType: string;
  visaIssueDate: string;
  visaExpiry: string;
}

interface AdditionalForm {
  insuranceNumber: string;
  insuranceCompany: string;
  bankAccount: string;
  homeOffice: string;
  allowances: boolean;
  nepodepiseProhlaseni: boolean;
  zaucovani: boolean;
  zaucovaniDo: string;
}

const emptyPersonal: PersonalForm = {
  firstName: "", lastName: "", displayName: "", dateOfBirth: "", gender: "", genderNeutralDisplay: false, birthSurname: "",
  birthNumber: "", maritalStatus: "", education: "", nationality: "",
  placeOfBirth: "",
};

const emptyContact: ContactForm = {
  phone: "", email: "", permanentAddress: "", contactAddressSameAsPermanent: false, contactAddress: "",
};

const emptyDocuments: DocumentsForm = {
  idCardNumber: "", passportNumber: "", passportIssueDate: "",
  passportExpiry: "", passportAuthority: "", visaNumber: "", visaType: "", visaIssueDate: "", visaExpiry: "",
};

const emptyAdditional: AdditionalForm = {
  insuranceNumber: "", insuranceCompany: "", bankAccount: "",
  homeOffice: "", allowances: false, nepodepiseProhlaseni: false,
  zaucovani: false, zaucovaniDo: "",
};

// ─── SensitiveInput ───────────────────────────────────────────────────────────
// In edit mode: shows input + "Smazat" button, or a "Bude smazáno" state with undo.
// In create mode: plain input.

function SensitiveInput({
  value,
  onChange,
  isEdit,
  isCleared,
  onClear,
  onUnclear,
  placeholder,
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  isEdit: boolean;
  isCleared: boolean;
  onClear: () => void;
  onUnclear: () => void;
  placeholder?: string;
  type?: string;
}) {
  if (isEdit && isCleared) {
    return (
      <div className={styles.clearedField}>
        <span className={styles.clearedText}>Bude smazáno</span>
        <button type="button" className={styles.unclearBtn} onClick={onUnclear}>
          Zpět
        </button>
      </div>
    );
  }
  return (
    <div className={styles.sensitiveRow}>
      <input
        className={styles.input}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {isEdit && (
        <button type="button" className={styles.clearBtn} onClick={onClear} title="Smazat uloženou hodnotu">
          Smazat
        </button>
      )}
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function EmployeeFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEdit = !!id;
  const navigate = useNavigate();

  const [loadingData, setLoadingData] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [employeeName, setEmployeeName] = useState("");
  // Terminated employee matching the new hire (name + birthdate) – drives the
  // reactivate-vs-create-duplicate prompt.
  const [dupMatch, setDupMatch] = useState<
    { id: string; firstName: string; lastName: string; dobMatched: boolean } | null
  >(null);

  const [personal, setPersonal] = useState<PersonalForm>(emptyPersonal);
  const [contact, setContact] = useState<ContactForm>(emptyContact);
  const [documents, setDocuments] = useState<DocumentsForm>(emptyDocuments);
  const [additional, setAdditional] = useState<AdditionalForm>(emptyAdditional);
  // Previously-stored phone, to detect a changed non-+420 number on save (then
  // prompt for its display format). Empty for a brand-new employee.
  const initialPhone = useRef("");
  const [phonePrompt, setPhonePrompt] = useState(false);

  const [educationOptions, setEducationOptions] = useState<string[]>([]);
  // Display text for the searchable nationality field (the code lives in personal.nationality).
  const [natQuery, setNatQuery] = useState("");

  useEffect(() => {
    api.get<Array<{ id: string; name: string; code: string }>>("/educationLevels")
      .then((list) => setEducationOptions(
        list.map((l) => (l.code ? `${l.code} - ${l.name}` : l.name))
      ))
      .catch(() => setEducationOptions([]));
  }, []);

  // Tracks which sensitive fields the user has explicitly marked for deletion
  const [cleared, setCleared] = useState<Set<string>>(new Set());

  function markCleared(field: string) {
    setCleared((prev) => new Set(prev).add(field));
  }
  function unmarkCleared(field: string) {
    setCleared((prev) => { const s = new Set(prev); s.delete(field); return s; });
  }

  useEffect(() => {
    if (!isEdit || !id) return;
    Promise.all([
      api.get<Record<string, unknown>>(`/employees/${id}`),
      api.get<Record<string, unknown> | null>(`/employees/${id}/contact`),
      api.get<Record<string, unknown> | null>(`/employees/${id}/documents`),
      api.get<Record<string, unknown> | null>(`/employees/${id}/benefits`),
    ]).then(([emp, cont, docs, bens]) => {
      const p = { ...emptyPersonal, ...emp, birthNumber: "" } as PersonalForm;
      setPersonal(p);
      setNatQuery(emp.nationality ? natLabel(emp.nationality as string) : "");
      // Breadcrumb + "Upravit – …" title. Uses the display name so it matches the
      // detail page it links back to (whose hero shows the display name); the
      // surname-first legal form stays in the Zaměstnanci list and the pickers.
      setEmployeeName(employeeDisplayName(emp as Parameters<typeof employeeDisplayName>[0]));
      setContact({ ...emptyContact, ...(cont ?? {}) } as ContactForm);
      initialPhone.current = ((cont?.phone as string) ?? "").trim();
      // Sensitive fields start blank in edit mode (blank = keep existing encrypted value)
      setDocuments({
        ...emptyDocuments,
        ...(docs ?? {}),
        idCardNumber: "",
      } as DocumentsForm);
      // Auto-untick "Zaučování" once its end date has passed: load it as
      // unticked when zaucovaniDo is set and in the past (saving then persists
      // the cleared flag). No end date = stays ticked until manually cleared.
      const zDo = typeof bens?.zaucovaniDo === "string" ? (bens.zaucovaniDo as string) : "";
      const zStillActive = bens?.zaucovani === true && (zDo === "" || zDo >= clock.today());
      setAdditional({
        ...emptyAdditional,
        ...(bens ?? {}),
        insuranceNumber: "",
        bankAccount: "",
        homeOffice: bens?.homeOffice != null ? String(bens.homeOffice) : "",
        zaucovani: zStillActive,
        zaucovaniDo: zDo,
      } as AdditionalForm);
    }).finally(() => setLoadingData(false));
  }, [id, isEdit]);

  function setP(field: keyof PersonalForm, value: string) {
    setPersonal((f) => ({ ...f, [field]: value }));
  }
  function setC(field: keyof ContactForm, value: string | boolean) {
    setContact((f) => ({ ...f, [field]: value }));
  }
  function setD(field: keyof DocumentsForm, value: string) {
    setDocuments((f) => ({ ...f, [field]: value }));
  }
  function setA(field: keyof AdditionalForm, value: string | boolean) {
    setAdditional((f) => ({ ...f, [field]: value }));
  }

  // Best-effort lookup of a terminated employee matching the new hire by name
  // (+ birthdate when provided). Never blocks creation if it fails.
  async function findTerminatedMatch(): Promise<
    { id: string; firstName: string; lastName: string; dobMatched: boolean } | null
  > {
    const f = personal.firstName.trim().toLowerCase();
    const l = personal.lastName.trim().toLowerCase();
    if (!f || !l) return null;
    const dob = personal.dateOfBirth;
    try {
      const list = await api.get<
        Array<{ id: string; firstName: string; lastName: string; dateOfBirth?: string }>
      >("/employees?status=terminated");
      for (const emp of list) {
        const nameEq =
          (emp.firstName ?? "").trim().toLowerCase() === f &&
          (emp.lastName ?? "").trim().toLowerCase() === l;
        if (!nameEq) continue;
        // With a birthdate, require it to match (distinguishes namesakes).
        // Without one, match on name alone (a softer "possible match").
        if (dob) {
          if ((emp.dateOfBirth ?? "") === dob) {
            return { id: emp.id, firstName: emp.firstName, lastName: emp.lastName, dobMatched: true };
          }
        } else {
          return { id: emp.id, firstName: emp.firstName, lastName: emp.lastName, dobMatched: false };
        }
      }
    } catch {
      // Ignore – the match check must never prevent creating an employee.
    }
    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // For a brand-new employee, offer to reactivate a matching terminated one
    // instead of creating a duplicate.
    if (!isEdit) {
      setSaving(true);
      setError(null);
      const match = await findTerminatedMatch();
      if (match) {
        setSaving(false);
        setDupMatch(match);
        return;
      }
    }
    await doSave();
  }

  async function doSave(phoneOverride?: string) {
    // Non-+420 numbers get a one-time "how should this display?" prompt; the
    // confirmed string comes back as phoneOverride and is stored verbatim.
    if (phoneOverride === undefined && needsPhoneFormatPrompt(contact.phone, initialPhone.current)) {
      setPhonePrompt(true);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      let empId = id;

      // ── Personal + job assignment ──────────────────────────────────────────
      const personalPayload: Record<string, unknown> = { ...personal };
      if (!personalPayload.birthNumber) delete personalPayload.birthNumber;
      const personalClearFields = ["birthNumber"].filter((f) => cleared.has(f));
      if (personalClearFields.length) personalPayload.clearFields = personalClearFields;

      if (isEdit) {
        await api.patch(`/employees/${empId}`, personalPayload);
      } else {
        const res = await api.post<{ id: string }>("/employees", personalPayload);
        empId = res.id;
      }

      // ── Contact ───────────────────────────────────────────────────────────
      const contactPayload = { ...contact };
      if (phoneOverride !== undefined) contactPayload.phone = phoneOverride;
      if (contactPayload.contactAddressSameAsPermanent) {
        contactPayload.contactAddress = contactPayload.permanentAddress;
      }

      // ── Documents ─────────────────────────────────────────────────────────
      const docsPayload: Record<string, unknown> = { ...documents };
      if (!docsPayload.idCardNumber) delete docsPayload.idCardNumber;
      const docsClearFields = ["idCardNumber"].filter((f) => cleared.has(f));
      if (docsClearFields.length) docsPayload.clearFields = docsClearFields;

      // ── Additional info ───────────────────────────────────────────────────
      const addPayload: Record<string, unknown> = { ...additional };
      if (!addPayload.insuranceNumber) delete addPayload.insuranceNumber;
      if (!addPayload.bankAccount) delete addPayload.bankAccount;
      addPayload.homeOffice = additional.homeOffice !== "" ? Number(additional.homeOffice) : null;
      // Multisport is managed by the dedicated editor on the employee detail page
      // (PUT /multisport). Strip any multisport fields the loaded benefits doc may
      // have spread into the form state so this benefits save never overwrites them.
      delete addPayload.multisport;
      delete addPayload.multisportFrom;
      delete addPayload.multisportTo;
      delete addPayload.multisportPeriods;
      delete addPayload.multisportCompanions;
      const addClearFields = ["insuranceNumber", "bankAccount"].filter((f) => cleared.has(f));
      if (addClearFields.length) addPayload.clearFields = addClearFields;

      await Promise.all([
        api.put(`/employees/${empId}/contact`, contactPayload),
        api.put(`/employees/${empId}/documents`, docsPayload),
        api.put(`/employees/${empId}/benefits`, addPayload),
      ]);

      navigate(`/zamestnanci/${empId}`);
    } catch (err: unknown) {
      setError((err as Error).message ?? "Chyba při ukládání.");
    } finally {
      setSaving(false);
    }
  }

  if (loadingData) return <div className={styles.state}>Načítám…</div>;

  const sensitiveHint = isEdit ? "Ponechte prázdné pro zachování stávající hodnoty" : "";

  // Nationality drives which document subsections show (TODO 14):
  // Czech → only OP; foreign (set) → only passport + visa; empty → all.
  const isCz = isCzechNationality(personal.nationality);
  const hasNat = !!personal.nationality;

  return (
    <div className={styles.page}>
      {phonePrompt && (
        <PhoneFormatModal
          phone={contact.phone.trim()}
          onConfirm={(display) => {
            setPhonePrompt(false);
            setContact((c) => ({ ...c, phone: display }));
            void doSave(display);
          }}
          onCancel={() => setPhonePrompt(false)}
        />
      )}
      {dupMatch && (
        <ConfirmModal
          title={dupMatch.dobMatched ? "Nalezen ukončený zaměstnanec" : "Možná shoda se zaměstnancem"}
          message={
            `${dupMatch.firstName} ${dupMatch.lastName} je již v systému jako ukončený zaměstnanec` +
            (dupMatch.dobMatched ? " (shoduje se jméno i datum narození)." : " (shoduje se jméno).") +
            " Můžete otevřít jeho profil a upravit údaje – nový pracovní poměr (Nástup) pak přidáte ručně v historii. Nebo přesto vytvořit nového."
          }
          confirmLabel="Reaktivovat a upravit údaje"
          tertiary={{
            label: "Přesto vytvořit nového",
            variant: "secondary",
            onClick: () => {
              setDupMatch(null);
              void doSave();
            },
          }}
          cancelLabel="Zrušit"
          onConfirm={() => {
            const targetId = dupMatch.id;
            setDupMatch(null);
            navigate(`/zamestnanci/${targetId}/upravit`);
          }}
          onCancel={() => setDupMatch(null)}
        />
      )}
      <div className={styles.breadcrumb}>
        <Link to="/zamestnanci">Zaměstnanci</Link>
        {isEdit && (
          <>
            <span> / </span>
            <Link to={`/zamestnanci/${id}`}>{employeeName}</Link>
          </>
        )}
        <span> / </span>
        <span>{isEdit ? "Upravit" : "Nový zaměstnanec"}</span>
      </div>

      <h1 className={styles.title}>
        {isEdit ? `Upravit – ${employeeName}` : "Nový zaměstnanec"}
      </h1>

      <form onSubmit={handleSubmit}>

        {/* ── Osobní údaje ─────────────────────────────────────────────────── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Osobní údaje</h2>
          <div className={styles.grid}>
            <Field label="Jméno *">
              <input className={styles.input} value={personal.firstName} onChange={(e) => setP("firstName", e.target.value)} required />
            </Field>
            <Field label="Příjmení *">
              <input className={styles.input} value={personal.lastName} onChange={(e) => setP("lastName", e.target.value)} required />
            </Field>
            <Field label="Zobrazované jméno">
              <input
                className={styles.input}
                value={personal.displayName}
                onChange={(e) => setP("displayName", e.target.value)}
                placeholder={`${personal.firstName} ${personal.lastName}`.trim() || "Jméno Příjmení"}
                title="Zkrácené jméno zobrazené v plánu směn, mzdách a přehledech. Necháte-li prázdné, použije se „Jméno Příjmení“."
              />
            </Field>
            <Field label="Datum narození">
              <input className={styles.input} type="date" value={personal.dateOfBirth} onChange={(e) => setP("dateOfBirth", e.target.value)} />
            </Field>
            <Field label="Pohlaví">
              <select className={styles.input} value={personal.gender} onChange={(e) => setP("gender", e.target.value)}>
                <option value="">– vyberte –</option>
                <option value="m">Muž</option>
                <option value="f">Žena</option>
              </select>
              <label style={{ marginTop: "0.5rem", display: "flex", flexDirection: "row", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontWeight: 400 }}>
                <input
                  type="checkbox"
                  checked={personal.genderNeutralDisplay}
                  onChange={(e) => setPersonal((f) => ({ ...f, genderNeutralDisplay: e.target.checked }))}
                />
                Nerozlišovat tvary podle pohlaví
              </label>
              <span style={{ marginTop: "0.25rem", fontSize: "0.8rem", color: "var(--color-text-muted)" }}>Rodinný stav se zobrazí v kombinovaném tvaru (např. „ženatý/vdaná").</span>
            </Field>
            <Field label="Rodné příjmení">
              <input className={styles.input} value={personal.birthSurname} onChange={(e) => setP("birthSurname", e.target.value)} />
            </Field>
            <Field label="Rodné číslo">
              <SensitiveInput
                value={personal.birthNumber}
                onChange={(v) => setP("birthNumber", v)}
                isEdit={isEdit}
                isCleared={cleared.has("birthNumber")}
                onClear={() => markCleared("birthNumber")}
                onUnclear={() => unmarkCleared("birthNumber")}
                placeholder={sensitiveHint || "000000/0000"}
              />
            </Field>
            <Field label="Rodinný stav">
              <select className={styles.input} value={personal.maritalStatus} onChange={(e) => setP("maritalStatus", e.target.value)}>
                <option value="">– vyberte –</option>
                {MARITAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Vzdělání">
              <select className={styles.input} value={personal.education} onChange={(e) => setP("education", e.target.value)}>
                <option value="">– vyberte –</option>
                {educationOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                {personal.education && !educationOptions.includes(personal.education) && (
                  <option value={personal.education}>{personal.education}</option>
                )}
              </select>
            </Field>
            <Field label="Státní příslušnost">
              <input
                className={styles.input}
                list="nationalityOptions"
                value={natQuery}
                placeholder="Začněte psát kód nebo název (např. CZE, Slovensko)…"
                onChange={(e) => {
                  const v = e.target.value;
                  setNatQuery(v);
                  setP("nationality", resolveNationalityCode(v));
                }}
              />
              <datalist id="nationalityOptions">
                {NATIONALITIES.map((n) => (
                  <option key={n.code} value={`${n.code} – ${n.name}`} />
                ))}
              </datalist>
            </Field>
            <Field label="Místo narození">
              <input className={styles.input} value={personal.placeOfBirth} onChange={(e) => setP("placeOfBirth", e.target.value)} />
            </Field>
          </div>
        </section>

        {/* ── Kontakt ──────────────────────────────────────────────────────── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Kontakt</h2>
          <div className={styles.grid}>
            <Field label="Telefon">
              <input className={styles.input} type="tel" value={contact.phone} onChange={(e) => setC("phone", e.target.value)} />
            </Field>
            <Field label="E-mail">
              <input className={styles.input} type="email" value={contact.email} onChange={(e) => setC("email", e.target.value)} />
            </Field>
          </div>
          <div className={styles.gridFull}>
            <Field label="Trvalá adresa">
              <input className={styles.input} value={contact.permanentAddress} onChange={(e) => setC("permanentAddress", e.target.value)} placeholder="Ulice čp., Město, PSČ, Stát" />
            </Field>
          </div>
          <div className={styles.checkboxRow}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={contact.contactAddressSameAsPermanent}
                onChange={(e) => setC("contactAddressSameAsPermanent", e.target.checked)}
              />
              Kontaktní adresa je stejná jako trvalá
            </label>
          </div>
          {!contact.contactAddressSameAsPermanent && (
            <div className={styles.gridFull}>
              <Field label="Kontaktní adresa">
                <input className={styles.input} value={contact.contactAddress} onChange={(e) => setC("contactAddress", e.target.value)} placeholder="Ulice čp., Město, PSČ, Stát" />
              </Field>
            </div>
          )}
        </section>

        {/* ── Doklady ──────────────────────────────────────────────────────── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Doklady</h2>

          {(isCz || !hasNat) && (
            <>
              <p className={styles.subsectionLabel}>Občanský průkaz</p>
              <div className={styles.grid}>
                <Field label="Číslo OP">
                  <SensitiveInput
                    value={documents.idCardNumber}
                    onChange={(v) => setD("idCardNumber", v)}
                    isEdit={isEdit}
                    isCleared={cleared.has("idCardNumber")}
                    onClear={() => markCleared("idCardNumber")}
                    onUnclear={() => unmarkCleared("idCardNumber")}
                    placeholder={sensitiveHint}
                  />
                </Field>
              </div>
            </>
          )}

          {!isCz && (
            <>
              <p className={styles.subsectionLabel}>Cestovní pas</p>
              <div className={styles.grid}>
                <Field label="Číslo pasu">
                  <input className={styles.input} value={documents.passportNumber} onChange={(e) => setD("passportNumber", e.target.value)} />
                </Field>
                <Field label="Datum vydání pasu">
                  <input className={styles.input} type="date" value={documents.passportIssueDate} onChange={(e) => setD("passportIssueDate", e.target.value)} />
                </Field>
                <Field label="Platnost pasu">
                  <input className={styles.input} type="date" value={documents.passportExpiry} onChange={(e) => setD("passportExpiry", e.target.value)} />
                </Field>
                <Field label="Vydal">
                  <input className={styles.input} value={documents.passportAuthority} onChange={(e) => setD("passportAuthority", e.target.value)} />
                </Field>
              </div>

              <p className={styles.subsectionLabel}>Povolení k pobytu</p>
              <div className={styles.grid}>
                <Field label="Číslo povolení k pobytu">
                  <input className={styles.input} value={documents.visaNumber} onChange={(e) => setD("visaNumber", e.target.value)} />
                </Field>
                <Field label="Typ povolení k pobytu">
                  <input className={styles.input} value={documents.visaType} onChange={(e) => setD("visaType", e.target.value)} />
                </Field>
                <Field label="Datum vydání povolení">
                  <input className={styles.input} type="date" value={documents.visaIssueDate} onChange={(e) => setD("visaIssueDate", e.target.value)} />
                </Field>
                <Field label="Platnost povolení">
                  <input className={styles.input} type="date" value={documents.visaExpiry} onChange={(e) => setD("visaExpiry", e.target.value)} />
                </Field>
              </div>
            </>
          )}
        </section>

        {/* ── Doplňující informace ─────────────────────────────────────────── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Doplňující informace</h2>
          <p className={styles.subsectionLabel}>Pojištění a bankovní účet</p>
          <div className={styles.grid}>
            <Field label="Číslo pojištění">
              <SensitiveInput
                value={additional.insuranceNumber}
                onChange={(v) => setA("insuranceNumber", v)}
                isEdit={isEdit}
                isCleared={cleared.has("insuranceNumber")}
                onClear={() => markCleared("insuranceNumber")}
                onUnclear={() => unmarkCleared("insuranceNumber")}
                placeholder={sensitiveHint}
              />
            </Field>
            <Field label="Pojišťovna">
              <input className={styles.input} value={additional.insuranceCompany} onChange={(e) => setA("insuranceCompany", e.target.value)} />
            </Field>
            <Field label="Číslo bankovního účtu">
              <SensitiveInput
                value={additional.bankAccount}
                onChange={(v) => setA("bankAccount", v)}
                isEdit={isEdit}
                isCleared={cleared.has("bankAccount")}
                onClear={() => markCleared("bankAccount")}
                onUnclear={() => unmarkCleared("bankAccount")}
                placeholder={sensitiveHint}
              />
            </Field>
          </div>

          <p className={styles.subsectionLabel}>Benefity</p>
          <div className={styles.grid}>
            <Field label="Home office (hodin/měsíc)">
              <input
                className={styles.input}
                type="number"
                min="0"
                value={additional.homeOffice}
                onChange={(e) => setA("homeOffice", e.target.value)}
                placeholder="0"
              />
            </Field>
          </div>
          <div className={styles.checkboxRow}>
            <label className={styles.checkboxLabel}>
              <input type="checkbox" checked={additional.allowances} onChange={(e) => setA("allowances", e.target.checked)} />
              Náhrady
            </label>
          </div>
          <div className={styles.checkboxRow}>
            <label className={styles.checkboxLabel}>
              <input type="checkbox" checked={additional.nepodepiseProhlaseni} onChange={(e) => setA("nepodepiseProhlaseni", e.target.checked)} />
              Nepodepíše prohlášení poplatníka
            </label>
          </div>
          <div className={styles.checkboxRow}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={additional.zaucovani}
                onChange={(e) => setA("zaucovani", e.target.checked)}
              />
              Zaučování
            </label>
          </div>
          {additional.zaucovani && (
            <div className={styles.grid}>
              <Field label="Zaučování do">
                <input
                  className={styles.input}
                  type="date"
                  value={additional.zaucovaniDo}
                  onChange={(e) => setA("zaucovaniDo", e.target.value)}
                />
              </Field>
            </div>
          )}
        </section>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.actions}>
          <Link to={isEdit ? `/zamestnanci/${id}` : "/zamestnanci"} className={styles.cancelBtn}>
            Zrušit
          </Link>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "Ukládám…" : isEdit ? "Uložit změny" : "Vytvořit zaměstnance"}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.field}>
      <label className={styles.label}>{label}</label>
      {children}
    </div>
  );
}
