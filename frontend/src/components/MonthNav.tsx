import { MONTH_NAMES } from "../lib/dateFormat";
import styles from "./MonthNav.module.css";

interface Props {
  year: number;
  month: number;
  onSelect: (year: number, month: number) => void;
  /**
   * "Today" as the app sees it — pass `clock.now()`, never `new Date()`, so the
   * test clock moves DNES along with everything else.
   */
  today: Date;
  dataTour?: string;
}

/**
 * ‹ / › month pager with the month label and a DNES jump-to-current-month button.
 *
 * Shared by the shift planner and payroll, which had byte-identical `.monthNav`,
 * `.navBtn` and `.monthLabel` rules and two copies of the same year-wrapping
 * paging functions. Pairs with `MonthJumpSelect` in the header's `1fr auto 1fr`
 * grid: picker left, this centred.
 *
 * DNES is always rendered and merely `disabled` on the current month. Hiding it
 * changed the row's width, which made the centred month label visibly jump as
 * you paged across the current month.
 */
export default function MonthNav({ year, month, onSelect, today, dataTour }: Props) {
  const prev = () => (month === 1 ? onSelect(year - 1, 12) : onSelect(year, month - 1));
  const next = () => (month === 12 ? onSelect(year + 1, 1) : onSelect(year, month + 1));

  const isCurrentMonth = month === today.getMonth() + 1 && year === today.getFullYear();
  const goToday = () => onSelect(today.getFullYear(), today.getMonth() + 1);

  return (
    <div className={styles.monthNav} data-tour={dataTour}>
      <button className={styles.navBtn} onClick={prev} aria-label="Předchozí měsíc">‹</button>
      <span className={styles.monthLabel}>
        {MONTH_NAMES[month - 1]} {year}
      </span>
      <button className={styles.navBtn} onClick={next} aria-label="Následující měsíc">›</button>
      <button className={styles.todayBtn} onClick={goToday} disabled={isCurrentMonth}>
        DNES
      </button>
    </div>
  );
}
