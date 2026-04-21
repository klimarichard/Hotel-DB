import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase";
import { api } from "../lib/api";
import { useAuth } from "../hooks/useAuth";
import { parseShiftExpression, getCellColor, SECTIONS, SECTION_LABELS, getCzechHolidays, MOD_PERSONS } from "../lib/shiftConstants";
import ShiftGrid from "../components/ShiftGrid";
import AddEmployeeToPlanModal from "../components/AddEmployeeToPlanModal";
import EditEmployeeInPlanModal from "../components/EditEmployeeInPlanModal";
import ConfirmModal from "../components/ConfirmModal";
import XOverrideModal from "../components/XOverrideModal";
import ShiftOverridePanel from "../components/ShiftOverridePanel";
import ShiftChangeRequestPanel from "../components/ShiftChangeRequestPanel";
import MyRequestsPanel from "../components/MyRequestsPanel";
import ShiftChangeRequestModal from "../components/ShiftChangeRequestModal";
import { useShiftOverridesContext } from "../context/ShiftOverridesContext";
import { useShiftChangeRequestsContext } from "../context/ShiftChangeRequestsContext";
import styles from "./ShiftPlannerPage.module.css";

// ─── Shared types ─────────────────────────────────────────────────────────────

export type PlanStatus = "created" | "opened" | "closed" | "published";

export interface PlanEmployee {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  section: "vedoucí" | "recepce" | "portýři";
  primaryShiftType: "D" | "N" | "R" | "DP" | "NP" | null;
  primaryHotel: string | null;
  displayOrder: number;
  active: boolean;
  contractType: string | null;
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
  employees: PlanEmployee[];
  shifts: ShiftDoc[];
  modShifts: ModShiftDoc[];
}

interface PlanListItem {
  id: string;
  month: number;
  year: number;
  status: PlanStatus;
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
  const { role, employeeId: currentEmployeeId } = useAuth();
  const now = new Date();

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
    employeeId: string; date: string; currentRawInput: string;
  } | null>(null);
  const [pendingX, setPendingX] = useState<PendingXRequest | null>(null);
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

  const [exporting, setExporting] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  const headerRef = useRef<HTMLDivElement>(null);
  const planBarRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [stickyTop, setStickyTop] = useState(0);

  const canEdit = role === "admin" || role === "director" || role === "manager";
  const canPublish = role === "admin" || role === "director";

  // Local draft for deadline inputs — avoids live-saving on every keystroke
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
  const { pendingCount: changeRequestCount, refresh: refreshChangeRequestCount } = useShiftChangeRequestsContext();
  const [planOverrideCount, setPlanOverrideCount] = useState(0);

  // ── Load plan for selected month/year ──────────────────────────────────────

  const loadPlan = useCallback(() => {
    setLoading(true);
    setError(null);
    setPlan(null);

    api
      .get<PlanListItem[]>("/shifts/plans")
      .then((plans) => {
        setPlansList(plans);
        const match = plans.find(
          (p) => p.month === selectedMonth && p.year === selectedYear
        );
        if (!match) {
          setLoading(false);
          return;
        }
        return api.get<PlanDetail>(`/shifts/plans/${match.id}`).then((detail) => {
          setPlan({ ...detail, modShifts: detail.modShifts ?? [] });
          // Fetch pending override count for this plan (silently ignored for non-admin/director)
          api
            .get<{ id: string; status: string }[]>(`/shifts/plans/${match.id}/shiftOverrides`)
            .then((overrides) => setPlanOverrideCount(overrides.filter((o) => o.status === "pending").length))
            .catch(() => {});
        });
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [selectedMonth, selectedYear]);

  useEffect(() => {
    loadPlan();
  }, [loadPlan]);

  // ── Real-time plan reload via Firestore onSnapshot ────────────────────────
  // Listens to the plan document. Every mutation in shifts.ts bumps the plan's
  // updatedAt, so any change by any user triggers a full reload here.

  const lastUpdatedAtRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!plan?.id) return;
    const unsub = onSnapshot(doc(db, "shiftPlans", plan.id), (snap) => {
      const updatedAt = snap.data()?.updatedAt?.toMillis?.()?.toString() ?? snap.data()?.updatedAt;
      if (lastUpdatedAtRef.current === undefined) {
        // First fire — just record the baseline, don't reload
        lastUpdatedAtRef.current = updatedAt;
        return;
      }
      if (updatedAt !== lastUpdatedAtRef.current) {
        lastUpdatedAtRef.current = updatedAt;
        loadPlan();
      }
    });
    return () => { unsub(); lastUpdatedAtRef.current = undefined; };
  }, [plan?.id, loadPlan]);

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
      message: `Opravdu smazat plán ${MONTH_NAMES[plan.month - 1]} ${plan.year}? Tato akce je nevratná — smažou se všechny směny i zaměstnanci v plánu.`,
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
    try {
      await api.patch(`/shifts/plans/${plan.id}/deadlines`, { [field]: iso });
      setPlan((prev) => (prev ? { ...prev, [field]: iso } : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba při nastavení termínu");
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

  async function handleDeleteEmployee(emp: PlanEmployee) {
    if (!plan) return;
    if (!window.confirm(`Odebrat ${emp.lastName} ${emp.firstName} z plánu?`)) return;
    try {
      await api.delete(`/shifts/plans/${plan.id}/employees/${emp.id}`);
      setPlan((prev) =>
        prev ? { ...prev, employees: prev.employees.filter((e) => e.id !== emp.id) } : prev
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba při odebírání zaměstnance");
    }
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
        grouped.set(section, plan.employees
          .filter((e) => e.section === section)
          .sort((a, b) => a.displayOrder - b.displayOrder));
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

      // ── MOD letter per employee (same logic as ShiftGrid) ──
      const modLetterByEmpId = new Map<string, string>();
      // Seed from static name-based mapping
      for (const emp of plan.employees) {
        const fullName = `${emp.firstName} ${emp.lastName}`;
        for (const [letter, name] of Object.entries(MOD_PERSONS)) {
          if (name === fullName) modLetterByEmpId.set(emp.employeeId, letter);
        }
      }
      // Apply per-plan overrides
      const modPersons = plan.modPersons ?? {};
      const overriddenLetters = new Set(Object.keys(modPersons));
      if (overriddenLetters.size > 0) {
        for (const [empId, letter] of [...modLetterByEmpId.entries()]) {
          if (overriddenLetters.has(letter)) modLetterByEmpId.delete(empId);
        }
        for (const [letter, empId] of Object.entries(modPersons)) {
          modLetterByEmpId.set(empId, letter);
        }
      }

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
          const nameHtml = modBadge
            ? `${emp.lastName} ${emp.firstName} <span style="display:inline-block;background:#e5e7eb;border-radius:3px;padding:0 2px;font-weight:700;font-size:5.5pt;margin-left:2px;">${modBadge}</span>`
            : `${emp.lastName} ${emp.firstName}`;
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

    // Resolve MOD letter for a vedoucí employee
    const modPersonsMap = new Map(Object.entries(plan.modPersons ?? {}));
    const effectiveModPersons = new Map<string, string>(); // employeeId → letter
    for (const [letter, empId] of modPersonsMap) effectiveModPersons.set(empId, letter);
    for (const [letter, fullName] of Object.entries(MOD_PERSONS)) {
      const emp = plan.employees.find(
        (e) => e.section === "vedoucí" && !effectiveModPersons.has(e.employeeId) &&
          `${e.lastName} ${e.firstName}` === fullName
      );
      if (emp) effectiveModPersons.set(emp.employeeId, letter);
    }

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
      const sectionEmps = plan.employees
        .filter((e) => e.section === section)
        .sort((a, b) => a.displayOrder - b.displayOrder);
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
        const name = `${emp.lastName} ${emp.firstName}${modLetter ? ` (${modLetter})` : ""}`;
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

  function getXLimit(contractType: string | null): number | null {
    const ct = (contractType ?? "").toUpperCase();
    if (ct.includes("HPP")) return 8;
    if (ct.includes("PPP")) return 13;
    return null; // DPP or unknown = no limit
  }

  function countXShifts(shifts: ShiftDoc[], employeeId: string): number {
    return shifts.filter((s) => s.employeeId === employeeId && s.status === "day_off").length;
  }

  /** Returns the length of the consecutive X run that would include newDate. */
  function consecutiveXRun(shifts: ShiftDoc[], employeeId: string, newDate: string): number {
    const xDates = new Set(
      shifts
        .filter((s) => s.employeeId === employeeId && s.status === "day_off")
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

  async function handleCellSave(employeeId: string, date: string, rawInput: string) {
    if (!plan) return;

    // Employees may only enter X or clear a cell — silently discard anything else
    if (role === "employee" && rawInput.trim() !== "") {
      const parsed = parseShiftExpression(rawInput);
      if (!parsed.isValid || !parsed.segments.every((s) => s.code === "X")) {
        return; // resolve without error so ShiftCell reverts to original value
      }
    }

    if (rawInput.trim() === "") {
      // Check if an approved vacation covers this date — warn before deleting
      const { hasVacation } = await api.get<{ hasVacation: boolean }>(
        `/vacation/check?employeeId=${encodeURIComponent(employeeId)}&date=${date}`
      );
      if (hasVacation) {
        // Show warning modal; the actual delete runs from onConfirm
        setConfirmModal({
          title: "Smazání X — schválená dovolená",
          message:
            "Tento den je součástí schválené dovolené. Opravdu chcete X smazat? " +
            "Dovolená zůstane schválená, ale X v plánu zmizí.",
          confirmLabel: "Smazat X",
          danger: true,
          onConfirm: () => {
            setConfirmModal(null);
            api.delete(`/shifts/plans/${plan.id}/shifts/${employeeId}/${date}`)
              .then(() => {
                setPlan((prev) => {
                  if (!prev) return prev;
                  const docId = `${employeeId}_${date}`;
                  return { ...prev, shifts: prev.shifts.filter((s) => s.id !== docId) };
                });
              })
              .catch((e) => setError(e instanceof Error ? e.message : "Chyba při mazání"));
          },
        });
        // Return without deleting — let the modal handle it.
        // ShiftCell will re-display the original value since setPlan wasn't called.
        return;
      }
      await api.delete(`/shifts/plans/${plan.id}/shifts/${employeeId}/${date}`);
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

    if (isAllX && role !== "admin" && role !== "director") {
      // Hard block: no more than 6 consecutive Xs — no override allowed
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

      // Per-employee X limit check
      const limit = getXLimit(emp?.contractType ?? null);
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

    await api.put(`/shifts/plans/${plan.id}/shifts/${employeeId}/${date}`, { rawInput });
    const docId = `${employeeId}_${date}`;
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
    };
    setPlan((prev) => {
      if (!prev) return prev;
      const others = prev.shifts.filter((s) => s.id !== docId);
      return { ...prev, shifts: [...others, updated] };
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header — month nav centred as the page's primary control */}
      <div className={styles.header} ref={headerRef} style={{ position: "sticky", top: 0, zIndex: 10, background: "var(--color-bg)" }}>
        <div />
        <div className={styles.monthNav}>
          <button className={styles.navBtn} onClick={prevMonth}>‹</button>
          <span className={styles.monthLabel}>
            {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
          </span>
          <button className={styles.navBtn} onClick={nextMonth}>›</button>
        </div>
        <div />
      </div>

      {/* Loading / error */}
      {loading && <div className={styles.state}>Načítám…</div>}
      {error && <div className={styles.errorState}>{error}</div>}

      {!loading && !error && (
        <>
          {/* Plan bar */}
          <div ref={planBarRef} className={styles.planBar} style={{ position: "sticky", top: headerHeight, zIndex: 10, background: "var(--color-bg)", paddingBottom: "0.5rem" }}>
            {plan ? (
              <StatusBadge status={plan.status} />
            ) : (
              <span className={styles.noPlan}>Plán pro tento měsíc neexistuje</span>
            )}

            {/* Create plan */}
            {!plan && canEdit && (
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
                <button
                  className={styles.primaryBtn}
                  onClick={handleCreatePlan}
                  disabled={actionLoading}
                >
                  Vytvořit plán
                </button>
              </>
            )}

            {/* Open plan */}
            {plan?.status === "created" && canEdit && (
              <button
                className={styles.primaryBtn}
                onClick={() => handleTransitionStatus("opened")}
                disabled={actionLoading}
              >
                Otevřít plán
              </button>
            )}

            {/* Close plan */}
            {plan?.status === "opened" && canEdit && (
              <button
                className={styles.primaryBtn}
                onClick={() => handleTransitionStatus("closed")}
                disabled={actionLoading}
              >
                Uzavřít plán
              </button>
            )}

            {/* Publish plan */}
            {plan?.status === "closed" && canPublish && (
              <button
                className={styles.primaryBtn}
                onClick={() => handleTransitionStatus("published")}
                disabled={actionLoading}
              >
                Publikovat
              </button>
            )}

            {/* Add employee */}
            {plan && (plan.status !== "published" || role === "admin") && canEdit && (
              <button
                className={styles.secondaryBtn}
                onClick={() => setShowAddEmployee(true)}
              >
                + Přidat zaměstnance
              </button>
            )}

            {/* Copy employees into existing created plan */}
            {plan?.status === "created" && canEdit && plansList.filter(p => p.id !== plan.id).length > 0 && (
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
                  <button
                    className={styles.secondaryBtn}
                    onClick={handleCopyEmployees}
                    disabled={actionLoading}
                  >
                    Kopírovat
                  </button>
                )}
              </>
            )}

            {/* Unavailability requests toggle */}
            {/* Override requests toggle (admin/director only) */}
            {plan && canPublish && (
              <button
                className={styles.secondaryBtn}
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
              </button>
            )}

            {/* Admin/director: separate Žádosti o změny button with badge */}
            {plan && canPublish && (
              <button
                className={styles.secondaryBtn}
                onClick={() => setShowChangeRequests((v) => !v)}
                style={{ position: "relative" }}
              >
                Žádosti o změny
                {changeRequestCount > 0 && (
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
                    {changeRequestCount}
                  </span>
                )}
              </button>
            )}

            {/* Employee/manager: combined Moje žádosti button */}
            {plan && !canPublish && (
              <button
                className={styles.secondaryBtn}
                onClick={() => setShowMyRequests((v) => !v)}
              >
                Moje žádosti
              </button>
            )}

            {/* Export (admin/director) */}
            {plan && canPublish && plan.employees.length > 0 && (
              <div className={styles.exportWrapper} ref={exportMenuRef}>
                <button
                  className={styles.secondaryBtn}
                  onClick={() => setShowExportMenu((v) => !v)}
                  disabled={exporting}
                >
                  {exporting ? "Exportuji\u2026" : "Exportovat \u25be"}
                </button>
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
            {plan && role === "admin" && plan.status !== "created" && (
              <button
                className={styles.secondaryBtn}
                onClick={confirmRevertPlan}
                disabled={actionLoading}
              >
                ← Vrátit zpět
              </button>
            )}

            {/* Delete plan (admin, any status) */}
            {plan && role === "admin" && (
              <button
                className={styles.dangerBtn}
                onClick={confirmDeletePlan}
                disabled={actionLoading}
              >
                Smazat plán
              </button>
            )}
          </div>

          {/* Deadline bar — visible to all when there is a saved deadline or user can edit.
              Otevření shown only when created; Uzavření when opened; Publikování when closed. */}
          {plan && (
            (plan.status === "created" && (canEdit || plan.openedAt)) ||
            (plan.status === "opened" && (canEdit || plan.closedAt)) ||
            (plan.status === "closed" && (canEdit || plan.publishedAt))
          ) && (
            <div className={styles.deadlineBar}>
              {plan.status === "created" && (canEdit || plan.openedAt) && (
                <div className={styles.deadlineItem}>
                  <label className={styles.deadlineLabel}>Otevření:</label>
                  {canEdit && (
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
                      <span className={styles.deadlineCountdown}>
                        ({deadlineCountdown(plan.openedAt)})
                      </span>
                      {canEdit && (
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
              {plan.status === "opened" && (canEdit || plan.closedAt) && (
                <div className={styles.deadlineItem}>
                  <label className={styles.deadlineLabel}>Uzavření:</label>
                  {canEdit && (
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
                      <span className={styles.deadlineCountdown}>
                        ({deadlineCountdown(plan.closedAt)})
                      </span>
                      {canEdit && (
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
              {plan.status === "closed" && (canEdit || plan.publishedAt) && (
                <div className={styles.deadlineItem}>
                  <label className={styles.deadlineLabel}>Publikování:</label>
                  {canEdit && (
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
                      <span className={styles.deadlineCountdown}>
                        ({deadlineCountdown(plan.publishedAt)})
                      </span>
                      {canEdit && (
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

          {/* Shift change requests panel — admin/director only (full review mode) */}
          {plan && showChangeRequests && canPublish && (
            <ShiftChangeRequestPanel
              planId={plan.id}
              employees={plan.employees}
              canReview={true}
              onResolved={() => { refreshChangeRequestCount(); }}
            />
          )}

          {/* My requests panel — employee/manager (read-only, own requests only) */}
          {plan && showMyRequests && !canPublish && (
            <MyRequestsPanel planId={plan.id} />
          )}

          {/* Shift grid */}
          {plan && plan.employees.length === 0 && (
            <div className={styles.emptyPlan}>
              Plán neobsahuje žádné zaměstnance. Přidejte je tlačítkem výše.
            </div>
          )}
          {plan && plan.employees.length > 0 && (
            <ShiftGrid
              plan={plan}
              onCellSave={handleCellSave}
              onModSave={handleModSave}
              onEditEmployee={(emp) => setEditingEmployee(emp)}
              onDeleteEmployee={handleDeleteEmployee}
              canEditEmployees={
                role === "admin" || (canEdit && plan.status !== "published")
              }
              canSeeInactiveFlag={canEdit}
              readOnly={role === "employee" ? plan.status !== "opened" : !canEdit}
              alwaysReadOnlySections={role === "employee" ? ["vedoucí"] : []}
              currentEmployeeId={currentEmployeeId}
              showCounterTable={plan.status === "closed" && role === "admin"}
              showModCounts={role === "admin" || role === "director"}
              onModPersonChange={role === "admin" || role === "director" ? handleModPersonChange : undefined}
              onCellRequestChange={
                role === "employee" && plan.status === "published"
                  ? (employeeId, date, currentRawInput) => {
                      setPendingChangeRequest({ employeeId, date, currentRawInput });
                    }
                  : undefined
              }
              stickyTop={stickyTop}
            />
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
          onClose={() => setShowAddEmployee(false)}
          onAdded={(emp) => {
            setPlan((prev) =>
              prev ? { ...prev, employees: [...prev.employees, emp] } : prev
            );
            setShowAddEmployee(false);
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
            return emp ? `${emp.lastName} ${emp.firstName}` : pendingX.employeeId;
          })()}
          date={pendingX.date}
          violations={pendingX.violations}
          onSubmit={async (reason) => {
            await api.post(`/shifts/plans/${plan.id}/shiftOverrides`, {
              employeeId: pendingX.employeeId,
              date: pendingX.date,
              requestedInput: pendingX.rawInput,
              reason,
              violationTypes: pendingX.violations.map((v) => v.type),
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
            return emp ? `${emp.lastName} ${emp.firstName}` : pendingChangeRequest.employeeId;
          })()}
          date={pendingChangeRequest.date}
          currentShift={pendingChangeRequest.currentRawInput}
          onSubmit={async (reason) => {
            await api.post(`/shifts/plans/${plan.id}/shiftChangeRequests`, {
              employeeId: pendingChangeRequest.employeeId,
              date: pendingChangeRequest.date,
              currentRawInput: pendingChangeRequest.currentRawInput,
              reason,
            });
            setPendingChangeRequest(null);
          }}
          onClose={() => setPendingChangeRequest(null)}
        />
      )}
      {editingEmployee && plan && (
        <EditEmployeeInPlanModal
          planId={plan.id}
          employee={editingEmployee}
          onClose={() => setEditingEmployee(null)}
          onSaved={(updated) => {
            setPlan((prev) =>
              prev
                ? {
                    ...prev,
                    employees: prev.employees.map((e) =>
                      e.id === updated.id ? updated : e
                    ),
                  }
                : prev
            );
            setEditingEmployee(null);
          }}
        />
      )}
    </div>
  );
}
