import { Router, Response, NextFunction } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { requirePermission, hasPermission, getManagementTypeIds } from "../auth/permissions";
import { encryptFields, redactFields, decrypt, decryptFields, REDACTION_MASK } from "../services/encryption";
import {
  ctxFromReq,
  logCreate,
  logUpdate,
  logDelete,
  logSystemEvent,
  writeAudit,
} from "../services/auditLog";
import {
  refreshProbationAlertsForEmployee,
  deleteProbationAlertsForEmployee,
} from "../services/probationAlerts";
import * as clock from "../services/clock";
import { fillQuestionnairePdf, fillProhlaseniPdf } from "../services/formPdf";
import { formatNationality } from "../services/nationalities";
import { normalizeContactAddresses } from "../services/addressFormat";
import { randomUUID } from "crypto";
import {
  anyPeriodActiveOn,
  readMultisport,
  endOfMonth,
  type MultisportPeriod,
  type MultisportCompanion,
} from "../services/multisport";

export const employeesRouter = Router();

const db = () => admin.firestore();

// Sensitive fields that must be encrypted at rest and redacted in responses
const SENSITIVE_FIELDS = ["birthNumber"] as const;
const DOCUMENT_SENSITIVE_FIELDS = ["idCardNumber", "idCardExpiry"] as const;
const BENEFITS_SENSITIVE_FIELDS = ["insuranceNumber", "bankAccount"] as const;

// Root-employee fields the client must never set directly: they are derived /
// denormalized server-side and feed the Employees list, status logic, and
// payroll. `status` + `current*` come from folding the latest employment
// session (applyDerivedStatus / computeEffectiveRootFields), `employment*Date`
// and `parentalLeave*` from the session fold, and `zaucovani*` from the
// benefits doc. Stripped from the PATCH /:id body so a crafted request can't
// corrupt them (mass-assignment hardening). These live ONLY on the root doc, so
// the subdoc/employment-row writes don't need them.
const PROTECTED_ROOT_FIELDS = [
  "status",
  "currentJobTitle",
  "currentDepartment",
  "currentContractType",
  "currentCompanyId",
  "additionalContracts",
  "employmentStartDate",
  "employmentEndDate",
  "parentalLeaveFrom",
  "parentalLeaveTo",
  "zaucovani",
  "zaucovaniDo",
  "createdAt",
  "createdBy",
] as const;

/** Coerce any Firestore value to a plain string ("" for null/undefined). */
function asStr(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/**
 * Stream a generated PDF buffer back for in-browser viewing (inline). Sets a
 * UTF-8 filename with a plain-ASCII fallback for legacy clients.
 */
function sendPdfInline(res: Response, pdf: Buffer, filenameBase: string): void {
  const asciiFallback = filenameBase
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7e]/g, "_");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Length", pdf.length);
  // inline so the frontend can open it in a new browser tab (view, not download).
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${asciiFallback}.pdf"; filename*=UTF-8''${encodeURIComponent(filenameBase)}.pdf`
  );
  res.end(pdf);
}

/** Czech phone display: "+420" national numbers grouped "+420 XXX XXX XXX". */
function formatPhoneCZ(phone: string): string {
  const t = phone.trim();
  if (t.startsWith("+420")) {
    const digits = t.slice(4).replace(/\s+/g, "");
    if (/^\d{9}$/.test(digits)) {
      return `+420 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)}`;
    }
  }
  return t;
}

/**
 * Resolve a combined gendered Czech string ("svobodný/á", "ženatý/vdaná") to the
 * variant for the employee's gender ("m"/"f"). Mirrors frontend genderDisplay.ts:
 * a female part of ≤2 chars is a suffix replacing the male ending, else a full word.
 */
function displayGendered(value: string, gender: string): string {
  if (!value) return "";
  const slash = value.indexOf("/");
  if (slash === -1) return value;
  const male = value.slice(0, slash);
  const female = value.slice(slash + 1);
  const g = gender.trim().toLowerCase();
  if (g === "m") return male;
  if (g === "f") return female.length <= 2 ? male.slice(0, -female.length) + female : female;
  return value;
}

/**
 * Walk an employee's employment rows in chronological order, find the latest
 * session (last Nástup → Dodatek* → Ukončení? group), fold each Dodatek's
 * `changes[]` into the Nástup's fields, and write the resulting effective
 * state to the employee root doc.
 *
 * Returns the patched fields (for audit logging) or null if no Nástup row
 * exists yet, or if the latest session has been terminated (we leave root
 * fields alone on Ukončení — the employee.status flow handles deactivation).
 */
async function computeEffectiveRootFields(
  empRef: admin.firestore.DocumentReference,
  positionDeptMap?: Map<string, string>
): Promise<Record<string, unknown> | null> {
  const snap = await empRef.collection("employment").orderBy("startDate", "asc").get();
  type Row = Record<string, unknown> & { id: string };
  const rows: Row[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));

  // clock.today() honours the non-prod test clock.
  const today = clock.today();

  // Build the FULL chronological session list. Every `nástup` opens a session;
  // `změna smlouvy` / `ukončení` attach to the most recently opened one. A
  // nástup flagged `parallel: true` marks a CONCURRENT (second-job) contract:
  // it forms its own session, kept SEPARATE from the primary line so it doesn't
  // overwrite current* (which would hide the main contract). Without any
  // parallel session, the selection below is byte-identical to the old
  // "latest session" behaviour.
  type Session = { nastup: Row; dodatky: Row[]; terminated: boolean; parallel: boolean };
  const sessions: Session[] = [];
  let current: Session | null = null;
  for (const r of rows) {
    const ct = r.changeType as string | undefined;
    if (ct === "nástup") {
      if (current) sessions.push(current);
      current = { nastup: r, dodatky: [], terminated: false, parallel: r.parallel === true };
    } else if (current && ct === "změna smlouvy") {
      current.dodatky.push(r);
    } else if (current && ct === "ukončení") {
      // Date-based: a future-dated Ukončení leaves the employee active (and
      // still showing their current position) until the day after the end date.
      if (((r.startDate as string | undefined) ?? "") < today) current.terminated = true;
    }
  }
  if (current) sessions.push(current);

  // A position-change Dodatek can move the employee to a position that belongs
  // to a DIFFERENT department, so currentDepartment (→ Oddělení column + detail
  // header) must follow the effective position. Resolve position name → dept
  // name via the jobPositions catalogue, built lazily only when a position
  // actually changes (the bulk refresh passes a shared map in). An unresolvable
  // (free-text / legacy) position leaves the department on its last known value,
  // and a session with no position-change Dodatek keeps the Nástup's department.
  let lazyMap: Map<string, string> | null = positionDeptMap ?? null;
  const resolveDept = async (positionName: string): Promise<string | undefined> => {
    if (!lazyMap) lazyMap = await buildPositionDeptMap();
    return lazyMap.get(positionName);
  };

  // Fold a single session's applicable Dodatky into its effective contract
  // fields. Only Dodatky whose validity (startDate) has arrived are folded —
  // mirrors the frontend computeEffectiveState so list + detail header agree.
  const foldSession = async (
    s: Session
  ): Promise<{ jobTitle: string; contractType: string; companyId: string | null; department: string }> => {
    let jobTitle = (s.nastup.jobTitle as string | undefined) ?? "";
    let contractType = (s.nastup.contractType as string | undefined) ?? "";
    const companyId = (s.nastup.companyId as string | undefined) ?? null;
    let department = (s.nastup.department as string | undefined) ?? "";
    for (const dodatek of s.dodatky) {
      if (((dodatek.startDate as string | undefined) ?? "") > today) continue;
      const changes = (dodatek.changes as Array<{ changeKind?: string; value?: string }> | undefined) ?? [];
      for (const ch of changes) {
        if (ch.changeKind === "pracovní pozice" && ch.value) {
          jobTitle = ch.value;
          const resolved = await resolveDept(ch.value);
          if (resolved) department = resolved;
        } else if (ch.changeKind === "úvazek" && ch.value) {
          // Same mapping as the frontend's uvazekToContractType — keep
          // the two in sync if either side changes.
          const v = ch.value.toLowerCase();
          if (v.includes("polovič") || v.includes("zkrácen") || v.includes("částečn")) contractType = "PPP";
          else if (v.includes("plný") || v.includes("plny")) contractType = "HPP";
        }
      }
    }
    return { jobTitle, contractType, companyId, department };
  };

  // PRIMARY = the latest NON-parallel session (mirrors the previous "latest
  // session" pick exactly when there are no parallel sessions). current* is
  // cleared (null return) when there is no primary or it has been terminated,
  // exactly as before — UNLESS an active concurrent contract remains (below).
  const nonParallel = sessions.filter((s) => !s.parallel);
  const primary = nonParallel.length ? nonParallel[nonParallel.length - 1] : null;
  const primaryActive = !!primary && !primary.terminated;

  // ADDITIONAL = every ACTIVE parallel (concurrent) contract. Phase 1: surfaced
  // on the Zaměstnanci list as a secondary badge — NOT yet paid or
  // shift-attributed (that is Phase 2 / Phase 3). endDate is taken from the
  // Nástup row (concurrent contracts rarely carry Dodatky in practice).
  const additionalContracts: Array<Record<string, unknown>> = [];
  for (const s of sessions) {
    if (!s.parallel) continue;
    const started = (((s.nastup.startDate as string | undefined) ?? "") <= today);
    if (!started || s.terminated) continue;
    const f = await foldSession(s);
    additionalContracts.push({
      nastupRowId: s.nastup.id,
      contractType: f.contractType,
      jobTitle: f.jobTitle,
      department: f.department,
      companyId: f.companyId,
      startDate: (s.nastup.startDate as string | undefined) ?? null,
      endDate: (s.nastup.endDate as string | null | undefined) ?? null,
    });
  }

  // No active primary AND no concurrent contracts → behave exactly as before
  // (caller clears the root fields via EMPTY_ROOT_FIELDS).
  if (!primaryActive && additionalContracts.length === 0) return null;

  const pf = primaryActive
    ? await foldSession(primary as Session)
    : { jobTitle: "", contractType: "", companyId: null as string | null, department: "" };

  return {
    currentCompanyId: pf.companyId,
    currentDepartment: pf.department,
    currentContractType: pf.contractType,
    currentJobTitle: pf.jobTitle,
    additionalContracts,
  };
}

/**
 * Build a map of job-position NAME → its department NAME (resolved via the
 * position's departmentId). Used to keep currentDepartment in step with a
 * Dodatek that moves the employee to a position in another department. Position
 * names are treated as unique; if two positions share a name across departments
 * the last one wins (rare — the position picker is department-scoped).
 */
async function buildPositionDeptMap(): Promise<Map<string, string>> {
  const [posSnap, depSnap] = await Promise.all([
    db().collection("jobPositions").get(),
    db().collection("departments").get(),
  ]);
  const depNameById = new Map<string, string>();
  for (const d of depSnap.docs) {
    depNameById.set(d.id, ((d.data() as { name?: string }).name) ?? "");
  }
  const map = new Map<string, string>();
  for (const p of posSnap.docs) {
    const data = p.data() as { name?: string; departmentId?: string };
    const depName = depNameById.get(data.departmentId ?? "") ?? "";
    if (data.name && depName) map.set(data.name, depName);
  }
  return map;
}

async function recomputeRootFromLatestSession(
  empRef: admin.firestore.DocumentReference,
  now: FirebaseFirestore.FieldValue
): Promise<Record<string, unknown> | null> {
  const patch = await computeEffectiveRootFields(empRef);
  if (!patch) return null;
  await empRef.update({ ...patch, updatedAt: now });
  return patch;
}

const EMPTY_ROOT_FIELDS = {
  currentCompanyId: null,
  currentDepartment: "",
  currentContractType: "",
  currentJobTitle: "",
  additionalContracts: [],
} as const;

/**
 * Stable, key-order-independent comparison of two `additionalContracts` arrays
 * (concurrent-contract denormalization). Serialises each entry as a fixed-order
 * tuple so a Firestore-read object and a freshly-built one compare equal when
 * their values match.
 */
function additionalContractsKey(arr: unknown): string {
  return JSON.stringify(
    ((arr as Array<Record<string, unknown>>) ?? []).map((c) => [
      c.nastupRowId ?? null,
      c.contractType ?? null,
      c.jobTitle ?? null,
      c.department ?? null,
      c.companyId ?? null,
      c.startDate ?? null,
      c.endDate ?? null,
    ])
  );
}

/**
 * Derive an employee's lifecycle status from their employment sessions —
 * strictly DATE-BASED, with deliberately asymmetric boundaries:
 *   • A session has STARTED only once its Nástup startDate is on/before today
 *     (`startDate <= today`). A future-dated Nástup does NOT count as active
 *     until the day it arrives — so reinstating with a future start shows the
 *     employee as active ON that day, not before.
 *   • A session has ENDED only once its effective end date is strictly before
 *     today (`endDate < today`). The end date itself (the Ukončení row's
 *     startDate, or a fixed-term endDate) is the last ACTIVE day — so a
 *     termination dated today or in the future leaves the employee active.
 * Status is "active" when at least one started-and-not-yet-ended session
 * exists, else "terminated". Returns "before-start" when there are no employment
 * rows yet (a freshly-created / name-only employee, awaiting their first Nástup):
 * no session means they have not started, so they belong in the Před nástupem tab
 * — never "active" before onboarding, and never "terminated" either.
 */
export function computeEffectiveStatus(
  rows: Array<Record<string, unknown>>,
  today: string
): "active" | "before-start" | "terminated" {
  type S = { nastup: Record<string, unknown>; dodatky: Record<string, unknown>[]; ukonceniDate: string | null };
  const sorted = [...rows].sort((a, b) =>
    String(a.startDate ?? "").localeCompare(String(b.startDate ?? ""))
  );
  const sessions: S[] = [];
  let cur: S | null = null;
  for (const r of sorted) {
    const ct = r.changeType as string | undefined;
    if (ct === "nástup") {
      if (cur) sessions.push(cur);
      cur = { nastup: r, dodatky: [], ukonceniDate: null };
    } else if (cur && ct === "změna smlouvy") {
      cur.dodatky.push(r);
    } else if (cur && ct === "ukončení") {
      cur.ukonceniDate = (r.startDate as string | undefined) ?? null;
    }
  }
  if (cur) sessions.push(cur);
  // No employment session at all → the employee has not started yet, so they
  // belong in the Před nástupem tab (e.g. a name-only employee added before any
  // contract exists), not "active".
  if (sessions.length === 0) return "before-start";

  const isActive = (s: S): boolean => {
    // Not started yet — a future Nástup only activates ON its day.
    const start = (s.nastup.startDate as string | undefined) ?? "";
    if (start > today) return false;
    // Effective end date: the Nástup's endDate, overridden by any "délka
    // smlouvy" Dodatek already in effect, then by the Ukončení row's startDate.
    let endDate = (s.nastup.endDate as string | null | undefined) ?? null;
    for (const d of s.dodatky) {
      if (((d.startDate as string | undefined) ?? "") > today) continue;
      const changes = (d.changes as Array<{ changeKind?: string; value?: string }> | undefined) ?? [];
      for (const ch of changes) {
        // Empty value = change to doba neurčitá: a Dodatek clears a fixed end
        // date, so the session is no longer terminated (don't drop the null).
        if (ch.changeKind === "délka smlouvy") endDate = ch.value || null;
      }
    }
    if (s.ukonceniDate) endDate = s.ukonceniDate;
    // The end date is the last active day; only the day AFTER is terminated.
    return !(endDate && endDate < today);
  };

  if (sessions.some(isActive)) return "active";
  // Not currently active. If the most recent session's Nástup is in the future,
  // they are "before start" (an upcoming new hire, or a returning past employee
  // with an upcoming contract); otherwise genuinely terminated. Any future start
  // qualifies — no time window.
  const latest = sessions[sessions.length - 1];
  const latestStart = (latest.nastup.startDate as string | undefined) ?? "";
  return latestStart > today ? "before-start" : "terminated";
}

/**
 * Absolute month index of an ISO date ("YYYY-MM-DD") → year*12 + (month-1).
 * Used to measure the gap between employment sessions in WHOLE CALENDAR MONTHS
 * so the comparison is year-boundary-safe (Dec 2025 = …, Jan 2026 = …+1).
 * Parses by substring, never `new Date()`, to dodge the UTC-shift gotcha.
 */
function isoMonthIndex(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const m = /^(\d{4})-(\d{2})/.exec(dateStr);
  if (!m) return null;
  return Number(m[1]) * 12 + (Number(m[2]) - 1);
}

/**
 * Derive the two denormalized date columns shown on the Zaměstnanci list:
 *
 *   • `employmentStartDate` — the start of the employee's CURRENT CONTINUOUS run
 *     at the company, NOT their latest Nástup. Sessions are folded oldest→newest;
 *     a new Nástup continues the same run when it starts in the SAME calendar
 *     month as, or the month immediately AFTER, the previous session's effective
 *     end (gap ≤ 1 whole month — confirmed rule 2026-06-20). Dec-31-end →
 *     Jan-1-start is therefore continuous. A larger gap (terminated, rehired
 *     months later) starts a fresh run, and the continuous start is that latest
 *     run's start. Worked example: Richard Klíma's latest Nástup is 1. 1. 2026
 *     but he has worked unbroken since Nov 2022 → this returns Nov 2022.
 *
 *   • `employmentEndDate` — the effective end of the LATEST session, or null when
 *     open-ended. Mirrors `computeEffectiveStatus`'s isActive end-date resolution
 *     (Nástup endDate, overridden by any in-effect "délka smlouvy" Dodatek, then
 *     by the Ukončení row's startDate). Null for ordinary open-ended staff (→ "—"
 *     in the UI), filled for terminated employees and for still-active staff with
 *     a known future end (fixed-term / signed-ahead exit).
 *
 * Computed for EVERY employee regardless of active/terminated status, so it sits
 * apart from `computeEffectiveRootFields` (which returns null when terminated).
 */
export function computeEmploymentDates(
  rows: Array<Record<string, unknown>>,
  today: string
): { employmentStartDate: string | null; employmentEndDate: string | null } {
  type S = { nastup: Record<string, unknown>; dodatky: Record<string, unknown>[]; ukonceniDate: string | null };
  const sorted = [...rows].sort((a, b) =>
    String(a.startDate ?? "").localeCompare(String(b.startDate ?? ""))
  );
  const sessions: S[] = [];
  let cur: S | null = null;
  for (const r of sorted) {
    const ct = r.changeType as string | undefined;
    if (ct === "nástup") {
      if (cur) sessions.push(cur);
      cur = { nastup: r, dodatky: [], ukonceniDate: null };
    } else if (cur && ct === "změna smlouvy") {
      cur.dodatky.push(r);
    } else if (cur && ct === "ukončení") {
      cur.ukonceniDate = (r.startDate as string | undefined) ?? null;
    }
  }
  if (cur) sessions.push(cur);
  if (sessions.length === 0) return { employmentStartDate: null, employmentEndDate: null };

  // Effective end of a session: Nástup endDate, overridden by an in-effect "délka
  // smlouvy" Dodatek (empty value = doba neurčitá clears it), then by Ukončení.
  // The today-filter only matters for the latest session (a past session's
  // Dodatky are all already in effect), so it is safe to apply uniformly.
  const effectiveEnd = (s: S): string | null => {
    let endDate = (s.nastup.endDate as string | null | undefined) ?? null;
    for (const d of s.dodatky) {
      if (((d.startDate as string | undefined) ?? "") > today) continue;
      const changes = (d.changes as Array<{ changeKind?: string; value?: string }> | undefined) ?? [];
      for (const ch of changes) {
        if (ch.changeKind === "délka smlouvy") endDate = ch.value || null;
      }
    }
    if (s.ukonceniDate) endDate = s.ukonceniDate;
    return endDate;
  };

  // Walk oldest→newest; reset the run start only on a real (>1 month) gap.
  let runStart = (sessions[0].nastup.startDate as string | undefined) ?? null;
  for (let i = 1; i < sessions.length; i++) {
    const prevIdx = isoMonthIndex(effectiveEnd(sessions[i - 1]));
    const curStart = (sessions[i].nastup.startDate as string | undefined) ?? null;
    const curIdx = isoMonthIndex(curStart);
    // Unmeasurable boundary (missing/garbled date, or an open-ended prior
    // session) → treat as continuous (forgiving: keep the run going).
    const continuous = prevIdx === null || curIdx === null ? true : curIdx - prevIdx <= 1;
    if (!continuous) runStart = curStart;
  }

  return {
    employmentStartDate: runStart,
    employmentEndDate: effectiveEnd(sessions[sessions.length - 1]),
  };
}

/**
 * Recompute + persist the employee's active/terminated status from their
 * employment sessions, so terminating (Ukončení row or a fixed-term contract
 * expiring) auto-moves them to the Ukončení tab, and a fresh Nástup brings them
 * back. Orthogonal to the current* denormalized fields — only ever writes
 * `status`. Audits the change when a req context is supplied (the nightly sweep
 * passes none).
 */
/**
 * Denormalized parental-leave window for the Zaměstnanci-list "RODIČOVSKÁ"
 * badge. Among the employee's `rodičovská` rows, pick the earliest period that
 * hasn't ended yet (endDate >= today) — the active or next-upcoming one — and
 * store its from/to on the root. The list does a live containment check
 * (from <= today <= to), so a future period shows nothing until its start and
 * an ended one drops off, without needing a same-day recompute.
 */
function computeParentalLeave(
  rows: Array<Record<string, unknown>>,
  today: string
): { parentalLeaveFrom: string | null; parentalLeaveTo: string | null } {
  const periods = rows
    .filter(
      (r) =>
        r.changeType === "rodičovská" &&
        typeof r.startDate === "string" &&
        typeof r.endDate === "string" &&
        (r.endDate as string) >= today
    )
    .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
  const p = periods[0];
  return {
    parentalLeaveFrom: p ? (p.startDate as string) : null,
    parentalLeaveTo: p ? (p.endDate as string) : null,
  };
}

async function applyDerivedStatus(
  empRef: admin.firestore.DocumentReference,
  now: FirebaseFirestore.FieldValue,
  req?: AuthRequest
): Promise<void> {
  const snap = await empRef.collection("employment").orderBy("startDate", "asc").get();
  const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
  const today = clock.today();
  const status = computeEffectiveStatus(rows, today);
  // Denormalized Zaměstnanci-list date columns — folded from the same session
  // read, persisted alongside status (both apply to active AND terminated
  // employees, so they live here rather than in computeEffectiveRootFields).
  const { employmentStartDate, employmentEndDate } = computeEmploymentDates(rows, today);
  const { parentalLeaveFrom, parentalLeaveTo } = computeParentalLeave(rows, today);
  const before = (await empRef.get()).data() as Record<string, unknown> | undefined;
  if (!before) return;
  const statusChanged = before.status !== status;
  const datesChanged =
    (before.employmentStartDate ?? null) !== employmentStartDate ||
    (before.employmentEndDate ?? null) !== employmentEndDate;
  const parentalChanged =
    (before.parentalLeaveFrom ?? null) !== parentalLeaveFrom ||
    (before.parentalLeaveTo ?? null) !== parentalLeaveTo;
  // Write when status, a date, OR the parental-leave window changed — so existing
  // employees still backfill the new fields on the next nightly sweep / Úlohy
  // refresh, without churning updatedAt when nothing moved.
  if (!statusChanged && !datesChanged && !parentalChanged) return;
  await empRef.update({
    status,
    employmentStartDate,
    employmentEndDate,
    parentalLeaveFrom,
    parentalLeaveTo,
    updatedAt: now,
  });
  // Only the lifecycle status transition is audited; the date fields are pure
  // derived denormalizations and would only add noise (decision 2026-06-20).
  if (statusChanged) {
    if (req) {
      // Status change driven by a user action (e.g. adding an Ukončení row).
      await logUpdate(ctxFromReq(req), {
        collection: "employees",
        resourceId: empRef.id,
        employeeId: empRef.id,
        before: { status: before.status ?? null },
        after: { status },
      });
    } else {
      // Nightly, date-driven transition with no human actor → Systém event:
      // a contract end date passing (auto-terminate) or a future Nástup arriving
      // (auto-reactivate). Previously the nightly sweep flipped status silently.
      await logSystemEvent({
        event:
          status === "terminated"
            ? "employee.autoTerminate"
            : status === "active"
              ? "employee.autoReactivate"
              : "employee.autoStatusChange",
        collection: "employees",
        resourceId: empRef.id,
        employeeId: empRef.id,
        summary: { from: before.status ?? null, to: status },
      });
    }
  }
}

/**
 * Re-sync the denormalized current* root fields after ANY employment-row write
 * (add / edit / delete) by folding the employee's latest session — NEVER by
 * copying a single row's own fields. A Dodatek (`změna smlouvy`) row carries its
 * change inside `changes[]` and has no jobTitle/department/contractType/companyId,
 * so copying them onto the root would wipe the employee's "current" values (the
 * exact bug that blanked the Zaměstnanci list). Clears the fields when no active
 * session remains, and writes an audit entry only when something actually changed.
 */
async function resyncRootFields(
  empRef: admin.firestore.DocumentReference,
  req: AuthRequest,
  now: FirebaseFirestore.FieldValue
): Promise<void> {
  const before = (await empRef.get()).data() as Record<string, unknown> | undefined;
  // recomputeRootFromLatestSession already writes the folded patch when non-null.
  const patch = await recomputeRootFromLatestSession(empRef, now);
  const after = patch ?? { ...EMPTY_ROOT_FIELDS };
  if (!patch) {
    await empRef.update({ ...after, updatedAt: now });
  }
  // Auto-move to / from the Ukončení tab based on whether an active session
  // remains (orthogonal to the current* fields). Must run regardless of whether
  // the current* fields changed, so it sits before the early returns below.
  await applyDerivedStatus(empRef, now, req);
  if (!before) return;
  // current*-only diff gates the AUDIT entry here (the root WRITE already
  // happened in recomputeRootFromLatestSession). A concurrent-contract change is
  // audited at the row level by the POST/PATCH logCreate/logUpdate, so it must
  // NOT also emit a no-diff current* entry.
  const changed =
    after.currentJobTitle !== (before.currentJobTitle ?? "") ||
    after.currentContractType !== (before.currentContractType ?? "") ||
    after.currentDepartment !== (before.currentDepartment ?? "") ||
    after.currentCompanyId !== (before.currentCompanyId ?? null);
  if (!changed) return;
  await logUpdate(ctxFromReq(req), {
    collection: "employees",
    resourceId: empRef.id,
    employeeId: empRef.id,
    before: {
      currentCompanyId: before.currentCompanyId ?? null,
      currentDepartment: before.currentDepartment ?? "",
      currentContractType: before.currentContractType ?? "",
      currentJobTitle: before.currentJobTitle ?? "",
    },
    after,
  });
}

/**
 * Daily refresh over EVERY employee: (1) re-derive active/terminated status so
 * date transitions flip on their day in BOTH directions with no employment
 * write — active→terminated when a termination/fixed-term date has passed, and
 * terminated→active when a future-dated Nástup (e.g. a future reinstatement)
 * arrives; (2) re-fold each active employee's effective root fields so a
 * future-dated Dodatek flips position/úvazek (Zaměstnanci list + payroll
 * contract type) on its validity date. Writes only when a field actually
 * changed, to avoid churning updatedAt across the collection.
 */
export async function refreshEffectiveRootForAllActive(): Promise<{ scanned: number; updated: number }> {
  const snap = await db().collection("employees").get();
  // Build the position→department map once for the whole sweep instead of per
  // employee (the per-write paths build their own on demand).
  const positionDeptMap = await buildPositionDeptMap();
  let updated = 0;
  for (const doc of snap.docs) {
    // Re-derive status from the sessions (date-based) — moves people into OR
    // out of the Ukončení tab as termination / future-Nástup dates pass.
    await applyDerivedStatus(doc.ref, FieldValue.serverTimestamp());
    const patch = await computeEffectiveRootFields(doc.ref, positionDeptMap);
    if (!patch) continue;
    const before = doc.data() as Record<string, unknown>;
    const changed =
      patch.currentJobTitle !== (before.currentJobTitle ?? "") ||
      patch.currentContractType !== (before.currentContractType ?? "") ||
      patch.currentDepartment !== (before.currentDepartment ?? "") ||
      patch.currentCompanyId !== (before.currentCompanyId ?? null) ||
      additionalContractsKey(patch.additionalContracts) !== additionalContractsKey(before.additionalContracts);
    if (changed) {
      await doc.ref.update({ ...patch, updatedAt: FieldValue.serverTimestamp() });
      updated++;
    }
  }
  return { scanned: snap.size, updated };
}

// ─── LIST ────────────────────────────────────────────────────────────────────

// ─── ROW-LEVEL SCOPE REFINEMENT (non-management viewers) ─────────────────────
// Each employee route is capability-gated by requirePermission(...) — that
// handles read-only viewers (e.g. účetní lack every write permission, so writes
// 403 at the route). This router-level guard adds the one row-level rule on top:
//   • non-management-scoped callers (e.g. built-in personalista) — cannot
//     see/touch a record whose linked login is a management user type. Triggered
//     by permission state (view.nonManagement without view.all), not a role
//     string, so it works for custom types and per-user overrides too.
// requireAuth is applied at the router level so req.permissions is set first.

/**
 * employeeIds whose linked login is a "management" user type. Determined by the
 * type's `management` flag (via getManagementTypeIds), keyed by the user's
 * roleType (falling back to the legacy role). Works for built-in and custom
 * types alike; falls back to the built-in admin/director/manager classification
 * when roleTypes is unseeded/unavailable.
 */
export async function getManagementEmployeeIds(): Promise<Set<string>> {
  const mgmtTypes = await getManagementTypeIds();
  const snap = await db().collection("users").get();
  const ids = new Set<string>();
  for (const d of snap.docs) {
    const u = d.data() as Record<string, unknown>;
    const typeId = (u.roleType as string) || "";
    const empId = u.employeeId;
    if (typeId && mgmtTypes.has(typeId) && typeof empId === "string" && empId) ids.add(empId);
  }
  return ids;
}

/**
 * True when the caller's employee visibility is the non-management SUBSET
 * (e.g. built-in personalista) rather than full access — i.e. they hold
 * `employees.view.nonManagement` but not `employees.view.all`. Reads the
 * caller's EFFECTIVE permission set (works for any user type), driving the
 * row-level management-record block (here and in contracts.ts).
 */
export function isNonManagementScoped(perms: Set<string> | undefined): boolean {
  const set = perms ?? new Set<string>();
  return (
    hasPermission(set, "employees.view.nonManagement") &&
    !hasPermission(set, "employees.view.all")
  );
}

async function enforceEmpAccess(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (isNonManagementScoped(req.permissions)) {
    // Router is mounted at /employees, so req.path is relative: the first
    // segment is the employee id for /:id[/...] routes ("" for the list/create,
    // "export" for the export route — neither is a real id).
    const seg = req.path.split("/")[1] || "";
    if (seg && seg !== "export") {
      const mgmt = await getManagementEmployeeIds();
      if (mgmt.has(seg)) {
        res.status(403).json({ error: "Tento záznam není pro roli personalista přístupný." });
        return;
      }
    }
  }
  next();
}

employeesRouter.use(requireAuth);
employeesRouter.use(enforceEmpAccess);

// ─── LIST ────────────────────────────────────────────────────────────────────

/**
 * GET /api/employees
 * Query params: status, companyId, department, contractType, nationality
 * Admin + director + accountant (read-only) + hr (management records filtered out)
 */
employeesRouter.get(
  "/",
  requirePermission("employees.view.all", "employees.view.nonManagement"),
  async (req: AuthRequest, res) => {
    let query: admin.firestore.Query = db().collection("employees");

    if (req.query.status) query = query.where("status", "==", req.query.status);
    if (req.query.companyId) query = query.where("currentCompanyId", "==", req.query.companyId);
    if (req.query.department) query = query.where("currentDepartment", "==", req.query.department);
    if (req.query.contractType) query = query.where("currentContractType", "==", req.query.contractType);
    if (req.query.nationality) query = query.where("nationality", "==", req.query.nationality);

    const snapshot = await query.get();
    let employees = snapshot.docs.map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      return { id: doc.id, ...redactFields(data, [...SENSITIVE_FIELDS]) };
    });

    // Non-management-scoped callers (hr) never see admin/director/manager records.
    if (isNonManagementScoped(req.permissions)) {
      const mgmt = await getManagementEmployeeIds();
      employees = employees.filter((e) => !mgmt.has(e.id));
    }

    res.json(employees);
  }
);

// ─── EXPORT ──────────────────────────────────────────────────────────────────

/**
 * GET /api/employees/export
 * Returns merged rows (root + contact + documents + benefits + latest employment)
 * for CSV export on the frontend.
 *
 * Query params (all optional):
 *   status, companyId, department, contractType, nationality, jobTitle
 *   includeSensitive=true — decrypts birthNumber / idCardNumber / insuranceNumber
 *                          / bankAccount; writes ONE auditLog entry per export.
 *
 * Must be declared before GET /:id so Express matches "export" as a literal.
 */
employeesRouter.get(
  "/export",
  requirePermission("employees.export"),
  async (req: AuthRequest, res) => {
    const includeSensitive = req.query.includeSensitive === "true";

    // `employees.export` lets a caller export the roster; decrypting the
    // sensitive fields into the CSV requires the SEPARATE, higher-trust
    // `employees.export.sensitive`. The frontend hides the toggle without it,
    // but that's only cosmetic — enforce it here so a direct API call (or a
    // custom type granted plain export only) can't dump plaintext PII.
    if (includeSensitive && !hasPermission(req.permissions ?? new Set(), "employees.export.sensitive")) {
      res.status(403).json({ error: "K exportu citlivých údajů je třeba oprávnění „Exportovat citlivé údaje“." });
      return;
    }

    let query: admin.firestore.Query = db().collection("employees");
    if (req.query.status) query = query.where("status", "==", req.query.status);
    if (req.query.companyId) query = query.where("currentCompanyId", "==", req.query.companyId);
    if (req.query.department) query = query.where("currentDepartment", "==", req.query.department);
    if (req.query.contractType) query = query.where("currentContractType", "==", req.query.contractType);
    if (req.query.nationality) query = query.where("nationality", "==", req.query.nationality);
    if (req.query.jobTitle) query = query.where("currentJobTitle", "==", req.query.jobTitle);

    const snapshot = await query.get();
    let exportDocs = snapshot.docs;
    if (isNonManagementScoped(req.permissions)) {
      const mgmt = await getManagementEmployeeIds();
      exportDocs = exportDocs.filter((d) => !mgmt.has(d.id));
    }

    const rows = await Promise.all(
      exportDocs.map(async (empDoc) => {
        const empRef = empDoc.ref;
        const [contactSnap, documentsSnap, benefitsSnap, employmentSnap] = await Promise.all([
          empRef.collection("contact").limit(1).get(),
          empRef.collection("documents").limit(1).get(),
          empRef.collection("benefits").limit(1).get(),
          // A few latest rows so we can skip informational "rodičovská" periods
          // and export the latest actual employment-contract row.
          empRef.collection("employment").orderBy("startDate", "desc").limit(5).get(),
        ]);

        let root = empDoc.data() as Record<string, unknown>;
        let documents = documentsSnap.empty
          ? {}
          : (documentsSnap.docs[0].data() as Record<string, unknown>);
        let benefits = benefitsSnap.empty
          ? {}
          : (benefitsSnap.docs[0].data() as Record<string, unknown>);
        const contact = contactSnap.empty
          ? {}
          : (contactSnap.docs[0].data() as Record<string, unknown>);
        const employmentDoc = employmentSnap.docs.find(
          (d) => (d.data() as Record<string, unknown>).changeType !== "rodičovská"
        );
        const employment = employmentDoc
          ? (employmentDoc.data() as Record<string, unknown>)
          : {};

        if (includeSensitive) {
          root = decryptFields(root, [...SENSITIVE_FIELDS]);
          documents = decryptFields(documents, [...DOCUMENT_SENSITIVE_FIELDS]);
          benefits = decryptFields(benefits, [...BENEFITS_SENSITIVE_FIELDS]);
        } else {
          root = redactFields(root, [...SENSITIVE_FIELDS]);
          documents = redactFields(documents, [...DOCUMENT_SENSITIVE_FIELDS]);
          benefits = redactFields(benefits, [...BENEFITS_SENSITIVE_FIELDS]);
        }

        return {
          id: empDoc.id,
          ...root,
          contact,
          documents,
          benefits,
          employment,
        };
      })
    );

    if (includeSensitive) {
      await writeAudit(ctxFromReq(req), {
        action: "export",
        collection: "employees",
        extra: {
          fields: [
            ...SENSITIVE_FIELDS,
            ...DOCUMENT_SENSITIVE_FIELDS,
            ...BENEFITS_SENSITIVE_FIELDS,
          ],
          filters: {
            status: req.query.status ?? null,
            companyId: req.query.companyId ?? null,
            department: req.query.department ?? null,
            contractType: req.query.contractType ?? null,
            nationality: req.query.nationality ?? null,
            jobTitle: req.query.jobTitle ?? null,
          },
          employeeCount: rows.length,
        },
      });
    }

    res.json({ employees: rows });
  }
);

// ─── GET ONE ─────────────────────────────────────────────────────────────────

/**
 * GET /api/employees/:id
 * Admin + HR only. Sensitive fields are redacted (use /reveal endpoints to expose).
 */
employeesRouter.get(
  "/:id",
  requirePermission("employees.view.all", "employees.view.nonManagement"),
  async (req: AuthRequest, res) => {
    const doc = await db().collection("employees").doc(req.params.id).get();
    if (!doc.exists) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }
    const data = doc.data() as Record<string, unknown>;
    res.json({ id: doc.id, ...redactFields(data, [...SENSITIVE_FIELDS]) });
  }
);

// ─── CREATE ───────────────────────────────────────────────────────────────────

/**
 * POST /api/employees
 * Creates employee + empty sub-documents (contact, benefits, documents).
 * Admin + HR only.
 */
employeesRouter.post(
  "/",
  requirePermission("employees.create"),
  async (req: AuthRequest, res) => {
    const body = req.body as Record<string, unknown>;
    const now = FieldValue.serverTimestamp();

    const employeeData = encryptFields(
      {
        firstName: body.firstName ?? "",
        lastName: body.lastName ?? "",
        displayName: body.displayName ?? "",
        dateOfBirth: body.dateOfBirth ?? null,
        gender: body.gender ?? null,
        // When true, gendered Czech strings (e.g. maritalStatus) are shown in
        // their combined form instead of resolved to the gender variant.
        genderNeutralDisplay: body.genderNeutralDisplay ?? false,
        birthSurname: body.birthSurname ?? "",
        birthNumber: body.birthNumber ?? "",
        maritalStatus: body.maritalStatus ?? "",
        education: body.education ?? "",
        nationality: body.nationality ?? "",
        placeOfBirth: body.placeOfBirth ?? "",
        // A brand-new employee has no employment session yet (the first Nástup is
        // added afterwards), so they start in the Před nástupem tab — matching
        // computeEffectiveStatus()'s empty-rows result. Adding a Nástup re-derives
        // this to "active" (started) or keeps "before-start" (future start).
        status: "before-start",
        currentCompanyId: body.currentCompanyId ?? null,
        currentDepartment: body.currentDepartment ?? "",
        currentContractType: body.currentContractType ?? "",
        currentJobTitle: body.currentJobTitle ?? "",
        // Denormalized list-date columns — null until the first Nástup is added
        // (which re-derives them via applyDerivedStatus). Seeded so the doc never
        // carries undefined fields.
        employmentStartDate: null,
        employmentEndDate: null,
        createdAt: now,
        updatedAt: now,
      },
      [...SENSITIVE_FIELDS]
    );

    const ref = await db().collection("employees").add(employeeData);
    await logCreate(ctxFromReq(req), {
      collection: "employees",
      resourceId: ref.id,
      employeeId: ref.id,
      summary: {
        firstName: body.firstName,
        lastName: body.lastName,
        currentDepartment: body.currentDepartment,
        currentJobTitle: body.currentJobTitle,
        currentContractType: body.currentContractType,
        currentCompanyId: body.currentCompanyId,
      },
      sensitiveFields: [...SENSITIVE_FIELDS],
    });
    res.status(201).json({ id: ref.id });
  }
);

// ─── UPDATE ───────────────────────────────────────────────────────────────────

/**
 * PATCH /api/employees/:id
 * Partial update. Re-encrypts sensitive fields if included.
 * Pass clearFields: ["birthNumber"] to explicitly delete a sensitive field.
 */
employeesRouter.patch(
  "/:id",
  requirePermission("employees.edit"),
  async (req: AuthRequest, res) => {
    const body = req.body as Record<string, unknown>;
    const clearFields = Array.isArray(body.clearFields) ? body.clearFields as string[] : [];
    const payload = { ...body };
    delete payload.clearFields;
    // Mass-assignment guard: drop any server-derived / denormalized field so a
    // crafted body can't overwrite status, current position/company, employment
    // dates, parental-leave window, or the training flag (all recomputed
    // elsewhere). updatedAt is set just below.
    for (const f of PROTECTED_ROOT_FIELDS) delete payload[f];
    // Never re-encrypt a round-tripped redaction mask — that would overwrite the
    // real encrypted value with ciphertext of "••••••••". Drop it so update()
    // preserves the stored value.
    for (const f of SENSITIVE_FIELDS) if (payload[f] === REDACTION_MASK) delete payload[f];

    const updated = encryptFields(
      { ...payload, updatedAt: FieldValue.serverTimestamp() },
      [...SENSITIVE_FIELDS]
    ) as Record<string, unknown>;

    // Explicitly delete cleared sensitive fields
    for (const f of SENSITIVE_FIELDS) {
      if (clearFields.includes(f)) {
        updated[f] = FieldValue.delete();
      }
    }

    const empRef = db().collection("employees").doc(req.params.id);
    const beforeSnap = await empRef.get();
    const before = beforeSnap.exists ? (beforeSnap.data() as Record<string, unknown>) : {};
    await empRef.update(updated);

    // Build the post-write view from the request body so we can diff against
    // the before-snapshot. clearFields turn into nulls so the diff registers a
    // change (FieldValue.delete sentinels would be opaque).
    const afterForLog: Record<string, unknown> = { ...payload };
    for (const f of clearFields) afterForLog[f] = null;
    await logUpdate(ctxFromReq(req), {
      collection: "employees",
      resourceId: req.params.id,
      employeeId: req.params.id,
      before,
      after: { ...before, ...afterForLog },
      sensitiveFields: [...SENSITIVE_FIELDS],
    });
    res.json({ success: true });
  }
);

// ─── REVEAL SENSITIVE FIELD ───────────────────────────────────────────────────

/**
 * POST /api/employees/:id/reveal
 * Body: { field: "birthNumber" | "idCardNumber" | ... }
 * Returns decrypted value and logs the reveal event.
 * Admin + HR only.
 */
employeesRouter.post(
  "/:id/reveal",
  requirePermission("sensitive.reveal"),
  async (req: AuthRequest, res) => {
    const { field } = req.body as { field: string };
    const allSensitive = [
      ...SENSITIVE_FIELDS,
      ...DOCUMENT_SENSITIVE_FIELDS,
      ...BENEFITS_SENSITIVE_FIELDS,
    ] as string[];

    if (!allSensitive.includes(field)) {
      res.status(400).json({ error: "Field is not a sensitive field or does not exist" });
      return;
    }

    // Determine which collection/doc holds this field
    let encryptedValue: string | undefined;
    const empDoc = await db().collection("employees").doc(req.params.id).get();
    if (!empDoc.exists) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }

    if ((SENSITIVE_FIELDS as readonly string[]).includes(field)) {
      encryptedValue = (empDoc.data() as Record<string, string>)[field];
    } else if ((DOCUMENT_SENSITIVE_FIELDS as readonly string[]).includes(field)) {
      const docsSnap = await db()
        .collection("employees")
        .doc(req.params.id)
        .collection("documents")
        .limit(1)
        .get();
      if (!docsSnap.empty) {
        encryptedValue = (docsSnap.docs[0].data() as Record<string, string>)[field];
      }
    } else if ((BENEFITS_SENSITIVE_FIELDS as readonly string[]).includes(field)) {
      const benefitsSnap = await db()
        .collection("employees")
        .doc(req.params.id)
        .collection("benefits")
        .limit(1)
        .get();
      if (!benefitsSnap.empty) {
        encryptedValue = (benefitsSnap.docs[0].data() as Record<string, string>)[field];
      }
    }

    if (!encryptedValue) {
      res.status(404).json({ error: "Field value not found" });
      return;
    }

    const plaintext = decrypt(encryptedValue);

    await writeAudit(ctxFromReq(req), {
      action: "reveal",
      collection: "employees",
      resourceId: req.params.id,
      employeeId: req.params.id,
      extra: { fieldName: field },
    });

    res.json({ value: plaintext });
  }
);

/**
 * GET /api/employees/:id/questionnaire-pdf
 * Fills the "Osobní dotazník zaměstnance" form PDF with all employee data
 * INCLUDING decrypted sensitive fields (rodné číslo, číslo OP, číslo pojištěnce,
 * číslo účtu). Gated by its own permission and audited as an export.
 */
employeesRouter.get(
  "/:id/questionnaire-pdf",
  requirePermission("employees.view.all", "employees.view.nonManagement"),
  async (req: AuthRequest, res) => {
    const id = req.params.id;
    const empRef = db().collection("employees").doc(id);
    const empSnap = await empRef.get();
    if (!empSnap.exists) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }

    const [contactSnap, documentsSnap, benefitsSnap, employmentSnap] = await Promise.all([
      empRef.collection("contact").limit(1).get(),
      empRef.collection("documents").limit(1).get(),
      empRef.collection("benefits").limit(1).get(),
      empRef.collection("employment").orderBy("startDate", "desc").limit(5).get(),
    ]);

    const root = decryptFields(empSnap.data() as Record<string, unknown>, [...SENSITIVE_FIELDS]);
    const documents = documentsSnap.empty
      ? {}
      : decryptFields(documentsSnap.docs[0].data() as Record<string, unknown>, [...DOCUMENT_SENSITIVE_FIELDS]);
    const benefits = benefitsSnap.empty
      ? {}
      : decryptFields(benefitsSnap.docs[0].data() as Record<string, unknown>, [...BENEFITS_SENSITIVE_FIELDS]);
    const contact = contactSnap.empty ? {} : (contactSnap.docs[0].data() as Record<string, unknown>);
    const employmentDoc = employmentSnap.docs.find(
      (d) => (d.data() as Record<string, unknown>).changeType !== "rodičovská"
    );
    const employment = employmentDoc ? (employmentDoc.data() as Record<string, unknown>) : {};

    const permanentAddress = asStr(contact.permanentAddress);
    const contactAddress = contact.contactAddressSameAsPermanent
      ? permanentAddress
      : asStr(contact.contactAddress);

    const title = `Dotazník ${asStr(root.firstName)} ${asStr(root.lastName)}`.replace(/\s+/g, " ").trim();
    const pdf = await fillQuestionnairePdf({
      jobTitle: asStr(root.currentJobTitle),
      startDate: asStr(employment.startDate),
      firstName: asStr(root.firstName),
      lastName: asStr(root.lastName),
      birthSurname: asStr(root.birthSurname),
      nationality: formatNationality(asStr(root.nationality)),
      placeOfBirth: asStr(root.placeOfBirth),
      dateOfBirth: asStr(root.dateOfBirth),
      birthNumber: asStr(root.birthNumber),
      // genderNeutralDisplay employees keep the combined form ("ženatý/vdaná").
      // displayGendered() returns the combined value for any non-m/f gender, so
      // passing "" suppresses resolution.
      maritalStatus: displayGendered(asStr(root.maritalStatus), root.genderNeutralDisplay ? "" : asStr(root.gender)),
      education: asStr(root.education),
      permanentAddress,
      contactAddress,
      idCardNumber: asStr(documents.idCardNumber),
      // "Povolení k pobytu" maps to the documents visa* fields.
      residencePermitNumber: asStr(documents.visaNumber),
      residencePermitType: asStr(documents.visaType),
      residencePermitIssueDate: asStr(documents.visaIssueDate),
      residencePermitExpiry: asStr(documents.visaExpiry),
      passportNumber: asStr(documents.passportNumber),
      passportAuthority: asStr(documents.passportAuthority),
      passportIssueDate: asStr(documents.passportIssueDate),
      passportExpiry: asStr(documents.passportExpiry),
      phone: formatPhoneCZ(asStr(contact.phone)),
      email: asStr(contact.email),
      insuranceCompany: asStr(benefits.insuranceCompany),
      insuranceNumber: asStr(benefits.insuranceNumber),
      bankAccount: asStr(benefits.bankAccount),
    }, title);

    await writeAudit(ctxFromReq(req), {
      action: "export",
      collection: "employees",
      resourceId: id,
      employeeId: id,
      extra: {
        document: "questionnaire",
        fields: [...SENSITIVE_FIELDS, ...DOCUMENT_SENSITIVE_FIELDS, ...BENEFITS_SENSITIVE_FIELDS],
      },
    });

    sendPdfInline(res, pdf, title);
  }
);

/**
 * GET /api/employees/:id/tax-declaration-pdf
 * Fills the "Prohlášení poplatníka daně" form PDF (7 fields) from employer +
 * employee identity data; decrypts rodné číslo. The daňový-nerezident
 * (foreigner) block is not a form field and is left for hand-fill. Gated by its
 * own permission and audited as an export.
 */
employeesRouter.get(
  "/:id/tax-declaration-pdf",
  requirePermission("employment.manage", "documents.view"),
  async (req: AuthRequest, res) => {
    const id = req.params.id;
    const empRef = db().collection("employees").doc(id);
    const empSnap = await empRef.get();
    if (!empSnap.exists) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }

    const [contactSnap, employmentSnap] = await Promise.all([
      empRef.collection("contact").limit(1).get(),
      empRef.collection("employment").orderBy("startDate", "desc").limit(5).get(),
    ]);
    const root = decryptFields(empSnap.data() as Record<string, unknown>, [...SENSITIVE_FIELDS]);
    const contact = contactSnap.empty ? {} : (contactSnap.docs[0].data() as Record<string, unknown>);
    const employmentDoc = employmentSnap.docs.find(
      (d) => (d.data() as Record<string, unknown>).changeType !== "rodičovská"
    );
    const employment = employmentDoc ? (employmentDoc.data() as Record<string, unknown>) : {};

    const companyId = asStr(employment.companyId) || asStr(root.currentCompanyId);
    let company: Record<string, unknown> = {};
    if (companyId) {
      const companySnap = await db().collection("companies").doc(companyId).get();
      if (companySnap.exists) company = companySnap.data() as Record<string, unknown>;
    }

    // "Zdaňovací období" is user-entered (free text, e.g. "2026" or "od září 2026")
    // via the generate dialog; fall back to the current year if omitted.
    const period = asStr(req.query.period).trim() || String(Number((clock.today() || "").slice(0, 4)) || "");

    // adresa_bydliště: Czech employees (nationality "CZE") use their trvalá
    // (permanent) address; foreigners use their resolved Czech contact address,
    // since their permanent address is usually abroad. "Resolved" expands the
    // "stejná jako trvalá" flag to the actual permanent-address value rather than
    // leaving a placeholder.
    const permanentAddress = asStr(contact.permanentAddress);
    const resolvedContact = contact.contactAddressSameAsPermanent
      ? permanentAddress
      : asStr(contact.contactAddress);
    const isCzech = asStr(root.nationality).trim() === "CZE";

    const title = `Prohlášení ${period} ${asStr(root.firstName)} ${asStr(root.lastName)}`.replace(/\s+/g, " ").trim();
    const pdf = await fillProhlaseniPdf({
      taxPeriod: period,
      companyName: asStr(company.name),
      companyAddress: asStr(company.address),
      lastName: asStr(root.lastName),
      firstName: asStr(root.firstName),
      birthNumber: asStr(root.birthNumber),
      residenceAddress: isCzech ? permanentAddress : resolvedContact,
    }, title);

    await writeAudit(ctxFromReq(req), {
      action: "export",
      collection: "employees",
      resourceId: id,
      employeeId: id,
      extra: { document: "taxDeclaration", companyId: companyId || null, period, fields: ["birthNumber"] },
    });

    sendPdfInline(res, pdf, title);
  }
);

// ─── SUB-RESOURCES ────────────────────────────────────────────────────────────

/**
 * GET /api/employees/:id/contact
 */
employeesRouter.get(
  "/:id/contact",
  requirePermission("employees.view.all", "employees.view.nonManagement"),
  async (req: AuthRequest, res) => {
    const snap = await db()
      .collection("employees")
      .doc(req.params.id)
      .collection("contact")
      .limit(1)
      .get();
    res.json(snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() });
  }
);

/**
 * PUT /api/employees/:id/contact
 */
employeesRouter.put(
  "/:id/contact",
  requirePermission("employees.edit"),
  async (req: AuthRequest, res) => {
    const colRef = db().collection("employees").doc(req.params.id).collection("contact");
    const snap = await colRef.limit(1).get();
    const before = snap.empty ? {} : (snap.docs[0].data() as Record<string, unknown>);
    // Normalize Czech place-name connectors in the address fields on save (#6).
    const body = normalizeContactAddresses(req.body as Record<string, unknown>);
    const data = {
      ...body,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (snap.empty) {
      await colRef.add(data);
    } else {
      await snap.docs[0].ref.set(data);
    }
    await logUpdate(ctxFromReq(req), {
      collection: "employees/contact",
      resourceId: req.params.id,
      employeeId: req.params.id,
      before,
      after: { ...before, ...body },
    });
    res.json({ success: true });
  }
);

/**
 * GET /api/employees/:id/employment
 * Returns full employment history ordered by startDate desc.
 */
employeesRouter.get(
  "/:id/employment",
  requirePermission("employment.view"),
  async (req: AuthRequest, res) => {
    const snap = await db()
      .collection("employees")
      .doc(req.params.id)
      .collection("employment")
      .orderBy("startDate", "desc")
      .get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json(rows);
  }
);

/**
 * On termination, cap the employee's Multisport at the end of the termination
 * month: every basic period and companion card that is still open (or ends
 * after that month) gets its `to` set to the month-end; periods/companions that
 * would only start after the termination month are dropped. Refreshes the
 * derived `multisport` flag + audit-logs. No-op when there is no Multisport.
 */
async function endMultisportOnTermination(
  empRef: admin.firestore.DocumentReference,
  terminationDate: string,
  req: AuthRequest
): Promise<void> {
  if (!terminationDate || !/^\d{4}-\d{2}-\d{2}$/.test(terminationDate)) return;
  const eom = endOfMonth(terminationDate);
  const colRef = empRef.collection("benefits");
  const snap = await colRef.limit(1).get();
  if (snap.empty) return;
  const data = snap.docs[0].data() as Record<string, unknown>;
  const { periods, companions } = readMultisport(data);
  if (periods.length === 0 && companions.length === 0) return;

  const capPeriods: MultisportPeriod[] = periods
    .filter((p) => p.from <= eom)
    .map((p) => (p.to == null || p.to > eom ? { ...p, to: eom } : p));
  const capCompanions: MultisportCompanion[] = companions
    .filter((c) => c.from <= eom)
    .map((c) => (c.to == null || c.to > eom ? { ...c, to: eom } : c));

  const activeToday = anyPeriodActiveOn(capPeriods, clock.today());
  const before = {
    multisportPeriods: (data.multisportPeriods as unknown) ?? null,
    multisportCompanions: (data.multisportCompanions as unknown) ?? null,
    multisport: (data.multisport as unknown) ?? null,
  };
  await snap.docs[0].ref.update({
    multisportPeriods: capPeriods,
    multisportCompanions: capCompanions,
    multisport: activeToday,
    multisportFrom: FieldValue.delete(),
    multisportTo: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await logUpdate(ctxFromReq(req), {
    collection: "employees/benefits",
    resourceId: empRef.id,
    employeeId: empRef.id,
    before,
    after: { multisportPeriods: capPeriods, multisportCompanions: capCompanions, multisport: activeToday },
  });
}

/**
 * POST /api/employees/:id/employment
 * Adds a new employment history row and updates denormalized fields on the employee doc.
 */
employeesRouter.post(
  "/:id/employment",
  requirePermission("employment.manage"),
  async (req: AuthRequest, res) => {
    const body = req.body as Record<string, unknown>;
    const now = FieldValue.serverTimestamp();
    const empRef = db().collection("employees").doc(req.params.id);

    // Whitelist changeType; "rodičovská" (parental leave) is informational —
    // start + end only, never employment-contract data, so it can't be folded
    // into salary/position/status/payroll (which ignore unknown change types).
    const VALID_CHANGE_TYPES = ["nástup", "změna smlouvy", "ukončení", "rodičovská"];
    if (typeof body.changeType !== "string" || !VALID_CHANGE_TYPES.includes(body.changeType)) {
      res.status(400).json({ error: "Neplatný typ změny." });
      return;
    }
    if (body.changeType === "rodičovská") {
      if (!body.startDate || !body.endDate) {
        res.status(400).json({ error: "Rodičovská vyžaduje začátek i konec." });
        return;
      }
      for (const k of [
        "salary", "hourlyRate", "contractType", "jobTitle", "department",
        "companyId", "changes", "agreedReward", "agreedWorkScope",
        "workLocation", "probationPeriod", "status",
      ]) {
        delete body[k];
      }
    }

    const employmentData = {
      ...body,
      createdBy: req.uid,
      createdAt: now,
    };

    const newRow = await empRef.collection("employment").add(employmentData);

    // Re-sync denormalized root fields by folding the latest employment session
    // (Nástup + applicable Dodatky), never by copying this single row's fields —
    // a Dodatek row has no jobTitle/department/contractType, so a raw copy would
    // wipe the root. Applies to both new Nástup and new Dodatek rows.
    if (body.changeType === "nástup" || body.changeType === "změna smlouvy") {
      await resyncRootFields(empRef, req, now);
    } else if (body.changeType === "rodičovská") {
      // No root-field fold (no salary/position), but refresh the denormalized
      // parental-leave window for the Zaměstnanci-list badge.
      await applyDerivedStatus(empRef, now, req);
    }

    // Terminating an employee ends their Multisport: cap every basic period and
    // companion card at the end of the termination month (a frontend warning
    // separately reminds the admin to cancel it in the Multisport extranet).
    if (body.changeType === "ukončení") {
      await endMultisportOnTermination(empRef, body.startDate as string, req);
    }

    await logCreate(ctxFromReq(req), {
      collection: "employees/employment",
      resourceId: req.params.id,
      subResourceId: newRow.id,
      employeeId: req.params.id,
      summary: {
        startDate: body.startDate,
        endDate: body.endDate,
        status: body.status,
        contractType: body.contractType,
        jobTitle: body.jobTitle,
        department: body.department,
        companyId: body.companyId,
        salary: body.salary,
        hourlyRate: body.hourlyRate,
        changes: body.changes,
        parallel: body.parallel,
      },
    });

    // Reconcile probation alerts (best-effort — never block the response)
    refreshProbationAlertsForEmployee(req.params.id).catch((e) =>
      console.error("[probationAlerts] refresh failed:", e)
    );

    res.status(201).json({ id: newRow.id });
  }
);

/**
 * GET /api/employees/:id/documents
 */
employeesRouter.get(
  "/:id/documents",
  requirePermission("employees.view.all", "employees.view.nonManagement"),
  async (req: AuthRequest, res) => {
    const snap = await db()
      .collection("employees")
      .doc(req.params.id)
      .collection("documents")
      .limit(1)
      .get();
    if (snap.empty) { res.json(null); return; }
    const data = snap.docs[0].data() as Record<string, unknown>;
    res.json({ id: snap.docs[0].id, ...redactFields(data, [...DOCUMENT_SENSITIVE_FIELDS]) });
  }
);

// ─── ALERT HELPER ────────────────────────────────────────────────────────────

const EXPIRY_ALERT_DAYS = 30;

// `sensitive` = stored AES-encrypted (must be decrypted before use). Kept here,
// next to DOCUMENT_SENSITIVE_FIELDS, rather than inferred from the self-service
// EDITABLE_FIELDS whitelist — the two are unrelated (a field can be encrypted
// without being self-editable, e.g. idCardExpiry).
export const EXPIRY_FIELDS: { field: string; label: string; sensitive: boolean }[] = [
  { field: "idCardExpiry", label: "Platnost OP", sensitive: true },
  { field: "passportExpiry", label: "Platnost pasu", sensitive: false },
  { field: "visaExpiry", label: "Platnost povolení k pobytu", sensitive: false },
];

export async function updateDocumentAlerts(
  employeeId: string,
  firstName: string,
  lastName: string,
  body: Record<string, unknown>
): Promise<void> {
  const alertsCol = db().collection("alerts");
  const today = clock.now();
  today.setHours(0, 0, 0, 0);

  for (const { field, label } of EXPIRY_FIELDS) {
    const docId = `${employeeId}_${field}`;
    const value = body[field] as string | undefined;

    if (!value) {
      // Field cleared — remove any existing alert
      await alertsCol.doc(docId).delete();
      continue;
    }

    const expiry = new Date(value);
    const daysUntilExpiry = Math.ceil(
      (expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysUntilExpiry > EXPIRY_ALERT_DAYS) {
      // Not expiring soon — remove any existing alert
      await alertsCol.doc(docId).delete();
    } else {
      // Expiring soon or already expired — upsert alert. Preserve the
      // read-state across refreshes: an alert the user already dismissed
      // must stay read when this daily/manual refresh rewrites the doc.
      // It only resets to unread when the underlying expiryDate changes
      // (i.e. the document was renewed to a new date) — that's a genuinely
      // new deadline worth re-surfacing.
      const ref = alertsCol.doc(docId);
      const existing = await ref.get();
      const prev = existing.data() as Record<string, unknown> | undefined;
      const keepRead = !!prev && prev.expiryDate === value && prev.read === true;
      await ref.set({
        employeeId,
        employeeFirstName: firstName,
        employeeLastName: lastName,
        field,
        fieldLabel: label,
        expiryDate: value,
        daysUntilExpiry,
        status: daysUntilExpiry < 0 ? "expired" : "expiring",
        read: keepRead,
        readAt: keepRead ? prev!.readAt ?? null : null,
        readBy: keepRead ? prev!.readBy ?? null : null,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }
}

/**
 * PUT /api/employees/:id/documents
 * Encrypts idCardNumber and idCardExpiry before writing.
 * Blank sensitive fields are omitted so existing encrypted values are preserved.
 */
employeesRouter.put(
  "/:id/documents",
  requirePermission("employees.edit"),
  async (req: AuthRequest, res) => {
    const body = req.body as Record<string, unknown>;

    const clearFields = Array.isArray(body.clearFields) ? body.clearFields as string[] : [];

    // Build alert body: cleared expiry fields are treated as removed
    const alertBody = { ...body } as Record<string, unknown>;
    for (const f of clearFields) { alertBody[f] = undefined; }

    // Check expiry alerts using plaintext body BEFORE encryption
    const empDoc = await db().collection("employees").doc(req.params.id).get();
    if (empDoc.exists) {
      const emp = empDoc.data() as Record<string, unknown>;
      await updateDocumentAlerts(
        req.params.id,
        emp.firstName as string,
        emp.lastName as string,
        alertBody
      );
    }

    // Strip blank or still-masked sensitive fields — the existing encrypted
    // value is preserved via update(). Dropping the redaction mask prevents a
    // round-trip from re-encrypting "••••••••" over the real value.
    const payload: Record<string, unknown> = { ...body };
    delete payload.clearFields;
    for (const f of DOCUMENT_SENSITIVE_FIELDS) { if (!payload[f] || payload[f] === REDACTION_MASK) delete payload[f]; }

    const data = encryptFields(
      { ...payload, updatedAt: FieldValue.serverTimestamp() },
      [...DOCUMENT_SENSITIVE_FIELDS]
    ) as Record<string, unknown>;

    // Explicitly delete cleared sensitive fields
    for (const f of DOCUMENT_SENSITIVE_FIELDS) {
      if (clearFields.includes(f)) {
        data[f] = FieldValue.delete();
      }
    }

    const colRef = db().collection("employees").doc(req.params.id).collection("documents");
    const snap = await colRef.limit(1).get();
    const before = snap.empty ? {} : (snap.docs[0].data() as Record<string, unknown>);
    if (snap.empty) {
      await colRef.add(data);
    } else {
      await snap.docs[0].ref.update(data); // update preserves unmentioned fields
    }

    // Build the after-view from the plaintext body (sensitive values are
    // redacted by logUpdate, so we never store ciphertext).
    const afterForLog: Record<string, unknown> = { ...before, ...payload };
    for (const f of clearFields) afterForLog[f] = null;
    await logUpdate(ctxFromReq(req), {
      collection: "employees/documents",
      resourceId: req.params.id,
      employeeId: req.params.id,
      before,
      after: afterForLog,
      sensitiveFields: [...DOCUMENT_SENSITIVE_FIELDS],
    });
    res.json({ success: true });
  }
);

// ─── DALŠÍ DOKUMENTY (additional documents) ──────────────────────────────────
// Arbitrary admin-uploaded PDFs per employee, each with a human display name.
// Stored separately from the identity `documents` subcollection and from
// `contracts`: new subcollection `employees/{id}/otherDocuments` + new Storage
// prefix `other-documents/{employeeId}/...` so it never collides with either.

/**
 * GET /api/employees/:id/other-documents
 * List all additional documents for an employee, newest first.
 * Mirrors the role list of GET /:id/documents.
 */
employeesRouter.get(
  "/:id/other-documents",
  requirePermission("documents.view"),
  async (req: AuthRequest, res) => {
    const snap = await db()
      .collection("employees")
      .doc(req.params.id)
      .collection("otherDocuments")
      .orderBy("uploadedAt", "desc")
      .get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }
);

/**
 * POST /api/employees/:id/other-documents
 * Upload a PDF (base64 in body) via Admin SDK and create the metadata record.
 * storage.rules deny direct client access, so the upload happens server-side.
 * Mirrors the role list of PUT /:id/documents.
 *
 * Body: { name, pdfBase64 }
 */
employeesRouter.post(
  "/:id/other-documents",
  requirePermission("documents.upload"),
  async (req: AuthRequest, res) => {
    const { name, pdfBase64 } = req.body as {
      name?: string;
      pdfBase64?: string;
    };

    if (typeof name !== "string" || !name.trim() || !pdfBase64) {
      res.status(400).json({ error: "name a pdfBase64 jsou povinné." });
      return;
    }

    const employeeId = req.params.id;

    // Reserve a doc id up-front so the storage path lines up with the
    // metadata record (`other-documents/{employeeId}/{docId}.pdf`).
    const docRef = db()
      .collection("employees")
      .doc(employeeId)
      .collection("otherDocuments")
      .doc();

    const buffer = Buffer.from(pdfBase64, "base64");
    const storagePath = `other-documents/${employeeId}/${docRef.id}.pdf`;
    const file = admin.storage().bucket().file(storagePath);
    await file.save(buffer, {
      contentType: "application/pdf",
      metadata: { metadata: { uploadedBy: req.uid ?? "unknown" } },
    });

    await docRef.set({
      name: name.trim(),
      storagePath,
      contentType: "application/pdf",
      uploadedAt: FieldValue.serverTimestamp(),
      uploadedBy: req.uid,
    });
    await logCreate(ctxFromReq(req), {
      collection: "employees/otherDocuments",
      resourceId: employeeId,
      subResourceId: docRef.id,
      employeeId,
      summary: { name: name.trim() },
    });
    res.status(201).json({ id: docRef.id });
  }
);

/**
 * GET /api/employees/:id/other-documents/:docId/download
 * Streams the PDF back to the client (inline). storage.rules deny direct
 * client access, so reads must go through the Admin SDK here.
 * Mirrors the role list of the list endpoint.
 */
employeesRouter.get(
  "/:id/other-documents/:docId/download",
  requirePermission("documents.view"),
  async (req: AuthRequest, res) => {
    const ref = db()
      .collection("employees")
      .doc(req.params.id)
      .collection("otherDocuments")
      .doc(req.params.docId);

    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Dokument nenalezen." });
      return;
    }

    const data = snap.data() as Record<string, unknown>;
    const storagePath = data.storagePath;
    if (typeof storagePath !== "string" || !storagePath) {
      res.status(404).json({ error: "Soubor nenalezen." });
      return;
    }

    const file = admin.storage().bucket().file(storagePath);
    const [exists] = await file.exists();
    if (!exists) {
      res.status(404).json({ error: "Soubor chybí v úložišti." });
      return;
    }

    // Use the document's human display name as the filename base.
    // Browsers accept UTF-8 filenames via filename*=UTF-8''<percent-encoded>;
    // include a plain-ASCII fallback for legacy clients via the standard
    // `filename=` parameter (diacritics replaced).
    const filenameBase =
      typeof data.name === "string" && data.name ? data.name : req.params.docId;
    const asciiFallback = filenameBase
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^\x20-\x7e]/g, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${asciiFallback}.pdf"; filename*=UTF-8''${encodeURIComponent(filenameBase)}.pdf`
    );
    file.createReadStream()
      .on("error", (e) => {
        if (!res.headersSent) res.status(500).json({ error: e.message });
        else res.end();
      })
      .pipe(res);
  }
);

/**
 * DELETE /api/employees/:id/other-documents/:docId
 * Deletes the Firestore record and the associated Storage file (best-effort).
 * Mirrors the role list of PUT /:id/documents.
 */
employeesRouter.delete(
  "/:id/other-documents/:docId",
  requirePermission("documents.delete"),
  async (req: AuthRequest, res) => {
    const employeeId = req.params.id;
    const docId = req.params.docId;

    const ref = db()
      .collection("employees")
      .doc(employeeId)
      .collection("otherDocuments")
      .doc(docId);

    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Dokument nenalezen." });
      return;
    }

    const data = snap.data() as Record<string, unknown>;
    const storagePath = data.storagePath;
    if (typeof storagePath === "string" && storagePath) {
      await admin.storage().bucket().file(storagePath).delete().catch(() => undefined);
    }

    await ref.delete();
    await logDelete(ctxFromReq(req), {
      collection: "employees/otherDocuments",
      resourceId: employeeId,
      subResourceId: docId,
      employeeId,
      summary: { name: data.name },
    });
    res.json({ ok: true });
  }
);

/**
 * GET /api/employees/:id/benefits
 */
employeesRouter.get(
  "/:id/benefits",
  requirePermission("benefits.view"),
  async (req: AuthRequest, res) => {
    const snap = await db()
      .collection("employees")
      .doc(req.params.id)
      .collection("benefits")
      .limit(1)
      .get();
    if (snap.empty) { res.json(null); return; }
    const data = snap.docs[0].data() as Record<string, unknown>;
    res.json({ id: snap.docs[0].id, ...redactFields(data, [...BENEFITS_SENSITIVE_FIELDS]) });
  }
);

/**
 * PUT /api/employees/:id/benefits
 * Encrypts insuranceNumber and bankAccount before writing.
 * Blank sensitive fields are omitted so existing encrypted values are preserved.
 */
employeesRouter.put(
  "/:id/benefits",
  requirePermission("benefits.edit"),
  async (req: AuthRequest, res) => {
    const body = req.body as Record<string, unknown>;
    const clearFields = Array.isArray(body.clearFields) ? body.clearFields as string[] : [];
    const payload: Record<string, unknown> = { ...body };
    delete payload.clearFields;
    // Drop blank or still-masked sensitive fields so update() preserves the
    // stored encrypted value and a round-tripped mask isn't re-encrypted.
    for (const f of BENEFITS_SENSITIVE_FIELDS) { if (!payload[f] || payload[f] === REDACTION_MASK) delete payload[f]; }

    const data = encryptFields(
      { ...payload, updatedAt: FieldValue.serverTimestamp() },
      [...BENEFITS_SENSITIVE_FIELDS]
    ) as Record<string, unknown>;

    // Explicitly delete cleared sensitive fields
    for (const f of BENEFITS_SENSITIVE_FIELDS) {
      if (clearFields.includes(f)) {
        data[f] = FieldValue.delete();
      }
    }

    const colRef = db().collection("employees").doc(req.params.id).collection("benefits");
    const snap = await colRef.limit(1).get();
    const before = snap.empty ? {} : (snap.docs[0].data() as Record<string, unknown>);
    if (snap.empty) {
      await colRef.add(data);
    } else {
      await snap.docs[0].ref.update(data);
    }

    // Denormalize the "Zaučování" (training) flag + end date onto the root
    // employee doc so the Employees list (which reads only root docs) can render
    // the "V zácviku" badge without joining the benefits sub-doc. The badge's
    // auto-expiry is computed live from zaucovaniDo on read — no nightly job.
    const zaucovani = payload.zaucovani === true;
    const zaucovaniDo = zaucovani && typeof payload.zaucovaniDo === "string" ? payload.zaucovaniDo : "";
    await db().collection("employees").doc(req.params.id).set(
      { zaucovani, zaucovaniDo, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );

    const afterForLog: Record<string, unknown> = { ...before, ...payload };
    for (const f of clearFields) afterForLog[f] = null;
    await logUpdate(ctxFromReq(req), {
      collection: "employees/benefits",
      resourceId: req.params.id,
      employeeId: req.params.id,
      before,
      after: afterForLog,
      sensitiveFields: [...BENEFITS_SENSITIVE_FIELDS],
    });
    res.json({ success: true });
  }
);

/**
 * PUT /api/employees/:id/multisport
 * Source of truth for the Multisport benefit: multiple basic enrollment
 * periods + "Doprovodná" companion cards (name/from/to/price). Periods are
 * whole-month by convention. The `multisport` boolean on the benefits doc is
 * kept as a DERIVED "active today" flag (also refreshed by the daily sweep),
 * so CSV/quick-display/sweep keep working. Supersedes multisportFrom/To.
 *
 * Body: { periods: {from, to|null}[], companions: {id?, name, from, to|null, price}[] }
 */
employeesRouter.put(
  "/:id/multisport",
  requirePermission("benefits.edit"),
  async (req: AuthRequest, res) => {
    const body = req.body as {
      periods?: Array<{ from?: string; to?: string | null }>;
      companions?: Array<{ id?: string; name?: string; from?: string; to?: string | null; price?: number }>;
    };
    const isDate = (s: unknown): s is string =>
      typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
    const normEnd = (v: string | null | undefined): string | null =>
      v == null || v === "" ? null : v;

    const periods: MultisportPeriod[] = [];
    for (const p of body.periods ?? []) {
      if (!isDate(p.from)) {
        res.status(400).json({ error: "Multisport: neplatné datum začátku období." });
        return;
      }
      const to = normEnd(p.to);
      if (to != null && (!isDate(to) || to < p.from)) {
        res.status(400).json({ error: "Multisport: neplatné datum konce období." });
        return;
      }
      periods.push({ from: p.from, to });
    }

    const companions: MultisportCompanion[] = [];
    for (const c of body.companions ?? []) {
      const name = typeof c.name === "string" ? c.name.trim() : "";
      if (!name) {
        res.status(400).json({ error: "Doprovodná Multisport: vyplňte jméno." });
        return;
      }
      if (!isDate(c.from)) {
        res.status(400).json({ error: "Doprovodná Multisport: neplatné datum začátku." });
        return;
      }
      const to = normEnd(c.to);
      if (to != null && (!isDate(to) || to < c.from)) {
        res.status(400).json({ error: "Doprovodná Multisport: neplatné datum konce." });
        return;
      }
      const price = Number(c.price);
      if (!Number.isFinite(price) || price < 0) {
        res.status(400).json({ error: "Doprovodná Multisport: neplatná cena." });
        return;
      }
      companions.push({ id: c.id || randomUUID(), name, from: c.from, to, price });
    }

    const activeToday = anyPeriodActiveOn(periods, clock.today());

    const colRef = db().collection("employees").doc(req.params.id).collection("benefits");
    const snap = await colRef.limit(1).get();
    const before = snap.empty ? {} : (snap.docs[0].data() as Record<string, unknown>);
    if (snap.empty) {
      await colRef.add({
        multisportPeriods: periods,
        multisportCompanions: companions,
        multisport: activeToday,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      await snap.docs[0].ref.update({
        multisportPeriods: periods,
        multisportCompanions: companions,
        multisport: activeToday,
        // legacy single-window fields are superseded by multisportPeriods
        multisportFrom: FieldValue.delete(),
        multisportTo: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    await logUpdate(ctxFromReq(req), {
      collection: "employees/benefits",
      resourceId: req.params.id,
      employeeId: req.params.id,
      before: {
        multisportPeriods: (before.multisportPeriods as unknown) ?? null,
        multisportCompanions: (before.multisportCompanions as unknown) ?? null,
        multisport: (before.multisport as unknown) ?? null,
      },
      after: { multisportPeriods: periods, multisportCompanions: companions, multisport: activeToday },
    });
    res.json({ success: true, multisport: activeToday });
  }
);

/**
 * PATCH /api/employees/:id/employment/:rowId
 * Updates a single employment history record.
 * If status === "active", re-syncs denormalized fields on the employee root doc.
 */
employeesRouter.patch(
  "/:id/employment/:rowId",
  requirePermission("employment.manage"),
  async (req: AuthRequest, res) => {
    const body = req.body as Record<string, unknown>;
    const now = FieldValue.serverTimestamp();
    const empRef = db().collection("employees").doc(req.params.id);
    const rowRef = empRef.collection("employment").doc(req.params.rowId);

    const rowSnap = await rowRef.get();
    if (!rowSnap.exists) {
      res.status(404).json({ error: "Employment record not found" });
      return;
    }

    const before = rowSnap.data() as Record<string, unknown>;
    // A parental-leave row stays informational — never let an edit turn it into
    // employment-contract data (which would then fold into salary/position).
    if (before.changeType === "rodičovská") {
      for (const k of [
        "changeType", "salary", "hourlyRate", "contractType", "jobTitle",
        "department", "companyId", "changes", "agreedReward", "agreedWorkScope",
        "workLocation", "probationPeriod", "status",
      ]) {
        delete body[k];
      }
    }
    await rowRef.update({ ...body, updatedAt: now });

    // Re-sync the denormalized root fields by folding the whole session — NOT by
    // copying this row's own fields. Editing a Dodatek (which has no
    // jobTitle/department/contractType/companyId) used to blank the root and wipe
    // the employee's position/department/contract type from the Zaměstnanci list.
    await resyncRootFields(empRef, req, now);

    await logUpdate(ctxFromReq(req), {
      collection: "employees/employment",
      resourceId: req.params.id,
      subResourceId: req.params.rowId,
      employeeId: req.params.id,
      before,
      after: { ...before, ...body },
    });

    refreshProbationAlertsForEmployee(req.params.id).catch((e) =>
      console.error("[probationAlerts] refresh failed:", e)
    );

    res.json({ success: true });
  }
);

/**
 * DELETE /api/employees/:id/employment/:rowId
 *
 * Deletes a single employment row OR — when the row is a Nástup — the
 * entire session it anchors (Nástup + all subsequent Dodatky + the
 * Ukončení if any). Any contracts tied to deleted rows are cleaned up
 * too: Firestore record + unsigned/signed PDFs from Storage. Root-doc
 * denormalized fields are recomputed afterwards (or cleared if no
 * active session remains).
 */
employeesRouter.delete(
  "/:id/employment/:rowId",
  requirePermission("employment.manage"),
  async (req: AuthRequest, res) => {
    const empRef = db().collection("employees").doc(req.params.id);
    const rowRef = empRef.collection("employment").doc(req.params.rowId);
    const rowSnap = await rowRef.get();
    if (!rowSnap.exists) {
      res.status(404).json({ error: "Employment record not found" });
      return;
    }
    const target = rowSnap.data() as Record<string, unknown>;
    const isNastup = target.changeType === "nástup";

    // Decide which rows to delete.
    let rowsToDelete: Array<{ id: string; data: Record<string, unknown> }>;
    if (isNastup) {
      // Cascade to every row from this Nástup forward, up until the next
      // Nástup (exclusive). That captures Dodatky + Ukončení belonging to
      // this session.
      const allSnap = await empRef.collection("employment").orderBy("startDate", "asc").get();
      const all = allSnap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
      const startIdx = all.findIndex((r) => r.id === req.params.rowId);
      const session: typeof all = [];
      if (startIdx >= 0) {
        for (let i = startIdx; i < all.length; i++) {
          if (i > startIdx && all[i].data.changeType === "nástup") break;
          session.push(all[i]);
        }
      }
      rowsToDelete = session;
    } else {
      rowsToDelete = [{ id: req.params.rowId, data: target }];
    }

    const rowIds = rowsToDelete.map((r) => r.id);

    // Find every contract record tied to one of the deleted rows so we
    // don't leave orphaned PDFs in Storage.
    const contractsToDelete: Array<{ id: string; data: Record<string, unknown> }> = [];
    if (rowIds.length > 0) {
      // Firestore "in" queries cap at 30 items; chunk to be safe even
      // though sessions of >30 rows would be pathological.
      const chunkSize = 30;
      for (let i = 0; i < rowIds.length; i += chunkSize) {
        const chunk = rowIds.slice(i, i + chunkSize);
        const cSnap = await empRef
          .collection("contracts")
          .where("employmentRowId", "in", chunk)
          .get();
        cSnap.docs.forEach((d) =>
          contractsToDelete.push({ id: d.id, data: d.data() as Record<string, unknown> })
        );
      }
    }

    // Best-effort Storage cleanup — failures here shouldn't block the
    // Firestore deletes that follow.
    const bucket = admin.storage().bucket();
    await Promise.all(
      contractsToDelete.flatMap((c) => {
        const paths = [c.data.unsignedStoragePath, c.data.signedStoragePath].filter(
          (p): p is string => typeof p === "string" && p.length > 0
        );
        return paths.map((p) => bucket.file(p).delete().catch(() => undefined));
      })
    );

    // Delete contract docs, then employment rows, in one batched write.
    const batch = db().batch();
    for (const c of contractsToDelete) {
      batch.delete(empRef.collection("contracts").doc(c.id));
    }
    for (const r of rowsToDelete) {
      batch.delete(empRef.collection("employment").doc(r.id));
    }
    await batch.commit();

    // Audit-log every deletion (one entry per row, one per contract).
    const ctx = ctxFromReq(req);
    for (const c of contractsToDelete) {
      await logDelete(ctx, {
        collection: "employees/contracts",
        resourceId: req.params.id,
        subResourceId: c.id,
        employeeId: req.params.id,
        summary: {
          type: c.data.type,
          status: c.data.status,
          displayName: c.data.displayName,
          deletedDueToEmploymentRowDelete: req.params.rowId,
        },
      });
    }
    for (const r of rowsToDelete) {
      await logDelete(ctx, {
        collection: "employees/employment",
        resourceId: req.params.id,
        subResourceId: r.id,
        employeeId: req.params.id,
        summary: {
          changeType: r.data.changeType,
          startDate: r.data.startDate,
          contractType: r.data.contractType,
          jobTitle: r.data.jobTitle,
          cascadedFromNastup: isNastup && r.id !== req.params.rowId ? req.params.rowId : undefined,
        },
      });
    }

    // Recompute root denormalized fields. If the latest session disappeared,
    // clear them so the Detail tab no longer claims a current employment.
    const now = FieldValue.serverTimestamp();
    const beforeEmp = (await empRef.get()).data() as Record<string, unknown> | undefined;
    const updated = await recomputeRootFromLatestSession(empRef, now);
    if (!updated) {
      // No active session left — wipe the denormalized fields so the UI
      // stops showing stale "current" values.
      await empRef.update({
        currentCompanyId: null,
        currentDepartment: "",
        currentContractType: "",
        currentJobTitle: "",
        updatedAt: now,
      });
    }
    // Auto-move to / from the Ukončení tab after the session change (e.g.
    // deleting an Ukončení row reactivates the employee, deleting the whole
    // session leaves no active contract).
    await applyDerivedStatus(empRef, now, req);
    if (beforeEmp) {
      await logUpdate(ctx, {
        collection: "employees",
        resourceId: req.params.id,
        employeeId: req.params.id,
        before: {
          currentCompanyId: beforeEmp.currentCompanyId,
          currentDepartment: beforeEmp.currentDepartment,
          currentContractType: beforeEmp.currentContractType,
          currentJobTitle: beforeEmp.currentJobTitle,
        },
        after: updated ?? {
          currentCompanyId: null,
          currentDepartment: "",
          currentContractType: "",
          currentJobTitle: "",
        },
      });
    }

    refreshProbationAlertsForEmployee(req.params.id).catch((e) =>
      console.error("[probationAlerts] refresh failed:", e)
    );

    res.json({
      ok: true,
      deletedRows: rowsToDelete.length,
      deletedContracts: contractsToDelete.length,
    });
  }
);

/**
 * GET /api/employees/:id/alerts
 * Returns active expiry alerts for a specific employee.
 */
employeesRouter.get(
  "/:id/alerts",
  requirePermission("employees.view.all", "employees.view.nonManagement"),
  async (req: AuthRequest, res) => {
    const snap = await db()
      .collection("alerts")
      .where("employeeId", "==", req.params.id)
      .get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }
);

/**
 * GET /api/employees/:id/linked-user
 * Returns the user account linked to this employee, or null.
 */
employeesRouter.get(
  "/:id/linked-user",
  requirePermission("employees.view.all", "employees.view.nonManagement"),
  async (req, res) => {
    const snap = await db()
      .collection("users")
      .where("employeeId", "==", req.params.id)
      .limit(1)
      .get();
    if (snap.empty) {
      res.json(null);
      return;
    }
    const data = snap.docs[0].data() as Record<string, unknown>;
    res.json({ uid: snap.docs[0].id, email: data.email, name: data.name });
  }
);

/**
 * DELETE /api/employees/:id
 * Deletes an employee and all their sub-collections.
 * Query param: deleteUser=true → also delete the linked Firebase Auth user.
 *              deleteUser=false (default) → unlink but keep the user account.
 */
employeesRouter.delete(
  "/:id",
  requirePermission("employees.delete"),
  async (req, res) => {
    const { id } = req.params;
    const deleteUser = req.query.deleteUser === "true";
    const empRef = db().collection("employees").doc(id);

    // ── Delete protection ────────────────────────────────────────────────
    // Block hard-delete if the employee has ANY payroll or shift history.
    // Such employees must be TERMINATED ("Ukončit smlouvu"), not deleted —
    // deleting them orphans payrollPeriods entries and shiftPlans rows (the
    // "Kyrylo Tarasenko" orphan class that produced phantom 0-hour rows). Only
    // genuine mis-entries with no footprint may be removed.
    //
    // Index-free by design: a collectionGroup("entries"/"planEmployees").where()
    // would require dedicated COLLECTION_GROUP indexes, which the emulator does
    // NOT enforce → silent prod 500s. Instead we iterate the (few, monthly)
    // period/plan parents and use a doc-id lookup / collection-scope query,
    // both backed by automatic single-field indexes that always exist.
    const [periodsSnap, plansSnap] = await Promise.all([
      db().collection("payrollPeriods").get(),
      db().collection("shiftPlans").get(),
    ]);
    const [payrollEntries, planMembers, planCells] = await Promise.all([
      Promise.all(periodsSnap.docs.map((p) => p.ref.collection("entries").doc(id).get())),
      Promise.all(plansSnap.docs.map((pl) =>
        pl.ref.collection("planEmployees").where("employeeId", "==", id).limit(1).get()
      )),
      // Also block on stray shift CELLS: a cell (shiftPlans/*/shifts) can outlive
      // its planEmployees row (removed-from-plan without clearing cells, or legacy
      // data), so checking membership alone let an employee with orphan-prone
      // cells through the guard. Same index-free per-plan pattern.
      Promise.all(plansSnap.docs.map((pl) =>
        pl.ref.collection("shifts").where("employeeId", "==", id).limit(1).get()
      )),
    ]);
    const hasHistory =
      payrollEntries.some((e) => e.exists) ||
      planMembers.some((m) => !m.empty) ||
      planCells.some((c) => !c.empty);
    if (hasHistory) {
      res.status(400).json({
        error:
          "Zaměstnance nelze smazat, protože má záznamy ve mzdách nebo směnách. " +
          "Místo smazání ho ukončete (Ukončit smlouvu).",
      });
      return;
    }

    // Handle linked user account
    const usersSnap = await db()
      .collection("users")
      .where("employeeId", "==", id)
      .limit(1)
      .get();

    if (!usersSnap.empty) {
      const userDoc = usersSnap.docs[0];
      if (deleteUser) {
        try { await admin.auth().deleteUser(userDoc.id); } catch { /* already deleted */ }
        await userDoc.ref.delete();
      } else {
        await userDoc.ref.update({
          employeeId: null,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }

    // Best-effort: remove Storage blobs for contracts + other documents before
    // deleting their Firestore records (the records carry the storage paths).
    // Previously these blobs were orphaned in Storage on employee delete.
    const storagePaths: string[] = [];
    const [contractsSnap, otherDocsSnap] = await Promise.all([
      empRef.collection("contracts").get(),
      empRef.collection("otherDocuments").get(),
    ]);
    contractsSnap.docs.forEach((d) => {
      const c = d.data() as Record<string, unknown>;
      if (typeof c.unsignedStoragePath === "string" && c.unsignedStoragePath) storagePaths.push(c.unsignedStoragePath);
      if (typeof c.signedStoragePath === "string" && c.signedStoragePath) storagePaths.push(c.signedStoragePath);
    });
    otherDocsSnap.docs.forEach((d) => {
      const o = d.data() as Record<string, unknown>;
      if (typeof o.storagePath === "string" && o.storagePath) storagePaths.push(o.storagePath);
    });
    if (storagePaths.length) {
      const bucket = admin.storage().bucket();
      await Promise.all(storagePaths.map((p) => bucket.file(p).delete().catch(() => undefined)));
    }

    // Delete sub-collections ("otherDocuments" was previously omitted here,
    // orphaning its Firestore records).
    for (const col of ["contact", "employment", "documents", "benefits", "contracts", "otherDocuments"]) {
      const snap = await empRef.collection(col).get();
      if (!snap.empty) {
        const batch = db().batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    }

    // Delete related top-level documents
    const alertsSnap = await db().collection("alerts").where("employeeId", "==", id).get();
    if (!alertsSnap.empty) {
      const batch = db().batch();
      alertsSnap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }

    const vacSnap = await db().collection("vacationRequests").where("employeeId", "==", id).get();
    if (!vacSnap.empty) {
      const batch = db().batch();
      vacSnap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }

    // Pending self-service change requests (previously orphaned)
    const ecrSnap = await db().collection("employeeChangeRequests").where("employeeId", "==", id).get();
    if (!ecrSnap.empty) {
      const batch = db().batch();
      ecrSnap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }

    // Cascade-delete probation alerts for this employee
    await deleteProbationAlertsForEmployee(id);

    // Cascade-clean any stray shift-plan request docs (unavailability / override /
    // change requests). The guard above blocks delete when the employee has plan
    // membership or cells, but a pending request could linger without either
    // (e.g. submitted, then the membership row was removed), so they'd otherwise
    // dangle. Reuses plansSnap from the guard (plans are few/monthly).
    for (const pl of plansSnap.docs) {
      for (const col of ["unavailabilityRequests", "shiftOverrideRequests", "shiftChangeRequests"]) {
        const rs = await pl.ref.collection(col).where("employeeId", "==", id).get();
        if (!rs.empty) {
          const batch = db().batch();
          rs.docs.forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
      }
    }

    // Capture summary before delete for the audit log
    const empSnap = await empRef.get();
    const empData = empSnap.exists ? (empSnap.data() as Record<string, unknown>) : {};

    // Delete the employee document
    await empRef.delete();

    await logDelete(ctxFromReq(req as AuthRequest), {
      collection: "employees",
      resourceId: id,
      employeeId: id,
      summary: {
        firstName: empData.firstName,
        lastName: empData.lastName,
        currentDepartment: empData.currentDepartment,
        currentJobTitle: empData.currentJobTitle,
        currentContractType: empData.currentContractType,
        deleteUser,
      },
      sensitiveFields: [...SENSITIVE_FIELDS],
    });

    res.json({ ok: true });
  }
);

/**
 * GET /api/employees/:id/contracts
 */
employeesRouter.get(
  "/:id/contracts",
  requirePermission("contracts.view"),
  async (req: AuthRequest, res) => {
    const snap = await db()
      .collection("employees")
      .doc(req.params.id)
      .collection("contracts")
      .orderBy("generatedAt", "desc")
      .get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }
);
