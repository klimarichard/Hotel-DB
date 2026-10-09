/**
 * Kontrola mezd — orchestration + the section model shared by the modal and
 * the Excel export (one model → the screen and the file cannot drift apart).
 */
import {
  CheckInputError,
  FUZZY_SCORE,
  HOUR_CHECKS,
  fmtNum,
  matchNames,
  parsePdfLines,
  parseVacationBlocks,
  parseXlsRows,
  runXlsPdfChecks,
  type Pair,
  type Slip,
  type XlsEmployee,
  type XlsPdfSections,
} from "./core";
import { appEntryName, runAppChecks, type AppCheckData, type AppSection } from "./appCheck";
import { readPayslipPdf, readXlsRows } from "./readers";
import { runVacationChecks, type VacationFinding } from "./vacationCheck";

export { CheckInputError } from "./core";
export type { AppCheckData } from "./appCheck";

export interface CheckResult {
  /** "YYYY-MM" of the payroll period. */
  tag: string;
  employees: XlsEmployee[];
  slips: Slip[];
  pairs: Pair[];
  unmatchedXls: XlsEmployee[];
  unmatchedPdf: Slip[];
  sections: XlsPdfSections;
  app: AppSection;
  /** The app's entries — `app.pairs[].right` indexes into this. */
  appEntries: AppCheckData["entries"];
  /** Payslip remaining vacation ≠ the app's ledger (empty = all agree). */
  vacation: VacationFinding[];
  /** Period year, for ledger writes. */
  year: number;
  /** Parser sanity warnings, shown above the findings. */
  warnings: string[];
}

export async function runPayrollCheck(xlsFile: File, pdfFile: File, app: AppCheckData): Promise<CheckResult> {
  const [rows, pdf] = await Promise.all([readXlsRows(xlsFile), readPayslipPdf(pdfFile)]);
  const employees = parseXlsRows(rows);
  const slips = parsePdfLines(pdf.lines);
  const vacationBlocks = parseVacationBlocks(pdf.pages);
  for (const s of slips) s.vacation = vacationBlocks.get(s.slip) ?? null;
  if (!employees.length) throw new CheckInputError("V XLS nebyl nalezen žádný zaměstnanec.");
  if (!slips.length) throw new CheckInputError("V PDF nebyl nalezen žádný mzdový lístek. Je to opravdu PDF s mzdovými lístky?");

  // A payslip layout change would make lines silently stop parsing — say so loudly.
  const warnings: string[] = [];
  const empty = slips.filter((s) => !s.items.length);
  if (empty.length)
    warnings.push(`Na ${empty.length} z ${slips.length} mzdových lístků se nepodařilo přečíst žádnou mzdovou složku (${empty.map((s) => s.name).join(", ")}). Výsledky u nich nejsou spolehlivé.`);
  const noCredit = slips.filter((s) => s.credit === null);
  if (noCredit.length) warnings.push(`Na lístcích ${noCredit.map((s) => s.name).join(", ")} nebyla nalezena sleva na poplatníka.`);
  const noVacation = slips.filter((s) => !s.vacation);
  if (noVacation.length)
    warnings.push(`Na lístcích ${noVacation.map((s) => s.name).join(", ")} se nepodařilo přečíst zůstatek dovolené – u nich se dovolená nekontroluje.`);

  const { pairs, unmatchedLeft, unmatchedRight } = matchNames(employees.map((e) => e.name), slips.map((s) => s.name));
  return {
    tag: `${app.year}-${String(app.month).padStart(2, "0")}`,
    employees,
    slips,
    pairs,
    unmatchedXls: unmatchedLeft.map((i) => employees[i]),
    unmatchedPdf: unmatchedRight.map((i) => slips[i]),
    sections: runXlsPdfChecks(employees, slips, pairs),
    app: runAppChecks(employees, app),
    appEntries: app.entries,
    vacation: runVacationChecks(slips, app.entries),
    year: app.year,
    warnings,
  };
}

// ─── Section model ───────────────────────────────────────────────────────────

export type SectionCell = string | number | null;

/** A correction the user can apply from the modal (screen only, not exported). */
export interface VacationAction {
  employeeId: string;
  year: number;
  currentYearHours: number;
}

export interface SectionRow {
  cells: SectionCell[];
  /** Highlight the whole row. */
  warn?: boolean;
  action?: VacationAction;
}

export interface Section {
  key: string;
  title: string;
  columns: string[];
  rows: SectionRow[];
  /** Column indexes holding signed differences (shown red + with a sign). */
  deltaCols: number[];
  /** Drop the section entirely when it has no rows (instead of "Bez rozdílů"). */
  hideWhenEmpty?: boolean;
}

export const HOUR_COLUMNS = HOUR_CHECKS.map(([c]) => c);

export function buildSections(r: CheckResult): Section[] {
  const s = r.sections;
  const out: Section[] = [];

  out.push({
    key: "unmatched",
    title: "Nespárovaní (XLS × PDF)",
    columns: ["Zaměstnanec", "Úsek / středisko", "Zdroj", "Detail"],
    rows: [
      ...r.unmatchedXls.map((e) => ({ cells: [e.name, e.dept, "jen v XLS", `řádek ${e.row}` + (e.flag ? `, ${e.flag}` : "")] })),
      ...r.unmatchedPdf.map((p) => ({ cells: [p.name, p.centre, "jen v PDF", `lístek ${p.slip}, ${p.contract}`] })),
    ],
    deltaCols: [],
  });

  out.push({
    key: "app",
    title: "Aplikace × XLS",
    columns: ["Zaměstnanec", "Úsek", "Položka", "XLS", "Aplikace", "Rozdíl", "Poznámka"],
    rows: [
      ...r.app.missingInXls.map((e) => ({
        cells: [appEntryName(e), "", "Celý řádek", null, null, null, "Je ve mzdách v aplikaci, v XLS chybí"],
        warn: true,
      })),
      ...r.app.rows.map(({ emp, finding: f }) => ({ cells: [emp.name, emp.dept, f.item, f.xls, f.app, f.delta, f.note] })),
    ],
    deltaCols: [5],
  });

  out.push({
    key: "hours",
    title: "Hodiny (XLS × PDF)",
    columns: ["Zaměstnanec", "Úsek", ...HOUR_COLUMNS, "Součet fondu", "Hodnocení", "Detail (XLS → PDF)"],
    rows: s.hours.map(({ emp, finding: h }) => ({
      cells: [emp.name, emp.dept, ...HOUR_COLUMNS.map((c) => h.deltas[c] ?? null), h.net, h.verdict, h.detail],
      warn: h.warn,
    })),
    deltaCols: HOUR_COLUMNS.map((_, i) => i + 2).concat(HOUR_COLUMNS.length + 2),
  });

  out.push({
    key: "allow",
    title: "Náhrady",
    columns: ["Zaměstnanec", "Úsek", "Položka", "XLS", "PDF (Kč)", "Hodnocení"],
    rows: s.allow.map(({ emp, finding: f }) => ({ cells: [emp.name, emp.dept, f.column, f.xls ?? "–", f.pdf ?? "–", f.verdict] })),
    deltaCols: [],
  });

  out.push({
    key: "credit",
    title: "Sleva na poplatníka",
    columns: ["Zaměstnanec", "Úsek", "Označení v XLS", "Sleva v PDF (Kč)", "Hodnocení"],
    rows: s.credit.map(({ emp, finding: f }) => ({ cells: [emp.name, emp.dept, f.flag ?? "–", f.credit, f.verdict], warn: f.warn })),
    deltaCols: [],
  });

  for (const [key, title] of [["multi", "Multisport"], ["meal", "Stravenkový paušál"]] as const) {
    out.push({
      key,
      title,
      columns: ["Zaměstnanec", "Úsek", "XLS (Kč)", "PDF (Kč)", "Rozdíl", "Poznámka"],
      rows: s[key].map(({ emp, finding: f }) => ({ cells: [emp.name, emp.dept, f.xls, f.pdf, f.delta, f.note] })),
      deltaCols: [4],
    });
  }

  out.push({
    key: "other",
    title: "Ostatní",
    columns: ["Zaměstnanec", "Úsek", "Položka", "XLS", "PDF (Kč)", "Rozdíl", "Poznámka"],
    rows: s.other.map(({ emp, finding: f }) => ({ cells: [emp.name, emp.dept, f.item, f.xls, f.pdf, f.delta, f.note] })),
    deltaCols: [5],
  });

  // Only when something disagrees (user's call) – hence hideWhenEmpty.
  out.push({
    key: "vacation",
    title: "Dovolená (aplikace × PDF)",
    columns: ["Zaměstnanec", "Úvazek", "Zůstatek v aplikaci (h)", "Zůstatek na lístku (h)", "Rozdíl", "Letošní nárok (h)", "Nový Letošní nárok (h)", "Lístek: Letošní · Loňská · Dodatková"],
    rows: r.vacation.map((v) => ({
      cells: [
        appEntryName(v.entry),
        v.slip.contract,
        v.appRemaining ?? "nárok nezadán",
        v.pdfRemaining,
        v.delta,
        v.currentYearHours,
        v.proposedCurrentYearHours,
        [v.slip.vacation!.letosni, v.slip.vacation!.lonska, v.slip.vacation!.dodatkova].map(fmtNum).join(" · "),
      ],
      action: { employeeId: v.entry.employeeId, year: r.year, currentYearHours: v.proposedCurrentYearHours },
    })),
    deltaCols: [4],
    hideWhenEmpty: true,
  });

  return out.filter((sec) => !(sec.hideWhenEmpty && !sec.rows.length));
}

export interface PairingRow {
  xls: string;
  pdf: string;
  score: number;
  centre: string;
  contract: string;
  credit: number;
  app: string;
  fuzzy: boolean;
}

/** The "Párování" list: every XLS↔PDF pair plus the app entry matched to that XLS row. */
export function pairingRows(r: CheckResult): PairingRow[] {
  const appByXls = new Map(r.app.pairs.map((p) => [p.left, p]));
  return r.pairs.map((p) => {
    const slip = r.slips[p.right];
    const ap = appByXls.get(p.left);
    return {
      xls: r.employees[p.left].name,
      pdf: slip.name,
      score: Math.round(p.score * 100) / 100,
      centre: slip.centre,
      contract: slip.contract,
      credit: slip.credit ?? 0,
      app: ap ? appEntryName(r.appEntries[ap.right]) : "",
      fuzzy: p.score < FUZZY_SCORE || (!!ap && ap.score < FUZZY_SCORE),
    };
  });
}

/** Names the user should eyeball: fuzzy pairings on either side. */
export function fuzzyNames(r: CheckResult): string[] {
  return pairingRows(r).filter((p) => p.fuzzy).map((p) => p.xls);
}
