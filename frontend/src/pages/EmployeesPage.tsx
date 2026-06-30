import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { employeeDisplayName, employeeSurnameFirst } from "@/lib/employeeName";
import { nationalityName } from "@/lib/nationalities";
import { formatDateCZ } from "@/lib/dateFormat";
import * as clock from "@/lib/clock";
import Button from "@/components/Button";
import ExportEmployeesModal from "@/components/ExportEmployeesModal";
import styles from "./EmployeesPage.module.css";

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  displayName?: string;
  birthSurname?: string;
  nationality: string;
  status: "active" | "before-start" | "terminated";
  currentCompanyId: string | null;
  currentDepartment: string;
  currentContractType: string;
  currentJobTitle: string;
  // Continuous-employment start (NOT the latest Nástup) + effective end (or null).
  employmentStartDate?: string | null;
  employmentEndDate?: string | null;
  // "Zaučování" (training) — denormalized from the benefits sub-doc onto root.
  zaucovani?: boolean;
  zaucovaniDo?: string | null;
  // Parental-leave window — denormalized from the employment rows onto root
  // (the active-or-next "rodičovská" period). Badge shows only while today is
  // within it; the live check below makes appearance/clearing automatic.
  parentalLeaveFrom?: string | null;
  parentalLeaveTo?: string | null;
  // Concurrent (parallel) contracts — denormalized from the employment rows
  // onto root (server-owned). Each active second-job contract becomes a
  // secondary badge. Phase 1: display only — not yet paid or shift-attributed.
  additionalContracts?: AdditionalContract[];
}

interface AdditionalContract {
  nastupRowId: string;
  contractType: string;
  jobTitle: string;
  department: string;
  companyId: string | null;
  startDate: string | null;
  endDate: string | null;
}

// In training = flag set AND (no end date, or end date today/in the future).
// Mirrors the EmployeeDetailPage banner so the badge auto-clears once it passes.
function isInTraining(emp: Employee): boolean {
  return emp.zaucovani === true && (!emp.zaucovaniDo || emp.zaucovaniDo >= clock.today());
}

// On parental leave = today is on/after the start and (if an end date is set)
// on/before it. An open-ended period (no end date yet — unknown when leave
// begins) keeps the badge until an end date is later filled in and passes.
function isOnParentalLeave(emp: Employee): boolean {
  const today = clock.today();
  return (
    !!emp.parentalLeaveFrom &&
    emp.parentalLeaveFrom <= today &&
    (!emp.parentalLeaveTo || today <= emp.parentalLeaveTo)
  );
}

// Position / department shown in the list. While on parental leave the primary
// contract is paused, so its column reads "RODIČOVSKÁ"; if the employee also
// holds a concurrent contract, that contract's value follows a slash
// ("RODIČOVSKÁ/<concurrent>"). Several concurrent contracts join with "/".
// Returns "" (not "—") when empty so the caller controls the empty fallback and
// the sort comparator can reuse the same value.
function positionDisplay(emp: Employee): string {
  if (isOnParentalLeave(emp)) {
    const extra = (emp.additionalContracts ?? []).map((c) => c.jobTitle).filter(Boolean);
    return extra.length ? `RODIČOVSKÁ/${extra.join("/")}` : "RODIČOVSKÁ";
  }
  return emp.currentJobTitle ?? "";
}
function departmentDisplay(emp: Employee): string {
  if (isOnParentalLeave(emp)) {
    const extra = (emp.additionalContracts ?? []).map((c) => c.department).filter(Boolean);
    return extra.length ? `RODIČOVSKÁ/${extra.join("/")}` : "RODIČOVSKÁ";
  }
  return emp.currentDepartment ?? "";
}

// Cell content for the Pozice / Oddělení columns. While on parental leave the
// column leads with the "Rodičovská" badge (the primary contract is paused),
// followed by any concurrent contract's value ("[badge] / <concurrent>");
// otherwise the plain text. The badge's default left margin is dropped since it
// now leads the cell. Sorting still uses positionDisplay/departmentDisplay so
// the order matches what's shown.
function parentalCell(emp: Employee, base: string, extra: string[]) {
  if (!isOnParentalLeave(emp)) return base || "—";
  const tail = extra.filter(Boolean);
  return (
    <>
      <span className={styles.parentalBadge} style={{ marginLeft: 0 }}>Rodičovská</span>
      {tail.length > 0 && <span style={{ marginLeft: 6 }}>/ {tail.join(" / ")}</span>}
    </>
  );
}

// Every column is sortable except Stav (which mirrors the three tabs, so a sort
// would be redundant). "name" sorts by surname then first name.
type SortKey = "name" | "jobTitle" | "department" | "nationality" | "startDate" | "endDate";

// Reused Czech collator (numeric so any digits inside a value sort naturally).
const csCollator = new Intl.Collator("cs", { sensitivity: "base", numeric: true });

// The string a row contributes for a given sort key. Date keys return the raw
// ISO string (lexicographic === chronological); text keys return the displayed
// text so the sort matches what the user reads (e.g. resolved nationality name).
function sortValue(e: Employee, key: SortKey): string {
  switch (key) {
    case "jobTitle":
      return positionDisplay(e);
    case "department":
      return departmentDisplay(e);
    case "nationality":
      return e.nationality ? nationalityName(e.nationality) : "";
    case "startDate":
      return e.employmentStartDate ?? "";
    case "endDate":
      return e.employmentEndDate ?? "";
    default:
      return "";
  }
}

export default function EmployeesPage() {
  const { can } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"active" | "before-start" | "terminated">("active");
  const [search, setSearch] = useState("");
  const [showExport, setShowExport] = useState(false);
  // Default sort: surname A→Z (matches the previous hard-coded order).
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Click a header: same column toggles direction; a new column starts at asc.
  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get<Employee[]>(`/employees?status=active`),
      api.get<Employee[]>(`/employees?status=before-start`),
      api.get<Employee[]>(`/employees?status=terminated`),
    ])
      .then(([active, beforeStart, terminated]) => setEmployees([...active, ...beforeStart, ...terminated]))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const q = search.toLowerCase();
  const filtered = employees
    // When searching, match across BOTH tabs; otherwise show only the current tab.
    .filter((e) => (q ? true : e.status === statusFilter))
    .filter((e) => {
      return (
        !q ||
        (e.firstName ?? "").toLowerCase().includes(q) ||
        (e.lastName ?? "").toLowerCase().includes(q) ||
        (e.birthSurname ?? "").toLowerCase().includes(q) ||
        employeeDisplayName(e).toLowerCase().includes(q) ||
        (e.currentJobTitle ?? "").toLowerCase().includes(q) ||
        (e.nationality ?? "").toLowerCase().includes(q) ||
        (e.nationality ? nationalityName(e.nationality) : "").toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const mul = sortDir === "asc" ? 1 : -1;
      if (sortKey === "name") {
        const last = csCollator.compare(a.lastName ?? "", b.lastName ?? "");
        const r = last !== 0 ? last : csCollator.compare(a.firstName ?? "", b.firstName ?? "");
        return r * mul;
      }
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      // Missing values (e.g. blank Datum ukončení) always sink to the bottom,
      // regardless of sort direction.
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      if (sortKey === "startDate" || sortKey === "endDate") return av.localeCompare(bv) * mul;
      return csCollator.compare(av, bv) * mul;
    });

  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.title}>Zaměstnanci</h1>
        <div className={styles.headerActions}>
          {can("employees.export") && (
            <Button variant="secondary" data-tour="emp-export" onClick={() => setShowExport(true)}>
              Exportovat CSV
            </Button>
          )}
          {can("employees.create") && (
            <Link to="/zamestnanci/novy" className={styles.addBtn} data-tour="emp-create">
              + Přidat zaměstnance
            </Link>
          )}
        </div>
      </div>

      {showExport && <ExportEmployeesModal onClose={() => setShowExport(false)} />}

      <div className={styles.filters} data-tour="emp-filters">
        <input
          className={styles.search}
          type="text"
          placeholder="Hledat jméno nebo pozici..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className={styles.toggle}>
          <button
            className={statusFilter === "active" ? styles.toggleActive : styles.toggleBtn}
            onClick={() => setStatusFilter("active")}
          >
            Aktivní
          </button>
          <button
            className={statusFilter === "before-start" ? styles.toggleActive : styles.toggleBtn}
            onClick={() => setStatusFilter("before-start")}
          >
            Před nástupem
          </button>
          <button
            className={statusFilter === "terminated" ? styles.toggleActive : styles.toggleBtn}
            onClick={() => setStatusFilter("terminated")}
          >
            Ukončení
          </button>
        </div>
      </div>

      {loading && <div className={styles.state}>Načítám...</div>}
      {error && <div className={styles.errorState}>{error}</div>}

      {!loading && !error && (
        <div className={styles.tableScroll}>
        <table className={styles.table} data-tour="emp-list">
          <thead>
            <tr>
              {(
                [
                  ["name", "Jméno"],
                  ["jobTitle", "Pozice"],
                  ["department", "Oddělení"],
                  ["nationality", "Národnost"],
                  ["startDate", "Datum nástupu"],
                  ["endDate", "Datum ukončení"],
                ] as [SortKey, string][]
              ).map(([key, label]) => (
                <th
                  key={key}
                  className={styles.sortable}
                  onClick={() => toggleSort(key)}
                  aria-sort={
                    sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : "none"
                  }
                >
                  {label}
                  {sortKey === key && (
                    <span className={styles.sortArrow}>{sortDir === "asc" ? "▲" : "▼"}</span>
                  )}
                </th>
              ))}
              <th>Stav</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className={styles.empty}>
                  Žádní zaměstnanci nenalezeni.
                </td>
              </tr>
            ) : (
              filtered.map((emp) => (
                <tr
                  key={emp.id}
                  className={
                    emp.currentContractType === "DPP"
                      ? styles.dppRow
                      : emp.currentContractType === "PPP"
                        ? styles.pppRow
                        : ""
                  }
                >
                  <td>
                    <Link to={`/zamestnanci/${emp.id}`} className={styles.nameLink}>
                      {employeeSurnameFirst(emp)}
                    </Link>
                    {emp.currentContractType && (
                      <span className={styles.contractBadge}>{emp.currentContractType}</span>
                    )}
                    {isInTraining(emp) && (
                      <span className={styles.trainingBadge}>V zácviku</span>
                    )}
                    {(emp.additionalContracts ?? []).map((c) => (
                      <span
                        key={c.nastupRowId}
                        className={styles.concurrentBadge}
                        title={
                          `Souběžná smlouva: ${c.contractType}` +
                          (c.jobTitle ? ` · ${c.jobTitle}` : "") +
                          (c.department ? ` (${c.department})` : "") +
                          " — zatím se nepromítá do mezd ani směn"
                        }
                      >
                        + {c.contractType}
                      </span>
                    ))}
                  </td>
                  <td>{parentalCell(emp, emp.currentJobTitle ?? "", (emp.additionalContracts ?? []).map((c) => c.jobTitle))}</td>
                  <td>{parentalCell(emp, emp.currentDepartment ?? "", (emp.additionalContracts ?? []).map((c) => c.department))}</td>
                  <td>{emp.nationality ? nationalityName(emp.nationality) : "—"}</td>
                  <td>{formatDateCZ(emp.employmentStartDate) || "—"}</td>
                  <td>{formatDateCZ(emp.employmentEndDate) || "—"}</td>
                  <td>
                    <span
                      className={
                        emp.status === "active"
                          ? styles.badgeActive
                          : emp.status === "before-start"
                            ? styles.badgeBeforeStart
                            : styles.badgeTerminated
                      }
                    >
                      {emp.status === "active"
                        ? "Aktivní"
                        : emp.status === "before-start"
                          ? "Před nástupem"
                          : "Ukončen"}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
