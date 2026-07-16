import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { api, ApiError } from "../lib/api";
import * as clock from "../lib/clock";
import { useAuth } from "../hooks/useAuth";
import { parseShiftExpression, getCellColor, SECTIONS, SECTION_LABELS, getCzechHolidays, sortSectionEmployees, isPureNumericExpression } from "../lib/shiftConstants";
import { modLettersByEmployeeId } from "../lib/modPersons";
import { employeeDisplayName } from "../lib/employeeName";
import { formatIsoDatetimeCZ } from "../lib/dateFormat";
import { escapeHtml } from "../lib/escapeHtml";
import ShiftGrid from "../components/ShiftGrid";
import AddEmployeeToPlanModal from "../components/AddEmployeeToPlanModal";
import EditEmployeeInPlanModal from "../components/EditEmployeeInPlanModal";
import ConfirmModal from "../components/ConfirmModal";
import XOverrideModal from "../components/XOverrideModal";
import ShiftOverridePanel from "../components/ShiftOverridePanel";
import ShiftChangeRequestPanel from "../components/ShiftChangeRequestPanel";
import MyRequestsPanel from "../components/MyRequestsPanel";
import ShiftChangeRequestModal from "../components/ShiftChangeRequestModal";
import FreeClaimModal from "../components/FreeClaimModal";
import Button from "../components/Button";
import { useShiftOverridesContext } from "../context/ShiftOverridesContext";
import { useShiftChangeRequestsContext } from "../context/ShiftChangeRequestsContext";
import { tourDemo } from "../lib/tours/demoData";
import styles from "./ShiftPlannerPage.module.css";

// ─── Shared types ─────────────────────────────────────────────────────────────

export type PlanStatus = "created" | "opened" | "closed" | "published";

export interface PlanEmployee {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  displayName?: string;
  section: "vedoucí" | "recepce" | "portýři";
  primaryShiftType: "D" | "N" | "R" | "DP" | "NP" | null;
  primaryHotel: string | null;
  displayOrder: number;
  active: boolean;
  contractType: string | null;
  // Admin-set absolute X limit for the month. Only settable (and only applied) when
  // the employee has an approved vacation overlapping the month; otherwise the base
  // limit (8 HPP / 13 PPP) applies.
  xLimitOverride?: number | null;
}

export interface ViolationInfo {
  type: "employee_x_limit" | "day_coverage" | "night_coverage";
  limit?: number;
  current?: number;
  available?: number;
}

interface PendingXRequest {
  employeeId: string;
  date: string;
  rawInput: string;
  violations: ViolationInfo[];
}

export interface ShiftDoc {
  id: string;
  employeeId: string;
  date: string;
  rawInput: string;
  hoursComputed: number;
  isDouble: boolean;
  status: "assigned" | "day_off" | "unassigned";
  source?: string | null; // "vacation" for auto-applied vacation Xs; absent for manual
  typeTag?: string | null; // #29: shift-type tag on a numeric "worked hours" cell (tally only, no pay effect)
}

export interface ModShiftDoc {
  id: string;
  date: string;
  code: string;
}

export interface PlanDetail {
  id: string;
  month: number;
  year: number;
  status: PlanStatus;
  createdBy: string;
  openedAt: string | null;
  closedAt: string | null;
  publishedAt: string | null;
  modPersons: Record<string, string>; // letter → employeeId, per-plan overrides
  freeShiftDpaDays?: string[]; // days where the optional DPA free-shift row is active
  employees: PlanEmployee[];
  shifts: ShiftDoc[];
  modShifts: ModShiftDoc[];
}

interface PlanListItem {
  id: string;
  month: number;
  year: number;
  status: PlanStatus;
  /** Firestore Timestamp (serialized) — the change-detection token for the poll. */
  updatedAt?: { _seconds?: number; _nanoseconds?: number; seconds?: number; nanoseconds?: number };
}

/** Epoch millis of a serialized Firestore Timestamp (external-change detection). */
function tsMillis(ts: PlanListItem["updatedAt"]): number | null {
  if (!ts) return null;
  const s = typeof ts.seconds === "number" ? ts.seconds : ts._seconds;
  const n = typeof ts.nanoseconds === "number" ? ts.nanoseconds : ts._nanoseconds;
  if (typeof s !== "number") return null;
  return s * 1000 + Math.floor((n ?? 0) / 1e6);
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "Leden", "Únor", "Březen", "Duben", "Květen", "Červen",
  "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec",
];

const STATUS_LABELS: Record<PlanStatus, string> = {
  created: "Vytvořený",
  opened: "Otevřený",
  closed: "Uzavřený",
  published: "Publikovaný",
};

const PREV_STATUS: Partial<Record<PlanStatus, PlanStatus>> = {
  opened: "created",
  closed: "opened",
  published: "closed",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function deadlineCountdown(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "prošel";
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(hours / 24);
  if (days > 0) return `za ${days}d ${hours % 24}h`;
  const mins = Math.floor((diff % 3600000) / 60000);
  return `za ${hours}h ${mins}m`;
}

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  // Format: YYYY-MM-DDTHH:MM
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: PlanStatus }) {
  return (
    <span className={`${styles.badge} ${styles[`badge_${status}`]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ShiftPlannerPage() {
  const { can, employeeId: currentEmployeeId, sharedTerminal } = useAuth();
  const now = clock.now();

  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [showOverrideRequests, setShowOverrideRequests] = useState(false);
  const [showChangeRequests, setShowChangeRequests] = useState(false);
  const [showMyRequests, setShowMyRequests] = useState(false);
  const [pendingChangeRequest, setPendingChangeRequest] = useState<{
    employeeId: string; date: string; currentRawInput: string; clickedAt: string;
  } | null>(null);
  const [pendingX, setPendingX] = useState<PendingXRequest | null>(null);
  const [pendingFreeClaim, setPendingFreeClaim] = useState<{ date: string; code: string; hotel: string } | null>(null);
  // Shared terminal only: default the "who is requesting?" picker to whoever is on
  // the reception shift now — but only when the terminal maps to a single hotel
  // (else null; see GET /shifts/on-shift-requester). Same source as the Walkiny /
  // Lobby bar "on shift now" default.
  const [defaultRequester, setDefaultRequester] = useState<string | null>(null);
  useEffect(() => {
    if (!sharedTerminal) return;
    api
      .get<{ employeeId: string | null }>("/shifts/on-shift-requester")
      .then((r) => setDefaultRequester(r.employeeId ?? null))
      .catch(() => {});
  }, [sharedTerminal]);
  const [editingEmployee, setEditingEmployee] = useState<PlanEmployee | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel?: string;
    showCancel?: boolean;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);
  const [plansList, setPlansList] = useState<PlanListItem[]>([]);
  const [copyFromId, setCopyFromId] = useState("");
  // Scheduled opening of a plan this user cannot see yet (still "created").
  // Without it the month reads "Plán pro tento měsíc neexistuje", which is
  // untrue — the plan exists and already has an automatic opening scheduled.
  const [upcomingOpenAt, setUpcomingOpenAt] = useState<string | null>(null);

  const [exporting, setExporting] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  const headerRef = useRef<HTMLDivElement>(null);
  const planBarRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [stickyTop, setStickyTop] = useState(0);

  // Full-screen grid on phones: collapse the month nav + plan bar while the
  // grid is scrolled, restore them at the top (the legend is hidden outright via
  // CSS). isPhone mirrors the CSS phone breakpoint (incl. landscape) so the
  // behaviour only applies there; chromeHidden also zeroes --sticky-top so the
  // grid claims the freed height.
  const [isPhone, setIsPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(
      "(max-width: 559.98px), (orientation: landscape) and (max-height: 480px)"
    );
    const update = () => setIsPhone(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  const [gridAtTop, setGridAtTop] = useState(true);
  const chromeHidden = isPhone && !gridAtTop;
  // Exact heights drive the collapse animation (max-height auto can't transition);
  // capping to the measured height means a clean ease with no dead-zone.
  const planBarHeight = Math.max(0, stickyTop - headerHeight);

  // Permission-derived (Phase 3). Coverage is identical to the previous role
  // checks: cells.edit = {admin,director,manager}; plan.transition = {admin,director}.
  const canEdit = can("shifts.cells.edit");
  const canPublish = can("shifts.plan.transition");
  // NB: distinct from canEdit above — that one is shifts.cells.edit (grid cells).
  // This gates the deadline controls, i.e. who may SET an automatic transition.
  const canEditDeadlines = can("shifts.plan.edit");
  // The absolute moment a deadline fires. Only for users who can't edit it:
  // an editor reads it off their datetime-local input, but everyone else saw
  // just "(za 3h 12m)" with no idea WHICH DAY that lands on.
  const deadlineWhen = (iso: string | null) =>
    iso && !canEditDeadlines ? (
      <span className={styles.deadlineWhen}>{formatIsoDatetimeCZ(iso)}</span>
    ) : null;
  // Self-service worker (built-in "employee"): edits only own X, no full cell edit.
  const selfServiceOnly = can("shifts.cells.editOwnX") && !can("shifts.cells.edit");
  // "Moje žádosti" is for users who can submit their own requests (change /
  // exception / free-shift claim) – not reviewers, and not types with no
  // request rights at all (e.g. personalista).
  const canSubmitRequests =
    can("shifts.changeRequest.submit") || can("shifts.override.submit") || can("shifts.freeShift.claim");
  // Free shifts below the grid are shown to those who can claim them, plus those
  // who manage them (admin/director toggle DPA free days). Hidden from everyone
  // else (e.g. personalista, FOM).
  const canSeeFreeShifts = can("shifts.freeShift.claim") || can("shifts.freeShift.manage");

  // Local draft for deadline inputs – avoids live-saving on every keystroke
  const [deadlineDraft, setDeadlineDraft] = useState({ openedAt: "", closedAt: "", publishedAt: "" });

  // Sync draft whenever the plan loads, changes month, or status changes
  useEffect(() => {
    if (plan) {
      setDeadlineDraft({
        openedAt: toDatetimeLocal(plan.openedAt),
        closedAt: toDatetimeLocal(plan.closedAt),
        publishedAt: toDatetimeLocal(plan.publishedAt),
      });
    }
  }, [plan?.id, plan?.status]);

  useEffect(() => {
    if (!showExportMenu) return;
    function handleClick(e: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showExportMenu]);

  useLayoutEffect(() => {
    function measure() {
      const h = headerRef.current?.offsetHeight ?? 0;
      const p = planBarRef.current?.offsetHeight ?? 0;
      setHeaderHeight(h);
      setStickyTop(h + p);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [plan?.status, loading]);

  const { refresh: refreshOverrideCount } = useShiftOverridesContext();
  const { refresh: refreshChangeRequestCount } = useShiftChangeRequestsContext();
  const [planOverrideCount, setPlanOverrideCount] = useState(0);
  const [planChangeRequestCount, setPlanChangeRequestCount] = useState(0);
  // Change-detection token: the updatedAt (millis) of the plan we currently show.
  const seenUpdatedRef = useRef<number | null>(null);

  // ── Load plan for selected month/year ──────────────────────────────────────

  // silent=true: update plan in-place without blanking the grid (used after
  // mutations where the user should see the result immediately without a flash).
  const loadPlan = useCallback((silent = false) => {
    if (!silent) {
      setLoading(true);
      setError(null);
      setPlan(null);
      setUpcomingOpenAt(null);
    }

    api
      .get<PlanListItem[]>("/shifts/plans")
      .then((plans) => {
        setPlansList(plans);
        const match = plans.find(
          (p) => p.month === selectedMonth && p.year === selectedYear
        );
        if (!match) {
          seenUpdatedRef.current = null;
          // No VISIBLE plan – but a "created" one may exist and simply be hidden
          // from this user until it opens. Ask for its scheduled opening so the
          // month can say when it lands instead of claiming it doesn't exist.
          // Failure is silent: this is a nicety, not something to error the page
          // over, and it stays null so the original wording shows.
          api
            .get<{ openedAt: string | null }>(
              `/shifts/plans-upcoming?year=${selectedYear}&month=${selectedMonth}`
            )
            .then((r) => setUpcomingOpenAt(r.openedAt))
            .catch(() => {});
          if (!silent) setLoading(false);
          return;
        }
        setUpcomingOpenAt(null);
        seenUpdatedRef.current = tsMillis(match.updatedAt);
        return api.get<PlanDetail>(`/shifts/plans/${match.id}`).then((detail) => {
          setPlan({ ...detail, modShifts: detail.modShifts ?? [] });
          // Fetch pending override count for this plan (silently ignored for non-admin/director)
          api
            .get<{ id: string; status: string }[]>(`/shifts/plans/${match.id}/shiftOverrides`)
            .then((overrides) => setPlanOverrideCount(overrides.filter((o) => o.status === "pending").length))
            .catch(() => {});
          api
            .get<{ id: string; status: string }[]>(`/shifts/plans/${match.id}/shiftChangeRequests`)
            .then((reqs) => setPlanChangeRequestCount(reqs.filter((r) => r.status === "pending").length))
            .catch(() => {});
        });
      })
      .catch((e) => { if (!silent) setError(e.message); })
      .finally(() => { if (!silent) setLoading(false); });
  }, [selectedMonth, selectedYear]);

  useEffect(() => {
    loadPlan();
  }, [loadPlan]);

  // External-change detection. The plan has no realtime channel (firestore.rules
  // block client SDK reads, so an onSnapshot is impossible), so we poll the plan
  // list while the tab is visible + refetch on focus, and silently reload when THIS
  // month's plan changed. Skipped while a cell <input> is focused so a reload can't
  // disrupt typing or invalidate the in-progress save's compare-and-swap base.
  useEffect(() => {
    async function check() {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) return;
      if (seenUpdatedRef.current === null) return;
      try {
        const plans = await api.get<PlanListItem[]>("/shifts/plans");
        const match = plans.find((p) => p.month === selectedMonth && p.year === selectedYear);
        if (!match) return;
        const serverMs = tsMillis(match.updatedAt);
        if (serverMs !== null && serverMs !== seenUpdatedRef.current) loadPlan(true);
      } catch {
        // transient — next tick retries
      }
    }
    const iv = setInterval(() => void check(), 15000);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(iv);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [selectedMonth, selectedYear, loadPlan]);

  // Guided-tour only: on the dedicated "Žádost o změnu směny" demo route
  // (scenario "shifts-change-request") auto-open the change-request modal once
  // the mock published plan has loaded, so the tour step can spotlight it
  // (`data-tour="shift-change-request-modal"`). The real modal normally opens on
  // a double-click of a read-only cell, which the tour engine can't perform; this
  // is confined to the sandbox route (its own page instance via App.tsx key), so
  // it never affects the real Směny page or the other shift demo routes.
  useEffect(() => {
    if (tourDemo.scenario !== "shifts-change-request") return;
    if (!plan || plan.status !== "published" || plan.employees.length === 0) return;
    if (pendingChangeRequest) return;
    const target =
      plan.employees.find((e) => e.section === "recepce") ?? plan.employees[0];
    const cell = plan.shifts.find((s) => s.employeeId === target.employeeId);
    setPendingChangeRequest({
      employeeId: target.employeeId,
      date: cell?.date ?? `${plan.year}-${String(plan.month).padStart(2, "0")}-01`,
      currentRawInput: cell?.rawInput ?? "DA",
      clickedAt: clock.now().toISOString(),
    });
  }, [plan, pendingChangeRequest]);

  // No client-side real-time listener: firestore.rules block direct client SDK
  // reads (all data flows through /api), so an onSnapshot on shiftPlans was
  // permission-denied and silently never fired. Plan changes refresh via the
  // explicit loadPlan() calls after each API mutation / navigation.

  // ── Frontend deadline timer ───────────────────────────────────────────────
  // The scheduled Cloud Function runs every 5 min in production but never in
  // the emulator. This timer fires at the exact deadline moment and calls the
  // trigger endpoint so transitions happen on time in both environments.

  useEffect(() => {
    if (!plan) return;

    const deadlineIso =
      plan.status === "created" ? plan.openedAt :
      plan.status === "opened"  ? plan.closedAt :
      plan.status === "closed"  ? plan.publishedAt :
      null;

    if (!deadlineIso) return;

    const msUntil = new Date(deadlineIso).getTime() - Date.now();

    const trigger = () => api.post("/shifts/trigger-deadlines", {}).catch(() => {});

    if (msUntil <= 0) {
      trigger();
      return;
    }

    const timer = window.setTimeout(trigger, msUntil);
    return () => window.clearTimeout(timer);
  }, [plan?.id, plan?.status, plan?.openedAt, plan?.closedAt, plan?.publishedAt]);

  // ── Month navigation ───────────────────────────────────────────────────────

  function prevMonth() {
    if (selectedMonth === 1) {
      setSelectedMonth(12);
      setSelectedYear((y) => y - 1);
    } else {
      setSelectedMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (selectedMonth === 12) {
      setSelectedMonth(1);
      setSelectedYear((y) => y + 1);
    } else {
      setSelectedMonth((m) => m + 1);
    }
  }

  // Whether we're viewing a month other than the current one (#53)
  const isCurrentMonth =
    selectedMonth === now.getMonth() + 1 && selectedYear === now.getFullYear();

  function goToday() {
    setSelectedMonth(now.getMonth() + 1);
    setSelectedYear(now.getFullYear());
  }

  // ── Plan actions ───────────────────────────────────────────────────────────

  async function handleCreatePlan() {
    setActionLoading(true);
    try {
      const { id } = await api.post<{ id: string }>("/shifts/plans", {
        month: selectedMonth,
        year: selectedYear,
      });
      if (copyFromId) {
        await api.post(`/shifts/plans/${id}/copy-employees`, { sourcePlanId: copyFromId });
      }
      const detail = await api.get<PlanDetail>(`/shifts/plans/${id}`);
      setPlan({ ...detail, modShifts: detail.modShifts ?? [] });
      setCopyFromId("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba při vytváření plánu");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleTransitionStatus(newStatus: PlanStatus) {
    if (!plan) return;
    setActionLoading(true);
    try {
      await api.patch(`/shifts/plans/${plan.id}`, { status: newStatus });
      // Reload to get fresh data (e.g., snapshot on close)
      loadPlan();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba při změně stavu");
    } finally {
      setActionLoading(false);
    }
  }

  function confirmDeletePlan() {
    if (!plan) return;
    setConfirmModal({
      title: "Smazat plán",
      message: `Opravdu smazat plán ${MONTH_NAMES[plan.month - 1]} ${plan.year}? Tato akce je nevratná – smažou se všechny směny i zaměstnanci v plánu.`,
      confirmLabel: "Smazat",
      danger: true,
      onConfirm: async () => {
        setConfirmModal(null);
        setActionLoading(true);
        try {
          await api.delete(`/shifts/plans/${plan.id}`);
          setPlan(null);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Chyba při mazání plánu");
        } finally {
          setActionLoading(false);
        }
      },
    });
  }

  function confirmRevertPlan() {
    if (!plan) return;
    const prevStatus = PREV_STATUS[plan.status];
    if (!prevStatus) return;
    const STATUS_LABELS_CZ: Record<PlanStatus, string> = {
      created: "Vytvořený",
      opened: "Otevřený",
      closed: "Uzavřený",
      published: "Publikovaný",
    };
    setConfirmModal({
      title: "Vrátit plán",
      message: `Vrátit plán zpět do stavu „${STATUS_LABELS_CZ[prevStatus]}"?`,
      confirmLabel: "Vrátit",
      danger: false,
      onConfirm: async () => {
        setConfirmModal(null);
        setActionLoading(true);
        try {
          // Clear the deadline that guarded the status we're leaving,
          // so the auto-trigger doesn't immediately re-apply it.
          const deadlineToClear =
            plan.status === "opened" ? "openedAt" :
            plan.status === "closed" ? "closedAt" :
            plan.status === "published" ? "publishedAt" : null;
          if (deadlineToClear) {
            await api.patch(`/shifts/plans/${plan.id}/deadlines`, { [deadlineToClear]: null });
          }
          await api.patch(`/shifts/plans/${plan.id}`, { status: prevStatus });
          loadPlan();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Chyba při vrácení stavu");
        } finally {
          setActionLoading(false);
        }
      },
    });
  }

  // ── Deadline management ────────────────────────────────────────────────────

  async function handleDeadlineChange(field: "openedAt" | "closedAt" | "publishedAt", value: string) {
    if (!plan) return;
    const iso = value ? new Date(value).toISOString() : null;
    // Guard chronological order (Otevření ≤ Uzavření ≤ Publikování) against the
    // other stored deadlines. Now that all three are settable from "created", an
    // out-of-order chain would make the auto-advance cron skip a state.
    if (iso) {
      const trio = {
        openedAt: field === "openedAt" ? iso : plan.openedAt,
        closedAt: field === "closedAt" ? iso : plan.closedAt,
        publishedAt: field === "publishedAt" ? iso : plan.publishedAt,
      };
      const seq = [trio.openedAt, trio.closedAt, trio.publishedAt].filter(Boolean) as string[];
      const inOrder = seq.every((v, i) => i === 0 || new Date(seq[i - 1]).getTime() <= new Date(v).getTime());
      if (!inOrder) {
        setConfirmModal({
          title: "Termíny ve špatném pořadí",
          message: "Termíny musí následovat po sobě: Otevření ≤ Uzavření ≤ Publikování. Upravte zadané datum.",
          confirmLabel: "Rozumím",
          showCancel: false,
          onConfirm: () => setConfirmModal(null),
        });
        return;
      }
    }
    try {
      await api.patch(`/shifts/plans/${plan.id}/deadlines`, { [field]: iso });
      setPlan((prev) => (prev ? { ...prev, [field]: iso } : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba při nastavení termínu");
    }
  }

  // ── Volné směny (free shifts) ──────────────────────────────────────────────

  async function handleToggleDpaDay(date: string, enabled: boolean) {
    if (!plan) return;
    try {
      const { freeShiftDpaDays } = await api.patch<{ ok: boolean; freeShiftDpaDays: string[] }>(
        `/shifts/plans/${plan.id}/free-dpa-day`,
        { date, enabled }
      );
      setPlan((prev) => (prev ? { ...prev, freeShiftDpaDays } : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba při úpravě volných směn");
    }
  }

  async function submitFreeClaim(claimantEmployeeId?: string) {
    if (!plan || !pendingFreeClaim) return;
    // On a shared terminal the claimant is picked in the dialog; otherwise it's
    // the logged-in user's own employee. The picked person both receives the shift
    // (employeeId) and is recorded as the requester (requestedByEmployeeId).
    const claimant = sharedTerminal ? claimantEmployeeId : currentEmployeeId;
    if (!claimant) return;
    const { date, code, hotel } = pendingFreeClaim;
    try {
      await api.post(`/shifts/plans/${plan.id}/shiftChangeRequests`, {
        employeeId: claimant,
        date,
        kind: "free-claim",
        code,
        hotel,
        ...(sharedTerminal ? { requestedByEmployeeId: claimant } : {}),
        requestedAtClient: clock.now().toISOString(),
      });
      setPendingFreeClaim(null);
      setPlanChangeRequestCount((c) => c + 1);
      refreshChangeRequestCount();
    } catch (e) {
      setPendingFreeClaim(null);
      setError(e instanceof Error ? e.message : "Chyba při žádosti o volnou směnu");
    }
  }

  // ── Copy employees into existing created plan ──────────────────────────────

  async function handleCopyEmployees() {
    if (!plan || !copyFromId) return;
    setActionLoading(true);
    try {
      await api.post(`/shifts/plans/${plan.id}/copy-employees`, { sourcePlanId: copyFromId });
      await loadPlan();
      setCopyFromId("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba při kopírování zaměstnanců");
    } finally {
      setActionLoading(false);
    }
  }

  // ── Employee edit / delete ─────────────────────────────────────────────────

  function handleDeleteEmployee(emp: PlanEmployee) {
    if (!plan) return;
    setConfirmModal({
      title: "Odebrat zaměstnance",
      message: `Odebrat ${employeeDisplayName(emp)} z plánu?`,
      confirmLabel: "Odebrat",
      danger: true,
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await api.delete(`/shifts/plans/${plan.id}/employees/${emp.id}`);
          loadPlan(true);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Chyba při odebírání zaměstnance");
        }
      },
    });
  }

  // ── MOD save ───────────────────────────────────────────────────────────────

  async function handleModSave(date: string, code: string) {
    if (!plan) return;
    if (code.trim() === "") {
      await api.delete(`/shifts/plans/${plan.id}/mod/${date}`);
      setPlan((prev) =>
        prev
          ? { ...prev, modShifts: prev.modShifts.filter((m) => m.date !== date) }
          : prev
      );
    } else {
      await api.put(`/shifts/plans/${plan.id}/mod/${date}`, { code });
      setPlan((prev) => {
        if (!prev) return prev;
        const existing = prev.modShifts.find((m) => m.date === date);
        if (existing) {
          return {
            ...prev,
            modShifts: prev.modShifts.map((m) =>
              m.date === date ? { ...m, code } : m
            ),
          };
        }
        return {
          ...prev,
          modShifts: [...prev.modShifts, { id: date, date, code }],
        };
      });
    }
  }

  // ── MOD person reassignment ────────────────────────────────────────────────

  async function handleModPersonChange(
    employeeId: string,
    oldLetter: string | null,
    newLetter: string | null
  ) {
    if (!plan) return;
    const { modPersons } = await api.patch<{ ok: boolean; modPersons: Record<string, string> }>(
      `/shifts/plans/${plan.id}/mod-persons`,
      { employeeId, oldLetter, newLetter }
    );
    // Rename modShifts in local state to match the new letter
    setPlan((prev) => {
      if (!prev) return prev;
      let modShifts = prev.modShifts;
      if (oldLetter && newLetter && oldLetter !== newLetter) {
        modShifts = modShifts.map((m) => m.code === oldLetter ? { ...m, code: newLetter } : m);
      } else if (oldLetter && !newLetter) {
        modShifts = modShifts.filter((m) => m.code !== oldLetter);
      }
      return { ...prev, modPersons, modShifts };
    });
  }

  // ── PDF export ─────────────────────────────────────────────────────────────

  async function handleExportPdf() {
    if (!plan) return;
    setExporting(true);
    try {
      const html2pdf = (await import("html2pdf.js" as string)).default;

      // ── Build days array for the month ──
      const daysInMonth: Date[] = [];
      const d = new Date(plan.year, plan.month - 1, 1);
      while (d.getMonth() === plan.month - 1) {
        daysInMonth.push(new Date(d));
        d.setDate(d.getDate() + 1);
      }
      const dayNames = ["Ne", "Po", "\u00dat", "St", "\u010ct", "P\u00e1", "So"];
      const holidays = getCzechHolidays(plan.year);
      const pad2 = (n: number) => String(n).padStart(2, "0");
      function fmtDate(dt: Date) {
        return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
      }
      function isWeekend(dt: Date) { return dt.getDay() === 0 || dt.getDay() === 6; }

      // ── Shift lookup map ──
      const shiftMap = new Map<string, ShiftDoc>();
      for (const s of plan.shifts) shiftMap.set(`${s.employeeId}_${s.date}`, s);

      // ── MOD lookup ──
      const modMap = new Map<string, string>();
      for (const m of plan.modShifts) modMap.set(m.date, m.code);

      // ── Group employees by section ──
      const grouped = new Map<string, PlanEmployee[]>();
      for (const section of SECTIONS) {
        grouped.set(section, sortSectionEmployees(section, plan.employees.filter((e) => e.section === section)));
      }

      // ── Styles ──
      const cs = {
        cell: "padding:0 1px;text-align:center;font-size:6pt;font-family:monospace;border:1px solid #d1d5db;line-height:1.3;",
        nameCell: "padding:1px 3px;font-size:6pt;white-space:nowrap;overflow:hidden;border:1px solid #d1d5db;text-align:left;",
        header: "padding:1px;text-align:center;font-size:5.5pt;font-weight:600;border:1px solid #d1d5db;background:#f3f4f6;line-height:1.2;",
        sectionRow: "padding:1px 3px;font-size:6pt;font-weight:700;text-transform:uppercase;background:#e5e7eb;border:1px solid #d1d5db;",
        modCell: "padding:0 1px;text-align:center;font-size:6pt;font-weight:700;border:1px solid #d1d5db;line-height:1.3;",
      };

      // ── Build HTML table ──
      let html = "";
      // Header row
      html += "<tr>";
      html += `<th style="${cs.header}">Zam\u011bstnanec</th>`;
      for (const day of daysInMonth) {
        const wkend = isWeekend(day);
        const hol = holidays.has(fmtDate(day));
        const bg = hol ? "#fef2f2" : wkend ? "#f0f9ff" : "#f3f4f6";
        html += `<th style="${cs.header}background:${bg};"><div>${day.getDate()}</div><div style="font-weight:400;font-size:5pt;">${dayNames[day.getDay()]}</div></th>`;
      }
      html += `<th style="${cs.header}">\u03a3</th>`;
      html += "</tr>";

      // MOD letter per employee - shared with the grid and the CSV export.
      const modLetterByEmpId = modLettersByEmployeeId(plan.modPersons);

      // Section rows
      for (const section of SECTIONS) {
        const emps = grouped.get(section) ?? [];
        if (emps.length === 0) continue;

        // Section header
        html += `<tr><td colspan="${daysInMonth.length + 2}" style="${cs.sectionRow}">${SECTION_LABELS[section]}</td></tr>`;

        // Employee rows
        for (const emp of emps) {
          html += "<tr>";
          const modBadge = section === "vedouc\u00ed" ? modLetterByEmpId.get(emp.employeeId) : undefined;
          const safeName = escapeHtml(employeeDisplayName(emp));
          const nameHtml = modBadge
            ? `${safeName} <span style="display:inline-block;background:#e5e7eb;border-radius:3px;padding:0 2px;font-weight:700;font-size:5.5pt;margin-left:2px;">${escapeHtml(modBadge)}</span>`
            : safeName;
          html += `<td style="${cs.nameCell}">${nameHtml}</td>`;
          let shiftCount = 0;
          for (const day of daysInMonth) {
            const dateStr = fmtDate(day);
            const shift = shiftMap.get(`${emp.employeeId}_${dateStr}`);
            const raw = shift?.rawInput ?? "";
            const parsed = parseShiftExpression(raw);
            const { bg, text } = getCellColor(parsed, false);
            const wkend = isWeekend(day);
            const hol = holidays.has(dateStr);
            const cellBg = bg !== "transparent" ? bg : (hol ? "#fef2f2" : wkend ? "#f0f9ff" : "#fff");
            if (shift?.status === "assigned") shiftCount++;
            html += `<td style="${cs.cell}background:${cellBg};color:${text};">${raw}</td>`;
          }
          html += `<td style="${cs.cell}font-weight:700;">${shiftCount}</td>`;
          html += "</tr>";
        }

        // MOD row after vedouc\u00ed
        if (section === "vedouc\u00ed") {
          html += "<tr>";
          html += `<td style="${cs.modCell}background:#f5f3ff;">MOD</td>`;
          for (const day of daysInMonth) {
            const dateStr = fmtDate(day);
            const code = modMap.get(dateStr) ?? "";
            html += `<td style="${cs.modCell}">${code}</td>`;
          }
          html += `<td style="${cs.modCell}"></td>`;
          html += "</tr>";
        }
      }

      // ── Legend lines ──
      const legendText = [
        "D - denn\u00ed sm\u011bna 7:00-19:00",
        "N - no\u010dn\u00ed sm\u011bna 19:00-7:00",
        "R - 9:00-17:30",
        "ZD - zau\u010dov\u00e1n\u00ed denn\u00ed 7:00-19:00",
        "ZN - zau\u010dov\u00e1n\u00ed no\u010dn\u00ed 19:00-7:00",
        "A - Ambiance",
        "S - Superior",
        "Q - Amigo & Alqush",
        "K - Ankora",
        "po 6 hodin\u00e1ch je 30 minut pauza",
      ].join(" &nbsp;\u2022&nbsp; ");

      // ── Colgroup for column widths ──
      // Name column gets explicit width; day columns share remaining space equally
      const colgroup = `<colgroup>
        <col style="width:14%;" />
        ${daysInMonth.map(() => '<col />').join("")}
        <col style="width:3%;" />
      </colgroup>`;

      // ── Full document ──
      const fullHtml = `
        <div style="font-family:Arial,sans-serif;color:#111827;background:#fff;">
          <h2 style="margin:0 0 3px 0;font-size:10pt;">Sm\u011bny \u2014 ${MONTH_NAMES[plan.month - 1]} ${plan.year}</h2>
          <table style="border-collapse:collapse;width:100%;table-layout:fixed;">
            ${colgroup}
            ${html}
          </table>
          <div style="margin-top:2px;font-size:5.5pt;color:#6b7280;">${legendText}</div>
        </div>`;

      const wrapper = document.createElement("div");
      wrapper.innerHTML = fullHtml;
      document.body.appendChild(wrapper);

      const filename = `smeny_${plan.year}_${pad2(plan.month)}.pdf`;

      await html2pdf().set({
        margin: [5, 5, 5, 5],
        filename,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, windowWidth: 1100 },
        jsPDF: { unit: "mm", format: "a4", orientation: "landscape" },
        pagebreak: { mode: ["avoid-all"] },
      }).from(wrapper.firstElementChild).save();

      document.body.removeChild(wrapper);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba p\u0159i exportu PDF");
    } finally {
      setExporting(false);
    }
  }

  // ── CSV export ─────────────────────────────────────────────────────────────

  function handleExportCsv() {
    if (!plan) return;
    const pad2 = (n: number) => String(n).padStart(2, "0");

    const daysInMonth: Date[] = [];
    const d = new Date(plan.year, plan.month - 1, 1);
    while (d.getMonth() === plan.month - 1) {
      daysInMonth.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }

    const shiftMap = new Map<string, ShiftDoc>();
    for (const s of plan.shifts) shiftMap.set(`${s.employeeId}_${s.date}`, s);
    const modMap = new Map<string, string>();
    for (const m of plan.modShifts) modMap.set(m.date, m.code);

    // MOD letter per employee. Was a second, divergent copy of the grid's logic:
    // it compared surname-first against a first-name-first table (so it never
    // matched), and its static pass could hand an already-reassigned letter to a
    // second employee. Both gone - one helper, keyed by employeeId.
    const effectiveModPersons = modLettersByEmployeeId(plan.modPersons);

    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows: string[] = [];

    // Header row
    const header = [
      "Zaměstnanec",
      ...daysInMonth.map((dt) => pad2(dt.getDate())),
      "Celkem směn",
    ];
    rows.push(header.map(escape).join(";"));

    // Employee rows grouped by section
    for (const section of SECTIONS) {
      const sectionEmps = sortSectionEmployees(section, plan.employees.filter((e) => e.section === section));
      if (sectionEmps.length === 0) continue;

      rows.push([escape(SECTION_LABELS[section]), ...daysInMonth.map(() => ""), ""].join(";"));

      for (const emp of sectionEmps) {
        let shiftCount = 0;
        const cells = daysInMonth.map((dt) => {
          const dateStr = `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
          const shift = shiftMap.get(`${emp.employeeId}_${dateStr}`);
          const raw = shift?.rawInput ?? "";
          if (raw && raw !== "X") shiftCount++;
          return escape(raw);
        });
        const modLetter = section === "vedoucí" ? (effectiveModPersons.get(emp.employeeId) ?? "") : "";
        const name = `${employeeDisplayName(emp)}${modLetter ? ` (${modLetter})` : ""}`;
        rows.push([escape(name), ...cells, escape(String(shiftCount))].join(";"));
      }

      // MOD row after vedoucí
      if (section === "vedoucí") {
        const modCells = daysInMonth.map((dt) => {
          const dateStr = `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
          return escape(modMap.get(dateStr) ?? "");
        });
        rows.push([escape("MOD"), ...modCells, ""].join(";"));
      }
    }

    const bom = "\uFEFF";
    const blob = new Blob([bom + rows.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `smeny_${plan.year}_${pad2(plan.month)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── X limit helpers ────────────────────────────────────────────────────────

  /** Base monthly X limit by contract type (8 HPP / 13 PPP); null = no limit. */
  function getXBase(contractType: string | null): number | null {
    const ct = (contractType ?? "").toUpperCase();
    if (ct.includes("HPP")) return 8;
    if (ct.includes("PPP")) return 13;
    return null; // DPP or unknown = no limit
  }

  // Count of vacation-origin Xs (source:"vacation") for an employee this month. A
  // non-zero count means the employee has an approved vacation overlapping the month –
  // the only situation in which admin may raise the X limit.
  function vacationXCount(shifts: ShiftDoc[], employeeId: string): number {
    return shifts.filter(
      (s) => s.employeeId === employeeId && s.status === "day_off" && s.source === "vacation"
    ).length;
  }

  /**
   * Effective monthly X limit. The admin-set override only applies when the employee
   * has an approved vacation this month; otherwise the base (8 HPP / 13 PPP) applies.
   * null when no base applies (DPP/unknown).
   */
  function getEffectiveXLimit(emp: PlanEmployee | undefined): number | null {
    if (!emp) return null;
    const base = getXBase(emp.contractType);
    if (base === null) return null;
    const hasVacation = vacationXCount(plan?.shifts ?? [], emp.employeeId) > 0;
    if (hasVacation && emp.xLimitOverride != null) return emp.xLimitOverride;
    return base;
  }

  // A day counts toward the voluntary X limit only when it's an employee-entered
  // X – vacation-origin Xs (source:"vacation") are tracked separately and excluded.
  function isVoluntaryX(s: ShiftDoc): boolean {
    return s.status === "day_off" && s.source !== "vacation";
  }

  function countXShifts(shifts: ShiftDoc[], employeeId: string): number {
    return shifts.filter((s) => s.employeeId === employeeId && isVoluntaryX(s)).length;
  }

  /** Returns the length of the consecutive (voluntary) X run that would include newDate. */
  function consecutiveXRun(shifts: ShiftDoc[], employeeId: string, newDate: string): number {
    const xDates = new Set(
      shifts
        .filter((s) => s.employeeId === employeeId && isVoluntaryX(s))
        .map((s) => s.date)
    );
    xDates.add(newDate);

    function addDays(dateStr: string, n: number): string {
      const [y, m, d] = dateStr.split("-").map(Number);
      const dt = new Date(y, m - 1, d + n); // local-time only, no UTC conversion
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    }

    let before = 0;
    let d = addDays(newDate, -1);
    while (xDates.has(d)) { before++; d = addDays(d, -1); }

    let after = 0;
    d = addDays(newDate, 1);
    while (xDates.has(d)) { after++; d = addDays(d, 1); }

    return before + 1 + after;
  }

  function checkCoverage(
    currentPlan: PlanDetail,
    employeeId: string,
    date: string
  ): { shiftType: "D" | "N"; available: number } | null {
    const emp = currentPlan.employees.find((e) => e.employeeId === employeeId);
    if (
      !emp ||
      emp.section !== "recepce" ||
      (emp.primaryShiftType !== "D" && emp.primaryShiftType !== "N")
    )
      return null;

    const st = emp.primaryShiftType as "D" | "N";
    const eligible = currentPlan.employees.filter(
      (e) => e.section === "recepce" && e.primaryShiftType === st && e.active
    );
    const withXAfter = eligible.filter((e) => {
      if (e.employeeId === employeeId) return true; // this one is getting X
      const shift = currentPlan.shifts.find(
        (s) => s.employeeId === e.employeeId && s.date === date
      );
      return shift?.status === "day_off";
    });
    const available = eligible.length - withXAfter.length;
    return available < 5 ? { shiftType: st, available } : null;
  }

  // ── Cell save (upsert / delete) ────────────────────────────────────────────

  // Double-click on an editable cell of an OPEN plan toggles the X marker. It
  // delegates to handleCellSave, so the X-limit exception dialog, the
  // "6 X in a row" block and the coverage checks all fire exactly as when the X
  // is typed. Only toggles empty ↔ X – never clobbers a real shift value.
  async function handleCellToggleX(employeeId: string, date: string) {
    if (!plan || plan.status !== "opened") return;
    const cur = (plan.shifts.find((s) => s.id === `${employeeId}_${date}`)?.rawInput ?? "")
      .trim()
      .toUpperCase();
    if (cur !== "" && cur !== "X") return; // don't overwrite an assigned shift
    await handleCellSave(employeeId, date, cur === "X" ? "" : "X");
  }

  /** A cell write hit a concurrency conflict (409): tell the user + refresh. */
  function notifyCellConflict() {
    setConfirmModal({
      title: "Buňku upravil někdo jiný",
      message:
        "Tuto buňku mezitím změnil jiný uživatel, vaše úprava se neuložila. Zobrazuji aktuální verzi plánu.",
      confirmLabel: "OK",
      showCancel: false,
      onConfirm: () => setConfirmModal(null),
    });
    loadPlan(true);
  }

  async function handleCellSave(employeeId: string, date: string, rawInput: string) {
    if (!plan) return;

    // Employees may only enter X or clear a cell – silently discard anything else
    if (selfServiceOnly && rawInput.trim() !== "") {
      const parsed = parseShiftExpression(rawInput);
      if (!parsed.isValid || !parsed.segments.every((s) => s.code === "X")) {
        return; // resolve without error so ShiftCell reverts to original value
      }
    }

    if (rawInput.trim() === "") {
      // Check if an approved vacation covers this date – warn before deleting
      const { hasVacation } = await api.get<{ hasVacation: boolean }>(
        `/vacation/check?employeeId=${encodeURIComponent(employeeId)}&date=${date}`
      );
      if (hasVacation) {
        // Show warning modal; the actual delete runs from onConfirm
        setConfirmModal({
          title: "Smazání X – schválená dovolená",
          message:
            "Tento den je součástí schválené dovolené. Opravdu chcete X smazat? " +
            "Dovolená zůstane schválená, ale X v plánu zmizí.",
          confirmLabel: "Smazat X",
          danger: true,
          onConfirm: () => {
            setConfirmModal(null);
            api.delete(
              `/shifts/plans/${plan.id}/shifts/${employeeId}/${date}?baseRawInput=${encodeURIComponent(
                plan.shifts.find((s) => s.id === `${employeeId}_${date}`)?.rawInput ?? ""
              )}`
            )
              .then(() => {
                setPlan((prev) => {
                  if (!prev) return prev;
                  const docId = `${employeeId}_${date}`;
                  return { ...prev, shifts: prev.shifts.filter((s) => s.id !== docId) };
                });
              })
              .catch((e) => {
                if (e instanceof ApiError && e.status === 409) {
                  notifyCellConflict();
                  return;
                }
                setError(e instanceof Error ? e.message : "Chyba při mazání");
              });
          },
        });
        // Return without deleting – let the modal handle it.
        // ShiftCell will re-display the original value since setPlan wasn't called.
        return;
      }
      const delBase = plan.shifts.find((s) => s.id === `${employeeId}_${date}`)?.rawInput ?? "";
      try {
        await api.delete(
          `/shifts/plans/${plan.id}/shifts/${employeeId}/${date}?baseRawInput=${encodeURIComponent(delBase)}`
        );
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          notifyCellConflict();
          return;
        }
        throw e;
      }
      setPlan((prev) => {
        if (!prev) return prev;
        const docId = `${employeeId}_${date}`;
        return { ...prev, shifts: prev.shifts.filter((s) => s.id !== docId) };
      });
      return;
    }

    const parsed = parseShiftExpression(rawInput);
    const isAllX =
      parsed.segments.length > 0 && parsed.segments.every((s) => s.code === "X");

    if (isAllX && !can("shifts.xAllowance.manage")) {
      // Hard block: no more than 6 consecutive Xs – no override allowed
      if (consecutiveXRun(plan.shifts, employeeId, date) > 6) {
        setConfirmModal({
          title: "Příliš mnoho X za sebou",
          message:
            "Nelze zadat více než 6 X po sobě jdoucích dnů. " +
            "Pokud potřebujete volno na delší dobu, požádejte o dovolenou.",
          confirmLabel: "Rozumím",
          showCancel: false,
          onConfirm: () => setConfirmModal(null),
        });
        return;
      }

      const emp = plan.employees.find((e) => e.employeeId === employeeId);
      const violations: ViolationInfo[] = [];

      // Per-employee X limit check (base + admin extra allowance)
      const limit = getEffectiveXLimit(emp);
      if (limit !== null) {
        const current = countXShifts(plan.shifts, employeeId);
        if (current >= limit) {
          violations.push({ type: "employee_x_limit", limit, current });
        }
      }

      // Per-day coverage check (recepce D/N only)
      const coverageViolation = checkCoverage(plan, employeeId, date);
      if (coverageViolation) {
        violations.push({
          type: coverageViolation.shiftType === "D" ? "day_coverage" : "night_coverage",
          available: coverageViolation.available,
        });
      }

      if (violations.length > 0) {
        setPendingX({ employeeId, date, rawInput, violations });
        return;
      }
    }

    const docId = `${employeeId}_${date}`;
    // Optimistic concurrency: send the value we based this edit on so the server
    // rejects (409) if the cell moved, rather than clobbering a colleague's change.
    const baseRawInput = plan.shifts.find((s) => s.id === docId)?.rawInput ?? null;
    try {
      await api.put(`/shifts/plans/${plan.id}/shifts/${employeeId}/${date}`, { rawInput, baseRawInput });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        notifyCellConflict();
        return;
      }
      if (e instanceof ApiError && e.status === 403) {
        // Server rejected a business rule (X-limit / coverage / 6-in-a-row) — e.g. a
        // concurrent X dropped coverage below 5 after our local check passed. The
        // frontend normally routes to the override flow first, so this is the race /
        // bypass backstop: surface the server's reason and refresh to the true state.
        setConfirmModal({
          title: "Nelze uložit",
          message: e.message || "Tuto úpravu nelze uložit.",
          confirmLabel: "OK",
          showCancel: false,
          onConfirm: () => setConfirmModal(null),
        });
        loadPlan(true);
        return;
      }
      throw e;
    }
    // Preserve an existing type-tag across a numeric→numeric edit; the backend
    // keeps it too (it only clears the tag when the cell stops being numeric).
    const existingTag = plan.shifts.find((s) => s.id === docId)?.typeTag ?? null;
    const updated: ShiftDoc = {
      id: docId,
      employeeId,
      date,
      rawInput,
      hoursComputed: parsed.hoursComputed,
      isDouble: parsed.isDouble,
      status:
        parsed.segments.length === 0
          ? "unassigned"
          : parsed.segments.every((s) => s.code === "X")
          ? "day_off"
          : "assigned",
      typeTag: isPureNumericExpression(parsed) ? existingTag : null,
    };
    setPlan((prev) => {
      if (!prev) return prev;
      const others = prev.shifts.filter((s) => s.id !== docId);
      return { ...prev, shifts: [...others, updated] };
    });
  }

  // #29: set/clear the shift-type tag on a numeric "worked hours" cell. Reuses the
  // cell upsert endpoint (sends the unchanged rawInput + the new tag); tally-only.
  async function handleCellTagSave(employeeId: string, date: string, typeTag: string | null) {
    if (!plan) return;
    const docId = `${employeeId}_${date}`;
    const shift = plan.shifts.find((s) => s.id === docId);
    if (!shift) return; // can only tag an existing cell
    try {
      await api.put(`/shifts/plans/${plan.id}/shifts/${employeeId}/${date}`, {
        rawInput: shift.rawInput,
        typeTag,
        baseRawInput: shift.rawInput,
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        notifyCellConflict();
        return;
      }
      throw e;
    }
    setPlan((prev) => {
      if (!prev) return prev;
      return { ...prev, shifts: prev.shifts.map((s) => (s.id === docId ? { ...s, typeTag } : s)) };
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ "--sticky-top": `${chromeHidden ? 0 : stickyTop}px` } as CSSProperties}>
      {/* Header – month nav centred as the page's primary control */}
      <div
        className={`${styles.header}${chromeHidden ? ` ${styles.chromeHidden}` : ""}`}
        ref={headerRef}
        style={{ position: "sticky", top: 0, zIndex: 10, background: "var(--color-bg)", maxHeight: isPhone ? (headerHeight || undefined) : undefined }}
      >
        <div />
        <div className={styles.monthNav} data-tour="shift-month-nav">
          <button className={styles.navBtn} onClick={prevMonth}>‹</button>
          <span className={styles.monthLabel}>
            {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
          </span>
          <button className={styles.navBtn} onClick={nextMonth}>›</button>
          {!isCurrentMonth && (
            <button className={styles.todayBtn} onClick={goToday}>DNES</button>
          )}
        </div>
        <div />
      </div>

      {/* Loading / error */}
      {loading && <div className={styles.state}>Načítám…</div>}
      {error && <div className={styles.errorState}>{error}</div>}

      {!loading && !error && (
        <>
          {/* Plan bar */}
          <div ref={planBarRef} className={`${styles.planBar}${chromeHidden ? ` ${styles.chromeHidden}` : ""}`} style={{ position: "sticky", top: headerHeight, zIndex: 10, background: "var(--color-bg)", paddingBottom: "0.5rem", maxHeight: isPhone ? (planBarHeight || undefined) : undefined }}>
            {plan ? (
              <StatusBadge status={plan.status} />
            ) : upcomingOpenAt ? (
              // The plan exists but is still "created", so this user can't open
              // it yet – announce when it will open rather than deny it exists.
              <span className={styles.planPending}>
                Plán se připravuje – otevře se {formatIsoDatetimeCZ(upcomingOpenAt)}
              </span>
            ) : (
              <span className={styles.noPlan}>Plán pro tento měsíc neexistuje</span>
            )}

            {/* Create plan */}
            {!plan && can("shifts.plan.create") && (
              <>
                {plansList.length > 0 && (
                  <select
                    className={styles.copyFromSelect}
                    value={copyFromId}
                    onChange={(e) => setCopyFromId(e.target.value)}
                  >
                    <option value="">Kopírovat zaměstnance z…</option>
                    {plansList.map((p) => (
                      <option key={p.id} value={p.id}>
                        {MONTH_NAMES[p.month - 1]} {p.year}
                      </option>
                    ))}
                  </select>
                )}
                <Button
                  data-tour="shift-create"
                  variant="primary"
                  onClick={handleCreatePlan}
                  disabled={actionLoading}
                >
                  Vytvořit plán
                </Button>
              </>
            )}

            {/* Open plan */}
            {plan?.status === "created" && canPublish && (
              <Button
                variant="primary"
                data-tour="shift-transitions"
                onClick={() => handleTransitionStatus("opened")}
                disabled={actionLoading}
              >
                Otevřít plán
              </Button>
            )}

            {/* Close plan */}
            {plan?.status === "opened" && canPublish && (
              <Button
                variant="primary"
                data-tour="shift-transitions"
                onClick={() => handleTransitionStatus("closed")}
                disabled={actionLoading}
              >
                Uzavřít plán
              </Button>
            )}

            {/* Publish plan */}
            {plan?.status === "closed" && canPublish && (
              <Button
                variant="primary"
                data-tour="shift-transitions"
                onClick={() => handleTransitionStatus("published")}
                disabled={actionLoading}
              >
                Publikovat
              </Button>
            )}

            {/* Add employee */}
            {plan && (plan.status !== "published" || can("shifts.plan.revert")) && can("shifts.planEmployees.manage") && (
              <Button
                data-tour="shift-add-employee"
                variant="secondary"
                onClick={() => setShowAddEmployee(true)}
              >
                + Přidat zaměstnance
              </Button>
            )}

            {/* Copy employees into existing created plan */}
            {plan?.status === "created" && can("shifts.plan.edit") && plansList.filter(p => p.id !== plan.id).length > 0 && (
              <>
                <select
                  className={styles.copyFromSelect}
                  value={copyFromId}
                  onChange={(e) => setCopyFromId(e.target.value)}
                >
                  <option value="">Kopírovat zaměstnance z…</option>
                  {plansList
                    .filter((p) => p.id !== plan.id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {MONTH_NAMES[p.month - 1]} {p.year}
                      </option>
                    ))}
                </select>
                {copyFromId && (
                  <Button
                    variant="secondary"
                    onClick={handleCopyEmployees}
                    disabled={actionLoading}
                  >
                    Kopírovat
                  </Button>
                )}
              </>
            )}

            {/* Unavailability requests toggle */}
            {/* Override requests toggle (admin/director only) */}
            {plan && can("shifts.override.review") && (
              <Button
                data-tour="shift-overrides"
                variant="secondary"
                onClick={() => setShowOverrideRequests((v) => !v)}
                style={{ position: "relative" }}
              >
                Výjimky
                {planOverrideCount > 0 && (
                  <span style={{
                    position: "absolute",
                    top: "-6px",
                    right: "-8px",
                    background: "#ef4444",
                    color: "#fff",
                    borderRadius: "9999px",
                    fontSize: "0.65rem",
                    fontWeight: 700,
                    minWidth: "1.1rem",
                    height: "1.1rem",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "0 3px",
                    lineHeight: 1,
                  }}>
                    {planOverrideCount}
                  </span>
                )}
              </Button>
            )}

            {/* Admin/director: separate Žádosti o změny button with badge */}
            {plan && can("shifts.changeRequest.review") && (
              <Button
                data-tour="shift-change-requests"
                variant="secondary"
                onClick={() => setShowChangeRequests((v) => !v)}
                style={{ position: "relative" }}
              >
                Žádosti o změny
                {planChangeRequestCount > 0 && (
                  <span style={{
                    position: "absolute",
                    top: "-6px",
                    right: "-8px",
                    background: "#ef4444",
                    color: "#fff",
                    borderRadius: "9999px",
                    fontSize: "0.65rem",
                    fontWeight: 700,
                    minWidth: "1.1rem",
                    height: "1.1rem",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "0 3px",
                    lineHeight: 1,
                  }}>
                    {planChangeRequestCount}
                  </span>
                )}
              </Button>
            )}

            {/* Non-reviewers who can submit their own requests: Moje žádosti */}
            {plan && !canPublish && canSubmitRequests && (
              <Button
                data-tour="shift-my-requests-btn"
                variant="secondary"
                onClick={() => setShowMyRequests((v) => !v)}
              >
                Moje žádosti
              </Button>
            )}

            {/* Export – anyone with shifts.export (built-in admin/director, plus
                custom types like Rezervace that are granted export rights) */}
            {plan && can("shifts.export") && plan.employees.length > 0 && (
              <div data-tour="shift-export" className={styles.exportWrapper} ref={exportMenuRef}>
                <Button
                  variant="secondary"
                  onClick={() => setShowExportMenu((v) => !v)}
                  disabled={exporting}
                >
                  {exporting ? "Exportuji\u2026" : "Exportovat \u25be"}
                </Button>
                {showExportMenu && (
                  <div className={styles.exportMenu}>
                    <button
                      className={styles.exportMenuItem}
                      onClick={() => { setShowExportMenu(false); handleExportPdf(); }}
                    >
                      PDF
                    </button>
                    <button
                      className={styles.exportMenuItem}
                      onClick={() => { setShowExportMenu(false); handleExportCsv(); }}
                    >
                      CSV
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Revert plan (admin only) */}
            {plan && can("shifts.plan.revert") && plan.status !== "created" && (
              <Button
                data-tour="shift-revert"
                variant="secondary"
                onClick={confirmRevertPlan}
                disabled={actionLoading}
              >
                ← Vrátit zpět
              </Button>
            )}

            {/* Delete plan (admin, any status) */}
            {plan && can("shifts.plan.delete") && plan.status === "created" && (
              <Button
                data-tour="shift-delete"
                variant="danger"
                onClick={confirmDeletePlan}
                disabled={actionLoading}
                style={{ marginLeft: "auto" }}
              >
                Smazat plán
              </Button>
            )}
          </div>

          {/* Deadline bar – visible to all when there is a saved deadline or user can edit.
              Each upcoming transition's deadline can be set from any earlier state, so from
              "created" admin can schedule all three at once (Otevření/Uzavření/Publikování).
              The cron advances one step per run, so a full chain cascades correctly. */}
          {plan && (
            (plan.status === "created" && (can("shifts.plan.edit") || plan.openedAt)) ||
            ((plan.status === "created" || plan.status === "opened") && (can("shifts.plan.edit") || plan.closedAt)) ||
            (plan.status !== "published" && (can("shifts.plan.edit") || plan.publishedAt))
          ) && (
            <div data-tour="shift-edit-deadlines" className={styles.deadlineBar}>
              {plan.status === "created" && (can("shifts.plan.edit") || plan.openedAt) && (
                <div className={styles.deadlineItem}>
                  <label className={styles.deadlineLabel}>Otevření:</label>
                  {can("shifts.plan.edit") && (
                    <>
                      <input
                        type="datetime-local"
                        className={styles.deadlineInput}
                        value={deadlineDraft.openedAt}
                        onChange={(e) => setDeadlineDraft((d) => ({ ...d, openedAt: e.target.value }))}
                      />
                      <button
                        className={styles.deadlineSave}
                        onClick={() => handleDeadlineChange("openedAt", deadlineDraft.openedAt)}
                        title="Uložit termín"
                      >
                        Uložit
                      </button>
                    </>
                  )}
                  {plan.openedAt && (
                    <>
                      {deadlineWhen(plan.openedAt)}
                      <span className={styles.deadlineCountdown}>
                        ({deadlineCountdown(plan.openedAt)})
                      </span>
                      {can("shifts.plan.edit") && (
                        <button
                          className={styles.deadlineClear}
                          onClick={() => {
                            setDeadlineDraft((d) => ({ ...d, openedAt: "" }));
                            handleDeadlineChange("openedAt", "");
                          }}
                          title="Zrušit termín"
                        >
                          ×
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
              {(plan.status === "created" || plan.status === "opened") && (can("shifts.plan.edit") || plan.closedAt) && (
                <div className={styles.deadlineItem}>
                  <label className={styles.deadlineLabel}>Uzavření:</label>
                  {can("shifts.plan.edit") && (
                    <>
                      <input
                        type="datetime-local"
                        className={styles.deadlineInput}
                        value={deadlineDraft.closedAt}
                        onChange={(e) => setDeadlineDraft((d) => ({ ...d, closedAt: e.target.value }))}
                      />
                      <button
                        className={styles.deadlineSave}
                        onClick={() => handleDeadlineChange("closedAt", deadlineDraft.closedAt)}
                        title="Uložit termín"
                      >
                        Uložit
                      </button>
                    </>
                  )}
                  {plan.closedAt && (
                    <>
                      {deadlineWhen(plan.closedAt)}
                      <span className={styles.deadlineCountdown}>
                        ({deadlineCountdown(plan.closedAt)})
                      </span>
                      {can("shifts.plan.edit") && (
                        <button
                          className={styles.deadlineClear}
                          onClick={() => {
                            setDeadlineDraft((d) => ({ ...d, closedAt: "" }));
                            handleDeadlineChange("closedAt", "");
                          }}
                          title="Zrušit termín"
                        >
                          ×
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
              {/* status is already narrowed to created/opened/closed by the bar's wrapper */}
              {(can("shifts.plan.edit") || plan.publishedAt) && (
                <div className={styles.deadlineItem}>
                  <label className={styles.deadlineLabel}>Publikování:</label>
                  {can("shifts.plan.edit") && (
                    <>
                      <input
                        type="datetime-local"
                        className={styles.deadlineInput}
                        value={deadlineDraft.publishedAt}
                        onChange={(e) => setDeadlineDraft((d) => ({ ...d, publishedAt: e.target.value }))}
                      />
                      <button
                        className={styles.deadlineSave}
                        onClick={() => handleDeadlineChange("publishedAt", deadlineDraft.publishedAt)}
                        title="Uložit termín"
                      >
                        Uložit
                      </button>
                    </>
                  )}
                  {plan.publishedAt && (
                    <>
                      {deadlineWhen(plan.publishedAt)}
                      <span className={styles.deadlineCountdown}>
                        ({deadlineCountdown(plan.publishedAt)})
                      </span>
                      {can("shifts.plan.edit") && (
                        <button
                          className={styles.deadlineClear}
                          onClick={() => {
                            setDeadlineDraft((d) => ({ ...d, publishedAt: "" }));
                            handleDeadlineChange("publishedAt", "");
                          }}
                          title="Zrušit termín"
                        >
                          ×
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Shift override requests panel */}
          {plan && showOverrideRequests && (
            <ShiftOverridePanel
              planId={plan.id}
              employees={plan.employees}
              onOverrideResolved={() => {
                setPlanOverrideCount((c) => Math.max(0, c - 1));
                refreshOverrideCount();
              }}
              onShiftApproved={(employeeId, date, rawInput, hoursComputed, isDouble) => {
                const docId = `${employeeId}_${date}`;
                const approved: ShiftDoc = {
                  id: docId,
                  employeeId,
                  date,
                  rawInput,
                  hoursComputed,
                  isDouble,
                  status: "day_off",
                };
                setPlan((prev) => {
                  if (!prev) return prev;
                  const others = prev.shifts.filter((s) => s.id !== docId);
                  return { ...prev, shifts: [...others, approved] };
                });
              }}
            />
          )}

          {/* Shift change requests panel – admin/director only (full review mode) */}
          {plan && showChangeRequests && can("shifts.changeRequest.review") && (
            <ShiftChangeRequestPanel
              planId={plan.id}
              employees={plan.employees}
              canReview={true}
              onResolved={() => {
                setPlanChangeRequestCount((c) => Math.max(0, c - 1));
                refreshChangeRequestCount();
                // Auto-applied changes land on the plan cells – reload so the
                // grid reflects them without a manual page refresh.
                loadPlan(true);
              }}
            />
          )}

          {/* My requests panel – employee/manager (read-only, own requests only) */}
          {plan && showMyRequests && !canPublish && canSubmitRequests && (
            <div data-tour="shift-my-requests">
              <MyRequestsPanel planId={plan.id} />
            </div>
          )}

          {/* Shift grid */}
          {plan && plan.employees.length === 0 && (
            <div className={styles.emptyPlan}>
              Plán neobsahuje žádné zaměstnance. Přidejte je tlačítkem výše.
            </div>
          )}
          {plan && plan.employees.length > 0 && (
            <div data-tour="shift-grid">
            <ShiftGrid
              // Remount when plan membership changes so removing a row triggers a
              // clean re-layout – the sticky + table-layout:fixed grid mis-renders
              // when a row is dropped in place (fixed on refresh otherwise). #35.
              // Sorted ids → changes on add/remove only, not on reorder.
              key={[...plan.employees].map((e) => e.id).sort().join(",")}
              plan={plan}
              onCellSave={handleCellSave}
              onCellTagSave={!selfServiceOnly && canEdit ? handleCellTagSave : undefined}
              onModSave={handleModSave}
              onEditEmployee={(emp) => setEditingEmployee(emp)}
              onDeleteEmployee={handleDeleteEmployee}
              canEditEmployees={
                can("shifts.plan.revert") || (can("shifts.planEmployees.manage") && plan.status !== "published")
              }
              canSeeInactiveFlag={canEdit}
              readOnly={selfServiceOnly ? plan.status !== "opened" : !canEdit}
              alwaysReadOnlySections={selfServiceOnly ? ["vedoucí"] : []}
              currentEmployeeId={currentEmployeeId}
              showCounterTable={can("shifts.counterTable.view")}
              showModCounts={canPublish && (plan.status === "closed" || plan.status === "published")}
              onModPersonChange={can("shifts.mod.manage") ? handleModPersonChange : undefined}
              onCellRequestChange={
                can("shifts.changeRequest.submit") && plan.status === "published"
                  ? (employeeId, date, currentRawInput) => {
                      // #32 – stamp the moment of the click, carried through to the POST
                      setPendingChangeRequest({
                        employeeId, date, currentRawInput,
                        clickedAt: clock.now().toISOString(),
                      });
                    }
                  : undefined
              }
              onCellDoubleClickX={plan.status === "opened" ? handleCellToggleX : undefined}
              xInfoFor={
                can("shifts.xAllowance.manage") && (plan.status === "created" || plan.status === "opened")
                  ? (emp) => {
                      const limit = getEffectiveXLimit(emp);
                      if (limit === null) return null;
                      const base = getXBase(emp.contractType) ?? 0;
                      const vacCount = vacationXCount(plan.shifts, emp.employeeId);
                      return {
                        used: countXShifts(plan.shifts, emp.employeeId),
                        base,
                        limit,
                        vacCount,
                        editable: vacCount > 0,
                      };
                    }
                  : undefined
              }
              onSetXAllowance={
                can("shifts.xAllowance.manage") && (plan.status === "created" || plan.status === "opened")
                  ? async (emp, limit) => {
                      await api.patch(`/shifts/plans/${plan.id}/employees/${emp.id}/x-allowance`, { limit });
                      loadPlan(true);
                    }
                  : undefined
              }
              showFreeShifts={
                (plan.status === "published" && canSeeFreeShifts) ||
                (plan.status === "closed" && can("shifts.freeShift.manage"))
              }
              freeShiftDpaDays={plan.freeShiftDpaDays ?? []}
              onClaimFreeShift={
                can("shifts.freeShift.claim") && plan.status === "published"
                  ? (date, code, hotel) => setPendingFreeClaim({ date, code, hotel })
                  : undefined
              }
              onToggleDpaDay={
                can("shifts.freeShift.manage") &&
                (plan.status === "published" || plan.status === "closed")
                  ? handleToggleDpaDay
                  : undefined
              }
              onAtTopChange={setGridAtTop}
            />
            </div>
          )}

          {plan && plan.employees.length > 0 && (
            <div className={styles.legend}>
              <span>D - denní směna 7:00-19:00</span>
              <span>N - noční směna 19:00-7:00</span>
              <span>R - 9:00-17:30</span>
              <span>ZD - zaučování denní 7:00-19:00</span>
              <span>ZN - zaučování noční 19:00-7:00</span>
              <span>A - Ambiance</span>
              <span>S - Superior</span>
              <span>Q - Amigo & Alqush</span>
              <span>K - Ankora</span>
              <span>po 6 hodinách je 30 minut pauza</span>
            </div>
          )}

        </>
      )}

      {/* Modals */}
      {showAddEmployee && plan && (
        <AddEmployeeToPlanModal
          planId={plan.id}
          existingEmployees={plan.employees}
          onClose={() => setShowAddEmployee(false)}
          onAdded={() => {
            setShowAddEmployee(false);
            loadPlan(true);
          }}
        />
      )}
      {confirmModal && (
        <ConfirmModal
          title={confirmModal.title}
          message={confirmModal.message}
          confirmLabel={confirmModal.confirmLabel}
          cancelLabel={confirmModal.cancelLabel}
          showCancel={confirmModal.showCancel}
          danger={confirmModal.danger}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}
      {pendingX && plan && (
        <XOverrideModal
          employeeName={(() => {
            const emp = plan.employees.find((e) => e.employeeId === pendingX.employeeId);
            return emp ? employeeDisplayName(emp) : pendingX.employeeId;
          })()}
          date={pendingX.date}
          violations={pendingX.violations}
          planEmployees={plan.employees}
          sharedTerminal={sharedTerminal}
          defaultRequesterEmployeeId={defaultRequester ?? undefined}
          onSubmit={async (reason, requestedByEmployeeId) => {
            await api.post(`/shifts/plans/${plan.id}/shiftOverrides`, {
              employeeId: pendingX.employeeId,
              date: pendingX.date,
              requestedInput: pendingX.rawInput,
              reason,
              violationTypes: pendingX.violations.map((v) => v.type),
              ...(requestedByEmployeeId ? { requestedByEmployeeId } : {}),
            });
            setPendingX(null);
            setPlanOverrideCount((c) => c + 1);
            refreshOverrideCount();
          }}
          onCancel={() => setPendingX(null)}
        />
      )}
      {pendingChangeRequest && plan && (
        <ShiftChangeRequestModal
          employeeName={(() => {
            const emp = plan.employees.find((e) => e.employeeId === pendingChangeRequest.employeeId);
            return emp ? employeeDisplayName(emp) : pendingChangeRequest.employeeId;
          })()}
          date={pendingChangeRequest.date}
          currentShift={pendingChangeRequest.currentRawInput}
          planEmployees={plan.employees}
          requesterEmployeeId={pendingChangeRequest.employeeId}
          sharedTerminal={sharedTerminal}
          defaultRequesterEmployeeId={defaultRequester ?? undefined}
          onSubmit={async ({ requestedChange, reason, requestedByEmployeeId }) => {
            await api.post(`/shifts/plans/${plan.id}/shiftChangeRequests`, {
              employeeId: pendingChangeRequest.employeeId,
              date: pendingChangeRequest.date,
              currentRawInput: pendingChangeRequest.currentRawInput,
              requestedChange,
              reason,
              ...(requestedByEmployeeId ? { requestedByEmployeeId } : {}),
              requestedAtClient: pendingChangeRequest.clickedAt,
            });
            setPendingChangeRequest(null);
            setPlanChangeRequestCount((c) => c + 1);
            refreshChangeRequestCount();
          }}
          onClose={() => setPendingChangeRequest(null)}
        />
      )}
      {pendingFreeClaim && plan && (
        <FreeClaimModal
          date={pendingFreeClaim.date}
          code={pendingFreeClaim.code}
          hotel={pendingFreeClaim.hotel}
          planEmployees={plan.employees}
          sharedTerminal={sharedTerminal}
          defaultRequesterEmployeeId={defaultRequester ?? undefined}
          onConfirm={submitFreeClaim}
          onCancel={() => setPendingFreeClaim(null)}
        />
      )}
      {editingEmployee && plan && (
        <EditEmployeeInPlanModal
          planId={plan.id}
          employee={editingEmployee}
          onClose={() => setEditingEmployee(null)}
          onSaved={() => {
            setEditingEmployee(null);
            loadPlan(true);
          }}
        />
      )}
    </div>
  );
}
