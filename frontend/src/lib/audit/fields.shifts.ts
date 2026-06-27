/**
 * Czech field labels for the `shiftPlans` collection and its sub-docs
 * (shifts, planEmployees, rules, modRow, shiftChangeRequests,
 * shiftOverrideRequests, unavailabilityRequests). Filled in by the
 * shifts-labels task.
 *
 * Field leaf names are sourced from functions/src/routes/shifts.ts (the
 * authoritative audited writes) and the Czech UI wording in
 * frontend/src/lib/shiftConstants.ts + ShiftPlannerPage.tsx.
 */

import type { FieldLabelMap } from "./labels";

const shiftPlans: FieldLabelMap = {
  // ── Plan document ──────────────────────────────────────────────────────────
  month: "Měsíc",
  year: "Rok",
  status: "Stav",
  state: "Stav",
  // Systém auto-transition summary (plan.autoTransition)
  from: "Původní stav",
  to: "Nový stav",
  // Systém auto-fill manager R summary (plan.autoFillManagerR)
  filled: "Doplněno směn R",
  managers: "Počet vedoucích",
  createdBy: "Vytvořil",
  createdAt: "Vytvořeno",
  updatedAt: "Naposledy upraveno",
  // Automatic transition deadlines (PATCH .../deadlines)
  openedAt: "Datum otevření",
  closedAt: "Datum uzavření",
  publishedAt: "Datum publikování",
  openAt: "Datum otevření",
  closeAt: "Datum uzavření",
  publishAt: "Datum publikování",
  // MOD (Manager on Duty) letter → employee assignment map
  modPersons: "Přiřazení MOD (vedoucí směny)",

  // ── Plan employees (planEmployees) ───────────────────────────────────────────
  employeeId: "Zaměstnanec",
  firstName: "Jméno",
  lastName: "Příjmení",
  displayName: "Zobrazované jméno",
  section: "Sekce",
  primaryShiftType: "Výchozí typ směny",
  primaryHotel: "Výchozí hotel",
  contractType: "Typ úvazku",
  displayOrder: "Pořadí",
  order: "Pořadí",
  active: "Aktivní",
  cascadedShifts: "Smazané navázané směny",
  sourcePlanId: "Zdrojový plán",
  copied: "Počet zkopírovaných zaměstnanců",
  kind: "Typ akce",

  // ── Shift cells (shifts) ─────────────────────────────────────────────────────
  date: "Datum",
  rawInput: "Směna (zápis)",
  segments: "Segmenty směny",
  hoursComputed: "Vypočtené hodiny",
  isDouble: "Dvojitá směna",
  typeTag: "Typ směny (štítek)",

  // ── Rules ──────────────────────────────────────────────────────────────────
  ruleType: "Typ pravidla",
  value: "Hodnota",
  enabled: "Zapnuto",
  rules: "Pravidla",

  // ── MOD row (modRow) ──────────────────────────────────────────────────────────
  code: "Kód MOD",

  // ── Requests (unavailabilityRequests / shiftOverrideRequests /
  //    shiftChangeRequests) ────────────────────────────────────────────────────
  reason: "Důvod",
  isException: "Výjimka",
  requestedInput: "Požadovaná směna",
  currentRawInput: "Stávající směna",
  violationTypes: "Porušená pravidla",
  requestedBy: "Zažádal",
  requestedAt: "Zažádáno",
  reviewedBy: "Vyřídil",
  reviewedAt: "Vyřízeno",
  rejectionReason: "Důvod zamítnutí",
};

export const SHIFT_FIELDS: Record<string, FieldLabelMap> = { shiftPlans };
