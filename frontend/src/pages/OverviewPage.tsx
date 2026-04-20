import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useTheme } from "@/context/ThemeContext";
import {
  HOTEL_CODES,
  HOTEL_NAMES,
  MOD_PERSONS,
  getCellColor,
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

interface StaffItem {
  emp: PlanEmployee;
  isPorter: boolean;
  isTrainee: boolean;
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

function hotelColor(hotel: HotelCode, dark: boolean): { bg: string; text: string } {
  return getCellColor(parseShiftExpression(`D${hotel}`), dark);
}


export default function OverviewPage() {
  const today = useMemo(() => new Date(), []);
  const todayKey = todayYMD(today);
  const { theme } = useTheme();
  const isDark = theme === "dark";

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

    const empty = (): StaffItem[] => [];
    const day: Record<HotelCode, StaffItem[]> = {
      A: empty(), S: empty(), Q: empty(), K: empty(), P: empty(), M: empty(),
    };
    const night: Record<HotelCode, StaffItem[]> = {
      A: empty(), S: empty(), Q: empty(), K: empty(), P: empty(), M: empty(),
    };
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
        const isTrainee = seg.code === "ZD" || seg.code === "ZN";
        const isPorter = seg.code === "DP" || seg.code === "NP";
        const item: StaffItem = { emp, isPorter, isTrainee };
        if (seg.code === "D" || seg.code === "ZD" || seg.code === "DP") {
          day[hotel].push(item);
        } else if (seg.code === "N" || seg.code === "ZN" || seg.code === "NP") {
          night[hotel].push(item);
        }
      }
    }

    const byOrder = (a: StaffItem, b: StaffItem) =>
      (a.isPorter ? 1 : 0) - (b.isPorter ? 1 : 0) ||
      a.emp.displayOrder - b.emp.displayOrder ||
      a.emp.lastName.localeCompare(b.emp.lastName, "cs");
    for (const h of HOTEL_CODES) {
      day[h].sort(byOrder);
      night[h].sort(byOrder);
    }
    absentManagers.sort(
      (a, b) =>
        a.displayOrder - b.displayOrder ||
        a.lastName.localeCompare(b.lastName, "cs")
    );

    const visibleHotels = HOTEL_CODES.filter(
      (h) =>
        day[h].length > 0 ||
        night[h].length > 0 ||
        (["A", "S", "Q", "K"] as HotelCode[]).includes(h)
    );

    // MOD lookup: per-plan override first, then static MOD_PERSONS name match.
    const modEntry = plan.modShifts.find((m) => m.id === todayKey);
    const modLetter = modEntry?.code ?? "";
    let modEmployee: PlanEmployee | undefined;
    if (modLetter) {
      const overrideEmpId = plan.modPersons?.[modLetter];
      if (overrideEmpId) {
        modEmployee = empById.get(overrideEmpId);
      } else {
        const staticName = MOD_PERSONS[modLetter];
        if (staticName) {
          modEmployee = plan.employees.find(
            (e) => `${e.firstName} ${e.lastName}` === staticName
          );
        }
      }
    }

    return { day, night, absentManagers, visibleHotels, modLetter, modEmployee };
  }, [plan, todayKey]);

  function renderName(item: StaffItem): React.ReactNode {
    const name = `${item.emp.firstName} ${item.emp.lastName}`;
    return (
      <span key={item.emp.employeeId}>
        {name}
        {item.isPorter && <span className={styles.flag}> (portýr)</span>}
        {item.isTrainee && <span className={styles.flag}> (zaučování)</span>}
      </span>
    );
  }

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
                  {staffing.visibleHotels.map((h) => {
                    const c = hotelColor(h, isDark);
                    return (
                      <th
                        key={h}
                        className={styles.hotelHeader}
                        style={{ background: c.bg, color: c.text }}
                      >
                        {HOTEL_NAMES[h]}
                      </th>
                    );
                  })}
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
                          {staffing.day[h].map((item) => renderName(item))}
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
                          {staffing.night[h].map((item) => renderName(item))}
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>MOD</h2>
            {staffing.modEmployee ? (
              <div className={styles.modRow}>
                <span className={styles.modLetter}>{staffing.modLetter}</span>
                <span>{staffing.modEmployee.firstName} {staffing.modEmployee.lastName}</span>
              </div>
            ) : staffing.modLetter ? (
              <div className={styles.modRow}>
                <span className={styles.modLetter}>{staffing.modLetter}</span>
                <span className={styles.dash}>
                  {MOD_PERSONS[staffing.modLetter] ?? "Nepřiřazeno"}
                </span>
              </div>
            ) : (
              <span className={styles.dash}>—</span>
            )}
          </section>

          {staffing.absentManagers.length > 0 && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Manažeři mimo (X)</h2>
              <ul className={styles.absentList}>
                {staffing.absentManagers.map((e) => (
                  <li key={e.employeeId}>{e.firstName} {e.lastName}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
