import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useIsPhone } from "@/hooks/useIsPhone";
import { ContractType } from "@/lib/contractVariables";
import { formatDateCZ } from "@/lib/dateFormat";
import type { EmploymentRow, ContractRecord } from "@/lib/employmentSessions";
import ContractActionButtons from "./ContractActionButtons";
import ConfirmModal from "./ConfirmModal";
import SalaryReveal from "./SalaryReveal";
import styles from "./EmploymentRowItem.module.css";

// Reveal buttons live inside the (phone-)clickable row summary; stop their taps
// from also toggling the row open/closed.
const StopTap = ({ children }: { children: React.ReactNode }) => (
  <span onClick={(e) => e.stopPropagation()}>{children}</span>
);

const RowChevron = ({ open }: { open: boolean }) => (
  <svg
    className={styles.rowChevron}
    data-open={open}
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

interface Props {
  row: EmploymentRow;
  contract: ContractRecord | null;
  defaultContractType: ContractType;
  defaultDisplayName: string;
  rowSnapshot: Record<string, unknown>;
  employeeId: string;
  /** Number of rows in the session this Nástup anchors. Drives the
   *  cascade-delete confirm copy ("smaže pracovní poměr – N záznamů").
   *  Ignored for non-Nástup rows. */
  sessionRowCount?: number;
  onGenerate?: () => void;
  /**
   * Open the row in edit mode. Hidden once a signed PDF is on file –
   * editing the underlying record after that would silently desync from
   * the legally-binding signed contract.
   */
  onEdit?: () => void;
  /** Delete this row (the parent recomputes after the API call returns). */
  onDelete?: () => void;
  onContractsChanged: () => void;
  /**
   * Self-service (Můj profil) download-only mode. When provided, the admin
   * ContractActionButtons are replaced by a single "Stáhnout smlouvu" button
   * that downloads this row's SIGNED contract via the self endpoint. Employees
   * get no generate/sign/delete/preview actions.
   */
  onSelfDownload?: (contractId: string, displayName?: string) => void;
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
  "počet hodin": "Počet hodin týdně",
};

function renderChangeValue(kind: string, value: string): React.ReactNode {
  // "délka smlouvy" is checked BEFORE the generic empty guard: an empty value
  // here is not a missing value, it IS the change – the dodatek clears the fixed
  // end date, which the edit form spells out ("Prázdné datum = změna na dobu
  // neurčitou") and the backend reads the same way (`ch.value || null`).
  if (kind === "délka smlouvy") {
    return value ? formatDateCZ(value) || value : "doba neurčitá";
  }
  if (!value) return "–";
  if (kind === "mzda") {
    const n = Number(value);
    if (Number.isFinite(n)) return <StopTap><SalaryReveal value={n} /></StopTap>;
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
  sessionRowCount,
  onGenerate,
  onEdit,
  onDelete,
  onContractsChanged,
  onSelfDownload,
}: Props) {
  const { can } = useAuth();
  const isPhone = useIsPhone();
  // Per-row collapse is PHONE-ONLY: on desktop every row renders its actions
  // inline exactly as before. On phones each entry starts collapsed (buttons
  // hidden) for a shorter, more readable list; tapping the summary reveals the
  // actions. `expanded` is inert on desktop because `showActions` ignores it there.
  const [expanded, setExpanded] = useState(false);
  const showActions = !isPhone || expanded;
  // Per-row Upravit/Smazat are employment-record management. Built-in
  // admin/director hold employment.manage → unchanged.
  const canManageEmployment = can("employment.manage");
  const label = ROW_LABEL[row.changeType] ?? row.changeType;

  let detail: React.ReactNode = null;
  if (row.changeType === "nástup") {
    const ct = row.contractType || null;
    const showSalary =
      (row.contractType === "HPP" || row.contractType === "PPP") &&
      typeof row.salary === "number" &&
      Number.isFinite(row.salary);
    if (ct && showSalary) {
      detail = (
        <>
          {ct} <StopTap><SalaryReveal value={row.salary as number} /></StopTap>
        </>
      );
    } else {
      detail = ct;
    }
  } else if (row.changeType === "změna smlouvy") {
    const parts = (row.changes ?? [])
      .filter((c) => c.changeKind)
      .map((c, i) => {
        const k = CHANGE_KIND_LABEL[c.changeKind] ?? c.changeKind;
        return (
          <span key={i} className={styles.changePart}>
            {k}: {renderChangeValue(c.changeKind, c.value)}
          </span>
        );
      });
    if (parts.length > 0) {
      detail = parts.reduce<React.ReactNode[]>((acc, p, i) => {
        if (i > 0) acc.push(<span key={`sep-${i}`} className={styles.changeSep}> · </span>);
        acc.push(p);
        return acc;
      }, []);
    }
  }

  const signedLocked = !!contract?.signedStoragePath;
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isNastup = row.changeType === "nástup";
  const cascadeCount = sessionRowCount ?? 1;
  const deleteTitle = isNastup
    ? "Smazat celý pracovní poměr?"
    : row.changeType === "změna smlouvy"
      ? "Smazat dodatek?"
      : "Smazat ukončení?";
  const deleteMessage = isNastup
    ? cascadeCount > 1
      ? `Tím se smaže celý pracovní poměr – ${cascadeCount} záznamů (Nástup, dodatky a případné Ukončení) včetně všech vygenerovaných i podepsaných smluv. Tato akce je nevratná.`
      : "Tím se smaže celý pracovní poměr včetně všech vygenerovaných i podepsaných smluv. Tato akce je nevratná."
    : "Pokud k záznamu existuje smlouva (nepodepsaná i podepsaná), bude také smazána. Tato akce je nevratná.";

  return (
    <div className={`${styles.row} ${isPhone ? styles.rowPhone : ""}`}>
      <div
        className={styles.meta}
        onClick={isPhone ? () => setExpanded((v) => !v) : undefined}
        role={isPhone ? "button" : undefined}
        tabIndex={isPhone ? 0 : undefined}
        aria-expanded={isPhone ? expanded : undefined}
        onKeyDown={
          isPhone
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setExpanded((v) => !v);
                }
              }
            : undefined
        }
      >
        {isPhone && <RowChevron open={expanded} />}
        <span className={styles.date}>{formatDateCZ(row.startDate)}</span>
        <span className={styles.kind}>{label}</span>
        {detail && <span className={styles.detail}>{detail}</span>}
      </div>
      {showActions && (
      <div className={styles.actions}>
        {canManageEmployment && onEdit && !signedLocked && (
          <button
            data-tour="emp-contract-edit"
            type="button"
            className={styles.editBtn}
            onClick={onEdit}
          >
            Upravit
          </button>
        )}
        {onSelfDownload ? (
          contract?.status === "signed" && (
            <button
              type="button"
              className={styles.editBtn}
              onClick={() => onSelfDownload(contract.id, contract.displayName)}
            >
              Stáhnout smlouvu
            </button>
          )
        ) : (
          <ContractActionButtons
            contract={contract}
            defaultType={defaultContractType}
            employmentRowId={row.id}
            rowSnapshot={rowSnapshot}
            defaultDisplayName={defaultDisplayName}
            employeeId={employeeId}
            onGenerate={onGenerate}
            onChanged={onContractsChanged}
          />
        )}
        {canManageEmployment && onDelete && (
          <button
            type="button"
            className={styles.deleteBtn}
            onClick={() => setConfirmDelete(true)}
          >
            Smazat
          </button>
        )}
      </div>
      )}

      {confirmDelete && (
        <ConfirmModal
          title={deleteTitle}
          message={deleteMessage}
          confirmLabel="Smazat"
          danger
          onConfirm={() => {
            setConfirmDelete(false);
            onDelete?.();
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
