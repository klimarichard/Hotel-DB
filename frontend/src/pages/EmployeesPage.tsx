import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import styles from "./EmployeesPage.module.css";

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  nationality: string;
  status: "active" | "terminated";
  currentCompanyId: string | null;
  currentDepartment: string;
  currentContractType: string;
  currentJobTitle: string;
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"active" | "terminated">("active");
  const [search, setSearch] = useState("");

  useEffect(() => {
    setLoading(true);
    api
      .get<Employee[]>(`/employees?status=${statusFilter}`)
      .then(setEmployees)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  const filtered = employees
    .filter((e) => {
      const q = search.toLowerCase();
      return (
        !q ||
        (e.firstName ?? "").toLowerCase().includes(q) ||
        (e.lastName ?? "").toLowerCase().includes(q) ||
        (e.currentJobTitle ?? "").toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const last = (a.lastName ?? "").localeCompare(b.lastName ?? "", "cs");
      return last !== 0 ? last : (a.firstName ?? "").localeCompare(b.firstName ?? "", "cs");
    });

  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.title}>Zaměstnanci</h1>
        <Link to="/zamestnanci/novy" className={styles.addBtn}>
          + Přidat zaměstnance
        </Link>
      </div>

      <div className={styles.filters}>
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
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Jméno</th>
              <th>Pozice</th>
              <th>Oddělení</th>
              <th>Typ smlouvy</th>
              <th>Národnost</th>
              <th>Stav</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className={styles.empty}>
                  Žádní zaměstnanci nenalezeni.
                </td>
              </tr>
            ) : (
              filtered.map((emp) => (
                <tr key={emp.id}>
                  <td>
                    <Link to={`/zamestnanci/${emp.id}`} className={styles.nameLink}>
                      {emp.lastName} {emp.firstName}
                    </Link>
                  </td>
                  <td>{emp.currentJobTitle || "—"}</td>
                  <td>{emp.currentDepartment || "—"}</td>
                  <td>{emp.currentContractType || "—"}</td>
                  <td>{emp.nationality || "—"}</td>
                  <td>
                    <span
                      className={
                        emp.status === "active" ? styles.badgeActive : styles.badgeTerminated
                      }
                    >
                      {emp.status === "active" ? "Aktivní" : "Ukončen"}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
