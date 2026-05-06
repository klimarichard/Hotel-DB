import { ContractType } from "@/lib/contractVariables";
import { formatDateCZ } from "@/lib/dateFormat";
import type { EmploymentRow, ContractRecord } from "@/lib/employmentSessions";
import ContractActionButtons from "./ContractActionButtons";
import styles from "./EmploymentRowItem.module.css";

interface Props {
  row: EmploymentRow;
  contract: ContractRecord | null;
  defaultContractType: ContractType;
  defaultDisplayName: string;
  rowSnapshot: Record<string, unknown>;
  employeeId: string;
  canEdit: boolean;
  onGenerate?: () => void;
  /**
   * Open the row in edit mode. Hidden once a signed PDF is on file —
   * editing the underlying record after that would silently desync from
   * the legally-binding signed contract.
   */
  onEdit?: () => void;
  onContractsChanged: () => void;
}

const ROW_LABEL: Record<string, string> = {
  "nástup": "Nástup",
  "změna smlouvy": "Dodatek",
  "ukončení": "Ukončení",
};

const CHANGE_KIND_LABEL: Record<string, string> = {
  "mzda": "Mzda",
  "pracovní pozice": "Pozice",
  "úvazek": "Úvazek",
  "délka smlouvy": "Délka smlouvy",
};

function formatChangeValue(kind: string, value: string): string {
  if (!value) return "—";
  if (kind === "mzda") {
    const n = Number(value);
    if (Number.isFinite(n)) return `${n.toLocaleString("cs-CZ")} Kč`;
  }
  if (kind === "délka smlouvy") {
    return formatDateCZ(value) ?? value;
  }
  return value;
}

export default function EmploymentRowItem({
  row,
  contract,
  defaultContractType,
  defaultDisplayName,
  rowSnapshot,
  employeeId,
  canEdit,
  onGenerate,
  onEdit,
  onContractsChanged,
}: Props) {
  const label = ROW_LABEL[row.changeType] ?? row.changeType;

  let detail: string | null = null;
  if (row.changeType === "nástup") {
    detail = row.contractType ? `${row.contractType}` : null;
  } else if (row.changeType === "změna smlouvy") {
    const parts = (row.changes ?? [])
      .filter((c) => c.changeKind)
      .map((c) => {
        const k = CHANGE_KIND_LABEL[c.changeKind] ?? c.changeKind;
        return `${k}: ${formatChangeValue(c.changeKind, c.value)}`;
      });
    detail = parts.length ? parts.join(" · ") : null;
  }

  const signedLocked = !!contract?.signedStoragePath;

  return (
    <div className={styles.row}>
      <div className={styles.meta}>
        <span className={styles.date}>{formatDateCZ(row.startDate)}</span>
        <span className={styles.kind}>{label}</span>
        {detail && <span className={styles.detail}>{detail}</span>}
      </div>
      <div className={styles.actions}>
        {canEdit && onEdit && !signedLocked && (
          <button
            type="button"
            className={styles.editBtn}
            onClick={onEdit}
          >
            Upravit
          </button>
        )}
        <ContractActionButtons
          contract={contract}
          defaultType={defaultContractType}
          employmentRowId={row.id}
          rowSnapshot={rowSnapshot}
          defaultDisplayName={defaultDisplayName}
          employeeId={employeeId}
          canEdit={canEdit}
          onGenerate={onGenerate}
          onChanged={onContractsChanged}
        />
      </div>
    </div>
  );
}
