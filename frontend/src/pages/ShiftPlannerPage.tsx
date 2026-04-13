import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../hooks/useAuth";
import { parseShiftExpression } from "../lib/shiftConstants";
import ShiftGrid from "../components/ShiftGrid";
import AddEmployeeToPlanModal from "../components/AddEmployeeToPlanModal";
import UnavailabilityPanel from "../components/UnavailabilityPanel";
import styles from "./ShiftPlannerPage.module.css";

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface PlanEmployee {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  section: "vedoucí" | "recepce" | "portýři";
  primaryShiftType: "D" | "N" | "R" | null;
  primaryHotel: string | null;
  displayOrder: number;
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

export interface PlanDetail {
  id: string;
  month: number;
  year: number;
  status: "draft" | "open" | "published";
  createdBy: string;
  employees: PlanEmployee[];
  shifts: ShiftDoc[];
}

interface PlanListItem {
  id: string;
  month: number;
  year: number;
  status: "draft" | "open" | "published";
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "Leden", "Únor", "Březen", "Duben", "Květen", "Červen",
  "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec",
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: "draft" | "open" | "published" }) {
  const map = { draft: "Koncept", open: "Otevřený", published: "Publikovaný" };
  return (
    <span className={`${styles.badge} ${styles[`badge_${status}`]}`}>
      {map[status]}
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
  const [actionLoading, setActionLoading] = useState(false);

  const canEdit = role === "admin" || role === "director" || role === "manager";
  const canPublish = role === "admin" || role === "director";

  // ── Load plan for selected month/year ──────────────────────────────────────

  useEffect(() => {
    setLoading(true);
    setError(null);
    setPlan(null);

    api
      .get<PlanListItem[]>("/shifts/plans")
      .then((plans) => {
        const match = plans.find(
          (p) => p.month === selectedMonth && p.year === selectedYear
        );
        if (!match) {
          setLoading(false);
          return;
        }
        return api.get<PlanDetail>(`/shifts/plans/${match.id}`).then((detail) => {
          setPlan(detail);
        });
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [selectedMonth, selectedYear]);

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
      const detail = await api.get<PlanDetail>(`/shifts/plans/${id}`);
      setPlan(detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba při vytváření plánu");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleTransitionStatus(newStatus: "open" | "published") {
    if (!plan) return;
    setActionLoading(true);
    try {
      await api.patch(`/shifts/plans/${plan.id}`, { status: newStatus });
      setPlan((prev) => (prev ? { ...prev, status: newStatus } : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba při změně stavu");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDeletePlan() {
    if (!plan) return;
    if (!window.confirm("Opravdu smazat tento plán? Tato akce je nevratná.")) return;
    setActionLoading(true);
    try {
      await api.delete(`/shifts/plans/${plan.id}`);
      setPlan(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba při mazání plánu");
    } finally {
      setActionLoading(false);
    }
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
    } else {
      await api.put(`/shifts/plans/${plan.id}/shifts/${employeeId}/${date}`, { rawInput });
      const parsed = parseShiftExpression(rawInput);
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
              <button
                className={styles.primaryBtn}
                onClick={handleCreatePlan}
                disabled={actionLoading}
              >
                Vytvořit plán
              </button>
            )}

            {/* Open plan */}
            {plan?.status === "draft" && canEdit && (
              <button
                className={styles.primaryBtn}
                onClick={() => handleTransitionStatus("open")}
                disabled={actionLoading}
              >
                Otevřít plán
              </button>
            )}

            {/* Publish plan */}
            {plan?.status === "open" && canPublish && (
              <button
                className={styles.primaryBtn}
                onClick={() => handleTransitionStatus("published")}
                disabled={actionLoading}
              >
                Publikovat
              </button>
            )}

            {/* Add employee */}
            {plan && plan.status !== "published" && canEdit && (
              <button
                className={styles.secondaryBtn}
                onClick={() => setShowAddEmployee(true)}
              >
                + Přidat zaměstnance
              </button>
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

            {/* Delete plan (admin, draft only) */}
            {plan?.status === "draft" && role === "admin" && (
              <button
                className={styles.dangerBtn}
                onClick={handleDeletePlan}
                disabled={actionLoading}
              >
                Smazat plán
              </button>
            )}
          </div>

          {/* Unavailability panel */}
          {plan && showUnavailability && (
            <UnavailabilityPanel planId={plan.id} />
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
              readOnly={plan.status === "published" || !canEdit}
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
    </div>
  );
}
