import { useState } from "react";
import Button from "@/components/Button";
import { employeeDisplayName } from "@/lib/employeeName";
import { computeBalance } from "@/lib/payrollBalance";
import styles from "./PayrollPage.module.css";
import type { PayrollEntry, OverrideField } from "./PayrollPage";

export interface BalanceSavePayload {
  sickLeaveHours: number;
  overrides: Partial<Record<OverrideField, number>>;
  autoOverrides: Partial<Record<OverrideField, number>>;
}

interface Props {
  entry: PayrollEntry;
  /** Whole-month / prorated norm before any per-employee override. */
  baseHoursNorm: number;
  maxHolidayHours: number;
  onClose: () => void;
  onSave: (payload: BalanceSavePayload) => Promise<void>;
}

const num = (s: string) => {
  const n = Number(s.trim().replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export default function PayrollBalanceModal({ entry, baseHoursNorm, maxHolidayHours, onClose, onSave }: Props) {
  const isPpp = entry.contractType === "PPP";
  const worked = entry.reportHours + entry.extraHours; // clean worked total (base-independent)

  const [base, setBase] = useState(String(entry.baseHours ?? baseHoursNorm));
  const [nemoc, setNemoc] = useState(String(entry.sickLeaveHours ?? 0));
  const [vykazPinned, setVykazPinned] = useState(entry.overrides?.reportHours !== undefined);
  const [vykaz, setVykaz] = useState(String(entry.overrides?.reportHours ?? entry.reportHours));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const B = num(base);
  const N = num(nemoc);

  const res = computeBalance({
    workedTotal: worked,
    cleanHoliday: entry.holidayHours,
    contractType: entry.contractType,
    hourlyRate: entry.hourlyRate,
    base: B,
    nemoc: N,
    maxHolidayHours,
    reportOverride: vykazPinned ? num(vykaz) : undefined,
    holidayOverride: entry.overrides?.holidayHours,
    extraPayOverride: entry.overrides?.extraPay,
  });

  const vykazShown = vykazPinned ? vykaz : fmt(res.vykaz);
  const baseOverridden = B !== baseHoursNorm;
  // HPP invariant: Výkaz + Dovolená + Nemoc must equal the full base. PPP has no
  // single target — Dovolená fills only to ½ základu, Výkaz can run up to the
  // full base, and Navíc starts only above it — so we show thresholds, not a sum-check.
  const sumOk = !isPpp && res.sum === B;

  async function handleSave() {
    const finalReportOverride =
      vykazPinned && num(vykaz) !== res.naturalVykaz ? num(vykaz) : undefined;
    const finalRes = computeBalance({
      workedTotal: worked,
      cleanHoliday: entry.holidayHours,
      contractType: entry.contractType,
      hourlyRate: entry.hourlyRate,
      base: B,
      nemoc: N,
      maxHolidayHours,
      reportOverride: finalReportOverride,
      holidayOverride: entry.overrides?.holidayHours,
      extraPayOverride: entry.overrides?.extraPay,
    });

    const overrides: Partial<Record<OverrideField, number>> = { ...(entry.overrides ?? {}) };
    if (baseOverridden) overrides.baseHours = B; else delete overrides.baseHours;
    if (finalReportOverride !== undefined) overrides.reportHours = finalReportOverride;
    else delete overrides.reportHours;
    // Dovolená is auto-balanced now — drop any legacy manual override.
    delete overrides.vacationHours;

    setSaving(true);
    setError(null);
    try {
      await onSave({ sickLeaveHours: N, overrides, autoOverrides: finalRes.autoOverrides });
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
          <span className={styles.modalTitle}>Mzdové složky — {employeeDisplayName(entry)}</span>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>
        <div className={styles.modalBody}>
          <div className={styles.balRow}>
            <span className={styles.balRowLabel}>
              Základ (norma)
              {baseOverridden && (
                <button type="button" className={styles.balReset} onClick={() => setBase(String(baseHoursNorm))}>
                  zpět na {fmt(baseHoursNorm)}
                </button>
              )}
            </span>
            <input
              className={styles.balInput}
              type="text"
              inputMode="decimal"
              value={base}
              onChange={(e) => setBase(e.target.value)}
            />
          </div>

          <div className={styles.balDivider} />

          <div className={styles.balRow}>
            <span className={styles.balRowLabel}>
              Výkaz
              <span className={styles.balRowSub}>{vykazPinned ? "ručně" : "odpracováno (auto)"}</span>
            </span>
            <span>
              <input
                className={styles.balInput}
                type="text"
                inputMode="decimal"
                value={vykazShown}
                onChange={(e) => { setVykazPinned(true); setVykaz(e.target.value); }}
              />
              {vykazPinned && (
                <button
                  type="button"
                  className={styles.balReset}
                  onClick={() => { setVykazPinned(false); setVykaz(String(entry.reportHours)); }}
                >
                  auto
                </button>
              )}
            </span>
          </div>

          <div className={styles.balRow}>
            <span className={styles.balRowLabel}>
              Dovolená
              <span className={styles.balRowSub}>auto = {isPpp ? "½ základu" : "základ"} − Výkaz − Nemoc</span>
            </span>
            <span className={styles.balReadonly}>{fmt(res.dovolena)}</span>
          </div>

          <div className={styles.balRow}>
            <span className={styles.balRowLabel}>Nemoc</span>
            <input
              className={styles.balInput}
              type="text"
              inputMode="decimal"
              value={nemoc}
              onChange={(e) => setNemoc(e.target.value)}
            />
          </div>

          <div className={styles.balDivider} />

          {isPpp ? (
            <>
              <div className={styles.balSum}>
                <span>Výkaz + Dovolená + Nemoc</span>
                <span>{fmt(res.sum)}</span>
              </div>
              <div className={styles.balSpill}>
                Dovolená se počítá do ½ základu ({fmt(B / 2)}); Navíc až nad celý základ ({fmt(B)}).
              </div>
            </>
          ) : (
            <div className={`${styles.balSum} ${sumOk ? styles.balSumOk : styles.balSumWarn}`}>
              <span>Součet (Výkaz + Dovolená + Nemoc)</span>
              <span>{fmt(res.sum)} / {fmt(B)}</span>
            </div>
          )}
          {(res.navicHours > 0 || res.transferToSvatek > 0) && (
            <div className={styles.balSpill}>
              Odpracované hodiny mimo Výkaz: Svátek +{fmt(res.transferToSvatek)} h · Navíc {fmt(res.navicHours)} h
            </div>
          )}
          {error && <div className={styles.modalError}>{error}</div>}
        </div>
        <div className={styles.modalActions}>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Zrušit</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Ukládám…" : "Uložit"}
          </Button>
        </div>
      </div>
    </div>
  );
}
