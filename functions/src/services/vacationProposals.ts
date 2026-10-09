/**
 * Vacation-balance correction proposals from the payroll check (Kontrola mezd).
 *
 * Firestore: vacationProposals/{year}-{MM}_{employeeId}
 *   {
 *     employeeId, year, month,
 *     contract, slipName,                      // as read off the payslip
 *     pdf: { letosni, lonska, dodatkova },     // payslip remaining hours at month end
 *     status: "pending" | "applied" | "dismissed" | "resolved",
 *     createdAt, createdBy, createdByName,
 *     reviewedAt, reviewedBy, reviewedByName,
 *     appliedCurrentYearHours: number | null,
 *     updatedAt,
 *   }
 *
 * The payroll checker and the person who manages vacation balances are
 * different people, so a discrepancy found in Kontrola mezd is parked here and
 * taken over (Převzít) or dismissed (Zamítnout) later on the Dovolená page.
 *
 * Only the PAYSLIP side is stored. Every app-side figure (appRemaining, delta,
 * the proposed Letošní) is recomputed from the ledger as it is NOW, through
 * `evaluateProposal` below — at save, at list, at count and at apply — so a
 * ledger edited in the meantime can never be overwritten with a stale number.
 */
import * as admin from "firebase-admin";
import {
  consumedAsOfMonth,
  remainingAsOfMonth,
  type LedgerMonth,
} from "./vacationLedger";

export type ProposalStatus = "pending" | "applied" | "dismissed" | "resolved";

export interface PayslipVacation {
  letosni: number;
  lonska: number;
  dodatkova: number;
}

export interface ProposalEvaluation {
  /** Payslip total P = letošní + loňská + dodatková. */
  total: number;
  /** App remaining at the end of `month`; null when Nárok unset / no ledger doc. */
  appRemaining: number | null;
  /** Ledger Letošní as it is now (null when unset / no ledger doc). */
  currentYearHours: number | null;
  /** P − base, rounded to 2 dp. */
  delta: number;
  discrepancy: boolean;
  /** (currentYearHours ?? 0) + delta, rounded to 2 dp. */
  proposedCurrentYearHours: number;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

export const proposalsCol = (): admin.firestore.CollectionReference =>
  admin.firestore().collection("vacationProposals");

/** Deterministic id: one proposal per (employee, year, month). */
export function proposalId(year: number, month: number, employeeId: string): string {
  return `${year}-${String(month).padStart(2, "0")}_${employeeId}`;
}

/** Read the stored payslip side defensively (legacy/garbled docs read as 0). */
export function readPdf(data: Record<string, unknown>): PayslipVacation {
  const p = (data.pdf ?? {}) as Record<string, unknown>;
  const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return { letosni: n(p.letosni), lonska: n(p.lonska), dodatkova: n(p.dodatkova) };
}

export function samePdf(a: PayslipVacation, b: PayslipVacation): boolean {
  return (
    round2(a.letosni) === round2(b.letosni) &&
    round2(a.lonska) === round2(b.lonska) &&
    round2(a.dodatkova) === round2(b.dodatkova)
  );
}

/**
 * THE correction rule — the only place it exists. Every endpoint (save from
 * Kontrola mezd, list, pending-count, apply) calls this against the CURRENT
 * ledger doc data (`null` when the ledger doc for that year does not exist).
 *
 *   appRemaining = remainingAsOfMonth(ledger, month)        (null if Nárok unset)
 *   base         = appRemaining ?? −(čerpáno 1..month + Proplaceno)
 *   delta        = round2(P − base)
 *   discrepancy  = NOT (|delta| < 0.005 AND (appRemaining !== null OR P === 0))
 *   proposed     = round2((Letošní ?? 0) + delta)
 *
 * The fallback base makes an unset Nárok behave as 0, so taking the proposal
 * over sets Letošní such that the app's remaining equals the payslip's; and an
 * unset Nárok with a non-zero payslip balance is always a discrepancy, even when
 * the arithmetic happens to cancel, because "–" ≠ a real balance.
 */
export function evaluateProposal(
  ledgerData: Record<string, unknown> | null,
  month: number,
  pdf: PayslipVacation
): ProposalEvaluation {
  const L = ledgerData ?? {};
  const months = (L.months as Record<string, LedgerMonth> | undefined) ?? {};
  const priorYearHours = (L.priorYearHours as number | null | undefined) ?? null;
  const currentYearHours = (L.currentYearHours as number | null | undefined) ?? null;
  const paidOutHours = (L.paidOutHours as number | null | undefined) ?? null;

  const total = round2(pdf.letosni + pdf.lonska + pdf.dodatkova);
  const appRemaining = ledgerData
    ? remainingAsOfMonth({ priorYearHours, currentYearHours, paidOutHours, months }, month)
    : null;
  const base = appRemaining ?? -(consumedAsOfMonth(months, month) + (paidOutHours ?? 0));
  const delta = round2(total - base);
  const discrepancy = !(Math.abs(delta) < 0.005 && (appRemaining !== null || total === 0));
  return {
    total,
    appRemaining,
    currentYearHours,
    delta,
    discrepancy,
    proposedCurrentYearHours: round2((currentYearHours ?? 0) + delta),
  };
}
