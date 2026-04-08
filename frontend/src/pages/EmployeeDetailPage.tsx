import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "@/lib/api";
import styles from "./EmployeeDetailPage.module.css";

type Tab = "personal" | "documents" | "contact" | "employment" | "benefits";

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  birthSurname: string;
  birthNumber: string; // "••••••••" from API
  maritalStatus: string;
  education: string;
  nationality: string;
  placeOfBirth: string;
  status: string;
  currentJobTitle: string;
  currentDepartment: string;
  currentContractType: string;
}

interface EmploymentRow {
  id: string;
  companyId: string;
  contractType: string;
  jobTitle: string;
  department: string;
  salary: number;
  startDate: string;
  endDate: string | null;
  status: string;
  changeType: string;
}

function SensitiveField({
  employeeId,
  field,
  label,
}: {
  employeeId: string;
  field: string;
  label: string;
}) {
  const [value, setValue] = useState("••••••••");
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleReveal() {
    if (revealed) {
      setValue("••••••••");
      setRevealed(false);
      return;
    }
    setLoading(true);
    try {
      const res = await api.post<{ value: string }>(
        `/employees/${employeeId}/reveal`,
        { field }
      );
      setValue(res.value);
      setRevealed(true);
    } catch {
      setValue("Chyba při načítání");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={styles.fieldValue}>
        {value}
        <button
          className={styles.revealBtn}
          onClick={handleReveal}
          disabled={loading}
          title={revealed ? "Skrýt" : "Zobrazit"}
        >
          {revealed ? "🙈" : "👁"}
        </button>
      </span>
    </div>
  );
}

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [employment, setEmployment] = useState<EmploymentRow[]>([]);
  const [tab, setTab] = useState<Tab>("personal");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      api.get<Employee>(`/employees/${id}`),
      api.get<EmploymentRow[]>(`/employees/${id}/employment`),
    ])
      .then(([emp, emp_history]) => {
        setEmployee(emp);
        setEmployment(emp_history);
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className={styles.state}>Načítám...</div>;
  if (!employee) return <div className={styles.state}>Zaměstnanec nenalezen.</div>;

  const tabs: { key: Tab; label: string }[] = [
    { key: "personal", label: "Osobní" },
    { key: "documents", label: "Doklady" },
    { key: "contact", label: "Kontakt" },
    { key: "employment", label: "Pracovní poměr" },
    { key: "benefits", label: "Benefity" },
  ];

  return (
    <div>
      <div className={styles.breadcrumb}>
        <Link to="/zamestnanci">Zaměstnanci</Link>
        <span> / </span>
        <span>
          {employee.lastName} {employee.firstName}
        </span>
      </div>

      <div className={styles.hero}>
        <div className={styles.heroName}>
          {employee.lastName} {employee.firstName}
        </div>
        <div className={styles.heroMeta}>
          {employee.currentJobTitle || "—"} · {employee.currentDepartment || "—"} ·{" "}
          <span
            className={
              employee.status === "active" ? styles.badgeActive : styles.badgeTerminated
            }
          >
            {employee.status === "active" ? "Aktivní" : "Ukončen"}
          </span>
        </div>
      </div>

      <div className={styles.tabs}>
        {tabs.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? styles.tabActive : styles.tabBtn}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={styles.panel}>
        {tab === "personal" && (
          <div className={styles.fields}>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Jméno</span>
              <span className={styles.fieldValue}>
                {employee.firstName} {employee.lastName}
              </span>
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Datum narození</span>
              <span className={styles.fieldValue}>{employee.dateOfBirth || "—"}</span>
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Pohlaví</span>
              <span className={styles.fieldValue}>
                {employee.gender === "m" ? "Muž" : employee.gender === "f" ? "Žena" : "—"}
              </span>
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Rodné příjmení</span>
              <span className={styles.fieldValue}>{employee.birthSurname || "—"}</span>
            </div>
            <SensitiveField employeeId={id!} field="birthNumber" label="Rodné číslo" />
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Rodinný stav</span>
              <span className={styles.fieldValue}>{employee.maritalStatus || "—"}</span>
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Vzdělání</span>
              <span className={styles.fieldValue}>{employee.education || "—"}</span>
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Státní příslušnost</span>
              <span className={styles.fieldValue}>{employee.nationality || "—"}</span>
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Místo narození</span>
              <span className={styles.fieldValue}>{employee.placeOfBirth || "—"}</span>
            </div>
          </div>
        )}

        {tab === "employment" && (
          <div>
            <h3 className={styles.sectionTitle}>Historie pracovního poměru</h3>
            {employment.length === 0 ? (
              <p className={styles.empty}>Žádné záznamy.</p>
            ) : (
              <div className={styles.timeline}>
                {employment.map((row) => (
                  <div key={row.id} className={styles.timelineRow}>
                    <div className={styles.timelineDot} />
                    <div className={styles.timelineContent}>
                      <div className={styles.timelineTitle}>
                        {row.jobTitle} · {row.contractType}
                      </div>
                      <div className={styles.timelineMeta}>
                        {row.startDate} — {row.endDate ?? "dosud"} · {row.department}
                      </div>
                      <div className={styles.timelineChange}>{row.changeType}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {(tab === "documents" || tab === "contact" || tab === "benefits") && (
          <div className={styles.empty}>
            Tato sekce bude implementována v dalším kroku.
          </div>
        )}
      </div>
    </div>
  );
}
