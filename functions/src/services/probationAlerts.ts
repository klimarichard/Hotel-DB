import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import * as clock from "./clock";

const db = () => admin.firestore();

export const PROBATION_ALERT_DAYS = 14;

export interface ParsedDuration {
  days: number; // total days the probation lasts
  unit: "day" | "week" | "month";
  count: number;
}

/**
 * Parse a Czech free-form probation period like "3 měsíce", "30 dní",
 * "2 týdny", "0", "" into a numeric duration. Returns null when the value
 * has no non-zero digit or the unit is unrecognized.
 *
 * Supported units (Czech, case-insensitive, accent-insensitive):
 *   - měsíc / měsíce / měsíců / m  → months (treated as 30-day units below
 *     for the purpose of "14 days before end" comparisons; actual end-date
 *     uses calendar-correct addMonths)
 *   - týden / týdny / týdnů / t    → weeks
 *   - den / dny / dní / d          → days
 */
export function parseProbationPeriod(input: unknown): ParsedDuration | null {
  if (typeof input !== "string") return null;
  const raw = input.trim().toLowerCase();
  if (!raw || !/[1-9]/.test(raw)) return null;

  // Strip diacritics so "měsíce" matches "mesice" too — robust against
  // user input that may or may not include accents.
  const ascii = raw.normalize("NFD").replace(/[̀-ͯ]/g, "");

  const m = ascii.match(/^\s*(\d+)\s*([a-z]+)?/);
  if (!m) return null;
  const count = parseInt(m[1], 10);
  if (!Number.isFinite(count) || count <= 0) return null;

  const unitWord = m[2] ?? "mesic"; // bare number → assume months (most common case)
  if (/^(mesic|mesice|mesicu|m)$/.test(unitWord)) {
    return { days: count * 30, unit: "month", count };
  }
  if (/^(tyden|tydny|tydnu|t)$/.test(unitWord)) {
    return { days: count * 7, unit: "week", count };
  }
  if (/^(den|dny|dni|d)$/.test(unitWord)) {
    return { days: count, unit: "day", count };
  }
  return null;
}

/**
 * Add N months to a YYYY-MM-DD date string and return a YYYY-MM-DD string.
 * Uses local-time arithmetic per CLAUDE.md (no toISOString).
 */
function addCalendarMonths(start: string, n: number): string {
  const [y, m, d] = start.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setMonth(date.getMonth() + n);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function addCalendarDays(start: string, n: number): string {
  const [y, m, d] = start.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + n);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Compute the probation end-date string from a startDate (YYYY-MM-DD) and
 * a parsed duration. Calendar-correct for months and weeks.
 */
export function computeProbationEndDate(startDate: string, parsed: ParsedDuration): string {
  switch (parsed.unit) {
    case "month":
      return addCalendarMonths(startDate, parsed.count);
    case "week":
      return addCalendarDays(startDate, parsed.count * 7);
    case "day":
      return addCalendarDays(startDate, parsed.count);
  }
}

interface EmploymentInput {
  rowId: string;
  startDate?: string | null;
  probationPeriod?: string | null;
  status?: string | null;
}

interface EmployeeInput {
  firstName?: string;
  lastName?: string;
  /** Custom "Zobrazované jméno", when set — snapshotted alongside the legal name. */
  displayName?: string;
}

/**
 * Reconcile the probationAlerts/{employeeId}_{rowId} document for one
 * employment row.
 *
 * - If `options.suppress` is set (caller decided this row's session is
 *   terminated or already has a salary Dodatek), or the row is not "active",
 *   or has no startDate, or probationPeriod is unparseable / zero → delete
 *   any existing alert for this row.
 * - Otherwise compute end-date and:
 *     * if more than PROBATION_ALERT_DAYS days away → delete alert
 *     * if within window or already past → upsert alert with status
 *       "ending" (≥0 days remaining) or "ended" (<0).
 *
 * Read-state (read/readAt/readBy) is preserved across refreshes as long as
 * the computed probationEndDate is unchanged; it resets to unread when the
 * end-date moves (start-date or probation-length edited), since that's a new
 * deadline worth re-surfacing.
 */
export async function updateProbationAlertForEmploymentRow(
  employeeId: string,
  employee: EmployeeInput,
  row: EmploymentInput,
  options: { suppress?: boolean } = {}
): Promise<void> {
  const docId = `${employeeId}_${row.rowId}`;
  const ref = db().collection("probationAlerts").doc(docId);

  if (options.suppress || row.status !== "active" || !row.startDate) {
    await ref.delete().catch(() => undefined);
    return;
  }

  const parsed = parseProbationPeriod(row.probationPeriod ?? "");
  if (!parsed) {
    await ref.delete().catch(() => undefined);
    return;
  }

  const endDate = computeProbationEndDate(row.startDate, parsed);

  // daysUntilEnd in local time
  const today = clock.now();
  today.setHours(0, 0, 0, 0);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const endLocal = new Date(ey, em - 1, ed);
  const daysUntilEnd = Math.ceil(
    (endLocal.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysUntilEnd > PROBATION_ALERT_DAYS) {
    await ref.delete().catch(() => undefined);
    return;
  }

  const existing = await ref.get();
  const prev = existing.data() as Record<string, unknown> | undefined;
  const keepRead = !!prev && prev.probationEndDate === endDate && prev.read === true;

  await ref.set({
    employeeId,
    employeeFirstName: employee.firstName ?? "",
    employeeLastName: employee.lastName ?? "",
    // The name on an alert is a snapshot: nothing rewrites it between refreshes,
    // so it must carry the display name as well — otherwise the Upozornění tabs
    // can only ever render the legal name. Reads re-resolve it live on top.
    employeeDisplayName: employee.displayName ?? "",
    employmentRowId: row.rowId,
    probationStartDate: row.startDate,
    probationEndDate: endDate,
    probationPeriodRaw: row.probationPeriod ?? "",
    daysUntilEnd,
    status: daysUntilEnd < 0 ? "ended" : "ending",
    read: keepRead,
    readAt: keepRead ? prev!.readAt ?? null : null,
    readBy: keepRead ? prev!.readBy ?? null : null,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

interface SessionFlags {
  /** Session has an Ukončení row or its effective endDate is in the past. */
  terminated: boolean;
  /** A Dodatek (změna smlouvy) on the session carries a "mzda" change. */
  hasSalaryDodatek: boolean;
}

function todayISO(): string {
  const d = clock.now();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Server-side mirror of the frontend groupBySession
 * (frontend/src/lib/employmentSessions.ts) — keep the two in sync if either
 * changes. Walks employment rows in startDate-asc order and, for each Nástup
 * row, reports the two flags that drive probation-alert suppression:
 *   - terminated: an Ukončení row closed the session, or the effective
 *     endDate (Nástup endDate, overridden by "délka smlouvy" Dodatky, then by
 *     the Ukončení row's startDate) is already in the past.
 *   - hasSalaryDodatek: any Dodatek on the session changed "mzda".
 * Returned map is keyed by the Nástup row id (the row that carries the
 * probationPeriod and thus owns the alert).
 */
function sessionFlagsByNastup(
  rows: Array<{ id: string; data: Record<string, unknown> }>
): Map<string, SessionFlags> {
  const sorted = [...rows].sort((a, b) =>
    String(a.data.startDate ?? "").localeCompare(String(b.data.startDate ?? ""))
  );
  const today = todayISO();
  const out = new Map<string, SessionFlags>();

  let current: {
    nastupId: string;
    endDate: string | null;
    hasSalaryDodatek: boolean;
    ukonceni: boolean;
  } | null = null;

  const flush = () => {
    if (!current) return;
    const terminated = current.ukonceni || (!!current.endDate && current.endDate < today);
    out.set(current.nastupId, { terminated, hasSalaryDodatek: current.hasSalaryDodatek });
    current = null;
  };

  for (const r of sorted) {
    const ct = r.data.changeType as string | undefined;
    if (ct === "nástup") {
      flush();
      current = {
        nastupId: r.id,
        endDate: (r.data.endDate as string | null) ?? null,
        hasSalaryDodatek: false,
        ukonceni: false,
      };
    } else if (ct === "změna smlouvy" && current) {
      const changes =
        (r.data.changes as Array<{ changeKind?: string; value?: string }> | undefined) ?? [];
      for (const ch of changes) {
        if (ch.changeKind === "mzda" && ch.value) current.hasSalaryDodatek = true;
        // Empty value = change to doba neurčitá: a Dodatek clears a fixed end
        // date, so the session stays active (don't drop the null and keep alerting).
        else if (ch.changeKind === "délka smlouvy") current.endDate = ch.value || null;
      }
    } else if (ct === "ukončení" && current) {
      current.ukonceni = true;
      if (r.data.startDate) current.endDate = r.data.startDate as string;
    }
  }
  flush();
  return out;
}

/**
 * Reconcile probationAlerts for a single employee. Loads the full employment
 * history, groups it into sessions, runs updateProbationAlertForEmploymentRow
 * on each active row (suppressing the alert when the row's session is
 * terminated or already has a salary Dodatek), and removes stale alert docs
 * for inactive rows.
 */
export async function refreshProbationAlertsForEmployee(employeeId: string): Promise<void> {
  const empSnap = await db().collection("employees").doc(employeeId).get();
  if (!empSnap.exists) {
    // Cascade-clean: drop every probationAlert with this employeeId
    const stale = await db()
      .collection("probationAlerts")
      .where("employeeId", "==", employeeId)
      .get();
    if (!stale.empty) {
      const batch = db().batch();
      stale.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    return;
  }
  const empData = empSnap.data() as Record<string, unknown>;

  // Load the full history once (single-field orderBy → no composite index):
  // needed both to find active rows and to group rows into sessions.
  const employmentSnap = await empSnap.ref
    .collection("employment")
    .orderBy("startDate", "asc")
    .get();
  const allRows = employmentSnap.docs.map((d) => ({
    id: d.id,
    data: d.data() as Record<string, unknown>,
  }));

  const flagsByNastup = sessionFlagsByNastup(allRows);
  const activeRows = allRows.filter((r) => r.data.status === "active");
  const activeRowIds = new Set(activeRows.map((r) => r.id));

  // Update for each active row (typically one)
  for (const row of activeRows) {
    const flags = flagsByNastup.get(row.id);
    // Suppress (and delete) probation alerts for terminated employees. The
    // canonical employee `status` is the source of truth — the employment ROW
    // status can lag the derived employee status, which let alerts survive for
    // terminated employees. (Before-start employees keep their alerts.)
    const suppress =
      empData.status === "terminated" || (!!flags && (flags.terminated || flags.hasSalaryDodatek));
    await updateProbationAlertForEmploymentRow(
      employeeId,
      {
        firstName: empData.firstName as string,
        lastName: empData.lastName as string,
        displayName: (empData.displayName as string) ?? "",
      },
      {
        rowId: row.id,
        startDate: row.data.startDate as string | null,
        probationPeriod: row.data.probationPeriod as string | null,
        status: row.data.status as string | null,
      },
      { suppress }
    );
  }

  // Clean up alerts pointing at rows that are no longer active
  const existing = await db()
    .collection("probationAlerts")
    .where("employeeId", "==", employeeId)
    .get();
  const batch = db().batch();
  let dirty = false;
  for (const a of existing.docs) {
    const data = a.data() as Record<string, unknown>;
    const rowId = data.employmentRowId as string | undefined;
    if (!rowId || !activeRowIds.has(rowId)) {
      batch.delete(a.ref);
      dirty = true;
    }
  }
  if (dirty) await batch.commit();
}

/**
 * Daily scheduled-function entry point. Iterates every employee.
 */
export async function refreshAllProbationAlerts(): Promise<{ scanned: number }> {
  const snap = await db().collection("employees").get();
  for (const emp of snap.docs) {
    await refreshProbationAlertsForEmployee(emp.id);
  }
  return { scanned: snap.size };
}

/**
 * Cascade-delete all probationAlerts for an employee. Used from the
 * employee DELETE handler.
 */
export async function deleteProbationAlertsForEmployee(employeeId: string): Promise<void> {
  const snap = await db()
    .collection("probationAlerts")
    .where("employeeId", "==", employeeId)
    .get();
  if (snap.empty) return;
  const batch = db().batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}
