import styles from "./MonthJumpSelect.module.css";

const MONTH_NAMES = [
  "Leden", "Únor", "Březen", "Duben", "Květen", "Červen",
  "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec",
];

export interface MonthJumpItem {
  year: number;
  month: number;
}

interface Props {
  /** Every month that exists. Order is irrelevant — grouped and sorted here. */
  items: readonly MonthJumpItem[];
  selectedYear: number;
  selectedMonth: number;
  onSelect: (year: number, month: number) => void;
  /** Required: the control is a bare select with no visible label. */
  ariaLabel: string;
  /** Shown while the selected month is not in `items`. */
  placeholder: string;
  dataTour?: string;
}

/**
 * Quick-jump month picker for a page whose primary navigation is ‹ / › paging.
 *
 * Shared by the shift planner and payroll: both grew past the point where paging
 * one month at a time is reasonable (33 shift plans after the historical import),
 * and both have the same header shape — a `1fr auto 1fr` grid whose left slot was
 * an empty spacer. Extracted rather than copied because a duplicated picker is
 * exactly the kind of mirror that drifts: the two would sort differently, or one
 * would gain the empty-state handling and the other wouldn't.
 *
 * Newest first, grouped by year. The months people reach for are the recent ones,
 * and an `<optgroup>` per year keeps a long list navigable.
 *
 * With no items the select itself is omitted (a picker with no destinations is
 * noise) but the wrapper still renders: it occupies the header grid's left
 * column, and dropping the element would re-flow `1fr auto 1fr` and knock the
 * centred month label off-centre.
 *
 * Hidden entirely on phones (see the media query in the stylesheet) — the
 * mobile header is a single column, so the picker stacked above the month
 * label instead of sitting beside it. `MonthNav` is the only month navigation
 * there.
 */
export default function MonthJumpSelect({
  items,
  selectedYear,
  selectedMonth,
  onSelect,
  ariaLabel,
  placeholder,
  dataTour,
}: Props) {
  // Empty when the selected month has no entry — a legitimate state on both
  // pages, since you navigate to a month BEFORE its plan / payroll period
  // exists. Showing the placeholder is honest; showing a different month's
  // value would be a lie about where you are.
  const value = items.some((i) => i.year === selectedYear && i.month === selectedMonth)
    ? `${selectedYear}-${selectedMonth}`
    : "";

  const byYear = new Map<number, MonthJumpItem[]>();
  for (const i of items) {
    const list = byYear.get(i.year) ?? [];
    list.push(i);
    byYear.set(i.year, list);
  }
  const groups = [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, list]) => [year, [...list].sort((a, b) => b.month - a.month)] as const);

  if (items.length === 0) return <div className={styles.wrap} />;

  return (
    <div className={styles.wrap}>
      <select
        className={styles.select}
        data-tour={dataTour}
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => {
          const [y, m] = e.target.value.split("-").map(Number);
          if (Number.isInteger(y) && Number.isInteger(m)) onSelect(y, m);
        }}
      >
        {value === "" && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {groups.map(([year, list]) => (
          <optgroup key={year} label={String(year)}>
            {list.map((i) => (
              <option key={`${i.year}-${i.month}`} value={`${i.year}-${i.month}`}>
                {MONTH_NAMES[i.month - 1]} {i.year}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
