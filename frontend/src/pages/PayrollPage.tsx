import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Navigate } from "react-router-dom";
import styles from "./PayrollPage.module.css";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PayrollEntry {
  id: string; // employeeId
  firstName: string;
  lastName: string;
  contractType: "HPP" | "PPP" | "DPP" | string;
  salary: number | null;
  hourlyRate: number | null;
  jobTitle: string;
  section: string;
  sickLeaveHours: number;
  totalHours: number;
  reportHours: number;
  vacationHours: number;
  nightHours: number;
  holidayHours: number;
  weekendHours: number;
  extraHours: number;
  extraPay: number;
  workingDays: number;
  foodVouchers: number;
  dppHours: number | null;
}

interface PayrollPeriod {
  id: string;
  year: number;
  month: number;
  baseHours: number;
  foodVoucherRate: number;
  entries: PayrollEntry[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "Leden", "Únor", "Březen", "Duben", "Květen", "Červen",
  "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec",
];

const SECTIONS = ["vedoucí", "recepce", "portýři"] as const;
const SECTION_LABELS: Record<string, string> = {
  vedoucí: "Vedoucí",
  recepce: "Recepce",
  portýři: "Portýři",
};

// ─── Icons ────────────────────────────────────────────────────────────────────

const EyeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
  </svg>
);
const EyeOffIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
);

// ─── Sub-components ───────────────────────────────────────────────────────────

function MaskedCZK({ value }: { value: number }) {
  const [visible, setVisible] = useState(false);
  if (value === 0) return <span className={styles.zero}>—</span>;
  return (
    <span className={styles.maskedCell}>
      {visible ? value.toLocaleString("cs-CZ") + " Kč" : "•••••"}
      <button
        type="button"
        className={styles.revealBtn}
        onClick={() => setVisible((v) => !v)}
        title={visible ? "Skrýt" : "Zobrazit"}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </span>
  );
}

function SickLeaveModal({
  entry,
  periodId,
  onClose,
  onSaved,
}: {
  entry: PayrollEntry;
  periodId: string;
  onClose: () => void;
  onSaved: (employeeId: string, hours: number) => void;
}) {
  const [hours, setHours] = useState(String(entry.sickLeaveHours ?? 0));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const h = Number(hours);
    if (isNaN(h) || h < 0) { setError("Neplatný počet hodin."); return; }
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/payroll/periods/${periodId}/entries/${entry.id}`, { sickLeaveHours: h });
      onSaved(entry.id, h);
      onClose();
    } catch (e) {
      setError((e as Error).message ?? "Chyba při ukládání.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <span className={styles.modalTitle}>Nemoc — {entry.lastName} {entry.firstName}</span>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>
        <div className={styles.modalBody}>
          <label className={styles.modalLabel}>Hodiny nemoci (NEMOC)</label>
          <input
            className={styles.modalInput}
            type="number"
            min="0"
            step="1"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            autoFocus
          />
          {error && <div className={styles.modalError}>{error}</div>}
        </div>
        <div className={styles.modalActions}>
          <button className={styles.modalCancelBtn} onClick={onClose} disabled={saving}>Zrušit</button>
          <button className={styles.modalSaveBtn} onClick={handleSave} disabled={saving}>
            {saving ? "Ukládám…" : "Uložit"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PayrollPage() {
  const { role, loading: authLoading } = useAuth();

  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);

  const [period, setPeriod] = useState<PayrollPeriod | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sickModal, setSickModal] = useState<PayrollEntry | null>(null);

  const loadPeriod = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<PayrollPeriod | null>(
        `/payroll/periods/by-month/${selectedYear}/${selectedMonth}`
      );
      setPeriod(data);
    } catch (e) {
      setError((e as Error).message ?? "Chyba při načítání.");
      setPeriod(null);
    } finally {
      setLoading(false);
    }
  }, [selectedYear, selectedMonth]);

  useEffect(() => { loadPeriod(); }, [loadPeriod]);

  if (authLoading) return <div className={styles.state}>Načítám…</div>;
  if (role !== "admin" && role !== "director") return <Navigate to="/" replace />;

  function prevMonth() {
    if (selectedMonth === 1) { setSelectedYear((y) => y - 1); setSelectedMonth(12); }
    else setSelectedMonth((m) => m - 1);
  }
  function nextMonth() {
    if (selectedMonth === 12) { setSelectedYear((y) => y + 1); setSelectedMonth(1); }
    else setSelectedMonth((m) => m + 1);
  }

  // Group entries by section (matching shift plan order)
  const entriesBySection = (section: string) =>
    period?.entries.filter((e) => e.section === section) ?? [];

  function renderVacationCell(entry: PayrollEntry) {
    if (entry.contractType === "DPP") return <span className={styles.dash}>—</span>;
    const vacation = entry.vacationHours;
    const sick = entry.sickLeaveHours ?? 0;
    if (sick > 0) {
      return (
        <span>
          {vacation > sick ? <>{vacation - sick}h<br /></> : null}
          <span className={styles.nemocBadge}>{sick}h NEMOC</span>
        </span>
      );
    }
    return <span>{vacation > 0 ? `${vacation}h` : "0h"}</span>;
  }

  function renderSection(section: string) {
    const entries = entriesBySection(section);
    if (entries.length === 0) return null;
    return (
      <>
        <tr className={styles.sectionRow}>
          <td colSpan={11}>{SECTION_LABELS[section] ?? section}</td>
        </tr>
        {entries.map((entry) => {
          const isDpp = entry.contractType === "DPP";
          return (
            <tr key={entry.id} className={isDpp ? styles.dppRow : ""}>
              <td className={styles.nameCell}>
                {entry.lastName} {entry.firstName}
                <span className={styles.contractBadge}>{entry.contractType}</span>
              </td>
              <td className={styles.numCell}>{entry.totalHours}h</td>
              <td className={styles.numCell}>{isDpp ? <span className={styles.dash}>—</span> : `${entry.reportHours}h`}</td>
              <td className={styles.numCell}>{renderVacationCell(entry)}</td>
              <td className={styles.numCell}>{isDpp ? <span className={styles.dash}>—</span> : (entry.nightHours > 0 ? `${entry.nightHours}h` : "0h")}</td>
              <td className={styles.numCell}>{isDpp ? <span className={styles.dash}>—</span> : (entry.holidayHours > 0 ? `${entry.holidayHours}h` : "0h")}</td>
              <td className={styles.numCell}>{isDpp ? <span className={styles.dash}>—</span> : (entry.weekendHours > 0 ? `${entry.weekendHours}h` : "0h")}</td>
              <td className={styles.numCell}>{isDpp ? `${entry.dppHours ?? 0}h` : <span className={styles.dash}>—</span>}</td>
              <td className={styles.numCell}>{isDpp ? <span className={styles.dash}>—</span> : <MaskedCZK value={entry.extraPay} />}</td>
              <td className={styles.numCell}>{isDpp ? <span className={styles.dash}>—</span> : <MaskedCZK value={entry.foodVouchers} />}</td>
              <td className={styles.actionCell}>
                {!isDpp && (
                  <button
                    className={styles.editBtn}
                    onClick={() => setSickModal(entry)}
                    title="Upravit hodiny nemoci"
                  >
                    ✎
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className={styles.header}>
        <div />
        <div className={styles.monthNav}>
          <button className={styles.navBtn} onClick={prevMonth}>‹</button>
          <span className={styles.monthLabel}>{MONTH_NAMES[selectedMonth - 1]} {selectedYear}</span>
          <button className={styles.navBtn} onClick={nextMonth}>›</button>
        </div>
        <div />
      </div>

      {loading && <div className={styles.state}>Načítám…</div>}
      {error && <div className={styles.errorState}>{error}</div>}

      {!loading && !error && !period && (
        <div className={styles.emptyState}>
          Žádné mzdové období pro {MONTH_NAMES[selectedMonth - 1]} {selectedYear}.
          <br />
          <span className={styles.emptyHint}>Mzdy se generují automaticky po publikování směnného plánu.</span>
        </div>
      )}

      {!loading && !error && period && (
        <>
          <div className={styles.meta}>
            Základ: <strong>{period.baseHours}h</strong>
            &ensp;·&ensp;Stravenky: <strong>{period.foodVoucherRate.toLocaleString("cs-CZ")} Kč/den</strong>
          </div>
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.nameHeader}>Zaměstnanec</th>
                  <th className={styles.numHeader}>HODINY</th>
                  <th className={styles.numHeader}>VÝKAZ</th>
                  <th className={styles.numHeader}>DOVOLENÁ</th>
                  <th className={styles.numHeader}>NOČNÍ</th>
                  <th className={styles.numHeader}>SVÁTEK</th>
                  <th className={styles.numHeader}>SO+NE</th>
                  <th className={styles.numHeader}>DPP/FAKT.</th>
                  <th className={styles.numHeader}>NAVÍC</th>
                  <th className={styles.numHeader}>STRAVENKY</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {SECTIONS.map((s) => renderSection(s))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {sickModal && period && (
        <SickLeaveModal
          entry={sickModal}
          periodId={period.id}
          onClose={() => setSickModal(null)}
          onSaved={(empId, hours) => {
            setPeriod((prev) => prev ? {
              ...prev,
              entries: prev.entries.map((e) =>
                e.id === empId ? { ...e, sickLeaveHours: hours } : e
              ),
            } : prev);
          }}
        />
      )}
    </div>
  );
}
