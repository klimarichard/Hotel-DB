import { useState, useEffect, useCallback, useRef, type MouseEvent } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import * as clock from "@/lib/clock";
import { Navigate } from "react-router-dom";
import PayrollNotesModal from "./PayrollNotesModal";
import PayrollBalanceModal, { type BalanceSavePayload } from "./PayrollBalanceModal";
import PayrollRecalcModal from "./PayrollRecalcModal";
import { computeBalance } from "@/lib/payrollBalance";
import ConfirmModal from "@/components/ConfirmModal";
import { employeeDisplayName, employeeSurnameFirst } from "@/lib/employeeName";
import { escapeHtml } from "@/lib/escapeHtml";
import styles from "./PayrollPage.module.css";

// ─── Types ────────────────────────────────────────────────────────────────────

export type OverrideField =
  | "totalHours"
  | "reportHours"
  | "vacationHours"
  | "nightHours"
  | "holidayHours"
  | "weekendHours"
  | "extraPay"
  | "foodVouchers"
  | "dppAmount"
  | "baseHours";

export interface PayrollNote {
  id: string;
  sourceNoteId: string;
  text: string;
  carryForward: boolean;
  sourceYear?: number;
  sourceMonth?: number;
  createdBy: string;
  createdByName: string;
  createdAt: { seconds?: number; _seconds?: number } | null;
  editedBy?: string;
  editedByName?: string;
  editedAt?: { seconds?: number; _seconds?: number } | null;
  // Read-state (carried-forward notes): struck through in the month marked read.
  read?: boolean;
  readAt?: { seconds?: number; _seconds?: number } | null;
  readByName?: string;
  // System-generated notes (mid-month Nástup/Ukončení) – regenerated on every
  // recalc, so they're read-only in the UI.
  auto?: boolean;
  kind?: "nastup" | "ukonceni" | string;
}

export interface PayrollEntry {
  id: string; // employeeId
  firstName: string;
  lastName: string;
  displayName?: string;
  baseHours?: number; // effective per-employee norm (override ?? prorated mid-month); falls back to period.baseHours
  baseHoursNorm?: number; // prorated/full norm before any per-employee override
  hoursPerWeek?: number | null; // PPP úvazek – prorates the vacation target (#15 Part B)
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
  multisportPrice?: number;
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

// Display groups for the payroll table: managers stay in their own section on
// top; reception + porters are shown together as one section. The stored
// `section` value on each entry is unchanged – this is a display-only merge.
const SECTION_GROUPS: { label: string; sections: string[] }[] = [
  { label: "FOM", sections: ["vedoucí"] },
  { label: "Recepce a portýři", sections: ["recepce", "portýři"] },
];

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

// Výkaz / Dovolená / Nemoc / Základ are balanced together in PayrollBalanceModal
// via computeBalance() (lib/payrollBalance.ts), which mirrors the backend's
// calculateEntry. The old incremental computeCascades was removed – it broke the
// invariant on re-edit (lowering Nemoc left Dovolená stuck).

// ─── NAVÍC tiered display ─────────────────────────────────────────────────────

function formatNavic(extraPay: number): React.ReactNode {
  if (!extraPay || extraPay <= 0) return "–";
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
  onEditClick,
}: {
  computed: number;
  override: number | undefined;
  autoOverride?: number;
  editable: boolean;
  onSave: (value: number | null) => Promise<void>;
  masked?: boolean;
  forceVisible?: boolean;
  renderValue?: (value: number) => React.ReactNode;
  // When set, double-click delegates to this (e.g. open the balance dialog)
  // instead of inline editing. The cell still shows override/auto markers.
  onEditClick?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // The "natural" value a cell shows with NO user override = the auto-balanced
  // value if present, else the raw computed value. Edits are compared against
  // THIS (not raw `computed`) so you can set a field to a value the balancer
  // wouldn't pick (e.g. Svátek → 0 when it was auto-filled to 14), and so
  // editing a field back to its shown value reliably clears the override.
  const hasOverride = override !== undefined;
  const naturalValue = autoOverride ?? computed;
  const isUserOverridden = hasOverride && override !== naturalValue;
  const isAutoOverridden = !isUserOverridden && autoOverride !== undefined;
  const displayValue = override ?? autoOverride ?? computed;
  const effectivelyVisible = visible || forceVisible;

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  async function commit() {
    const trimmed = draft.trim().replace(",", ".");
    if (trimmed === "") {
      // Clearing the field restores the natural value.
      if (hasOverride) await onSave(null);
      setEditing(false);
      return;
    }
    const num = Number(trimmed);
    if (isNaN(num) || num < 0) {
      setEditing(false);
      return;
    }
    if (num === naturalValue) {
      // Typing the natural (auto/computed) value clears any override – including
      // a stale one that already equals it – so the cell reads as non-edited.
      if (hasOverride) await onSave(null);
    } else if (num !== override) {
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

  const handleDoubleClick = () => {
    if (!editable) return;
    if (onEditClick) { onEditClick(); return; }
    setDraft(String(displayValue));
    setEditing(true);
  };

  const title = isUserOverridden
    ? `Ručně upraveno (původně ${naturalValue})${editable ? " · dvojklik upraví, ↺ vrátí původní" : ""}`
    : isAutoOverridden
      ? `Automaticky dopočítáno (vypočteno: ${computed})${editable ? " · dvojklik pro úpravu" : ""}`
      : editable ? "Dvojklik pro úpravu" : "";

  // Explicit "restore original" – only for truly inline cells (onEditClick cells
  // delegate to the balance modal, whose own onSave is a no-op, so a reset glyph
  // there would do nothing).
  const showReset = editable && isUserOverridden && !onEditClick;
  const resetButton = showReset ? (
    <button
      type="button"
      className={styles.resetBtn}
      title="Vrátit původní hodnotu"
      onClick={(e) => { e.stopPropagation(); void onSave(null); }}
    >
      ↺
    </button>
  ) : null;

  const renderedValue = renderValue
    ? renderValue(displayValue)
    : (displayValue === 0 ? "–" : displayValue.toLocaleString("cs-CZ"));

  if (masked) {
    return (
      <span
        className={classes.join(" ") + " " + styles.maskedCell}
        onDoubleClick={handleDoubleClick}
        title={title}
      >
        {effectivelyVisible ? renderedValue : "•••••"}
        {effectivelyVisible && resetButton}
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
      onDoubleClick={handleDoubleClick}
      title={title}
    >
      {renderedValue}
      {resetButton}
    </span>
  );
}


// ─── Main page ────────────────────────────────────────────────────────────────

export default function PayrollPage() {
  const { can, loading: authLoading } = useAuth();

  const now = clock.now();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);

  const [period, setPeriod] = useState<PayrollPeriod | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [balanceModal, setBalanceModal] = useState<PayrollEntry | null>(null);
  const [notesModal, setNotesModal] = useState<PayrollEntry | null>(null);
  const [recalcModal, setRecalcModal] = useState<PayrollEntry | null>(null);
  // Which employee rows are expanded in the phone accordion view (keyed by entry
  // id). Desktop ignores this and renders the full scroll table.
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  const [showAllNavic, setShowAllNavic] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);

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
  if (!can("nav.payroll.view")) return <Navigate to="/" replace />;

  const isLocked = period?.locked === true;
  // Permission-derived (Phase 3). Same coverage as before: payroll.edit =
  // {admin,director}; lock/hard-recompute/delete are all admin-only.
  const canEdit = can("payroll.edit") && !isLocked;
  const canToggleLock = can("payroll.lock");
  const canHardRecompute = can("payroll.recalculate.hard");
  const canDeletePeriod = can("payroll.period.delete");
  const canCreate = can("payroll.create");
  const canSoftRecalculate = can("payroll.recalculate");
  const canExport = can("payroll.export");
  const canManageNotes = can("payroll.notes.manage");

  function toggleLock() {
    if (!period) return;
    const next = !isLocked;
    setConfirmModal({
      title: next ? "Uzamknout období" : "Odemknout období",
      message: next
        ? "Uzamknout mzdové období? Úpravy budou zablokovány."
        : "Odemknout mzdové období? Úpravy budou povoleny.",
      confirmLabel: next ? "Uzamknout" : "Odemknout",
      danger: next,
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await api.patch(`/payroll/periods/${period.id}`, { locked: next });
          setPeriod((prev) => prev ? { ...prev, locked: next } : prev);
        } catch (e) {
          setError((e as Error).message ?? "Chyba při uzamykání.");
        }
      },
    });
  }

  function handleCreatePeriod() {
    if (creating) return;
    setConfirmModal({
      title: "Vytvořit mzdy",
      message: `Vytvořit mzdy pro ${MONTH_NAMES[selectedMonth - 1]} ${selectedYear}? Pro tento měsíc musí existovat publikovaný směnný plán.`,
      confirmLabel: "Vytvořit",
      onConfirm: async () => {
        setConfirmModal(null);
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
      },
    });
  }

  function recalculate() {
    if (!period || recalculating) return;
    setConfirmModal({
      title: "Přepočítat mzdy",
      message: "Přepočítat mzdy pro toto období? Ruční úpravy (overrides) zůstanou zachovány.",
      confirmLabel: "Přepočítat",
      onConfirm: async () => {
        setConfirmModal(null);
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
      },
    });
  }

  function hardRecalculate() {
    if (!period || resetting) return;
    setConfirmModal({
      title: "Tvrdý přepočet",
      message:
        "Přepočítat mzdy a ZAHODIT všechny ruční úpravy (overrides)? " +
        "Každá buňka se přepočítá načisto ze směnného plánu. " +
        "Nemoc a poznámky zůstanou zachovány. Tuto akci nelze vrátit zpět.",
      confirmLabel: "Zahodit úpravy a přepočítat",
      danger: true,
      onConfirm: async () => {
        setConfirmModal(null);
        setResetting(true);
        setError(null);
        try {
          await api.post(`/payroll/periods/${period.id}/reset`, {});
          await loadPeriod();
        } catch (e) {
          setError((e as Error).message ?? "Chyba při přepočtu.");
        } finally {
          setResetting(false);
        }
      },
    });
  }

  function deletePeriod() {
    if (!period || deleting) return;
    setConfirmModal({
      title: "Smazat mzdové období",
      message:
        `Nenávratně smazat mzdové období ${MONTH_NAMES[selectedMonth - 1]} ${selectedYear} ` +
        "včetně všech záznamů, ručních úprav, Nemoci a poznámek? " +
        "Vypočtené hodnoty lze znovu vygenerovat z publikovaného směnného plánu, " +
        "ruční úpravy ale budou ztraceny.",
      confirmLabel: "Smazat období",
      danger: true,
      onConfirm: async () => {
        setConfirmModal(null);
        setDeleting(true);
        setError(null);
        try {
          await api.delete(`/payroll/periods/${period.id}`);
          await loadPeriod();
        } catch (e) {
          setError((e as Error).message ?? "Chyba při mazání mzdového období.");
        } finally {
          setDeleting(false);
        }
      },
    });
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
      const fmt = (n: number) => (n === 0 ? "–" : n.toLocaleString("cs-CZ"));
      const navicText = (extraPay: number): string => {
        if (!extraPay || extraPay <= 0) return "–";
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
        notesHeading: "font-size:8pt;font-weight:700;text-transform:uppercase;letter-spacing:0.03em;border-bottom:1px solid #d1d5db;padding-bottom:2px;margin-bottom:4px;",
        noteLine: "font-size:7.5pt;line-height:1.35;margin-bottom:1px;white-space:pre-wrap;",
      };

      let rowsHtml = "";
      for (const group of SECTION_GROUPS) {
        const entries = entriesForGroup(group.sections);
        if (entries.length === 0) continue;
        rowsHtml += `<tr><td colspan="11" style="${cs.sectionRow}">${group.label}</td></tr>`;
        for (const entry of entries) {
          const isDpp = entry.contractType === "DPP";
          const safeName = escapeHtml(employeeSurnameFirst(entry));
          const nameHtml = entry.contractType
            ? `${safeName}<span style="${cs.badge}">${entry.contractType}</span>`
            : safeName;
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
            ? "–"
            : (sick > 0
              ? `${fmt(vacation)}<div style="${cs.nemoc}">${sick} NEMOC</div>`
              : fmt(vacation));

          rowsHtml += "<tr>";
          rowsHtml += `<td style="${cs.nameCell}">${nameHtml}</td>`;
          rowsHtml += `<td style="${cs.cell}">${fmt(hours)}</td>`;
          rowsHtml += `<td style="${cs.cell}">${isDpp ? "–" : fmt(report)}</td>`;
          rowsHtml += `<td style="${cs.cell}">${vacationCell}</td>`;
          rowsHtml += `<td style="${cs.cell}">${isDpp ? "–" : fmt(night)}</td>`;
          rowsHtml += `<td style="${cs.cell}">${isDpp ? "–" : fmt(holiday)}</td>`;
          rowsHtml += `<td style="${cs.cell}">${isDpp ? "–" : fmt(weekend)}</td>`;
          rowsHtml += `<td style="${cs.cell}">${isDpp ? fmt(dppAmount) : "–"}</td>`;
          rowsHtml += `<td style="${cs.cell}">${isDpp ? "–" : navicText(extraPay)}</td>`;
          rowsHtml += `<td style="${cs.cell}">${isDpp ? "–" : fmt(foodVouchers)}</td>`;
          const multisportCell =
            typeof entry.multisportPrice === "number"
              ? entry.multisportPrice > 0
                ? `${entry.multisportPrice.toLocaleString("cs-CZ")} Kč`
                : "–"
              : entry.multisportActive ? "ANO" : "–";
          rowsHtml += `<td style="${cs.cell}">${multisportCell}</td>`;
          rowsHtml += "</tr>";
        }
      }

      // Poznámky section. The Poznámky column itself is PDF-excluded (it is a
      // button, not a value), so without this block every note on the month is
      // lost in the export. Listed in the same order as the table – managers
      // first, then the rest by surname (same `entriesForGroup` helper) – and
      // per employee in stored order. Every note valid for the month is
      // included: manual, carried-forward, already-read and system auto-notes.
      let noteLinesHtml = "";
      for (const group of SECTION_GROUPS) {
        for (const entry of entriesForGroup(group.sections)) {
          const notes = entry.notes ?? [];
          if (notes.length === 0) continue;
          const safeName = escapeHtml(employeeSurnameFirst(entry));
          for (const note of notes) {
            noteLinesHtml +=
              `<div style="${cs.noteLine}"><strong>${safeName}:</strong> ${escapeHtml(note.text ?? "")}</div>`;
          }
        }
      }
      const notesHtml = noteLinesHtml
        ? `<div style="margin-top:10px;">
             <div style="${cs.notesHeading}">Poznámky</div>
             ${noteLinesHtml}
           </div>`
        : "";

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
          <h2 style="margin:0 0 6px 0;font-size:12pt;">Mzdy – ${MONTH_NAMES[period.month - 1]} ${period.year}</h2>
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
          ${notesHtml}
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

  // Direct per-cell override (HODINY, NOČNÍ, SVÁTEK, SO+NE, NAVÍC, STRAVENKY,
  // DPP). Výkaz / Dovolená / Nemoc / Základ are NOT edited here – they go through
  // the balance dialog (saveBalance) so the invariant is always maintained.
  async function saveOverride(entryId: string, field: OverrideField, value: number | null) {
    if (!period) return;
    const entry = period.entries.find((e) => e.id === entryId);
    if (!entry) return;

    const newOverrides = { ...(entry.overrides ?? {}) };
    if (value === null) delete newOverrides[field];
    else newOverrides[field] = value;

    await api.patch(`/payroll/periods/${period.id}/entries/${entryId}`, {
      overrides: newOverrides,
      autoOverrides: entry.autoOverrides ?? {},
    });
    setPeriod((prev) => prev ? {
      ...prev,
      entries: prev.entries.map((e) =>
        e.id === entryId ? { ...e, overrides: newOverrides } : e
      ),
    } : prev);
  }

  // Per-employee recalc: discard the selected fields' manual edits and recompute
  // that one row from the shift plan (Nemoc-checked → reset to 0). Admin-only.
  async function recalcEmployee(entry: PayrollEntry, fields: string[]) {
    if (!period) return;
    await api.post(`/payroll/periods/${period.id}/entries/${entry.id}/recalculate`, { fields });
    await loadPeriod();
  }

  // Balance dialog save: Nemoc + (optional) Výkaz/Základ overrides → recomputed
  // autoOverrides. Local clean fields are refreshed so display + later edits stay
  // consistent until the next server recalc.
  async function saveBalance(entry: PayrollEntry, payload: BalanceSavePayload) {
    if (!period) return;
    const norm = entry.baseHoursNorm ?? entry.baseHours ?? period.baseHours;
    const effBase = payload.overrides.baseHours ?? norm;
    const bal = computeBalance({
      workedTotal: entry.reportHours + entry.extraHours,
      cleanHoliday: entry.holidayHours,
      contractType: entry.contractType,
      hourlyRate: entry.hourlyRate,
      base: effBase,
      hoursPerWeek: entry.hoursPerWeek,
      nemoc: payload.sickLeaveHours,
      maxHolidayHours: period.maxHolidayHours,
      reportOverride: payload.overrides.reportHours,
      holidayOverride: payload.overrides.holidayHours,
      extraPayOverride: payload.overrides.extraPay,
    });
    await api.patch(`/payroll/periods/${period.id}/entries/${entry.id}`, {
      sickLeaveHours: payload.sickLeaveHours,
      overrides: payload.overrides,
      autoOverrides: payload.autoOverrides,
    });
    setPeriod((prev) => prev ? {
      ...prev,
      entries: prev.entries.map((e) =>
        e.id === entry.id
          ? {
              ...e,
              sickLeaveHours: payload.sickLeaveHours,
              overrides: payload.overrides,
              autoOverrides: payload.autoOverrides,
              baseHours: effBase,
              reportHours: bal.cleanReport,
              vacationHours: bal.cleanVacation,
              extraHours: bal.cleanExtra,
            }
          : e
      ),
    } : prev);
  }

  // Group entries by section, sorted by surname (Příjmení Jméno, Czech locale).
  // Entries are stored keyed by employeeId and come back in document-id order,
  // which is meaningless for display (e.g. an auto-id employee jumps to the top),
  // so sort them here.
  const entriesForGroup = (sections: string[]) =>
    (period?.entries.filter((e) => sections.includes(e.section)) ?? [])
      .slice()
      .sort((a, b) => employeeSurnameFirst(a).localeCompare(employeeSurnameFirst(b), "cs"));

  // Toggle an employee row open/closed in the phone accordion. Ignores taps on
  // interactive controls in the header cell (the ↻ recalc button) so they work.
  function toggleRow(id: string, e: MouseEvent) {
    if ((e.target as HTMLElement).closest("input, button, select, a")) return;
    setOpenRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderGroup(group: { label: string; sections: string[] }) {
    const entries = entriesForGroup(group.sections);
    if (entries.length === 0) return null;
    return (
      <>
        <tr key={`section-${group.label}`} className={styles.sectionRow}>
          <td colSpan={12}>{group.label}</td>
        </tr>
        {entries.map((entry) => {
          const isDpp = entry.contractType === "DPP";
          const isPpp = entry.contractType === "PPP";
          const ov = entry.overrides ?? {};
          const ao = entry.autoOverrides ?? {};
          const sick = entry.sickLeaveHours ?? 0;
          const rowClass = isDpp ? styles.dppRow : isPpp ? styles.pppRow : "";
          const open = openRows.has(entry.id);
          return (
            <tr key={entry.id} className={`${rowClass} ${open ? styles.foldOpen : ""}`}>
              <td className={styles.nameCell} onClick={(e) => toggleRow(entry.id, e)}>
                {employeeDisplayName(entry)}
                {entry.contractType && (
                  <span className={styles.contractBadge}>{entry.contractType}</span>
                )}
                {canHardRecompute && !isLocked && (
                  <button
                    type="button"
                    className={styles.recalcRowBtn}
                    onClick={() => setRecalcModal(entry)}
                    title="Přepočítat vybrané složky tohoto zaměstnance"
                  >
                    ↻
                  </button>
                )}
                <span className={styles.foldChevron} aria-hidden="true">▾</span>
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
                {isDpp ? <span className={styles.dash}>–</span> : (
                  <EditableCell
                    computed={entry.reportHours}
                    override={ov.reportHours}
                    autoOverride={ao.reportHours}
                    editable={canEdit}
                    onSave={async () => {}}
                    onEditClick={() => setBalanceModal(entry)}
                  />
                )}
              </td>
              <td className={styles.numCell}>
                {isDpp ? <span className={styles.dash}>–</span> : (
                  <span className={styles.vacationWrap}>
                    <span className={styles.vacationInline}>
                      <EditableCell
                        computed={entry.vacationHours}
                        override={ov.vacationHours}
                        autoOverride={ao.vacationHours}
                        editable={canEdit}
                        onSave={async () => {}}
                        onEditClick={() => setBalanceModal(entry)}
                      />
                      {canEdit && (
                        <button
                          type="button"
                          className={styles.nemocBtn}
                          onClick={() => setBalanceModal(entry)}
                          title="Upravit mzdové složky (Výkaz / Dovolená / Nemoc / Základ)"
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
                {isDpp ? <span className={styles.dash}>–</span> : (
                  <EditableCell
                    computed={entry.nightHours}
                    override={ov.nightHours}
                    editable={canEdit}
                    onSave={(v) => saveOverride(entry.id, "nightHours", v)}
                  />
                )}
              </td>
              <td className={styles.numCell}>
                {isDpp ? <span className={styles.dash}>–</span> : (
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
                {isDpp ? <span className={styles.dash}>–</span> : (
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
                ) : <span className={styles.dash}>–</span>}
              </td>
              <td className={styles.numCell}>
                {isDpp ? <span className={styles.dash}>–</span> : (
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
                {isDpp ? <span className={styles.dash}>–</span> : (
                  <EditableCell
                    computed={entry.foodVouchers}
                    override={ov.foodVouchers}
                    editable={canEdit}
                    onSave={(v) => saveOverride(entry.id, "foodVouchers", v)}
                  />
                )}
              </td>
              <td className={styles.numCell}>
                {typeof entry.multisportPrice === "number" ? (
                  entry.multisportPrice > 0 ? (
                    `${entry.multisportPrice.toLocaleString("cs-CZ")} Kč`
                  ) : (
                    <span className={styles.dash}>–</span>
                  )
                ) : entry.multisportActive ? (
                  "ANO"
                ) : (
                  <span className={styles.dash}>–</span>
                )}
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
                    disabled={!canManageNotes}
                  >
                    <span className={styles.dash}>–</span>
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
          {canCreate && (
            <>
              <br />
              <button
                type="button"
                data-tour="payroll-create"
                className={styles.lockBtn}
                onClick={handleCreatePeriod}
                disabled={creating}
                style={{ marginTop: "1rem" }}
                title="Vytvořit mzdové období z již publikovaného směnného plánu pro tento měsíc"
              >
                {creating ? "Vytvářím…" : "Vytvořit mzdy ručně"}
              </button>
            </>
          )}
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
              {!isLocked && canSoftRecalculate && (
                <button
                  type="button"
                  data-tour="payroll-recalc"
                  className={styles.lockBtn}
                  onClick={recalculate}
                  disabled={recalculating}
                  title="Přepočítat mzdy podle aktuálního směnného plánu a nastavení"
                >
                  {recalculating ? "Přepočítávám…" : "Přepočítat"}
                </button>
              )}
              {canExport && (
                <button
                  type="button"
                  data-tour="payroll-export"
                  className={styles.lockBtn}
                  onClick={handleExportPdf}
                  disabled={exporting}
                  title="Exportovat mzdy do PDF"
                >
                  {exporting ? "Exportuji…" : "Exportovat PDF"}
                </button>
              )}
              {canToggleLock && (
                <button
                  type="button"
                  data-tour="payroll-lock"
                  className={styles.lockBtn}
                  onClick={toggleLock}
                  title={isLocked ? "Odemknout období pro úpravy" : "Uzamknout období (zablokovat úpravy)"}
                >
                  {isLocked ? "Odemknout" : "Uzamknout"}
                </button>
              )}
              {!isLocked && canHardRecompute && (
                <button
                  type="button"
                  data-tour="payroll-recalc-hard"
                  className={styles.lockBtn}
                  onClick={hardRecalculate}
                  disabled={resetting}
                  title="Přepočítat a zahodit všechny ruční úpravy (Nemoc a poznámky zůstanou zachovány)"
                >
                  {resetting ? "Přepočítávám…" : "Tvrdý přepočet"}
                </button>
              )}
              {!isLocked && canDeletePeriod && (
                <button
                  type="button"
                  data-tour="payroll-delete"
                  className={styles.dangerBtn}
                  onClick={deletePeriod}
                  disabled={deleting}
                  title="Nenávratně smazat celé mzdové období (lze znovu vygenerovat z publikovaného plánu)"
                >
                  {deleting ? "Mažu…" : "Smazat období"}
                </button>
              )}
            </span>
          </div>
          <div className={styles.tableWrapper} data-tour="payroll-table">
            <table className={`${styles.table} ${styles.foldTable}`}>
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
                  <th className={styles.numHeader} data-tour="payroll-notes-col">POZNÁMKY</th>
                </tr>
              </thead>
              <tbody>
                {SECTION_GROUPS.map((g) => renderGroup(g))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {balanceModal && period && (
        <PayrollBalanceModal
          entry={balanceModal}
          baseHoursNorm={balanceModal.baseHoursNorm ?? balanceModal.baseHours ?? period.baseHours}
          maxHolidayHours={period.maxHolidayHours}
          onClose={() => setBalanceModal(null)}
          onSave={(payload) => saveBalance(balanceModal, payload)}
        />
      )}

      {recalcModal && period && (
        <PayrollRecalcModal
          entry={period.entries.find((e) => e.id === recalcModal.id) ?? recalcModal}
          onClose={() => setRecalcModal(null)}
          onConfirm={(fields) => recalcEmployee(recalcModal, fields)}
        />
      )}

      {notesModal && period && (
        <PayrollNotesModal
          periodId={period.id}
          periodYear={period.year}
          periodMonth={period.month}
          employeeId={notesModal.id}
          employeeLabel={employeeDisplayName(notesModal)}
          notes={period.entries.find((e) => e.id === notesModal.id)?.notes ?? []}
          canEdit={canManageNotes}
          onClose={() => setNotesModal(null)}
          onChanged={loadPeriod}
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
    </div>
  );
}
