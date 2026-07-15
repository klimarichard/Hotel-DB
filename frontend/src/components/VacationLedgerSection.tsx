import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import Button from "./Button";
import ConfirmModal from "./ConfirmModal";
import styles from "./VacationLedgerSection.module.css";

/**
 * Read/edit view of an employee's vacation-hour ledger for one calendar year.
 * All figures are in HOURS (the unit AVENSIO + the payroll engine use). Editing
 * is gated by the caller (`canManage` ← employees.vacationBalance.manage); when
 * false the whole card is read-only. Remaining is derived server-side and shown
 * emphasized (red when negative). Each month cell is tagged with its origin:
 *   A = AVENSIO seed · M = ze mzdy (payroll lock) · R = ruční úprava.
 */

type LedgerSource = "avensio-seed" | "payroll-lock" | "manual";

interface LedgerMonth {
  hours: number;
  source: LedgerSource;
}

interface Ledger {
  year: number;
  entitlementHours: number | null;
  paidOutHours: number | null;
  months: Record<string, LedgerMonth>;
  consumedHours: number;
  remainingHours: number | null;
}

const MONTHS_CZ = [
  "Leden", "Únor", "Březen", "Duben", "Květen", "Červen",
  "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec",
];

const SOURCE_TAG: Record<LedgerSource, { letter: string; title: string }> = {
  "avensio-seed": { letter: "A", title: "Načteno z AVENSIO (počáteční import)" },
  "payroll-lock": { letter: "M", title: "Doplněno automaticky uzamčením mezd" },
  manual: { letter: "R", title: "Ruční úprava" },
};

/** Format an hour figure: drop trailing .0, keep decimals like 157,4. */
function fmtH(n: number | null | undefined): string {
  if (n == null) return "–";
  return `${String(n).replace(".", ",")} h`;
}

type EditTarget =
  | { kind: "month"; month: number }
  | { kind: "entitlementHours" }
  | { kind: "paidOutHours" };

export default function VacationLedgerSection({
  employeeId,
  canManage,
  year = 2026,
}: {
  employeeId: string;
  canManage: boolean;
  year?: number;
}) {
  const [ledger, setLedger] = useState<Ledger | null | undefined>(undefined); // undefined = loading
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [errModal, setErrModal] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<Ledger | null>(`/employees/${employeeId}/vacation-ledger?year=${year}`)
      .then((l) => alive && setLedger(l))
      .catch(() => alive && setLedger(null));
    return () => {
      alive = false;
    };
  }, [employeeId, year]);

  function startEdit(target: EditTarget, current: number | null | undefined) {
    if (!canManage) return;
    setEdit(target);
    setDraft(current == null ? "" : String(current).replace(".", ","));
  }

  async function save() {
    if (!edit) return;
    // Empty string clears the value (→ null). Otherwise parse a non-negative number.
    const raw = draft.trim().replace(",", ".");
    let hours: number | null;
    if (raw === "") {
      hours = null;
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        setErrModal("Zadejte nezáporné číslo (počet hodin), nebo nechte prázdné pro smazání.");
        return;
      }
      hours = n;
    }
    const body =
      edit.kind === "month"
        ? { month: edit.month, hours }
        : edit.kind === "entitlementHours"
          ? { entitlementHours: hours }
          : { paidOutHours: hours };
    setSaving(true);
    try {
      await api.patch(`/employees/${employeeId}/vacation-ledger/${year}`, body);
      // Refetch so derived consumed/remaining stay authoritative (single source of math).
      const fresh = await api.get<Ledger | null>(
        `/employees/${employeeId}/vacation-ledger?year=${year}`
      );
      setLedger(fresh);
      setEdit(null);
    } catch (e) {
      setErrModal((e as Error).message || "Uložení se nezdařilo.");
    } finally {
      setSaving(false);
    }
  }

  if (ledger === undefined) {
    return <div className={styles.loading}>Načítám…</div>;
  }

  const entitlement = ledger?.entitlementHours ?? null;
  const paidOut = ledger?.paidOutHours ?? null;
  const consumed = ledger?.consumedHours ?? 0;
  const remaining = ledger?.remainingHours ?? null;
  const months = ledger?.months ?? {};

  const editInput = (
    <span className={styles.editor}>
      <input
        className={styles.input}
        type="text"
        inputMode="decimal"
        value={draft}
        autoFocus
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
          if (e.key === "Escape") setEdit(null);
        }}
        placeholder="prázdné = smazat"
      />
      <Button size="sm" onClick={() => void save()} disabled={saving}>
        Uložit
      </Button>
      <Button size="sm" variant="secondary" onClick={() => setEdit(null)} disabled={saving}>
        Zrušit
      </Button>
    </span>
  );

  return (
    <div className={styles.wrap}>
      {ledger === null && (
        <p className={styles.empty}>
          Pro rok {year} zatím nejsou u tohoto zaměstnance žádné údaje o dovolené.
          {canManage ? " Můžete je zadat níže." : ""}
        </p>
      )}

      {/* Souhrn */}
      <div className={styles.summary}>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>Nárok (rok {year})</span>
          {edit?.kind === "entitlementHours" ? (
            editInput
          ) : (
            <span
              className={canManage ? styles.editable : undefined}
              onClick={() => startEdit({ kind: "entitlementHours" }, entitlement)}
              title={canManage ? "Kliknutím upravit" : undefined}
            >
              {fmtH(entitlement)}
            </span>
          )}
        </div>

        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>Čerpáno</span>
          <span>{fmtH(consumed)}</span>
        </div>

        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>Proplaceno</span>
          {edit?.kind === "paidOutHours" ? (
            editInput
          ) : (
            <span
              className={canManage ? styles.editable : undefined}
              onClick={() => startEdit({ kind: "paidOutHours" }, paidOut)}
              title={canManage ? "Kliknutím upravit" : undefined}
            >
              {fmtH(paidOut)}
            </span>
          )}
        </div>

        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>Zůstatek</span>
          <span
            className={`${styles.remaining} ${remaining != null && remaining < 0 ? styles.negative : ""}`}
          >
            {fmtH(remaining)}
          </span>
        </div>
      </div>

      {/* Měsíční čerpání */}
      <div className={styles.monthsLabel}>Čerpání po měsících</div>
      <div className={styles.grid}>
        {MONTHS_CZ.map((name, i) => {
          const month = i + 1;
          const cell = months[String(month)];
          const isEditing = edit?.kind === "month" && edit.month === month;
          return (
            <div key={month} className={styles.cell}>
              <span className={styles.cellMonth}>{name}</span>
              {isEditing ? (
                editInput
              ) : (
                <span
                  className={canManage ? styles.editable : undefined}
                  onClick={() => startEdit({ kind: "month", month }, cell?.hours)}
                  title={canManage ? "Kliknutím upravit" : undefined}
                >
                  <span className={styles.cellHours}>{cell ? fmtH(cell.hours) : "–"}</span>
                  {cell && (
                    <span className={styles.tag} title={SOURCE_TAG[cell.source]?.title}>
                      {SOURCE_TAG[cell.source]?.letter ?? "?"}
                    </span>
                  )}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className={styles.legend}>
        <span title={SOURCE_TAG["avensio-seed"].title}><b>A</b> = AVENSIO</span>
        <span title={SOURCE_TAG["payroll-lock"].title}><b>M</b> = ze mzdy</span>
        <span title={SOURCE_TAG.manual.title}><b>R</b> = ruční úprava</span>
      </div>

      {errModal && (
        <ConfirmModal
          title="Chyba"
          message={errModal}
          confirmLabel="OK"
          showCancel={false}
          onConfirm={() => setErrModal(null)}
          onCancel={() => setErrModal(null)}
        />
      )}
    </div>
  );
}
