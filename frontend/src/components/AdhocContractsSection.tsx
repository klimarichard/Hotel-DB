import { useState } from "react";
import { CONTRACT_TYPE_LABELS } from "@/lib/contractVariables";
import { formatTimestampCZ } from "@/lib/dateFormat";
import type { ContractRecord } from "@/lib/employmentSessions";
import ContractActionButtons from "./ContractActionButtons";
import styles from "./AdhocContractsSection.module.css";

interface CustomTemplate { id: string; name: string }

interface Props {
  contracts: ContractRecord[];
  customTemplates: CustomTemplate[];
  employeeId: string;
  canEdit: boolean;
  onContractsChanged: () => void;
}

const Chevron = ({ open }: { open: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

export default function AdhocContractsSection({
  contracts,
  customTemplates,
  employeeId,
  canEdit,
  onContractsChanged,
}: Props) {
  const [open, setOpen] = useState(contracts.length > 0);

  function labelFor(type: string): string {
    return (
      CONTRACT_TYPE_LABELS[type] ??
      customTemplates.find((t) => t.id === type)?.name ??
      type
    );
  }

  return (
    <div className={styles.card}>
      <div
        className={styles.header}
        role="button"
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((v) => !v); }
        }}
      >
        <span className={styles.chevron}><Chevron open={open} /></span>
        <span className={styles.title}>Ad hoc smlouvy</span>
        <span className={styles.count}>{contracts.length}</span>
      </div>

      {open && (
        <div className={styles.body}>
          {contracts.length === 0 ? (
            <div className={styles.empty}>Žádné ad hoc smlouvy.</div>
          ) : (
            contracts.map((c) => (
              <div key={c.id} className={styles.row}>
                <div className={styles.meta}>
                  <span className={styles.type}>{labelFor(c.type)}</span>
                  <span className={styles.date}>{formatTimestampCZ(c.generatedAt) ?? "—"}</span>
                </div>
                <ContractActionButtons
                  contract={c}
                  defaultType={c.type}
                  defaultDisplayName={labelFor(c.type)}
                  employeeId={employeeId}
                  canEdit={canEdit}
                  onChanged={onContractsChanged}
                />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
