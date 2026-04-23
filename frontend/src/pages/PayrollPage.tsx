import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Navigate } from "react-router-dom";
import PayrollNotesModal from "./PayrollNotesModal";
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

export interface PayrollNote {
  id: string;
  sourceNoteId: string;
  text: string;
  carryForward: boolean;
  createdBy: string;
  createdByName: string;
  createdAt: { seconds?: number; _seconds?: number } | null;
  editedBy?: string;
  editedByName?: string;
  editedAt?: { seconds?: number; _seconds?: number } | null;
}

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
  autoOverrides?: Partial<Record<OverrideField, number>>;
  multisportActive?: boolean;
  notes?: PayrollNote[];
}

interface PayrollPeriod {
  id: string;
  year: number;
  month: number;
  baseHours: number;
  maxNightHours: number;
  maxHolidayHours: number;
  foodVoucherRate: number;
  locked?: boolean;
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

// ─── Cascade computation ──────────────────────────────────────────────────────
// MIRROR: keep in sync with cascade block in functions/src/services/payrollCalculator.ts

function computeCascades(
  entry: PayrollEntry,
  baseHours: number,
  maxHolidayHours: number,
  trigger: "reportHours" | "sickLeaveHours",
  newValue: number
): Partial<Record<OverrideField, number>> {
  const userOv = entry.overrides ?? {};
  const newAutoOv: Partial<Record<OverrideField, number>> = { ...(entry.autoOverrides ?? {}) };
  const isDpp = entry.contractType === "DPP";

  // Resolve effective values before this change
  let effReport = userOv.reportHours ?? entry.autoOverrides?.reportHours ?? entry.reportHours;
  let effVacation = userOv.vacationHours ?? entry.autoOverrides?.vacationHours ?? entry.vacationHours;
  let effExtraPay = userOv.extraPay ?? entry.autoOverrides?.extraPay ?? entry.extraPay;
  // Track extra hours directly to avoid rounding errors in NAVÍC→SVÁTEK transfer
  let effExtraHours = Math.max(0, entry.totalHours - baseHours);

  if (trigger === "reportHours" && !isDpp) {
    effReport = newValue;
    // Cascade Výkaz → Dovolená
    if (userOv.vacationHours === undefined) {
      const cv = entry.contractType === "HPP"
        ? Math.max(0, baseHours - effReport)
        : Math.max(0, baseHours / 2 - effReport);
      newAutoOv.vacationHours = cv;
      effVacation = cv;
    }
    // Cascade Výkaz → NAVÍC (when Hodiny > new Výkaz)
    if (entry.totalHours > effReport && entry.hourlyRate && entry.hourlyRate > 0
      && userOv.extraPay === undefined) {
      effExtraHours = entry.totalHours - effReport;
      const cp = entry.hourlyRate * effExtraHours;
      newAutoOv.extraPay = cp;
      effExtraPay = cp;
    } else if (userOv.extraPay === undefined) {
      // Výkaz raised above Hodiny — clear any cascaded NAVÍC
      effExtraHours = 0;
      delete newAutoOv.extraPay;
      effExtraPay = entry.extraPay;
    }
  }

  if (trigger === "sickLeaveHours" && !isDpp) {
    const nemoc = newValue;
    const ded = Math.min(nemoc, effVacation);
    // Cascade Nemoc → Dovolená
    if (userOv.vacationHours === undefined) {
      newAutoOv.vacationHours = effVacation - ded;
      effVacation -= ded;
    }
    const rem = nemoc - ded;
    // Cascade excess Nemoc → Výkaz → NAVÍC
    if (rem > 0 && userOv.reportHours === undefined) {
      newAutoOv.reportHours = Math.max(0, effReport - rem);
      effReport = newAutoOv.reportHours;
      if (entry.hourlyRate && entry.hourlyRate > 0 && userOv.extraPay === undefined) {
        effExtraHours += rem;
        newAutoOv.extraPay = ((newAutoOv.extraPay as number | undefined) ?? effExtraPay)
          + entry.hourlyRate * rem;
        effExtraPay = newAutoOv.extraPay as number;
      }
    } else if (userOv.reportHours === undefined) {
      // Nemoc fully covered by Dovolená — clear any cascaded Výkaz deduction
      delete newAutoOv.reportHours;
    }
  }

  // NAVÍC → SVÁTEK transfer (runs after both triggers)
  // Use effExtraHours (exact) not effExtraPay/hourlyRate (rounded) to avoid over-transfer.
  if (
    effExtraHours > 0 &&
    entry.holidayHours < maxHolidayHours &&
    entry.hourlyRate && entry.hourlyRate > 0 &&
    userOv.holidayHours === undefined
  ) {
    const availableHolHours = maxHolidayHours - entry.holidayHours;
    const transferH = Math.min(effExtraHours, availableHolHours);
    if (transferH > 0) {
      newAutoOv.holidayHours = entry.holidayHours + transferH;
      if (userOv.extraPay === undefined) {
        const remainingExtraHours = effExtraHours - transferH;
        newAutoOv.extraPay = remainingExtraHours > 0
          ? entry.hourlyRate * remainingExtraHours
          : 0;
      }
    }
  } else if (userOv.holidayHours === undefined) {
    delete newAutoOv.holidayHours;
  }

  return newAutoOv;
}

// ─── NAVÍC tiered display ─────────────────────────────────────────────────────

function formatNavic(extraPay: number): React.ReactNode {
  if (!extraPay || extraPay <= 0) return "—";
  if (extraPay < 5000) {
    const displayed = Math.ceil(extraPay / 0.85 / 100) * 100;
    return displayed.toLocaleString("cs-CZ");
  }
  if (extraPay === 5000) {
    return (6000).toLocaleString("cs-CZ");
  }
  // extraPay > 5000: two stacked lines in a column wrapper
  return (
    <span className={styles.navicStack}>
      <span>{(6000).toLocaleString("cs-CZ")}</span>
      <span>{(extraPay - 5000).toLocaleString("cs-CZ")}</span>
    </span>
  );
}

// ─── Editable cell ────────────────────────────────────────────────────────────

function EditableCell({
  computed,
  override,
  autoOverride,
  editable,
  onSave,
  masked = false,
  forceVisible = false,
  renderValue,
}: {
  computed: number;
  override: number | undefined;
  autoOverride?: number;
  editable: boolean;
  onSave: (value: number | null) => Promise<void>;
  masked?: boolean;
  forceVisible?: boolean;
  renderValue?: (value: number) => React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isUserOverridden = override !== undefined;
  const isAutoOverridden = !isUserOverridden && autoOverride !== undefined;
  const displayValue = override ?? autoOverride ?? computed;
  const effectivelyVisible = visible || forceVisible;

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  async function commit() {
    const trimmed = draft.trim().replace(",", ".");
    if (trimmed === "") {
      if (isUserOverridden) await onSave(null);
      setEditing(false);
      return;
    }
    const num = Number(trimmed);
    if (isNaN(num) || num < 0) {
      setEditing(false);
      return;
    }
    if (num === computed) {
      if (isUserOverridden) await onSave(null);
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
        type="text"
        inputMode="decimal"
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
  if (isUserOverridden) classes.push(styles.overridden);
  else if (isAutoOverridden) classes.push(styles.autoOverridden);
  if (editable) classes.push(styles.editable);

  const title = isUserOverridden
    ? `Ručně upraveno (vypočteno: ${computed})${editable ? " · dvojklik pro úpravu" : ""}`
    : isAutoOverridden
      ? `Automaticky dopočítáno (vypočteno: ${computed})${editable ? " · dvojklik pro úpravu" : ""}`
      : editable ? "Dvojklik pro úpravu" : "";

  const renderedValue = renderValue
    ? renderValue(displayValue)
    : (displayValue === 0 ? "—" : displayValue.toLocaleString("cs-CZ"));

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
        {effectivelyVisible ? renderedValue : "•••••"}
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
      {renderedValue}
    </span>
  );
}

// ─── Sick leave modal ────────────────────────────────────────────────────────

function SickLeaveModal({
  entry,
  onClose,
  onSave,
}: {
  entry: PayrollEntry;
  onClose: () => void;
  onSave: (hours: number) => Promise<void>;
}) {
  const [hours, setHours] = useState(String(entry.sickLeaveHours ?? 0));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const h = Number(hours.trim().replace(",", "."));
    if (isNaN(h) || h < 0) { setError("Neplatný počet hodin."); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave(h);
      onClose();
    } catch (e) {
      setError((e as Error).message ?? "Chyba při ukládání.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <span className={styles.modalTitle}>Nemoc — {entry.lastName} {entry.firstName}</span>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>
        <div className={styles.modalBody}>
          <label className={styles.modalLabel}>Hodiny nemoci (NEMOC)</label>
          <input
            className={styles.modalInput}
            type="text"
            inputMode="decimal"
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
  const [notesModal, setNotesModal] = useState<PayrollEntry | null>(null);
  const [showAllNavic, setShowAllNavic] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState(false);

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

  const isLocked = period?.locked === true;
  const canEdit = (role === "admin" || role === "director") && !isLocked;
  const canToggleLock = role === "admin";

  async function toggleLock() {
    if (!period) return;
    const next = !isLocked;
    const confirmMsg = next
      ? "Uzamknout mzdové období? Úpravy budou zablokovány."
      : "Odemknout mzdové období? Úpravy budou povoleny.";
    if (!window.confirm(confirmMsg)) return;
    try {
      await api.patch(`/payroll/periods/${period.id}`, { locked: next });
      setPeriod((prev) => prev ? { ...prev, locked: next } : prev);
    } catch (e) {
      setError((e as Error).message ?? "Chyba při uzamykání.");
    }
  }

  async function handleCreatePeriod() {
    if (creating) return;
    if (!window.confirm(
      `Vytvořit mzdy pro ${MONTH_NAMES[selectedMonth - 1]} ${selectedYear}? ` +
      `Pro tento měsíc musí existovat publikovaný směnný plán.`
    )) return;
    setCreating(true);
    setError(null);
    try {
      await api.post(`/payroll/periods/by-month/${selectedYear}/${selectedMonth}`, {});
      await loadPeriod();
    } catch (e) {
      setError((e as Error).message ?? "Chyba při vytváření mzdového období.");
    } finally {
      setCreating(false);
    }
  }

  async function recalculate() {
    if (!period || recalculating) return;
    if (!window.confirm("Přepočítat mzdy pro toto období? Ruční úpravy (overrides) zůstanou zachovány.")) return;
    setRecalculating(true);
    setError(null);
    try {
      await api.post(`/payroll/periods/${period.id}/recalculate`, {});
      await loadPeriod();
    } catch (e) {
      setError((e as Error).message ?? "Chyba při přepočtu.");
    } finally {
      setRecalculating(false);
    }
  }

  async function handleExportPdf() {
    if (!period || exporting) return;
    setExporting(true);
    setError(null);
    try {
      const html2pdf = (await import("html2pdf.js" as string)).default;

      const effNum = (e: PayrollEntry, field: OverrideField): number => {
        const ov = e.overrides?.[field];
        if (ov !== undefined) return ov;
        const ao = e.autoOverrides?.[field];
        if (ao !== undefined) return ao;
        const raw = (e as unknown as Record<string, unknown>)[field];
        return typeof raw === "number" ? raw : 0;
      };
      const fmt = (n: number) => (n === 0 ? "—" : n.toLocaleString("cs-CZ"));
      const navicText = (extraPay: number): string => {
        if (!extraPay || extraPay <= 0) return "—";
        if (extraPay < 5000) return (Math.ceil(extraPay / 0.85 / 100) * 100).toLocaleString("cs-CZ");
        if (extraPay === 5000) return (6000).toLocaleString("cs-CZ");
        return `${(6000).toLocaleString("cs-CZ")}<br>${(extraPay - 5000).toLocaleString("cs-CZ")}`;
      };

      const cs = {
        cell: "padding:2px 3px;text-align:center;font-size:7.5pt;font-family:Arial,sans-serif;border:1px solid #d1d5db;line-height:1.25;",
        nameCell: "padding:2px 5px;font-size:7.5pt;white-space:nowrap;border:1px solid #d1d5db;text-align:left;",
        header: "padding:3px 3px;text-align:center;font-size:7pt;font-weight:700;border:1px solid #d1d5db;background:#f3f4f6;line-height:1.2;",
        sectionRow: "padding:3px 5px;font-size:7.5pt;font-weight:700;text-transform:uppercase;background:#e5e7eb;border:1px solid #d1d5db;",
        badge: "display:inline-block;margin-left:4px;padding:0 4px;border:1px solid #d1d5db;border-radius:8px;font-size:6.5pt;color:#4b5563;background:#f3f4f6;",
        nemoc: "display:inline-block;margin-top:1px;padding:0 3px;background:#fef3c7;color:#92400e;border-radius:3px;font-size:6.5pt;font-weight:600;",
      };

      let rowsHtml = "";
      for (const section of SECTIONS) {
        const entries = period.entries.filter((e) => e.section === section);
        if (entries.length === 0) continue;
        rowsHtml += `<tr><td colspan="11" style="${cs.sectionRow}">${SECTION_LABELS[section] ?? section}</td></tr>`;
        for (const entry of entries) {
          const isDpp = entry.contractType === "DPP";
          const nameHtml = entry.contractType
            ? `${entry.lastName} ${entry.firstName}<span style="${cs.badge}">${entry.contractType}</span>`
            : `${entry.lastName} ${entry.firstName}`;
          const hours = effNum(entry, "totalHours");
          const report = effNum(entry, "reportHours");
          const vacation = effNum(entry, "vacationHours");
          const sick = entry.sickLeaveHours ?? 0;
          const night = effNum(entry, "nightHours");
          const holiday = effNum(entry, "holidayHours");
          const weekend = effNum(entry, "weekendHours");
          const extraPay = effNum(entry, "extraPay");
          const foodVouchers = effNum(entry, "foodVouchers");
          const dppAmount = entry.overrides?.dppAmount ?? entry.dppAmount ?? 0;

          const vacationCell = isDpp
            ? "—"
            : (sick > 0
              ? `${fmt(vacation)}<div style="${cs.nemoc}">${sick} NEMOC</div>`
              : fmt(vacation));

          rowsHtml += "<tr>";
          rowsHtml += `<td style="${cs.nameCell}">${nameHtml}</td>`;
          rowsHtml += `<td style="${cs.cell}">${fmt(hours)}</td>`;
          rowsHtml += `<td style="${cs.cell}">${isDpp ? "—" : fmt(report)}</td>`;
          rowsHtml += `<td style="${cs.cell}">${vacationCell}</td>`;
          rowsHtml += `<td style="${cs.cell}">${isDpp ? "—" : fmt(night)}</td>`;
          rowsHtml += `<td style="${cs.cell}">${isDpp ? "—" : fmt(holiday)}</td>`;
          rowsHtml += `<td style="${cs.cell}">${isDpp ? "—" : fmt(weekend)}</td>`;
          rowsHtml += `<td style="${cs.cell}">${isDpp ? fmt(dppAmount) : "—"}</td>`;
          rowsHtml += `<td style="${cs.cell}">${isDpp ? "—" : navicText(extraPay)}</td>`;
          rowsHtml += `<td style="${cs.cell}">${isDpp ? "—" : fmt(foodVouchers)}</td>`;
          rowsHtml += `<td style="${cs.cell}">${entry.multisportActive ? "ANO" : "—"}</td>`;
          rowsHtml += "</tr>";
        }
      }

      const headerHtml = `<tr>
        <th style="${cs.header}text-align:left;">Zaměstnanec</th>
        <th style="${cs.header}">HODINY</th>
        <th style="${cs.header}">VÝKAZ</th>
        <th style="${cs.header}">DOVOLENÁ</th>
        <th style="${cs.header}">NOČNÍ</th>
        <th style="${cs.header}">SVÁTEK</th>
        <th style="${cs.header}">SO+NE</th>
        <th style="${cs.header}">DPP/FAKT.</th>
        <th style="${cs.header}">NAVÍC</th>
        <th style="${cs.header}">STRAVENKY</th>
        <th style="${cs.header}">MULTISPORT</th>
      </tr>`;

      const fullHtml = `
        <div style="font-family:Arial,sans-serif;color:#111827;background:#fff;">
          <h2 style="margin:0 0 6px 0;font-size:12pt;">Mzdy — ${MONTH_NAMES[period.month - 1]} ${period.year}</h2>
          <div style="font-size:8pt;color:#6b7280;margin-bottom:6px;">
            Základ: <strong>${period.baseHours}</strong> &nbsp;·&nbsp;
            Max. nočních: <strong>${period.maxNightHours}</strong> &nbsp;·&nbsp;
            Max. svátků: <strong>${period.maxHolidayHours}</strong> &nbsp;·&nbsp;
            Stravenka: <strong>${period.foodVoucherRate.toLocaleString("cs-CZ")} Kč/den</strong>
          </div>
          <table style="border-collapse:collapse;width:100%;table-layout:auto;">
            <thead>${headerHtml}</thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>`;

      const wrapper = document.createElement("div");
      wrapper.innerHTML = fullHtml;
      document.body.appendChild(wrapper);

      const pad2 = (n: number) => String(n).padStart(2, "0");
      const yy = pad2(period.year % 100);
      const filename = `HPM_MZDY_${yy}${pad2(period.month)}.pdf`;

      await html2pdf().set({
        margin: [6, 6, 6, 6],
        filename,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, windowWidth: 1100 },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        pagebreak: { mode: ["avoid-all"] },
      }).from(wrapper.firstElementChild).save();

      document.body.removeChild(wrapper);
    } catch (e) {
      setError((e as Error).message ?? "Chyba při exportu PDF.");
    } finally {
      setExporting(false);
    }
  }

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

    // Compute cascades when Výkaz is changed
    let newAutoOverrides: Partial<Record<OverrideField, number>> = entry.autoOverrides ?? {};
    if (field === "reportHours") {
      if (value !== null) {
        newAutoOverrides = computeCascades(entry, period.baseHours, period.maxHolidayHours, "reportHours", value);
      } else {
        // User cleared the Výkaz override — clear all cascade autoOverrides
        newAutoOverrides = {};
      }
    }

    await api.patch(`/payroll/periods/${period.id}/entries/${entryId}`, {
      overrides: newOverrides,
      autoOverrides: newAutoOverrides,
    });
    setPeriod((prev) => prev ? {
      ...prev,
      entries: prev.entries.map((e) =>
        e.id === entryId ? { ...e, overrides: newOverrides, autoOverrides: newAutoOverrides } : e
      ),
    } : prev);
  }

  async function saveSickLeave(entry: PayrollEntry, hours: number) {
    if (!period) return;
    const newAutoOverrides = computeCascades(entry, period.baseHours, period.maxHolidayHours, "sickLeaveHours", hours);
    await api.patch(`/payroll/periods/${period.id}/entries/${entry.id}`, {
      sickLeaveHours: hours,
      autoOverrides: newAutoOverrides,
    });
    setPeriod((prev) => prev ? {
      ...prev,
      entries: prev.entries.map((e) =>
        e.id === entry.id ? { ...e, sickLeaveHours: hours, autoOverrides: newAutoOverrides } : e
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
          <td colSpan={12}>{SECTION_LABELS[section] ?? section}</td>
        </tr>
        {entries.map((entry) => {
          const isDpp = entry.contractType === "DPP";
          const isPpp = entry.contractType === "PPP";
          const ov = entry.overrides ?? {};
          const ao = entry.autoOverrides ?? {};
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
                    autoOverride={ao.reportHours}
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
                        autoOverride={ao.vacationHours}
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
                    autoOverride={ao.holidayHours}
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
                    autoOverride={ao.extraPay}
                    editable={canEdit}
                    onSave={(v) => saveOverride(entry.id, "extraPay", v)}
                    masked={true}
                    forceVisible={showAllNavic}
                    renderValue={formatNavic}
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
              <td className={styles.numCell}>
                {entry.multisportActive ? "ANO" : <span className={styles.dash}>—</span>}
              </td>
              <td className={styles.numCell}>
                {(entry.notes?.length ?? 0) > 0 ? (
                  <button
                    type="button"
                    className={styles.notesBadge}
                    onClick={() => setNotesModal(entry)}
                    title="Zobrazit poznámky"
                  >
                    {entry.notes!.length}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.notesDashBtn}
                    onClick={() => setNotesModal(entry)}
                    title="Přidat poznámku"
                    disabled={!canEdit}
                  >
                    <span className={styles.dash}>—</span>
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
          <br />
          <button
            type="button"
            className={styles.lockBtn}
            onClick={handleCreatePeriod}
            disabled={creating}
            style={{ marginTop: "1rem" }}
            title="Vytvořit mzdové období z již publikovaného směnného plánu pro tento měsíc"
          >
            {creating ? "Vytvářím…" : "Vytvořit mzdy ručně"}
          </button>
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
            <span className={styles.metaItem}>
              {isLocked && <span className={styles.lockedBadge}>🔒 Uzamčeno</span>}
              {!isLocked && (
                <button
                  type="button"
                  className={styles.lockBtn}
                  onClick={recalculate}
                  disabled={recalculating}
                  title="Přepočítat mzdy podle aktuálního směnného plánu a nastavení"
                >
                  {recalculating ? "Přepočítávám…" : "Přepočítat"}
                </button>
              )}
              <button
                type="button"
                className={styles.lockBtn}
                onClick={handleExportPdf}
                disabled={exporting}
                title="Exportovat mzdy do PDF"
              >
                {exporting ? "Exportuji…" : "Exportovat PDF"}
              </button>
              {canToggleLock && (
                <button
                  type="button"
                  className={styles.lockBtn}
                  onClick={toggleLock}
                  title={isLocked ? "Odemknout období pro úpravy" : "Uzamknout období (zablokovat úpravy)"}
                >
                  {isLocked ? "Odemknout" : "Uzamknout"}
                </button>
              )}
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
                  <th className={styles.numHeader}>MULTISPORT</th>
                  <th className={styles.numHeader}>POZNÁMKY</th>
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
          onClose={() => setSickModal(null)}
          onSave={(h) => saveSickLeave(sickModal, h)}
        />
      )}

      {notesModal && period && (
        <PayrollNotesModal
          periodId={period.id}
          employeeId={notesModal.id}
          employeeLabel={`${notesModal.lastName} ${notesModal.firstName}`}
          notes={period.entries.find((e) => e.id === notesModal.id)?.notes ?? []}
          canEdit={canEdit}
          onClose={() => setNotesModal(null)}
          onChanged={loadPeriod}
        />
      )}
    </div>
  );
}
