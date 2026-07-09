/**
 * Folds the backend's flat, one-doc-per-changed-field audit stream into
 * human-sized events: a single user action (one author, one record, one
 * action, ~one moment) becomes one card, with the changed fields sub-grouped
 * by area (Osobní údaje / Kontakt / …).
 *
 * Grouping is heuristic – the backend writes per-field docs with independent
 * serverTimestamps and no request id – so we group CONSECUTIVE entries in the
 * (time-desc) stream that share author + action + record and fall within a
 * short time window. Re-run over the full accumulated list so groups re-form
 * correctly across pagination.
 */

import {
  type AuditAction,
  deriveLegacyEventId,
  fieldLabel,
  rootCollection,
  sectionLabel,
} from "./labels";
import { formatAuditValue } from "./format";

export interface AuditEntry {
  id: string;
  userId: string;
  userEmail: string;
  userRole: string;
  action: AuditAction;
  collection: string;
  resourceId?: string;
  subResourceId?: string;
  fieldPath?: string;
  oldValue?: unknown;
  newValue?: unknown;
  redacted?: boolean;
  summary?: Record<string, unknown>;
  employeeId?: string;
  // Change-log overhaul: semantic event id + denormalized filter keys.
  event?: string;
  category?: string;
  year?: number;
  month?: number;
  templateId?: string;
  settingsArea?: string;
  extra?: Record<string, unknown>;
  timestamp?: { _seconds?: number; seconds?: number } | string | null;
}

export interface AuditFieldChange {
  fieldPath?: string;
  label: string;
  leaf?: string;
  redacted?: boolean;
  oldValue?: unknown;
  newValue?: unknown;
}

export interface AuditEventSection {
  label: string;
  changes: AuditFieldChange[];
}

export interface AuditEvent {
  /** Synthetic id (the newest entry's id in the group). */
  id: string;
  action: AuditAction;
  userId: string;
  userEmail: string;
  userRole: string;
  timestamp: Date | null;
  collectionRoot: string;
  primaryCollection: string;
  resourceId?: string;
  employeeId?: string;
  /** Semantic event id (set, or render-derived for legacy entries). */
  event?: string;
  /** update events: changed fields grouped by area. */
  sections: AuditEventSection[];
  /** create/delete events: redacted snapshot of the record. */
  summary?: Record<string, unknown>;
  /** reveal/export/manual-trigger: free-form extras. */
  extra?: Record<string, unknown>;
  /** Raw entries backing this event – for the "technical detail" escape hatch. */
  entries: AuditEntry[];
}

// Entries from one save cluster within a fraction of a second; a generous
// window absorbs clock granularity / sequential awaits without merging
// genuinely separate edits.
const GROUP_WINDOW_MS = 20_000;

const EMPLOYEE_SECTION_ORDER = [
  "Osobní údaje",
  "Kontakt",
  "Doklady",
  "Pojištění a banka",
  "Pracovní poměr",
  "Smlouvy",
];

export function tsToDate(ts: AuditEntry["timestamp"]): Date | null {
  if (!ts) return null;
  if (typeof ts === "string") {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  }
  const seconds = ts._seconds ?? ts.seconds;
  if (typeof seconds === "number") return new Date(seconds * 1000);
  return null;
}

function recordKey(e: AuditEntry): string {
  if (e.employeeId) return `emp:${e.employeeId}`;
  return `${rootCollection(e.collection)}:${e.resourceId ?? ""}`;
}

function sortSections(root: string, sections: AuditEventSection[]): AuditEventSection[] {
  if (root !== "employees") return sections;
  return sections
    .slice()
    .sort(
      (a, b) =>
        orderIndex(EMPLOYEE_SECTION_ORDER, a.label) - orderIndex(EMPLOYEE_SECTION_ORDER, b.label)
    );
}

function orderIndex(order: string[], label: string): number {
  const i = order.indexOf(label);
  return i === -1 ? order.length : i;
}

// Shift-cell audit entries (collection "shiftPlans/shifts") store the date only
// in the doc id (`employeeId_YYYY-MM-DD`), so the changed field is "rawInput"
// with no visible day. Label each such change row with its formatted date (e.g.
// "5. 5. 2025") instead of the generic "Směna (zápis)", so a grouped multi-day
// edit reads one row per day. Works for legacy entries too (render-derived from
// subResourceId, which existing docs already carry).
function shiftCellDateLabel(entry: AuditEntry): string | null {
  if (entry.collection !== "shiftPlans/shifts") return null;
  const m = /(\d{4}-\d{2}-\d{2})$/.exec(entry.subResourceId ?? "");
  return m ? formatAuditValue(m[1], "date") : null;
}

function buildEvent(entries: AuditEntry[]): AuditEvent {
  const first = entries[0];
  const root = rootCollection(first.collection);

  // Group field changes by their section label (preserving first-seen order).
  const sectionMap = new Map<string, AuditFieldChange[]>();
  for (const e of entries) {
    if (e.action !== "update") continue;
    const label = sectionLabel(e.collection);
    if (!sectionMap.has(label)) sectionMap.set(label, []);
    sectionMap.get(label)!.push({
      fieldPath: e.fieldPath,
      label: shiftCellDateLabel(e) ?? fieldLabel(e.collection, e.fieldPath),
      leaf: e.fieldPath?.split(".").pop(),
      redacted: e.redacted,
      oldValue: e.oldValue,
      newValue: e.newValue,
    });
  }
  const sections = sortSections(
    root,
    Array.from(sectionMap.entries()).map(([label, changes]) => ({ label, changes }))
  );

  // Semantic event: carried on the entry, or render-derived for legacy entries
  // from a status field change (so old approvals/rejections read correctly).
  let event = first.event;
  if (!event) {
    const statusEntry = entries.find((e) => e.fieldPath?.split(".").pop() === "status");
    if (statusEntry) event = deriveLegacyEventId(first.collection, statusEntry.newValue);
  }

  return {
    id: first.id,
    action: first.action,
    userId: first.userId,
    userEmail: first.userEmail,
    userRole: first.userRole,
    timestamp: tsToDate(first.timestamp),
    collectionRoot: root,
    primaryCollection: first.collection,
    resourceId: first.resourceId,
    employeeId: first.employeeId,
    event,
    sections,
    summary: first.summary,
    extra: first.extra,
    entries,
  };
}

/** Fold a time-desc list of audit entries into grouped events. */
export function groupEntries(entries: AuditEntry[]): AuditEvent[] {
  const events: AuditEvent[] = [];
  let current: AuditEntry[] = [];
  let anchorMs: number | null = null;
  let key: string | null = null;

  const flush = () => {
    if (current.length) events.push(buildEvent(current));
    current = [];
    anchorMs = null;
    key = null;
  };

  for (const e of entries) {
    const eKey = `${e.userId}|${e.action}|${recordKey(e)}`;
    const ms = tsToDate(e.timestamp)?.getTime() ?? null;
    const withinWindow =
      anchorMs !== null && ms !== null && Math.abs(anchorMs - ms) <= GROUP_WINDOW_MS;

    if (current.length && eKey === key && withinWindow) {
      current.push(e);
    } else {
      flush();
      current.push(e);
      key = eKey;
      anchorMs = ms;
    }
  }
  flush();
  return events;
}

// ─── Date bucketing for the timeline ──────────────────────────────────────────

export interface DateBucket {
  label: string;
  events: AuditEvent[];
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Group events under "Dnes" / "Včera" / explicit date headers (time-desc). */
export function bucketByDate(events: AuditEvent[], now = new Date()): DateBucket[] {
  const today = startOfDay(now);
  const dayMs = 86_400_000;
  const buckets: DateBucket[] = [];
  let currentKey: number | null = null;
  let currentBucket: DateBucket | null = null;

  for (const ev of events) {
    const d = ev.timestamp;
    const dayStart = d ? startOfDay(d) : -1;
    if (dayStart !== currentKey) {
      currentKey = dayStart;
      currentBucket = { label: dateLabel(dayStart, today, dayMs), events: [] };
      buckets.push(currentBucket);
    }
    currentBucket!.events.push(ev);
  }
  return buckets;
}

// ─── Record title ─────────────────────────────────────────────────────────────

export interface EventTitle {
  text: string;
  /** Link target (employee detail) when the record is a resolvable employee. */
  href?: string;
}

/**
 * Specific identifier for the record an event acted on – the employee name,
 * the payroll month, or a name pulled from a create/delete snapshot. Returns
 * an empty string when only a generic collection label would apply, since the
 * header's subject noun already conveys that (avoids "Vytvořil společnost –
 * Společnost").
 */
export function eventTitle(ev: AuditEvent, employeeName?: string): EventTitle {
  if (ev.employeeId && employeeName) {
    return { text: employeeName, href: `/zamestnanci/${ev.employeeId}` };
  }
  const root = ev.collectionRoot;
  if (root === "payrollPeriods" && ev.resourceId && /^\d{4}-\d{2}$/.test(ev.resourceId)) {
    const [y, m] = ev.resourceId.split("-");
    return { text: `Mzdy ${Number(m)}/${y}` };
  }
  const s = ev.summary;
  if (s) {
    const name = s.name ?? s.displayName ?? s.abbreviation ?? s.title;
    if (typeof name === "string" && name.trim()) return { text: name.trim() };
  }
  return { text: "" };
}

function dateLabel(dayStart: number, today: number, dayMs: number): string {
  if (dayStart === -1) return "Neznámé datum";
  if (dayStart === today) return "Dnes";
  if (dayStart === today - dayMs) return "Včera";
  return new Date(dayStart).toLocaleDateString("cs-CZ", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
