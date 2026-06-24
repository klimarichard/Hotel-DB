import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { ContractType } from "@/lib/contractVariables";
import { formatDateCZ } from "@/lib/dateFormat";
import { Fragment } from "react";
import type { EmploymentRow, ContractRecord, EmploymentSession } from "@/lib/employmentSessions";
import { collectFieldChain } from "@/lib/employmentSessions";
import EmploymentRowItem from "./EmploymentRowItem";
import Button from "./Button";
import SalaryReveal from "./SalaryReveal";
import styles from "./EmploymentSession.module.css";

interface CompanyMap {
  [companyId: string]: string;
}

interface Props {
  session: EmploymentSession;
  /** rowId → contract record (or absent → null). */
  contractsByRow: Map<string, ContractRecord>;
  defaultExpanded: boolean;
  companies: CompanyMap;
  employeeId: string;
  /** Build the template id used when the user uploads a signed PDF before generating one. */
  resolveDefaultType: (row: EmploymentRow) => ContractType;
  /** Build the human-readable filename used in Content-Disposition. */
  resolveDisplayName: (row: EmploymentRow) => string;
  resolveRowSnapshot: (row: EmploymentRow) => Record<string, unknown>;
  onGenerate: (row: EmploymentRow) => void;
  onEditRow: (row: EmploymentRow) => void;
  /**
   * Delete a row. The page is responsible for calling the DELETE
   * endpoint and refreshing employment + contracts + employee state
   * afterwards. Cascade behavior (Nástup → whole session) is enforced
   * server-side; the row's confirm copy reflects this.
   */
  onDeleteRow: (row: EmploymentRow) => void;
  onAddDodatek: () => void;
  /** Open the dialog to add a parental-leave (RODIČOVSKÁ) period to this session. */
  onAddRodicovska: () => void;
  onTerminate: () => void;
  onContractsChanged: () => void;
}

const Chevron = ({ open }: { open: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

export default function EmploymentSessionCard({
  session,
  contractsByRow,
  defaultExpanded,
  companies,
  employeeId,
  resolveDefaultType,
  resolveDisplayName,
  resolveRowSnapshot,
  onGenerate,
  onEditRow,
  onDeleteRow,
  onAddDodatek,
  onAddRodicovska,
  onTerminate,
  onContractsChanged,
}: Props) {
  const { can } = useAuth();
  // "+ Dodatek" / "Ukončit smlouvu" are employment-record management. Built-in
  // admin/director hold employment.manage → unchanged.
  const canManageEmployment = can("employment.manage");
  const [open, setOpen] = useState(defaultExpanded);
  const eff = session.effective;
  const companyName = companies[eff.companyId] ?? eff.companyId ?? "—";
  // DPP headers show no monetary value — DPP has no monthly salary, and the
  // agreed reward is not shown in the session header (per TODO line 59).
  const shownSalary = eff.contractType === "DPP" ? null : eff.salary;

  // Surface every distinct value the field has held during this session,
  // not just first → last. So three position changes render
  // "recepční → senior recepční → Front Office Manager" with the older
  // entries muted. Single-value chains (no transitions) collapse to the
  // plain current value.
  const titleChain = collectFieldChain(session, "jobTitle");
  const contractTypeChain = collectFieldChain(session, "contractType");
  const titleChanged = titleChain.length > 1;
  const contractTypeChanged = contractTypeChain.length > 1;

  return (
    <div className={`${styles.card} ${session.terminated ? styles.terminated : ""}`}>
      <div
        className={styles.header}
        onClick={() => setOpen((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((v) => !v); }
        }}
      >
        <div className={styles.headerLeft}>
          <span className={styles.chevron}><Chevron open={open} /></span>
          <span className={styles.title}>
            {titleChanged ? (
              titleChain.map((v, i) => {
                const isLast = i === titleChain.length - 1;
                return (
                  <Fragment key={i}>
                    <span className={isLast ? undefined : styles.titleFrom}>{v}</span>
                    {!isLast && <span className={styles.titleArrow}> → </span>}
                  </Fragment>
                );
              })
            ) : (
              eff.jobTitle || "—"
            )}
          </span>
          {eff.contractType && (
            <span className={styles.tag}>
              {contractTypeChanged ? contractTypeChain.join(" → ") : eff.contractType}
            </span>
          )}
          <span className={styles.meta}>{companyName}</span>
          {shownSalary != null && (
            <span className={styles.salaryWrap}>
              <SalaryReveal value={shownSalary} />
            </span>
          )}
          <span className={styles.dates}>
            {formatDateCZ(eff.startDate) ?? eff.startDate}
            {" → "}
            {eff.endDate ? formatDateCZ(eff.endDate) : <span className={styles.ongoing}>trvá</span>}
          </span>
        </div>
        {/* "Ukončit smlouvu" stays available for any session without a formal
            Ukončení row — including fixed-term contracts (e.g. DPP) whose end
            date is set or has already passed, so they can always be ended
            (early or retroactively). "+ Dodatek" remains hidden once the
            session is over (terminated = Ukončení row or endDate in the past). */}
        {canManageEmployment && !session.ukonceni && (
          <div className={styles.headerActions} onClick={(e) => e.stopPropagation()}>
            {!session.terminated && (
              <>
                <Button variant="secondary" size="sm" onClick={onAddDodatek}>+ Dodatek</Button>
                <Button variant="secondary" size="sm" data-tour="emp-employment-rodicovska" onClick={onAddRodicovska}>+ Rodičovská</Button>
              </>
            )}
            <Button variant="secondary" size="sm" onClick={onTerminate}>Ukončit smlouvu</Button>
          </div>
        )}
      </div>

      {/* Parental-leave periods — informational header band, always visible. */}
      {session.rodicovska.length > 0 && (
        <div className={styles.rodicovskaBand}>
          {session.rodicovska.map((rd) => (
            <div key={rd.id} className={styles.rodicovskaItem}>
              <span className={styles.rodicovskaTag}>Rodičovská</span>
              <span className={styles.rodicovskaDates}>
                {formatDateCZ(rd.startDate) ?? rd.startDate}
                {" – "}
                {rd.endDate ? formatDateCZ(rd.endDate) : "—"}
              </span>
              {canManageEmployment && (
                <button
                  type="button"
                  className={styles.rodicovskaDelete}
                  onClick={() => onDeleteRow(rd)}
                  aria-label="Odebrat rodičovskou"
                  title="Odebrat rodičovskou"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className={styles.body}>
          {session.rows.map((row) => (
            <EmploymentRowItem
              key={row.id}
              row={row}
              contract={contractsByRow.get(row.id) ?? null}
              defaultContractType={resolveDefaultType(row)}
              defaultDisplayName={resolveDisplayName(row)}
              rowSnapshot={resolveRowSnapshot(row)}
              employeeId={employeeId}
              sessionRowCount={session.rows.length}
              onGenerate={() => onGenerate(row)}
              onEdit={() => onEditRow(row)}
              onDelete={() => onDeleteRow(row)}
              onContractsChanged={onContractsChanged}
            />
          ))}
        </div>
      )}
    </div>
  );
}
