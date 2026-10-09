/**
 * Kontrola mezd — pure core (no DOM, no libraries).
 *
 * TypeScript port of `excels/mzdy/kontrola_mzdy.py`: compares the hand-written
 * attendance workbook (XLS) with the accountant's payslips (PDF). The file
 * readers live in `readers.ts`; they hand this module plain rows / text lines,
 * so the logic here is unit-testable in Node against the Python reference.
 *
 * Everything runs in the browser: the payslips (net pay, bank accounts) never
 * leave the user's machine.
 */

// ─── Configuration (mirrors the constants at the top of the Python script) ───

/** (XLS column, payslip codes) — hours are compared. */
export const HOUR_CHECKS: [string, number[]][] = [
  ["odpr.hod.", [7, 769, 3883]],
  ["dovolená", [611]],
  ["nemoc", [657, 666]], // 657 náhrada od zaměstnavatele, 666 dávka ČSSZ
  ["noční př.", [404]],
  ["svátek", [988]],
  ["SO+NE", [441]],
];
/** Items forming the working-time fund — their deltas may cancel out. */
export const FUND_COLUMNS = ["odpr.hod.", "dovolená", "nemoc"];
/** Only presence is compared (the XLS value is not the CZK amount). */
export const PRESENCE_CHECKS: [string, number[]][] = [
  ["Home Office", [2202]],
  ["Náhrady", [8833]],
];
export type AmountSpec = [column: string, codes: number[], tolerance: number];
export const MULTISPORT: AmountSpec = ["Multisport", [2294], 0];
export const MEAL: AmountSpec = ["Stravenkový paušál", [239], 1]; // payslip rounds down to whole CZK
export const OTHER_AMOUNT_CHECKS: AmountSpec[] = [
  ["DPČ+DPP", [3883], 0],
  ["Pohyblivá složka", [528], 0],
  ["Roční bonus", [524], 0],
];

export const TAXPAYER_CREDIT = 2570;
const NO_DECLARATION = "prohlášení"; // part of the legend text "Nepodepíše prohlášení"

export const KNOWN_CODES = new Set<number>([
  7,
  ...[...HOUR_CHECKS, ...PRESENCE_CHECKS].flatMap(([, codes]) => codes),
  ...[MULTISPORT, MEAL, ...OTHER_AMOUNT_CHECKS].flatMap(([, codes]) => codes),
]);

export const MATCH_THRESHOLD = 0.75;
export const SURNAME_THRESHOLD = 0.7;
/** Pairings below this score are flagged for a human look. */
export const FUZZY_SCORE = 0.95;
const NO_FILL = new Set<string | null>([null, "FFFFFF"]);

// ─── Types ───────────────────────────────────────────────────────────────────

export type CellValue = string | number;
/** One spreadsheet cell: value + solid background colour as RRGGBB (or null). */
export type Cell = [value: CellValue, rgb: string | null];

export interface XlsEmployee {
  name: string;
  dept: string;
  /** 1-based spreadsheet row, for the "řádek N" pointer. */
  row: number;
  values: Record<string, CellValue>;
  note: string;
  /** Legend text of the name-cell colour, "#RRGGBB (mimo legendu)", or null. */
  flag: string | null;
}

export interface SlipItem {
  code: number;
  label: string;
  hours: number;
  days: number;
  amount: number;
  date: string;
}

export interface Slip {
  name: string;
  /** Accountant's personal number. */
  id: string;
  slip: number;
  centre: string;
  contract: string;
  credit: number | null;
  items: SlipItem[];
}

// ─── XLS ─────────────────────────────────────────────────────────────────────

export class CheckInputError extends Error {}

export function parseXlsRows(rows: Cell[][]): XlsEmployee[] {
  const headerIdx = rows.findIndex((r) => r.some(([v]) => v === "Příjmení a jméno"));
  if (headerIdx < 0) throw new CheckInputError("V XLS chybí hlavička se sloupcem „Příjmení a jméno“.");
  const header = rows[headerIdx].map(([v]) => String(v).trim());
  const col: Record<string, number> = {};
  header.forEach((h, i) => {
    if (h) col[h] = i;
  });
  for (const required of ["Prac. Skupina", "Multisport"]) {
    if (!(required in col)) throw new CheckInputError(`V XLS chybí sloupec „${required}“.`);
  }
  const nameCol = col["Příjmení a jméno"];
  const groupCol = col["Prac. Skupina"];
  const noteCol = col["Multisport"] + 1; // notes sit in the header-less column after Multisport
  const legendCol = col["Legenda:"] as number | undefined;
  const dataCols = Object.entries(col).filter(([, i]) => i !== nameCol && i !== groupCol && i !== legendCol);

  const cell = (row: Cell[], i: number): Cell => (i < row.length ? row[i] : ["", null]);

  const legend = new Map<string, string>();
  if (legendCol !== undefined) {
    for (const row of rows.slice(headerIdx + 1)) {
      const [text, rgb] = cell(row, legendCol);
      if (String(text).trim() && !NO_FILL.has(rgb) && !legend.has(rgb!)) legend.set(rgb!, String(text).trim());
    }
  }

  const employees: XlsEmployee[] = [];
  let dept = "";
  rows.slice(headerIdx + 1).forEach((row, k) => {
    const group = cell(row, groupCol)[0];
    if (typeof group === "string" && group.trim()) {
      dept = group.trim();
      return;
    }
    const [rawName, nameRgb] = cell(row, nameCol);
    const name = String(rawName).trim();
    if (!name) return;
    const values: Record<string, CellValue> = {};
    for (const [h, i] of dataCols) values[h] = cell(row, i)[0];
    const note = noteCol < header.length && !header[noteCol] ? String(cell(row, noteCol)[0]).trim() : "";
    const flag = NO_FILL.has(nameRgb) ? null : legend.get(nameRgb!) ?? `#${nameRgb} (mimo legendu)`;
    employees.push({ name, dept, row: headerIdx + 2 + k, values, note, flag });
  });
  return employees;
}

// ─── PDF ─────────────────────────────────────────────────────────────────────

const SLIP_RE = /^\s*(\d+)\s+(.+?)\s+MZDOVÝ LÍSTEK číslo:\s*(\d+)/;
const ITEM_RE = /^(\d+) (.+?) (-?\d+(?:,\d+)?) (-?\d+(?:,\d+)?) (-?\d+(?:,\d+)?) (\d{2}\.\d{2}\.\d{4})\s*$/;
const CONTRACT_RE = /^0 ([A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][^\d/]+?)\s*$/;
// Text extraction scatters labels and values: the taxpayer-credit value sits on
// the line right after the "Zvýhodnění děti" label.
const CREDIT_LABEL = "Zvýhodnění děti";

const num = (s: string) => parseFloat(s.replace(",", "."));

export function parsePdfLines(lines: string[]): Slip[] {
  const slips: Slip[] = [];
  let cur: Slip | null = null;
  lines.forEach((line, i) => {
    let m = SLIP_RE.exec(line);
    if (m) {
      cur = {
        name: m[2].split(/\s+/).join(" "),
        id: m[1],
        slip: Number(m[3]),
        centre: (lines[i + 1] ?? "").trim(),
        contract: "",
        credit: null,
        items: [],
      };
      slips.push(cur);
      return;
    }
    if (!cur) return;
    if ((m = ITEM_RE.exec(line))) {
      cur.items.push({
        code: Number(m[1]),
        label: m[2].trim(),
        hours: num(m[3]),
        days: num(m[4]),
        amount: num(m[5]),
        date: m[6],
      });
    } else if (line.trim() === CREDIT_LABEL && i + 1 < lines.length) {
      cur.credit = num(lines[i + 1].trim());
    } else if (!cur.contract && (m = CONTRACT_RE.exec(line))) {
      cur.contract = m[1];
    }
  });
  return slips;
}

export function pdfSum(slip: Slip, codes: number[], kind: "hours" | "amount"): number {
  return slip.items.filter((it) => codes.includes(it.code)).reduce((a, it) => a + it[kind], 0);
}

// ─── Name matching ───────────────────────────────────────────────────────────

/** difflib.SequenceMatcher(None, a, b).ratio() — same algorithm, no autojunk (tokens are short). */
export function seqRatio(a: string, b: string): number {
  const total = a.length + b.length;
  if (!total) return 1;
  const b2j = new Map<string, number[]>();
  [...b].forEach((ch, j) => {
    const list = b2j.get(ch);
    if (list) list.push(j);
    else b2j.set(ch, [j]);
  });
  const longest = (alo: number, ahi: number, blo: number, bhi: number): [number, number, number] => {
    let besti = alo, bestj = blo, bestsize = 0;
    let j2len = new Map<number, number>();
    for (let i = alo; i < ahi; i++) {
      const next = new Map<number, number>();
      for (const j of b2j.get(a[i]) ?? []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) ?? 0) + 1;
        next.set(j, k);
        if (k > bestsize) {
          besti = i - k + 1;
          bestj = j - k + 1;
          bestsize = k;
        }
      }
      j2len = next;
    }
    return [besti, bestj, bestsize];
  };
  let matches = 0;
  const queue: [number, number, number, number][] = [[0, a.length, 0, b.length]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop()!;
    const [i, j, k] = longest(alo, ahi, blo, bhi);
    if (!k) continue;
    matches += k;
    if (alo < i && blo < j) queue.push([alo, i, blo, j]);
    if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
  }
  return (2 * matches) / total;
}

export function normTokens(name: string): string[] {
  const s = name
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(bc|ing|mgr|ma|dis)\./gi, " ")
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .toLowerCase();
  return s.match(/[a-z]+/g) ?? [];
}

export function nameScore(xlsName: string, otherName: string): [avg: number, surname: number] {
  const xt = normTokens(xlsName), pt = normTokens(otherName);
  if (!xt.length || !pt.length) return [0, 0];
  const surname = seqRatio(xt[0], pt[0]);
  const avg = xt.reduce((acc, a) => acc + Math.max(...pt.map((b) => seqRatio(a, b))), 0) / xt.length;
  return [avg, surname];
}

export interface Pair {
  score: number;
  /** Index into the left list (XLS employees). */
  left: number;
  /** Index into the right list. */
  right: number;
}

/**
 * Greedy best-first pairing — copes with shared surnames (Fedash, Liakh…).
 * `leftNames[i]` is always an XLS-style "Příjmení Jméno".
 */
export function matchNames(leftNames: string[], rightNames: string[]) {
  const candidates: Pair[] = [];
  leftNames.forEach((l, li) => {
    rightNames.forEach((r, ri) => {
      const [score, surname] = nameScore(l, r);
      if (score >= MATCH_THRESHOLD && surname >= SURNAME_THRESHOLD) candidates.push({ score, left: li, right: ri });
    });
  });
  // Python sorts the (score, ei, si) tuples descending — ties fall to the higher index.
  candidates.sort((x, y) => y.score - x.score || y.left - x.left || y.right - x.right);
  const pairs: Pair[] = [];
  const usedL = new Set<number>(), usedR = new Set<number>();
  for (const c of candidates) {
    if (usedL.has(c.left) || usedR.has(c.right)) continue;
    pairs.push(c);
    usedL.add(c.left);
    usedR.add(c.right);
  }
  pairs.sort((x, y) => x.left - y.left);
  return {
    pairs,
    unmatchedLeft: leftNames.map((_, i) => i).filter((i) => !usedL.has(i)),
    unmatchedRight: rightNames.map((_, i) => i).filter((i) => !usedR.has(i)),
  };
}

// ─── XLS ↔ PDF checks ────────────────────────────────────────────────────────

/** Number from a cell; "" → 0; non-numeric text (e.g. "MATERSKA") → null. */
export function asNumber(v: CellValue | undefined | null): number | null {
  if (v === "" || v === undefined || v === null) return 0;
  if (typeof v === "number") return v;
  const t = v.trim();
  if (!t) return 0;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const isEmpty = (v: CellValue | undefined) => v === "" || v === 0 || v === undefined;
/** Hours/CZK compare at cent precision — float sums of 0.5 h items must not flap. */
const same = (a: number, b: number) => Math.abs(a - b) < 0.005;
export const round2 = (n: number) => Math.round(n * 100) / 100;

export interface HourFinding {
  /** XLS column → PDF − XLS. */
  deltas: Record<string, number>;
  net: number | null;
  detail: string;
  verdict: string;
  /** Fund does not add up — highlighted. */
  warn: boolean;
}

export function checkHours(emp: XlsEmployee, slip: Slip): HourFinding | null {
  const deltas: Record<string, number> = {};
  const details: string[] = [];
  const texts: string[] = [];
  for (const [column, codes] of HOUR_CHECKS) {
    if (!(column in emp.values)) continue;
    const pdfVal = pdfSum(slip, codes, "hours");
    const xlsVal = asNumber(emp.values[column]);
    if (xlsVal === null) {
      texts.push(`${column}: v XLS text „${emp.values[column]}“, v PDF ${fmtNum(pdfVal)} h`);
      continue;
    }
    if (!same(xlsVal, pdfVal)) {
      deltas[column] = round2(pdfVal - xlsVal);
      details.push(`${column} ${fmtNum(xlsVal)} → ${fmtNum(pdfVal)}`);
    }
  }
  if (!Object.keys(deltas).length && !texts.length) return null;
  const fund = FUND_COLUMNS.filter((c) => c in deltas).map((c) => deltas[c]);
  const net = fund.length ? round2(fund.reduce((a, b) => a + b, 0)) : null;
  let verdict: string;
  if (fund.length > 1 && net === 0) verdict = "Přesun hodin mezi položkami, součet sedí";
  else if (fund.length) verdict = `Fond pracovní doby nesedí o ${signed(net!)} h`;
  else verdict = "Rozdíl v příplatkových hodinách";
  if (texts.length) verdict = Object.keys(deltas).length ? `${verdict}; ${texts.join("; ")}` : texts.join("; ");
  return { deltas, net, detail: details.join("; "), verdict, warn: !!net };
}

export interface AllowanceFinding {
  column: string;
  xls: CellValue | null;
  pdf: number | null;
  verdict: string;
}

export function checkAllowances(emp: XlsEmployee, slip: Slip): AllowanceFinding[] {
  const out: AllowanceFinding[] = [];
  for (const [column, codes] of PRESENCE_CHECKS) {
    if (!(column in emp.values)) continue;
    const xlsVal = emp.values[column];
    const inXls = !isEmpty(xlsVal);
    const pdfAmount = pdfSum(slip, codes, "amount");
    if (inXls !== (pdfAmount !== 0)) {
      out.push({
        column,
        xls: inXls ? xlsVal : null,
        pdf: pdfAmount || null,
        verdict: inXls ? "V XLS je, ve mzdě chybí" : "Ve mzdě je, v XLS není",
      });
    }
  }
  return out;
}

export interface CreditFinding {
  flag: string | null;
  credit: number;
  verdict: string;
  warn: boolean;
}

export function hasNoDeclarationFlag(emp: XlsEmployee): boolean {
  return !!emp.flag && emp.flag.toLowerCase().includes(NO_DECLARATION);
}

export function checkCredit(emp: XlsEmployee, slip: Slip): CreditFinding | null {
  const noDecl = hasNoDeclarationFlag(emp);
  const credit = slip.credit ?? 0;
  if (noDecl && credit > 0)
    return { flag: emp.flag, credit, verdict: "Sleva uplatněna, přestože prohlášení není podepsané", warn: true };
  if (!noDecl && credit === 0)
    return { flag: emp.flag, credit: 0, verdict: "Sleva neuplatněna, v XLS chybí označení „Nepodepíše prohlášení“", warn: false };
  if (credit !== 0 && credit !== TAXPAYER_CREDIT)
    return { flag: emp.flag, credit, verdict: `Neobvyklá výše slevy (běžně ${TAXPAYER_CREDIT} Kč)`, warn: false };
  return null;
}

export interface AmountFinding {
  xls: CellValue | null;
  pdf: number | null;
  delta: number | null;
  note: string;
}

export function checkAmount(emp: XlsEmployee, slip: Slip, [column, codes, tol]: AmountSpec): AmountFinding | null {
  if (!(column in emp.values)) return null;
  const pdfVal = pdfSum(slip, codes, "amount");
  const xlsVal = asNumber(emp.values[column]);
  if (xlsVal === null) return { xls: emp.values[column], pdf: pdfVal, delta: null, note: "V XLS je text" };
  if (Math.abs(xlsVal - pdfVal) > tol + 0.005) return { xls: xlsVal, pdf: pdfVal, delta: round2(pdfVal - xlsVal), note: "" };
  return null;
}

export interface OtherFinding {
  item: string;
  xls: CellValue | null;
  pdf: number | null;
  delta: number | null;
  note: string;
}

export function checkOther(emp: XlsEmployee, slip: Slip): OtherFinding[] {
  const out: OtherFinding[] = [];
  for (const spec of OTHER_AMOUNT_CHECKS) {
    const r = checkAmount(emp, slip, spec);
    if (r) out.push({ item: spec[0], ...r });
  }
  for (const it of slip.items) {
    if (!KNOWN_CODES.has(it.code))
      out.push({ item: `${it.code} ${it.label}`, xls: null, pdf: it.amount, delta: null, note: `Jen v PDF (${fmtNum(it.hours)} h)` });
  }
  if (emp.note && !emp.note.toLowerCase().includes("multisport")) // those go to the MULTISPORT section
    out.push({ item: "Poznámka v XLS", xls: null, pdf: null, delta: null, note: emp.note });
  if (emp.flag && emp.flag.startsWith("#")) // legend colours are expected
    out.push({ item: "Barva v XLS", xls: null, pdf: null, delta: null, note: emp.flag });
  return out;
}

export interface Row<T> {
  emp: XlsEmployee;
  finding: T;
}

export interface XlsPdfSections {
  hours: Row<HourFinding>[];
  allow: Row<AllowanceFinding>[];
  credit: Row<CreditFinding>[];
  multi: Row<AmountFinding>[];
  meal: Row<AmountFinding>[];
  other: Row<OtherFinding>[];
}

export function runXlsPdfChecks(employees: XlsEmployee[], slips: Slip[], pairs: Pair[]): XlsPdfSections {
  const sec: XlsPdfSections = { hours: [], allow: [], credit: [], multi: [], meal: [], other: [] };
  for (const { left, right } of pairs) {
    const emp = employees[left], slip = slips[right];
    const h = checkHours(emp, slip);
    if (h) sec.hours.push({ emp, finding: h });
    for (const f of checkAllowances(emp, slip)) sec.allow.push({ emp, finding: f });
    const c = checkCredit(emp, slip);
    if (c) sec.credit.push({ emp, finding: c });
    const m = checkAmount(emp, slip, MULTISPORT);
    if (m) sec.multi.push({ emp, finding: m });
    else if (emp.note.toLowerCase().includes("multisport"))
      sec.multi.push({ emp, finding: { xls: null, pdf: null, delta: null, note: emp.note } });
    const meal = checkAmount(emp, slip, MEAL);
    if (meal) sec.meal.push({ emp, finding: meal });
    for (const f of checkOther(emp, slip)) sec.other.push({ emp, finding: f });
  }
  return sec;
}

// ─── Formatting ──────────────────────────────────────────────────────────────

/** Czech number: 1 234,5 (no trailing zeros). */
export function fmtNum(n: number): string {
  return round2(n).toLocaleString("cs-CZ", { maximumFractionDigits: 2 });
}

export function signed(n: number): string {
  return (n > 0 ? "+" : "") + fmtNum(n);
}
