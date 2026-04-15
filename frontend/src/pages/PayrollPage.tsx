import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Navigate } from "react-router-dom";
import styles from "./PayrollPage.module.css";

// ─── Types ────────────────────────────────────────────────────────────────────

type OverrideField =
  | "totalHours"
  | "reportHours"
  | "vacationHours"
  | "nightHours"
  | "holidayHours"
  | "weekendHours"
  | "extraPay"
  | "foodVouchers"
  | "dppAmount";

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
  dppAmount: number | null;
  overrides?: Partial<Record<OverrideField, number>>;
}

interface PayrollPeriod {
  id: string;
  year: number;
  month: number;
  baseHours: number;
  maxNightHours: number;
  maxHolidayHours: number;
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

// ─── Editable cell ────────────────────────────────────────────────────────────

function EditableCell({
  computed,
  override,
  editable,
  onSave,
  masked = false,
  forceVisible = false,
}: {
  computed: number;
  override: number | undefined;
  editable: boolean;
  onSave: (value: number | null) => Promise<void>;
  masked?: boolean;
  forceVisible?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isOverridden = override !== undefined;
  const displayValue = isOverridden ? override! : computed;
  const effectivelyVisible = visible || forceVisible;

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  async function commit() {
    const trimmed = draft.trim();
    if (trimmed === "") {
      // Empty → clear override
      if (isOverridden) await onSave(null);
      setEditing(false);
      return;
    }
    const num = Number(trimmed);
    if (isNaN(num) || num < 0) {
      setEditing(false);
      return;
    }
    if (num === computed) {
      // Set back to computed → clear override
      if (isOverridden) await onSave(null);
    } else if (num !== displayValue) {
      await onSave(num);
    }
    setEditing(false);
  }

  function cancel() {
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={styles.editInput}
        type="number"
        min="0"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { e.preventDefault(); cancel(); }
        }}
      />
    );
  }

  const classes = [styles.cellValue];
  if (isOverridden) classes.push(styles.overridden);
  if (editable) classes.push(styles.editable);

  const title = isOverridden
    ? `Upraveno (automaticky: ${computed})${editable ? " · dvojklik pro úpravu" : ""}`
    : editable ? "Dvojklik pro úpravu" : "";

  if (masked) {
    return (
      <span
        className={classes.join(" ") + " " + styles.maskedCell}
        onDoubleClick={() => {
          if (!editable) return;
          setDraft(String(displayValue));
          setEditing(true);
        }}
        title={title}
      >
        {effectivelyVisible ? (displayValue === 0 ? "—" : displayValue.toLocaleString("cs-CZ")) : "•••••"}
        {!forceVisible && (
          <button
            type="button"
            className={styles.revealBtn}
            onClick={(e) => { e.stopPropagation(); setVisible((v) => !v); }}
          >
            {visible ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        )}
      </span>
    );
  }

  return (
    <span
      className={classes.join(" ")}
      onDoubleClick={() => {
        if (!editable) return;
        setDraft(String(displayValue));
        setEditing(true);
      }}
      title={title}
    >
      {displayValue === 0 ? "—" : displayValue.toLocaleString("cs-CZ")}
    </span>
  );
}

// ─── Sick leave modal ────────────────────────────────────────────────────────

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
  const [showAllNavic, setShowAllNavic] = useState(false);

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

  const canEdit = role === "admin" || role === "director";

  function prevMonth() {
    if (selectedMonth === 1) { setSelectedYear((y) => y - 1); setSelectedMonth(12); }
    else setSelectedMonth((m) => m - 1);
  }
  function nextMonth() {
    if (selectedMonth === 12) { setSelectedYear((y) => y + 1); setSelectedMonth(1); }
    else setSelectedMonth((m) => m + 1);
  }

  async function saveOverride(entryId: string, field: OverrideField, value: number | null) {
    if (!period) return;
    const entry = period.entries.find((e) => e.id === entryId);
    if (!entry) return;
    const newOverrides = { ...(entry.overrides ?? {}) };
    if (value === null) delete newOverrides[field];
    else newOverrides[field] = value;
    await api.patch(`/payroll/periods/${period.id}/entries/${entryId}`, {
      overrides: newOverrides,
    });
    setPeriod((prev) => prev ? {
      ...prev,
      entries: prev.entries.map((e) =>
        e.id === entryId ? { ...e, overrides: newOverrides } : e
      ),
    } : prev);
  }

  // Group entries by section (matching shift plan order)
  const entriesBySection = (section: string) =>
    period?.entries.filter((e) => e.section === section) ?? [];

  function renderSection(section: string) {
    const entries = entriesBySection(section);
    if (entries.length === 0) return null;
    return (
      <>
        <tr key={`section-${section}`} className={styles.sectionRow}>
          <td colSpan={10}>{SECTION_LABELS[section] ?? section}</td>
        </tr>
        {entries.map((entry) => {
          const isDpp = entry.contractType === "DPP";
          const isPpp = entry.contractType === "PPP";
          const ov = entry.overrides ?? {};
          const sick = entry.sickLeaveHours ?? 0;
          const rowClass = isDpp ? styles.dppRow : isPpp ? styles.pppRow : "";
          return (
            <tr key={entry.id} className={rowClass}>
              <td className={styles.nameCell}>
                {entry.lastName} {entry.firstName}
                {entry.contractType && (
                  <span className={styles.contractBadge}>{entry.contractType}</span>
                )}
              </td>
              <td className={styles.numCell}>
                <EditableCell
                  computed={entry.totalHours}
                  override={ov.totalHours}
                  editable={canEdit}
                  onSave={(v) => saveOverride(entry.id, "totalHours", v)}
                />
              </td>
              <td className={styles.numCell}>
                {isDpp ? <span className={styles.dash}>—</span> : (
                  <EditableCell
                    computed={entry.reportHours}
                    override={ov.reportHours}
                    editable={canEdit}
                    onSave={(v) => saveOverride(entry.id, "reportHours", v)}
                  />
                )}
              </td>
              <td className={styles.numCell}>
                {isDpp ? <span className={styles.dash}>—</span> : (
                  <span className={styles.vacationWrap}>
                    <span className={styles.vacationInline}>
                      <EditableCell
                        computed={entry.vacationHours}
                        override={ov.vacationHours}
                        editable={canEdit}
                        onSave={(v) => saveOverride(entry.id, "vacationHours", v)}
                      />
                      {canEdit && (
                        <button
                          type="button"
                          className={styles.nemocBtn}
                          onClick={() => setSickModal(entry)}
                          title="Upravit hodiny nemoci"
                        >
                          ✎
                        </button>
                      )}
                    </span>
                    {sick > 0 && (
                      <>
                        <br />
                        <span className={styles.nemocBadge}>{sick} NEMOC</span>
                      </>
                    )}
                  </span>
                )}
              </td>
              <td className={styles.numCell}>
                {isDpp ? <span className={styles.dash}>—</span> : (
                  <EditableCell
                    computed={entry.nightHours}
                    override={ov.nightHours}
                    editable={canEdit}
                    onSave={(v) => saveOverride(entry.id, "nightHours", v)}
                  />
                )}
              </td>
              <td className={styles.numCell}>
                {isDpp ? <span className={styles.dash}>—</span> : (
                  <EditableCell
                    computed={entry.holidayHours}
                    override={ov.holidayHours}
                    editable={canEdit}
                    onSave={(v) => saveOverride(entry.id, "holidayHours", v)}
                  />
                )}
              </td>
              <td className={styles.numCell}>
                {isDpp ? <span className={styles.dash}>—</span> : (
                  <EditableCell
                    computed={entry.weekendHours}
                    override={ov.weekendHours}
                    editable={canEdit}
                    onSave={(v) => saveOverride(entry.id, "weekendHours", v)}
                  />
                )}
              </td>
              <td className={styles.numCell}>
                {isDpp ? (
                  <EditableCell
                    computed={entry.dppAmount ?? 0}
                    override={ov.dppAmount}
                    editable={canEdit}
                    onSave={(v) => saveOverride(entry.id, "dppAmount", v)}
                  />
                ) : <span className={styles.dash}>—</span>}
              </td>
              <td className={styles.numCell}>
                {isDpp ? <span className={styles.dash}>—</span> : (
                  <EditableCell
                    computed={entry.extraPay}
                    override={ov.extraPay}
                    editable={canEdit}
                    onSave={(v) => saveOverride(entry.id, "extraPay", v)}
                    masked={true}
                    forceVisible={showAllNavic}
                  />
                )}
              </td>
              <td className={styles.numCell}>
                {isDpp ? <span className={styles.dash}>—</span> : (
                  <EditableCell
                    computed={entry.foodVouchers}
                    override={ov.foodVouchers}
                    editable={canEdit}
                    onSave={(v) => saveOverride(entry.id, "foodVouchers", v)}
                  />
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
            <span className={styles.metaItem}>
              <span className={styles.metaLabel}>Základ:</span>{" "}
              <strong>{period.baseHours}</strong>
            </span>
            <span className={styles.metaItem}>
              <span className={styles.metaLabel}>Max. nočních hodin:</span>{" "}
              <strong>{period.maxNightHours}</strong>
            </span>
            <span className={styles.metaItem}>
              <span className={styles.metaLabel}>Max. svátků:</span>{" "}
              <strong>{period.maxHolidayHours}</strong>
            </span>
            <span className={styles.metaItem}>
              <span className={styles.metaLabel}>Stravenky:</span>{" "}
              <strong>{period.foodVoucherRate.toLocaleString("cs-CZ")} Kč/den</strong>
            </span>
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
                  <th className={styles.numHeader}>
                    <span className={styles.navicHeaderInner}>
                      NAVÍC
                      <button
                        type="button"
                        className={styles.navicRevealBtn}
                        onClick={() => setShowAllNavic((v) => !v)}
                        title={showAllNavic ? "Skrýt všechny" : "Zobrazit všechny"}
                      >
                        {showAllNavic ? <EyeOffIcon /> : <EyeIcon />}
                      </button>
                    </span>
                  </th>
                  <th className={styles.numHeader}>STRAVENKY</th>
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
