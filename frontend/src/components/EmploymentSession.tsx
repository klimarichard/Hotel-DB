import { useState } from "react";
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
  canEdit: boolean;
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
  canEdit,
  resolveDefaultType,
  resolveDisplayName,
  resolveRowSnapshot,
  onGenerate,
  onEditRow,
  onDeleteRow,
  onAddDodatek,
  onTerminate,
  onContractsChanged,
}: Props) {
  const [open, setOpen] = useState(defaultExpanded);
  const eff = session.effective;
  const companyName = companies[eff.companyId] ?? eff.companyId ?? "—";
  const shownSalary = eff.contractType === "DPP" ? eff.agreedReward : eff.salary;

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
        {canEdit && !session.terminated && (
          <div className={styles.headerActions} onClick={(e) => e.stopPropagation()}>
            <Button variant="secondary" size="sm" onClick={onAddDodatek}>+ Dodatek</Button>
            <Button variant="secondary" size="sm" onClick={onTerminate}>Ukončit smlouvu</Button>
          </div>
        )}
      </div>

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
              canEdit={canEdit}
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
