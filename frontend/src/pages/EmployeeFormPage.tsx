import { useState, useEffect, FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import styles from "./EmployeeFormPage.module.css";

// ─── Constants ───────────────────────────────────────────────────────────────

const MARITAL_STATUSES = ["svobodný/á", "ženatý/vdaná", "rozvedený/á", "vdovec/vdova"];
const EDUCATIONS = [
  "A - bez vzdělání",
  "B - neúplné základní vzdělání",
  "C - základní vzdělání",
  "D - nižší střední vzdělání",
  "E - nižší střední odborné vzdělání",
  "H - střední odborné vzdělání s výučním listem",
  "J - střední nebo střední odborné vzdělání bez maturity i výučního listu",
  "K - úplné střední všeobecné vzdělání",
  "L - úplné střední odborné vzdělání s vyučením i maturitou",
  "M - úplně střední odborné vzdělání s maturitou (bez vyučení)",
  "N - vyšší odborné vzdělání",
  "P - vyšší odborné vzdělání v konzervatoři",
  "R - vysokoškolské bakalářské vzdělání",
  "T - vysokoškolské magisterské vzdělání",
  "V - vysokoškolské doktorské vzdělání",
];

// ─── State shapes ────────────────────────────────────────────────────────────

interface PersonalForm {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
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
  multisport: boolean;
  homeOffice: string;
  allowances: boolean;
}

const emptyPersonal: PersonalForm = {
  firstName: "", lastName: "", dateOfBirth: "", gender: "", birthSurname: "",
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
  multisport: false, homeOffice: "", allowances: false,
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

  const [personal, setPersonal] = useState<PersonalForm>(emptyPersonal);
  const [contact, setContact] = useState<ContactForm>(emptyContact);
  const [documents, setDocuments] = useState<DocumentsForm>(emptyDocuments);
  const [additional, setAdditional] = useState<AdditionalForm>(emptyAdditional);

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
      setEmployeeName(`${emp.lastName ?? ""} ${emp.firstName ?? ""}`.trim());
      setContact({ ...emptyContact, ...(cont ?? {}) } as ContactForm);
      // Sensitive fields start blank in edit mode (blank = keep existing encrypted value)
      setDocuments({
        ...emptyDocuments,
        ...(docs ?? {}),
        idCardNumber: "",
      } as DocumentsForm);
      setAdditional({
        ...emptyAdditional,
        ...(bens ?? {}),
        insuranceNumber: "",
        bankAccount: "",
        homeOffice: bens?.homeOffice != null ? String(bens.homeOffice) : "",
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
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

  return (
    <div className={styles.page}>
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
        {isEdit ? `Upravit — ${employeeName}` : "Nový zaměstnanec"}
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
            <Field label="Datum narození">
              <input className={styles.input} type="date" value={personal.dateOfBirth} onChange={(e) => setP("dateOfBirth", e.target.value)} />
            </Field>
            <Field label="Pohlaví">
              <select className={styles.input} value={personal.gender} onChange={(e) => setP("gender", e.target.value)}>
                <option value="">— vyberte —</option>
                <option value="m">Muž</option>
                <option value="f">Žena</option>
              </select>
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
                <option value="">— vyberte —</option>
                {MARITAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Vzdělání">
              <select className={styles.input} value={personal.education} onChange={(e) => setP("education", e.target.value)}>
                <option value="">— vyberte —</option>
                {EDUCATIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Státní příslušnost">
              <input className={styles.input} value={personal.nationality} onChange={(e) => setP("nationality", e.target.value)} />
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
              <input type="checkbox" checked={additional.multisport} onChange={(e) => setA("multisport", e.target.checked)} />
              Multisport
            </label>
          </div>
          <div className={styles.checkboxRow}>
            <label className={styles.checkboxLabel}>
              <input type="checkbox" checked={additional.allowances} onChange={(e) => setA("allowances", e.target.checked)} />
              Náhrady
            </label>
          </div>
        </section>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.actions}>
          <Link to={isEdit ? `/zamestnanci/${id}` : "/zamestnanci"} className={styles.cancelBtn}>
            Zrušit
          </Link>
          <button type="submit" className={styles.saveBtn} disabled={saving}>
            {saving ? "Ukládám…" : isEdit ? "Uložit změny" : "Vytvořit zaměstnance"}
          </button>
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
