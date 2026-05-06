import { useState } from "react";
import { ContractType } from "@/lib/contractVariables";
import { formatDateCZ } from "@/lib/dateFormat";
import type { EmploymentRow, ContractRecord, EmploymentSession } from "@/lib/employmentSessions";
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

  // Surface "original → current" in the header when a Dodatek shifted the
  // position or contract type during this session, so the user can see at
  // a glance that there was a transition without expanding the card.
  const nastupTitle = session.nastup.jobTitle ?? "";
  const nastupContractType = session.nastup.contractType ?? "";
  const titleChanged = !!nastupTitle && eff.jobTitle && eff.jobTitle !== nastupTitle;
  const contractTypeChanged =
    !!nastupContractType && !!eff.contractType && eff.contractType !== nastupContractType;

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
              <>
                <span className={styles.titleFrom}>{nastupTitle}</span>
                <span className={styles.titleArrow}> → </span>
                <span>{eff.jobTitle}</span>
              </>
            ) : (
              eff.jobTitle || "—"
            )}
          </span>
          {eff.contractType && (
            <span className={styles.tag}>
              {contractTypeChanged ? `${nastupContractType} → ${eff.contractType}` : eff.contractType}
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
