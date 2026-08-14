import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useIsPhone } from "@/hooks/useIsPhone";
import { ContractType } from "@/lib/contractVariables";
import {
  docKindForChangeType,
  docWords,
  EMPLOYMENT_DOC_KINDS,
} from "@/lib/contractDocKind";
import { formatDateCZ } from "@/lib/dateFormat";
import { UVAZEK_KIND, LEGACY_UVAZEK_KIND, LEGACY_HOURS_KIND } from "@/lib/changeKinds";
import type { ChangeRow, EmploymentRow, ContractRecord } from "@/lib/employmentSessions";
import ContractActionButtons from "./ContractActionButtons";
import AlignedLabel from "./AlignedLabel";
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

/**
 * Read actions an employee has on their OWN signed document. Passing this
 * object is what puts the card in self-service mode (Můj profil).
 */
export interface SelfServiceActions {
  /** Open the signed PDF in a new tab. */
  onPreview: (contractId: string) => void;
  /** Save the signed PDF under its convention filename. */
  onDownload: (contractId: string, displayName?: string) => void;
}

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
   * Self-service (Můj profil) mode. The row then offers exactly two actions on
   * its signed document - open it and save it - and NO management affordances:
   * no Upravit, no Smazat, no generate/sign. That holds even for a viewer who
   * happens to hold employment.manage, because an admin reading their own
   * profile is a viewer there; the page's edit callbacks are no-ops anyway, so
   * the buttons only ever promised something that could not happen.
   */
  selfService?: SelfServiceActions;
}

const ROW_LABEL: Record<string, string> = {
  "nástup": "Nástup",
  "změna smlouvy": "Dodatek",
  "ukončení": "Ukončení",
};

const CHANGE_KIND_LABEL: Record<string, string> = {
  "mzda": "Mzda",
  "pracovní pozice": "Pozice",
  [UVAZEK_KIND]: "Úvazek (počet hodin)",
  "délka smlouvy": "Délka smlouvy",
  // Retired kinds, still shown on Dodatky saved before the merge.
  [LEGACY_UVAZEK_KIND]: "Úvazek",
  [LEGACY_HOURS_KIND]: "Počet hodin týdně",
};

function renderChangeValue(change: ChangeRow): React.ReactNode {
  const { changeKind: kind, value } = change;
  // Merged úvazek: both halves on one line ("20 h/týd. · PPP"). Either half may
  // be absent on a row saved before the other was required.
  if (kind === UVAZEK_KIND) {
    const hours = value ? `${value} h/týd.` : "";
    const ct = change.contractType || "";
    return [hours, ct].filter(Boolean).join(" · ") || "–";
  }
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
  selfService,
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
  // admin/director hold employment.manage → unchanged. Self-service is the one
  // hard override: on Můj profil nobody manages anything, permission or not.
  const canManageEmployment = !selfService && can("employment.manage");
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
            {k}: {renderChangeValue(c)}
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

  // The row states what its document is; the resolved template does not (a
  // Nástup row with an unrecognised contract type resolves to no template at
  // all and must still read "smlouva").
  const docKind = docKindForChangeType(row.changeType);
  const w = docWords(docKind);

  // Widths the self-service preview button shares with the sibling rows. Same
  // wording as the detail page, and every row here is signed by definition.
  const selfPreviewVariants = EMPLOYMENT_DOC_KINDS.map(
    (k) => `Zobrazit ${docWords(k).podepsanyAkuzativ}`
  );

  const signedLocked = !!contract?.signedStoragePath;
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Handed to ContractActionButtons rather than rendered here: the actions are
  // right-aligned, so "Upravit" only keeps a stable column if it sits between
  // the preview pair and the generated-document slot.
  const editButton = canManageEmployment && onEdit && !signedLocked && (
    <button
      data-tour="emp-contract-edit"
      type="button"
      className={styles.editBtn}
      onClick={onEdit}
    >
      Upravit
    </button>
  );

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
    : `Pokud k záznamu existuje ${w.nominativ.toLowerCase()}, bude také ${w.smazan} – včetně případné podepsané kopie. Tato akce je nevratná.`;

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
        {selfService ? (
          contract?.status === "signed" && (
            <>
              <button
                type="button"
                className={styles.editBtn}
                onClick={() => selfService.onPreview(contract.id)}
              >
                <AlignedLabel variants={selfPreviewVariants}>
                  {`Zobrazit ${w.podepsanyAkuzativ}`}
                </AlignedLabel>
              </button>
              <button
                type="button"
                className={styles.editBtn}
                onClick={() => selfService.onDownload(contract.id, contract.displayName)}
              >
                Stáhnout
              </button>
            </>
          )
        ) : (
          <ContractActionButtons
            contract={contract}
            docKind={docKind}
            alignKinds={EMPLOYMENT_DOC_KINDS}
            editSlot={editButton}
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
