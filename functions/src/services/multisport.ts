/**
 * Pure helpers for the Multisport benefit (multiple basic periods + companion
 * "Doprovodná" cards). Periods are whole-month by convention (from = 1st of a
 * month, to = last day), so a month either fully overlaps a period or not —
 * there is no proration. Pure + exported for unit testing.
 */

export interface MultisportPeriod {
  from: string; // YYYY-MM-DD
  to: string | null; // null = ongoing
}

export interface MultisportCompanion {
  id?: string;
  name: string;
  from: string; // YYYY-MM-DD
  to: string | null; // null = ongoing
  price: number;
}

function monthBounds(year: number, month: number): { first: string; last: string } {
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  return { first: `${year}-${mm}-01`, last: `${year}-${mm}-${String(lastDay).padStart(2, "0")}` };
}

/** A period covers the given ISO date (inclusive on both ends). */
export function periodActiveOn(p: { from: string; to: string | null }, dateISO: string): boolean {
  return p.from <= dateISO && (p.to == null || p.to >= dateISO);
}

/** Any basic period covers the given ISO date. */
export function anyPeriodActiveOn(periods: MultisportPeriod[], dateISO: string): boolean {
  return periods.some((p) => periodActiveOn(p, dateISO));
}

/** A [from, to] window overlaps the payroll month [first, last]. */
export function overlapsMonth(from: string, to: string | null, year: number, month: number): boolean {
  const { first, last } = monthBounds(year, month);
  return from <= last && (to == null || to >= first);
}

/**
 * Price the employee should pay for the month: the basic price if any basic
 * period overlaps the month, plus each companion card whose window overlaps the
 * month. No proration — periods are whole-month.
 */
export function multisportPriceForMonth(
  periods: MultisportPeriod[],
  companions: MultisportCompanion[],
  basePrice: number,
  year: number,
  month: number
): number {
  let price = 0;
  if (periods.some((p) => overlapsMonth(p.from, p.to, year, month))) price += basePrice;
  for (const c of companions) {
    if (overlapsMonth(c.from, c.to, year, month)) price += Number(c.price) || 0;
  }
  return price;
}

const fmtCZ = (iso: string): string => {
  const p = iso.split("-");
  return p.length === 3 ? `${p[2]}. ${p[1]}. ${p[0]}` : iso; // DD. MM. YYYY — app convention
};

/**
 * Auto-note texts for any basic period or companion card that STARTS within the
 * payroll month (`kind: "multisport"`). Same shape as autoNotesFromRows so the
 * orchestrator can wrap them into system note docs identically.
 */
export function multisportStartNotes(
  periods: MultisportPeriod[],
  companions: MultisportCompanion[],
  year: number,
  month: number
): Array<{ kind: "multisport"; text: string }> {
  const { first, last } = monthBounds(year, month);
  const notes: Array<{ kind: "multisport"; text: string }> = [];
  for (const p of periods) {
    if (p.from && p.from >= first && p.from <= last) {
      notes.push({ kind: "multisport", text: `Multisport zahájen ${fmtCZ(p.from)}` });
    }
  }
  for (const c of companions) {
    if (c.from && c.from >= first && c.from <= last) {
      notes.push({ kind: "multisport", text: `Doprovodná Multisport (${c.name}) zahájena ${fmtCZ(c.from)}` });
    }
  }
  return notes;
}

/** Last-day-of-month ISO for the month containing the given ISO date. */
export function endOfMonth(dateISO: string): string {
  const [y, m] = dateISO.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

/**
 * Read the stored multisport shape off a benefits doc, with a back-compat
 * fallback to the legacy single-window model (`multisport` + `multisportFrom`/
 * `multisportTo`) for any doc not yet migrated to `multisportPeriods`.
 */
export function readMultisport(
  data: Record<string, unknown> | undefined | null
): { periods: MultisportPeriod[]; companions: MultisportCompanion[] } {
  if (!data) return { periods: [], companions: [] };
  const companions = Array.isArray(data.multisportCompanions)
    ? (data.multisportCompanions as MultisportCompanion[])
    : [];
  if (Array.isArray(data.multisportPeriods)) {
    return { periods: data.multisportPeriods as MultisportPeriod[], companions };
  }
  // Legacy fallback: synthesise one period from the old single window.
  if (data.multisport === true) {
    const from = (data.multisportFrom as string | null | undefined) ?? "1900-01-01";
    const to = (data.multisportTo as string | null | undefined) ?? null;
    return { periods: [{ from, to }], companions };
  }
  return { periods: [], companions };
}
