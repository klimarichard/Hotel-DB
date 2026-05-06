import { useState } from "react";
import { ContractType } from "@/lib/contractVariables";
import { formatDateCZ } from "@/lib/dateFormat";
import type { EmploymentRow, ContractRecord, EmploymentSession } from "@/lib/employmentSessions";
import EmploymentRowItem from "./EmploymentRowItem";
import Button from "./Button";
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
  onAddDodatek: () => void;
  onTerminate: () => void;
  onContractsChanged: () => void;
}

const Eye = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
  </svg>
);
const EyeOff = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);
const Chevron = ({ open }: { open: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

function SalaryReveal({ value }: { value: number }) {
  const [shown, setShown] = useState(false);
  return (
    <span className={styles.salary}>
      {shown ? `${value.toLocaleString("cs-CZ")} Kč` : "•••••"}
      <button
        type="button"
        className={styles.revealBtn}
        onClick={(e) => { e.stopPropagation(); setShown((v) => !v); }}
        title={shown ? "Skrýt" : "Zobrazit"}
      >
        {shown ? <EyeOff /> : <Eye />}
      </button>
    </span>
  );
}

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
  onAddDodatek,
  onTerminate,
  onContractsChanged,
}: Props) {
  const [open, setOpen] = useState(defaultExpanded);
  const eff = session.effective;
  const companyName = companies[eff.companyId] ?? eff.companyId ?? "—";
  const shownSalary = eff.contractType === "DPP" ? eff.agreedReward : eff.salary;

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
          <span className={styles.title}>{eff.jobTitle || "—"}</span>
          {eff.contractType && <span className={styles.tag}>{eff.contractType}</span>}
          <span className={styles.meta}>{companyName}</span>
          {shownSalary != null && <SalaryReveal value={shownSalary} />}
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
              onGenerate={() => onGenerate(row)}
              onContractsChanged={onContractsChanged}
            />
          ))}
        </div>
      )}
    </div>
  );
}
