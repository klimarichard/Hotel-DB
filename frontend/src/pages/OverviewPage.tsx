import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import {
  HOTEL_CODES,
  HOTEL_NAMES,
  parseShiftExpression,
  type HotelCode,
} from "@/lib/shiftConstants";
import type {
  PlanDetail,
  PlanEmployee,
  ShiftDoc,
} from "./ShiftPlannerPage";
import styles from "./OverviewPage.module.css";

interface PlanListItem {
  id: string;
  month: number;
  year: number;
  status: "created" | "opened" | "closed" | "published";
}

const DAY_NAMES_FULL = [
  "Neděle", "Pondělí", "Úterý", "Středa", "Čtvrtek", "Pátek", "Sobota",
];

const MONTH_GENITIVE = [
  "ledna", "února", "března", "dubna", "května", "června",
  "července", "srpna", "září", "října", "listopadu", "prosince",
];

function formatTodayHeader(d: Date): string {
  return `${DAY_NAMES_FULL[d.getDay()]} ${d.getDate()}. ${MONTH_GENITIVE[d.getMonth()]} ${d.getFullYear()}`;
}

function todayYMD(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function displayName(e: PlanEmployee): string {
  return `${e.firstName} ${e.lastName}`;
}

export default function OverviewPage() {
  const today = useMemo(() => new Date(), []);
  const todayKey = todayYMD(today);

  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noPlan, setNoPlan] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setNoPlan(false);
      try {
        const list = await api.get<PlanListItem[]>("/shifts/plans");
        const match = list.find(
          (p) => p.year === today.getFullYear() && p.month === today.getMonth() + 1
        );
        if (!match) {
          if (!cancelled) { setNoPlan(true); setPlan(null); }
          return;
        }
        const detail = await api.get<PlanDetail>(`/shifts/plans/${match.id}`);
        if (!cancelled) setPlan(detail);
      } catch (e) {
        if (!cancelled) setError((e as Error).message ?? "Chyba při načítání.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [today]);

  const staffing = useMemo(() => {
    if (!plan) return null;

    const empById = new Map<string, PlanEmployee>();
    for (const e of plan.employees) empById.set(e.employeeId, e);

    const day: Record<HotelCode, PlanEmployee[]> = { A: [], S: [], Q: [], K: [], P: [], M: [] };
    const night: Record<HotelCode, PlanEmployee[]> = { A: [], S: [], Q: [], K: [], P: [], M: [] };
    const absentManagers: PlanEmployee[] = [];

    const todayShifts = plan.shifts.filter((s: ShiftDoc) => s.date === todayKey);

    for (const s of todayShifts) {
      const emp = empById.get(s.employeeId);
      if (!emp) continue;

      if (emp.section === "vedoucí" && s.rawInput.trim().toUpperCase() === "X") {
        absentManagers.push(emp);
        continue;
      }

      const parsed = parseShiftExpression(s.rawInput);
      if (!parsed.isValid) continue;
      for (const seg of parsed.segments) {
        if (!seg.hotel) continue;
        const hotel = seg.hotel as HotelCode;
        if (seg.code === "D" || seg.code === "ZD" || seg.code === "DP") {
          day[hotel].push(emp);
        } else if (seg.code === "N" || seg.code === "ZN" || seg.code === "NP") {
          night[hotel].push(emp);
        }
      }
    }

    const byOrder = (a: PlanEmployee, b: PlanEmployee) =>
      a.displayOrder - b.displayOrder || a.lastName.localeCompare(b.lastName, "cs");
    for (const h of HOTEL_CODES) {
      day[h].sort(byOrder);
      night[h].sort(byOrder);
    }
    absentManagers.sort(byOrder);

    const visibleHotels = HOTEL_CODES.filter(
      (h) => day[h].length > 0 || night[h].length > 0 || (["A", "S", "Q", "K"] as HotelCode[]).includes(h)
    );

    const modEntry = plan.modShifts.find((m) => m.id === todayKey);
    const modLetter = modEntry?.code ?? "";
    const modEmployeeId = modLetter ? plan.modPersons?.[modLetter] : undefined;
    const modEmployee = modEmployeeId ? empById.get(modEmployeeId) : undefined;

    return { day, night, absentManagers, visibleHotels, modLetter, modEmployee };
  }, [plan, todayKey]);

  return (
    <div className={styles.page}>
      <h1 className={styles.dateHeader}>{formatTodayHeader(today)}</h1>

      {loading && <div className={styles.state}>Načítám…</div>}
      {error && <div className={styles.errorState}>{error}</div>}

      {!loading && !error && noPlan && (
        <div className={styles.emptyState}>
          Pro dnešní den není k dispozici žádný plán.
        </div>
      )}

      {!loading && !error && plan && staffing && (
        <>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Směny dnes</h2>
            <table className={styles.hotelTable}>
              <thead>
                <tr>
                  <th></th>
                  {staffing.visibleHotels.map((h) => (
                    <th key={h}>{HOTEL_NAMES[h]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>DENNÍ</td>
                  {staffing.visibleHotels.map((h) => (
                    <td key={h}>
                      {staffing.day[h].length === 0 ? (
                        <span className={styles.dash}>—</span>
                      ) : (
                        <div className={styles.nameList}>
                          {staffing.day[h].map((e) => (
                            <span key={e.employeeId}>{displayName(e)}</span>
                          ))}
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td>NOČNÍ</td>
                  {staffing.visibleHotels.map((h) => (
                    <td key={h}>
                      {staffing.night[h].length === 0 ? (
                        <span className={styles.dash}>—</span>
                      ) : (
                        <div className={styles.nameList}>
                          {staffing.night[h].map((e) => (
                            <span key={e.employeeId}>{displayName(e)}</span>
                          ))}
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Manažer ve službě</h2>
            {staffing.modEmployee ? (
              <div className={styles.modRow}>
                <span className={styles.modLetter}>{staffing.modLetter}</span>
                <span>{displayName(staffing.modEmployee)}</span>
              </div>
            ) : staffing.modLetter ? (
              <div className={styles.modRow}>
                <span className={styles.modLetter}>{staffing.modLetter}</span>
                <span className={styles.dash}>Nepřiřazeno</span>
              </div>
            ) : (
              <span className={styles.dash}>—</span>
            )}
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Manažeři mimo (X)</h2>
            {staffing.absentManagers.length === 0 ? (
              <span className={styles.absentEmpty}>Nikdo.</span>
            ) : (
              <ul className={styles.absentList}>
                {staffing.absentManagers.map((e) => (
                  <li key={e.employeeId}>{displayName(e)}</li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
