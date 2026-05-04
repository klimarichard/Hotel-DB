import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

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
}

/**
 * Reconcile the probationAlerts/{employeeId}_{rowId} document for one
 * employment row.
 *
 * - If the row is not "active", or has no startDate, or probationPeriod is
 *   unparseable / zero → delete any existing alert for this row.
 * - Otherwise compute end-date and:
 *     * if more than PROBATION_ALERT_DAYS days away → delete alert
 *     * if within window or already past → upsert alert with status
 *       "ending" (≥0 days remaining) or "ended" (<0).
 */
export async function updateProbationAlertForEmploymentRow(
  employeeId: string,
  employee: EmployeeInput,
  row: EmploymentInput
): Promise<void> {
  const docId = `${employeeId}_${row.rowId}`;
  const ref = db().collection("probationAlerts").doc(docId);

  if (row.status !== "active" || !row.startDate) {
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
  const today = new Date();
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

  await ref.set({
    employeeId,
    employeeFirstName: employee.firstName ?? "",
    employeeLastName: employee.lastName ?? "",
    employmentRowId: row.rowId,
    probationStartDate: row.startDate,
    probationEndDate: endDate,
    probationPeriodRaw: row.probationPeriod ?? "",
    daysUntilEnd,
    status: daysUntilEnd < 0 ? "ended" : "ending",
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Reconcile probationAlerts for a single employee. Looks up the employee's
 * active employment row, runs updateProbationAlertForEmploymentRow on it,
 * and (defensively) removes any stale alert docs for inactive rows.
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
  const employmentSnap = await empSnap.ref
    .collection("employment")
    .where("status", "==", "active")
    .orderBy("startDate", "desc")
    .get();

  const activeRows = employmentSnap.docs;
  const activeRowIds = new Set(activeRows.map((d) => d.id));

  // Update for each active row (typically one)
  for (const row of activeRows) {
    const rowData = row.data() as Record<string, unknown>;
    await updateProbationAlertForEmploymentRow(
      employeeId,
      { firstName: empData.firstName as string, lastName: empData.lastName as string },
      {
        rowId: row.id,
        startDate: rowData.startDate as string | null,
        probationPeriod: rowData.probationPeriod as string | null,
        status: rowData.status as string | null,
      }
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
