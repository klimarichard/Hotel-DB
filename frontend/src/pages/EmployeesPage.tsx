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
  // True when the CURRENT contract (most recent active) is a concurrent second
  // job worked during an active rodičovská on a DIFFERENT contract (server-owned).
  // Drives the "RODIČOVSKÁ / position" list label vs a plain "RODIČOVSKÁ".
  currentContractDuringLeave?: boolean;
  // The on-leave (main) contract's type, shown as a badge alongside the current
  // (concurrent) contract — e.g. [HPP] [DPP]. Only set while concurrent.
  leaveContractType?: string | null;
}

// In training = flag set AND (no end date, or end date today/in the future).
// Mirrors the EmployeeDetailPage banner so the badge auto-clears once it passes.
function isInTraining(emp: Employee): boolean {
  return emp.zaucovani === true && (!emp.zaucovaniDo || emp.zaucovaniDo >= clock.today());
}

// Contract-type badge class — coloured by the badge's OWN type (grey HPP /
// blue PPP / amber DPP), so a concurrent row shows each contract in its colour.
function contractBadgeClass(ct: string): string {
  if (ct === "DPP") return `${styles.contractBadge} ${styles.contractBadgeDpp}`;
  if (ct === "PPP") return `${styles.contractBadge} ${styles.contractBadgePpp}`;
  return styles.contractBadge;
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

// Position / department shown in the list. While on parental leave the column
// reads "RODIČOVSKÁ"; if the current contract is a concurrent job worked during
// that leave (currentContractDuringLeave), the current position/department
// follows a slash ("RODIČOVSKÁ/<current>"). Returns "" (not "—") when empty so
// the caller controls the empty fallback and the sort comparator reuses it.
function positionDisplay(emp: Employee): string {
  if (isOnParentalLeave(emp)) {
    return emp.currentContractDuringLeave && emp.currentJobTitle
      ? `RODIČOVSKÁ/${emp.currentJobTitle}`
      : "RODIČOVSKÁ";
  }
  return emp.currentJobTitle ?? "";
}
function departmentDisplay(emp: Employee): string {
  if (isOnParentalLeave(emp)) {
    return emp.currentContractDuringLeave && emp.currentDepartment
      ? `RODIČOVSKÁ/${emp.currentDepartment}`
      : "RODIČOVSKÁ";
  }
  return emp.currentDepartment ?? "";
}

// Cell content for the Pozice / Oddělení columns. While on parental leave the
// column leads with the "Rodičovská" badge; if the current contract is a
// concurrent job worked during that leave, the current value follows a slash
// ("[badge] / <current>"). The badge's default left margin is dropped since it
// now leads the cell. Sorting uses positionDisplay/departmentDisplay so the
// order matches what's shown.
function parentalCell(emp: Employee, base: string) {
  if (!isOnParentalLeave(emp)) return base || "—";
  const showCurrent = !!emp.currentContractDuringLeave && !!base;
  return (
    <>
      <span className={styles.parentalBadge} style={{ marginLeft: 0 }}>Rodičovská</span>
      {showCurrent && <span style={{ marginLeft: 6 }}>/ {base}</span>}
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
                    {/* On leave with a concurrent contract: show the main
                        (on-leave) contract's badge first, then the current one
                        — e.g. [HPP] [DPP]. */}
                    {emp.currentContractDuringLeave && emp.leaveContractType && (
                      <span className={contractBadgeClass(emp.leaveContractType)}>{emp.leaveContractType}</span>
                    )}
                    {emp.currentContractType && (
                      <span className={contractBadgeClass(emp.currentContractType)}>{emp.currentContractType}</span>
                    )}
                    {isInTraining(emp) && (
                      <span className={styles.trainingBadge}>V zácviku</span>
                    )}
                  </td>
                  <td>{parentalCell(emp, emp.currentJobTitle ?? "")}</td>
                  <td>{parentalCell(emp, emp.currentDepartment ?? "")}</td>
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
