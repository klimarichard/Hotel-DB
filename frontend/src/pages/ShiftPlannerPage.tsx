import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../hooks/useAuth";
import { parseShiftExpression } from "../lib/shiftConstants";
import ShiftGrid from "../components/ShiftGrid";
import AddEmployeeToPlanModal from "../components/AddEmployeeToPlanModal";
import EditEmployeeInPlanModal from "../components/EditEmployeeInPlanModal";
import ConfirmModal from "../components/ConfirmModal";
import UnavailabilityPanel from "../components/UnavailabilityPanel";
import XOverrideModal from "../components/XOverrideModal";
import ShiftOverridePanel from "../components/ShiftOverridePanel";
import { useShiftOverridesContext } from "../context/ShiftOverridesContext";
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
  closedAt: string | null;
  publishedAt: string | null;
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
  const { role } = useAuth();
  const now = new Date();

  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [showUnavailability, setShowUnavailability] = useState(false);
  const [showOverrideRequests, setShowOverrideRequests] = useState(false);
  const [pendingX, setPendingX] = useState<PendingXRequest | null>(null);
  const [editingEmployee, setEditingEmployee] = useState<PlanEmployee | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);
  const [plansList, setPlansList] = useState<PlanListItem[]>([]);
  const [copyFromId, setCopyFromId] = useState("");

  const canEdit = role === "admin" || role === "director" || role === "manager";
  const canPublish = role === "admin" || role === "director";

  // Local draft for deadline inputs — avoids live-saving on every keystroke
  const [deadlineDraft, setDeadlineDraft] = useState({ closedAt: "", publishedAt: "" });

  // Sync draft whenever the plan loads, changes month, or status changes
  useEffect(() => {
    if (plan) {
      setDeadlineDraft({
        closedAt: toDatetimeLocal(plan.closedAt),
        publishedAt: toDatetimeLocal(plan.publishedAt),
      });
    }
  }, [plan?.id, plan?.status]);

  const { refresh: refreshOverrideCount } = useShiftOverridesContext();
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

  // ── Automatic deadline checker ─────────────────────────────────────────────

  const deadlineTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    async function checkDeadlines() {
      if (!plan) return;

      // opened → closed
      if (plan.status === "opened" && plan.closedAt) {
        if (new Date(plan.closedAt).getTime() <= Date.now()) {
          try {
            await api.patch(`/shifts/plans/${plan.id}`, { status: "closed" });
            loadPlan(); // reload to get snapshot
          } catch { /* ignore */ }
          return;
        }
      }

      // closed → published
      if (plan.status === "closed" && plan.publishedAt) {
        if (new Date(plan.publishedAt).getTime() <= Date.now()) {
          try {
            await api.patch(`/shifts/plans/${plan.id}`, { status: "published" });
            setPlan((prev) => (prev ? { ...prev, status: "published" } : prev));
          } catch { /* ignore */ }
          return;
        }
      }
    }

    checkDeadlines();

    // Check every 60 seconds
    deadlineTimerRef.current = setInterval(checkDeadlines, 60000);
    return () => {
      if (deadlineTimerRef.current) clearInterval(deadlineTimerRef.current);
    };
  }, [plan?.id, plan?.status, plan?.closedAt, plan?.publishedAt, loadPlan]);

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

  async function handleDeadlineChange(field: "closedAt" | "publishedAt", value: string) {
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

    if (rawInput.trim() === "") {
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
      {/* Header */}
      <div className={styles.header}>
        <h1 className={styles.title}>Směny</h1>
        <div className={styles.monthNav}>
          <button className={styles.navBtn} onClick={prevMonth}>‹</button>
          <span className={styles.monthLabel}>
            {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
          </span>
          <button className={styles.navBtn} onClick={nextMonth}>›</button>
        </div>
      </div>

      {/* Loading / error */}
      {loading && <div className={styles.state}>Načítám…</div>}
      {error && <div className={styles.errorState}>{error}</div>}

      {!loading && !error && (
        <>
          {/* Plan bar */}
          <div className={styles.planBar}>
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
            {plan && canEdit && (
              <button
                className={styles.secondaryBtn}
                onClick={() => setShowUnavailability((v) => !v)}
              >
                Žádosti o volno
              </button>
            )}

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
              Uzavření shown only when opened; Publikování only when closed. */}
          {plan && (
            (plan.status === "opened" && (canEdit || plan.closedAt)) ||
            (plan.status === "closed" && (canEdit || plan.publishedAt))
          ) && (
            <div className={styles.deadlineBar}>
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

          {/* Unavailability panel */}
          {plan && showUnavailability && (
            <UnavailabilityPanel planId={plan.id} />
          )}

          {/* Shift override requests panel */}
          {plan && showOverrideRequests && (
            <ShiftOverridePanel
              planId={plan.id}
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
              readOnly={!canEdit}
              showCounterTable={plan.status === "closed" && role === "admin"}
            />
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
