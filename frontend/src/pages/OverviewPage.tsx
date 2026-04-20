import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/context/ThemeContext";
import { useAlertsContext } from "@/context/AlertsContext";
import { useShiftOverridesContext } from "@/context/ShiftOverridesContext";
import { useShiftChangeRequestsContext } from "@/context/ShiftChangeRequestsContext";
import {
  HOTEL_CODES,
  HOTEL_NAMES,
  MOD_PERSONS,
  SHIFT_COLORS,
  SHIFT_TEXT_COLORS,
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

interface StaffingResult {
  day: Record<HotelCode, StaffItem[]>;
  night: Record<HotelCode, StaffItem[]>;
  absentManagers: PlanEmployee[];
  visibleHotels: HotelCode[];
  modLetter: string;
  modEmployee: PlanEmployee | undefined;
}

// Hotel day rolls over at 07:00 local time — a shift worked on the night of
// the 20th that ends at 06:00 on the 21st is still part of the 20th. Before
// 07:00 we show the previous calendar date as "dnes".
const DAY_CUTOFF_HOUR = 7;

function hotelDayStart(now: Date): Date {
  const d = new Date(now);
  if (d.getHours() < DAY_CUTOFF_HOUR) {
    d.setDate(d.getDate() - 1);
  }
  d.setHours(0, 0, 0, 0);
  return d;
}

// Denní 07:00–18:59, noční 19:00–06:59.
const NIGHT_CUTOFF_HOUR = 19;

function currentShiftCode(now: Date): "D" | "N" {
  const h = now.getHours();
  return h >= DAY_CUTOFF_HOUR && h < NIGHT_CUTOFF_HOUR ? "D" : "N";
}

const DAY_NAMES_FULL = [
  "neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota",
];

const DAY_NAMES_SHORT = [
  "ne", "po", "út", "st", "čt", "pá", "so",
];

const MONTH_GENITIVE = [
  "ledna", "února", "března", "dubna", "května", "června",
  "července", "srpna", "září", "října", "listopadu", "prosince",
];

function formatLongHeader(d: Date): string {
  return `${DAY_NAMES_FULL[d.getDay()]}, ${d.getDate()}. ${MONTH_GENITIVE[d.getMonth()]} ${d.getFullYear()}`;
}

function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

function hotelColor(hotel: HotelCode, dark: boolean): { bg: string; text: string } {
  return getCellColor(parseShiftExpression(`D${hotel}`), dark);
}

function buildStaffing(plan: PlanDetail, dateKey: string): StaffingResult {
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

  const dayShifts = plan.shifts.filter((s: ShiftDoc) => s.date === dateKey);

  for (const s of dayShifts) {
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

  const modEntry = plan.modShifts.find((m) => m.id === dateKey);
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
}

interface MyShiftRow {
  date: Date;
  dateKey: string;
  shift: ShiftDoc | null;
}

function buildMyShifts(
  days: Date[],
  plansByYM: Map<string, PlanDetail>,
  employeeId: string,
): MyShiftRow[] {
  return days.map((date) => {
    const key = ymd(date);
    const ym = `${date.getFullYear()}-${date.getMonth() + 1}`;
    const plan = plansByYM.get(ym);
    const shift = plan?.shifts.find(
      (s) => s.date === key && s.employeeId === employeeId
    ) ?? null;
    return { date, dateKey: key, shift };
  });
}

function StaffingTable({
  staffing,
  isDark,
}: {
  staffing: StaffingResult;
  isDark: boolean;
}) {
  const renderName = (item: StaffItem) => {
    const name = `${item.emp.firstName} ${item.emp.lastName}`;
    return (
      <span key={item.emp.employeeId}>
        {name}
        {item.isPorter && <span className={styles.flag}> (portýr)</span>}
        {item.isTrainee && <span className={styles.flag}> (zaučování)</span>}
      </span>
    );
  };

  return (
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
  );
}

function ModBlock({ staffing }: { staffing: StaffingResult }) {
  if (staffing.modEmployee) {
    return (
      <div className={styles.modRow}>
        <span className={styles.modLetter}>{staffing.modLetter}</span>
        <span>
          {staffing.modEmployee.firstName} {staffing.modEmployee.lastName}
        </span>
      </div>
    );
  }
  if (staffing.modLetter) {
    return (
      <div className={styles.modRow}>
        <span className={styles.modLetter}>{staffing.modLetter}</span>
        <span className={styles.dash}>
          {MOD_PERSONS[staffing.modLetter] ?? "Nepřiřazeno"}
        </span>
      </div>
    );
  }
  return <span className={styles.dash}>—</span>;
}

export default function OverviewPage() {
  const today = useMemo(() => hotelDayStart(new Date()), []);
  const tomorrow = useMemo(() => addDays(today, 1), [today]);
  const shiftCode = useMemo(() => currentShiftCode(new Date()), []);
  const next7Days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(today, i));
  }, [today]);

  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { employeeId, role } = useAuth();
  const showTasks = role === "admin" || role === "director";

  const { unreadCount: alertsCount } = useAlertsContext();
  const { pendingCount: overridesCount } = useShiftOverridesContext();
  const { pendingCount: changesCount } = useShiftChangeRequestsContext();
  const [vacationCount, setVacationCount] = useState(0);

  const [plans, setPlans] = useState<PlanDetail[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tomorrowExpanded, setTomorrowExpanded] = useState(false);

  useEffect(() => {
    if (!showTasks) return;
    let cancelled = false;
    api
      .get<{ count: number }>("/vacation/pending-count")
      .then((data) => { if (!cancelled) setVacationCount(data.count); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [showTasks]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const list = await api.get<PlanListItem[]>("/shifts/plans");

        const uniqueYM = new Set<string>();
        for (const d of next7Days) {
          uniqueYM.add(`${d.getFullYear()}-${d.getMonth() + 1}`);
        }

        const ids: string[] = [];
        for (const ym of uniqueYM) {
          const [y, m] = ym.split("-").map(Number);
          const match = list.find((p) => p.year === y && p.month === m);
          if (match) ids.push(match.id);
        }

        const details = await Promise.all(
          ids.map((id) => api.get<PlanDetail>(`/shifts/plans/${id}`))
        );
        if (!cancelled) setPlans(details);
      } catch (e) {
        if (!cancelled) setError((e as Error).message ?? "Chyba při načítání.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [next7Days]);

  const plansByYM = useMemo(() => {
    const map = new Map<string, PlanDetail>();
    if (!plans) return map;
    for (const p of plans) map.set(`${p.year}-${p.month}`, p);
    return map;
  }, [plans]);

  const todayPlan = useMemo(
    () => plansByYM.get(`${today.getFullYear()}-${today.getMonth() + 1}`) ?? null,
    [plansByYM, today],
  );
  const tomorrowPlan = useMemo(
    () =>
      plansByYM.get(`${tomorrow.getFullYear()}-${tomorrow.getMonth() + 1}`) ??
      null,
    [plansByYM, tomorrow],
  );

  const todayKey = ymd(today);
  const tomorrowKey = ymd(tomorrow);

  const todayStaffing = useMemo(
    () => (todayPlan ? buildStaffing(todayPlan, todayKey) : null),
    [todayPlan, todayKey],
  );
  const tomorrowStaffing = useMemo(
    () => (tomorrowPlan ? buildStaffing(tomorrowPlan, tomorrowKey) : null),
    [tomorrowPlan, tomorrowKey],
  );

  const myShifts = useMemo<MyShiftRow[] | null>(() => {
    if (!employeeId || !plans) return null;
    return buildMyShifts(next7Days, plansByYM, employeeId);
  }, [employeeId, plans, plansByYM, next7Days]);

  return (
    <div className={styles.page}>
      <div className={styles.dateHeaderRow}>
        <h1 className={styles.dateHeader}>{formatLongHeader(today)}</h1>
        <span
          className={styles.shiftBadge}
          style={{
            background: SHIFT_COLORS[shiftCode],
            color: SHIFT_TEXT_COLORS[shiftCode],
          }}
        >
          {shiftCode === "D" ? "DENNÍ" : "NOČNÍ"}
        </span>
      </div>

      {loading && <div className={styles.state}>Načítám…</div>}
      {error && <div className={styles.errorState}>{error}</div>}

      {!loading && !error && (
        <>
          <section className={styles.section}>
            <h2 className={styles.dayHeading}>DNES</h2>

            <div className={styles.subBlock}>
              <h3 className={styles.subTitle}>Směny</h3>
              {todayStaffing ? (
                <StaffingTable staffing={todayStaffing} isDark={isDark} />
              ) : (
                <div className={styles.emptyInline}>
                  Pro dnešní den není k dispozici žádný plán.
                </div>
              )}
            </div>

            {todayStaffing && (
              <div className={styles.subBlock}>
                <h3 className={styles.subTitle}>MOD</h3>
                <ModBlock staffing={todayStaffing} />
              </div>
            )}

            {todayStaffing && todayStaffing.absentManagers.length > 0 && (
              <div className={styles.subBlock}>
                <h3 className={styles.subTitle}>Manažeři mimo (X)</h3>
                <ul className={styles.absentList}>
                  {todayStaffing.absentManagers.map((e) => (
                    <li key={e.employeeId}>{e.firstName} {e.lastName}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className={styles.section}>
            <button
              type="button"
              className={styles.collapsibleHeader}
              onClick={() => setTomorrowExpanded((v) => !v)}
              aria-expanded={tomorrowExpanded}
            >
              <div className={styles.collapsibleHeaderText}>
                <h2 className={styles.dayHeading}>ZÍTRA</h2>
                <div className={styles.daySubDate}>{formatLongHeader(tomorrow)}</div>
              </div>
              <span className={styles.chevron} aria-hidden>
                {tomorrowExpanded ? "▾" : "▸"}
              </span>
            </button>

            {tomorrowExpanded && (
              <>
                <div className={styles.subBlock}>
                  <h3 className={styles.subTitle}>Směny</h3>
                  {tomorrowStaffing ? (
                    <StaffingTable staffing={tomorrowStaffing} isDark={isDark} />
                  ) : (
                    <div className={styles.emptyInline}>
                      Pro zítřek není k dispozici žádný plán.
                    </div>
                  )}
                </div>

                {tomorrowStaffing && tomorrowStaffing.modLetter && (
                  <div className={styles.subBlock}>
                    <h3 className={styles.subTitle}>MOD</h3>
                    <ModBlock staffing={tomorrowStaffing} />
                  </div>
                )}

                {tomorrowStaffing && tomorrowStaffing.absentManagers.length > 0 && (
                  <div className={styles.subBlock}>
                    <h3 className={styles.subTitle}>Manažeři mimo (X)</h3>
                    <ul className={styles.absentList}>
                      {tomorrowStaffing.absentManagers.map((e) => (
                        <li key={e.employeeId}>{e.firstName} {e.lastName}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </section>

          {(() => {
            const taskTiles: { count: number; label: string; to: string }[] = showTasks
              ? [
                  { count: alertsCount, label: "Upozornění", to: "/upozorneni" },
                  { count: overridesCount, label: "Úpravy směn", to: "/smeny" },
                  { count: changesCount, label: "Výměny směn", to: "/smeny" },
                  { count: vacationCount, label: "Dovolenky", to: "/dovolena" },
                ]
              : [];

            const nextMyShiftRow = myShifts?.find(
              (r) => r.shift && r.shift.rawInput.trim() !== "",
            );
            const showMyShiftsTile = !!employeeId && !!myShifts;

            if (taskTiles.length === 0 && !showMyShiftsTile) return null;

            const myShiftParsed = nextMyShiftRow?.shift
              ? parseShiftExpression(nextMyShiftRow.shift.rawInput)
              : null;
            const myShiftColors =
              myShiftParsed && myShiftParsed.isValid && myShiftParsed.segments.length > 0
                ? getCellColor(myShiftParsed, isDark)
                : null;
            const myShiftHotel = myShiftParsed?.segments.find((s) => s.hotel)?.hotel;
            const myShiftWhenLabel = nextMyShiftRow
              ? (() => {
                  const i = myShifts!.indexOf(nextMyShiftRow);
                  if (i === 0) return "dnes";
                  if (i === 1) return "zítra";
                  return `${DAY_NAMES_SHORT[nextMyShiftRow.date.getDay()]} ${nextMyShiftRow.date.getDate()}. ${nextMyShiftRow.date.getMonth() + 1}.`;
                })()
              : "";

            return (
              <div className={styles.tileGrid}>
                {taskTiles.map((t) => (
                  <Link
                    key={t.label}
                    to={t.to}
                    className={`${styles.tile} ${t.count === 0 ? styles.tileMuted : ""}`}
                  >
                    <span className={styles.tileBig}>{t.count}</span>
                    <span className={styles.tileLabel}>{t.label}</span>
                  </Link>
                ))}

                {showMyShiftsTile && (
                  <Link
                    to="/smeny"
                    className={`${styles.tile} ${!nextMyShiftRow ? styles.tileMuted : ""}`}
                  >
                    {nextMyShiftRow && myShiftColors ? (
                      <span
                        className={styles.tileBadge}
                        style={{ background: myShiftColors.bg, color: myShiftColors.text }}
                      >
                        {nextMyShiftRow.shift!.rawInput}
                      </span>
                    ) : nextMyShiftRow ? (
                      <span className={styles.tileBadge}>
                        {nextMyShiftRow.shift!.rawInput}
                      </span>
                    ) : (
                      <span className={styles.tileBig}>—</span>
                    )}
                    <span className={styles.tileSub}>
                      {nextMyShiftRow
                        ? [myShiftWhenLabel, myShiftHotel ? HOTEL_NAMES[myShiftHotel as HotelCode] : ""]
                            .filter(Boolean)
                            .join(" · ")
                        : "žádné v 7 dnech"}
                    </span>
                    <span className={styles.tileLabel}>Moje směny</span>
                  </Link>
                )}
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}
