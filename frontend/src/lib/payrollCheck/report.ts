/**
 * Kontrola mezd — Excel export ("MZDY-kontrola-YYYY-MM.xlsx"). Rendered from
 * the same section model as the modal; layout follows the Python script's
 * report (one "Kontrola" sheet with coloured section bands + "Párování").
 */
import { buildSections, pairingRows, type CheckResult } from "./index";

const TITLE_FILL = "FF1F4E78";
const HEAD_FILL = "FFD9E1F2";
const WARN_FILL = "FFFCE4D6";
const OK_FILL = "FFE2EFDA";
const DELTA_FMT = "+0.##;-0.##;0";

const solid = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });

export async function exportCheckXlsx(r: CheckResult): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Kontrola");
  const sections = buildSections(r);
  const ncols = Math.max(...sections.map((s) => s.columns.length));

  ws.addRow([
    `Kontrola mezd ${r.tag} – ${r.employees.length} zaměstnanců v XLS, ${r.slips.length} mzdových lístků, spárováno ${r.pairs.length}, ve mzdách aplikace ${r.appEntries.length}`,
  ]).font = { bold: true, size: 14 };
  for (const w of r.warnings) ws.addRow([`⚠ ${w}`]).font = { bold: true, color: { argb: "FFC00000" } };

  for (const s of sections) {
    ws.addRow([]);
    const t = ws.addRow([`${s.title.toUpperCase()}  (${s.rows.length})`]);
    ws.mergeCells(t.number, 1, t.number, ncols);
    t.getCell(1).font = { bold: true, color: { argb: "FFFFFFFF" }, size: 12 };
    t.getCell(1).fill = solid(TITLE_FILL);

    const h = ws.addRow(s.columns);
    h.eachCell((c) => {
      c.font = { bold: true };
      c.fill = solid(HEAD_FILL);
      c.alignment = { wrapText: true, vertical: "middle" };
    });

    if (!s.rows.length) {
      const e = ws.addRow(["Bez rozdílů"]);
      e.getCell(1).font = { italic: true, color: { argb: "FF375623" } };
      e.getCell(1).fill = solid(OK_FILL);
      continue;
    }
    for (const row of s.rows) {
      const xr = ws.addRow(row.cells.map((c) => (c === null ? undefined : c)));
      for (const i of s.deltaCols) {
        const c = xr.getCell(i + 1);
        c.numFmt = DELTA_FMT;
        if (typeof c.value === "number" && c.value !== 0) c.font = { bold: true, color: { argb: "FFC00000" } };
      }
      if (row.warn) for (let i = 1; i <= s.columns.length; i++) xr.getCell(i).fill = solid(WARN_FILL);
    }
  }
  [30, 26, 24, 12, 12, 12, 12, 12, 12, 40, 45].forEach((w, i) => (ws.getColumn(i + 1).width = w));

  const pw = wb.addWorksheet("Párování");
  pw.addRow(["XLS", "PDF", "Shoda", "Středisko", "Úvazek", "Sleva na poplatníka", "Aplikace"]).eachCell((c) => {
    c.font = { bold: true };
    c.fill = solid(HEAD_FILL);
  });
  for (const p of pairingRows(r)) {
    const xr = pw.addRow([p.xls, p.pdf, p.score, p.centre, p.contract, p.credit, p.app]);
    if (p.fuzzy) for (let i = 1; i <= 7; i++) xr.getCell(i).fill = solid(WARN_FILL);
  }
  [32, 40, 8, 32, 26, 10, 32].forEach((w, i) => (pw.getColumn(i + 1).width = w));
  pw.views = [{ state: "frozen", ySplit: 1 }];

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `MZDY-kontrola-${r.tag}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
