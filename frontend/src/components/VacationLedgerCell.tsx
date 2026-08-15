import { useState } from "react";

/**
 * One value of a vacation-hour ledger, in its display or its edit state.
 *
 * Extracted from VacationLedgerSection so the per-employee section (employee
 * detail + Můj profil) and the aggregate table on /dovolena share ONE copy of
 * the interaction and its validation: double-click opens an input, Enter or
 * blur saves, Escape cancels, an empty input clears the value to null, and the
 * Czech decimal comma is accepted on input and used on output.
 *
 * The component is deliberately dumb about *what* it edits: the caller owns the
 * "which cell is open" state (`editing`), the in-flight flag (`saving`) and the
 * PATCH itself (`onCommit`). Validation lives here because it is the half that
 * must not drift between the two callers — it mirrors the server rule that
 * month cells reject negatives while the annual figures (Loňská / Letošní /
 * Proplaceno) accept them.
 *
 * Class names come in as props rather than from a module of its own so each
 * caller keeps its existing look (the section's compact summary vs. the table's
 * dense grid) without a second set of near-identical rules to keep in sync.
 */

export type LedgerCellValue = number | null | undefined;

/** Default rendering: Czech decimal comma, en dash for "no value". */
export function formatLedgerValue(v: LedgerCellValue): string {
  if (v == null) return "–";
  return String(v).replace(".", ",");
}

/** Value → editable draft text (Czech decimal comma, empty for null). */
function toDraft(v: LedgerCellValue): string {
  return v == null ? "" : String(v).replace(".", ",");
}

type ParseResult =
  | { ok: true; hours: number | null }
  | { ok: false; message: string };

/**
 * Parse the draft the same way the server validates it. Empty clears to null.
 * `allowNegative` is false for month cells (čerpáno cannot be negative) and
 * true for the annual figures, which carry deficits forward.
 */
export function parseLedgerDraft(draft: string, allowNegative: boolean): ParseResult {
  const raw = draft.trim().replace(",", ".");
  if (raw === "") return { ok: true, hours: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || (!allowNegative && n < 0)) {
    return {
      ok: false,
      message: allowNegative
        ? "Zadejte číslo (počet hodin), nebo nechte prázdné pro smazání."
        : "Zadejte nezáporné číslo (počet hodin), nebo nechte prázdné pro smazání.",
    };
  }
  return { ok: true, hours: n };
}

interface LedgerCellInputProps {
  initial: string;
  allowNegative: boolean;
  saving: boolean;
  inputClassName?: string;
  onCommit: (hours: number | null) => void;
  onCancel: () => void;
  onError: (message: string) => void;
}

/**
 * Mounted fresh each time a cell opens, which is what seeds the draft from the
 * current value without an effect (and without a frame of empty input).
 */
function LedgerCellInput({
  initial,
  allowNegative,
  saving,
  inputClassName,
  onCommit,
  onCancel,
  onError,
}: LedgerCellInputProps) {
  const [draft, setDraft] = useState(initial);

  function commit() {
    const parsed = parseLedgerDraft(draft, allowNegative);
    if (!parsed.ok) {
      // Stay open so the bad text is still there to fix — same as before the
      // extraction, where an invalid save() returned early without clearing.
      onError(parsed.message);
      return;
    }
    onCommit(parsed.hours);
  }

  return (
    <input
      className={inputClassName}
      type="text"
      inputMode="decimal"
      value={draft}
      autoFocus
      disabled={saving}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
    />
  );
}

export interface VacationLedgerCellProps {
  value: LedgerCellValue;
  /** This cell is the one open for editing (the caller allows only one). */
  editing: boolean;
  /** ← employees.vacationBalance.manage. Read-only callers get plain text. */
  canManage: boolean;
  /** Value was hand-edited (source "manual") → warning background + "*". */
  isManual?: boolean;
  /** Month cells: false. Loňská / Letošní / Proplaceno: true. */
  allowNegative: boolean;
  /** A save is in flight (disables the input). */
  saving: boolean;
  /** Display formatter; defaults to the Czech-comma / en-dash rendering. */
  format?: (v: LedgerCellValue) => string;
  /** Extra class on the display element (cell-specific colouring). */
  className?: string;
  /** Class applied when the value is clickable. */
  editableClassName?: string;
  /** Class applied when `isManual`. */
  overriddenClassName?: string;
  /** Class for the <input> in the edit state. */
  inputClassName?: string;
  /** Overrides the default "Dvojklik pro úpravu" / "Ručně upraveno" tooltip. */
  title?: string;
  onStartEdit: () => void;
  onCommit: (hours: number | null) => void;
  onCancel: () => void;
  onError: (message: string) => void;
}

export default function VacationLedgerCell({
  value,
  editing,
  canManage,
  isManual = false,
  allowNegative,
  saving,
  format = formatLedgerValue,
  className,
  editableClassName,
  overriddenClassName,
  inputClassName,
  title,
  onStartEdit,
  onCommit,
  onCancel,
  onError,
}: VacationLedgerCellProps) {
  if (editing) {
    return (
      <LedgerCellInput
        initial={toDraft(value)}
        allowNegative={allowNegative}
        saving={saving}
        inputClassName={inputClassName}
        onCommit={onCommit}
        onCancel={onCancel}
        onError={onError}
      />
    );
  }

  const cls = [
    className ?? "",
    canManage ? (editableClassName ?? "") : "",
    isManual ? (overriddenClassName ?? "") : "",
  ]
    .join(" ")
    .trim();

  const defaultTitle = isManual
    ? `Ručně upraveno${canManage ? " · dvojklik upraví" : ""}`
    : canManage
      ? "Dvojklik pro úpravu"
      : undefined;

  return (
    <span
      className={cls || undefined}
      onDoubleClick={() => {
        if (!canManage) return;
        onStartEdit();
      }}
      title={title ?? defaultTitle}
    >
      {format(value)}
    </span>
  );
}
