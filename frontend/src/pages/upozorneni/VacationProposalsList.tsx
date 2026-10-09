import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { MONTH_NAMES } from "@/lib/dateFormat";
import { employeeDisplayName } from "@/lib/employeeName";
import styles from "../AlertsPage.module.css";

/**
 * Read-only list of pending vacation-balance proposals created by the payroll
 * check (Kontrola mezd). Accept / dismiss happens on /dovolena – this list only
 * points there. Mounted only with employees.vacationBalance.manage (the
 * endpoint enforces the same key).
 */
interface VacationProposal {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  year: number;
  month: number;
  contract: string;
  slipName: string;
  pdf: { letosni: number; lonska: number; dodatkova: number; total: number };
  appRemaining: number | null;
  currentYearHours: number | null;
  proposedCurrentYearHours: number;
  delta: number;
  createdAt: string;
  createdByName: string | null;
}

const numFmt = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2 });

function hours(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? `${numFmt.format(n)} h` : "–";
}

function signedHours(n: number): string {
  // Intl renders a minus as U+2212 in cs-CZ; prepend "+" for positive deltas.
  return `${n > 0 ? "+" : ""}${numFmt.format(n)} h`;
}

function monthLabel(year: number, month: number): string {
  const name = month >= 1 && month <= 12 ? MONTH_NAMES[month - 1] : String(month);
  return `${name} ${year}`;
}

export default function VacationProposalsList({ spaced = false }: { spaced?: boolean }) {
  const [items, setItems] = useState<VacationProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api
      .get<{ proposals: VacationProposal[] }>("/vacation-proposals")
      .then((res) => setItems(Array.isArray(res?.proposals) ? res.proposals : []))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className={styles.section} style={spaced ? { marginTop: "1.75rem" } : undefined}>
      <div className={styles.sectionLabel}>
        Návrhy úprav nároku z kontroly mezd
        {items.length > 0 && <span className={styles.countBadge}>{items.length}</span>}
      </div>
      {loading ? (
        <div className={styles.state}>Načítám…</div>
      ) : failed ? (
        <div className={styles.empty}>Návrhy se nepodařilo načíst.</div>
      ) : items.length === 0 ? (
        <div className={styles.empty}>Žádné návrhy k vyřízení.</div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Zaměstnanec</th>
                <th>Období</th>
                <th>Rozdíl</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/zamestnanci/${p.employeeId}`} className={styles.empLink}>
                      {employeeDisplayName(p)}
                    </Link>
                  </td>
                  <td data-label="Období">{monthLabel(p.year, p.month)}</td>
                  <td data-label="Rozdíl">
                    Zůstatek: aplikace {hours(p.appRemaining)}, lístek {hours(p.pdf?.total)} (rozdíl{" "}
                    {signedHours(p.delta)}) · Letošní nárok {hours(p.currentYearHours)} →{" "}
                    {hours(p.proposedCurrentYearHours)}
                  </td>
                  <td>
                    <Link to="/dovolena" className={styles.markReadBtn}>
                      Otevřít →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
