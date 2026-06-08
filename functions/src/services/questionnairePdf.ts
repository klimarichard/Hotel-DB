/**
 * Builds the HTML for the "Osobní dotazník zaměstnance" (employee personal
 * questionnaire) export. The layout reproduces the legacy Excel form
 * (`screenshots/dotaznik.pdf`): a titled header, single-column label + boxed
 * value rows, a dark "CIZINCI" sub-section with two-column passport/permit rows,
 * then contact + insurance fields.
 *
 * The returned string is fed to `renderPdf()` (Puppeteer/Chromium), which wraps
 * it in <body> and applies its base CSS — a <style> block inside this body still
 * applies, so all form-specific styling lives here. Chromium renders Czech
 * diacritics natively, so no font embedding is needed (unlike the pdf-lib
 * overlay path used for the tax declaration).
 *
 * Every value is HTML-escaped. Sensitive fields (rodné číslo, číslo OP, číslo
 * pojištěnce, číslo účtu) arrive already DECRYPTED — the caller is responsible
 * for permission gating and audit logging.
 */

export interface QuestionnaireData {
  jobTitle?: string | null;
  startDate?: string | null; // YYYY-MM-DD
  firstName?: string | null;
  lastName?: string | null;
  birthSurname?: string | null;
  nationality?: string | null;
  placeOfBirth?: string | null;
  dateOfBirth?: string | null; // YYYY-MM-DD
  birthNumber?: string | null; // decrypted
  maritalStatus?: string | null;
  education?: string | null;
  permanentAddress?: string | null;
  contactAddress?: string | null;
  idCardNumber?: string | null; // decrypted
  passportNumber?: string | null;
  passportAuthority?: string | null;
  passportIssueDate?: string | null; // YYYY-MM-DD
  passportExpiry?: string | null; // YYYY-MM-DD
  visaNumber?: string | null;
  visaIssueDate?: string | null; // YYYY-MM-DD
  visaExpiry?: string | null; // YYYY-MM-DD
  visaType?: string | null;
  phone?: string | null;
  email?: string | null;
  insuranceCompany?: string | null;
  insuranceNumber?: string | null; // decrypted
  bankAccount?: string | null; // decrypted
}

function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Format a `YYYY-MM-DD` string as Czech `D. M. YYYY`. String-based on purpose —
 * never construct a Date here (the `new Date("YYYY-MM-DD")` UTC pitfall would
 * shift the day in UTC+2). Non-ISO inputs are returned escaped, as-is.
 */
function formatDateCZ(iso?: string | null): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return escapeHtml(iso);
  const [, y, mo, d] = m;
  return `${Number(d)}. ${Number(mo)}. ${y}`;
}

/** A label + boxed-value row. `boxSpan` lets the value box span filler columns. */
function row(label: string, value: string, boxSpan = 1, subLabel?: string): string {
  const labelCell = subLabel
    ? `<td class="lbl">${label}<div class="sub">${subLabel}</div></td>`
    : `<td class="lbl">${label}</td>`;
  return `<tr>${labelCell}<td class="box" colspan="${boxSpan}">${value}</td></tr>`;
}

/** Two label/value pairs on one row (four columns). */
function row2(
  label1: string,
  value1: string,
  label2: string,
  value2: string
): string {
  return (
    `<tr>` +
    `<td class="lbl">${label1}</td><td class="box">${value1}</td>` +
    `<td class="lbl">${label2}</td><td class="box">${value2}</td>` +
    `</tr>`
  );
}

const SPACER = `<tr class="spacer"><td colspan="4"></td></tr>`;

export function buildQuestionnaireHtml(d: QuestionnaireData): string {
  const e = escapeHtml;
  const fd = formatDateCZ;

  return `
<style>
  .q-wrap { font-family: Arial, sans-serif; color: #000; }
  .q-title {
    text-align: center;
    font-size: 16pt;
    font-weight: bold;
    border: 1.5px solid #000;
    background: #d9d9d9;
    padding: 8px 0;
    margin-bottom: 14px;
    letter-spacing: 0.5px;
  }
  table.q { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.q td { padding: 0; vertical-align: middle; }
  td.lbl {
    text-align: right;
    font-weight: bold;
    font-size: 10.5pt;
    padding: 3px 8px 3px 0;
    white-space: nowrap;
    overflow: hidden;
  }
  td.box {
    border: 1px solid #000;
    background: #f2f2f2;
    height: 20px;
    padding: 2px 6px;
    font-size: 10.5pt;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  td.lbl .sub { font-weight: normal; font-size: 7.5pt; line-height: 1; }
  tr.spacer td { height: 10px; border: none; background: none; }
  .cizinci-bar {
    background: #000;
    color: #fff;
    font-weight: bold;
    font-size: 8pt;
    padding: 2px 6px;
    letter-spacing: 1px;
    margin-top: 6px;
  }
  .cizinci {
    border: 1px solid #000;
    border-top: none;
    background: #ededed;
    padding: 8px;
  }
  .cizinci table.q td.box { background: #ffffff; }
</style>
<div class="q-wrap">
  <div class="q-title">OSOBNÍ DOTAZNÍK ZAMĚSTNANCE</div>

  <table class="q">
    <colgroup><col style="width:33%"><col><col style="width:0"><col style="width:0"></colgroup>
    ${row("Pracovní pozice:", e(d.jobTitle), 3)}
    ${row("Den nástupu:", fd(d.startDate), 3)}
    ${SPACER}
    ${row("Jméno:", e(d.firstName), 3)}
    ${row("Příjmení:", e(d.lastName), 3)}
    ${row("Rodné příjmení:", e(d.birthSurname), 3)}
    ${row("Státní příslušnost:", e(d.nationality), 3)}
    ${row("Místo narození (obec):", e(d.placeOfBirth), 3)}
    ${row("Datum narození:", fd(d.dateOfBirth), 3)}
    ${row("Rodné číslo:", e(d.birthNumber), 3)}
    ${row("Rodinný stav:", e(d.maritalStatus), 3)}
    ${row("Vzdělání:", e(d.education), 3, "(nejvyšší dosažené)")}
    ${SPACER}
    ${row("Trvalé bydliště:", e(d.permanentAddress), 3)}
    ${row("Kontaktní adresa:", e(d.contactAddress), 3)}
    ${SPACER}
    ${row("Číslo OP:", e(d.idCardNumber), 3)}
  </table>

  <div class="cizinci-bar">CIZINCI</div>
  <div class="cizinci">
    <table class="q">
      <colgroup><col style="width:23%"><col style="width:27%"><col style="width:23%"><col style="width:27%"></colgroup>
      ${row2("Číslo pasu:", e(d.passportNumber), "Vydávající úřad:", e(d.passportAuthority))}
      ${row2("Datum vydání pasu:", fd(d.passportIssueDate), "Platnost pasu:", fd(d.passportExpiry))}
      ${row("Povolení k pobytu:", e(d.visaNumber), 3)}
      ${row2("Datum vydání povolení:", fd(d.visaIssueDate), "Platnost povolení:", fd(d.visaExpiry))}
      ${row("Typ povolení:", e(d.visaType), 3)}
    </table>
  </div>

  <table class="q">
    <colgroup><col style="width:33%"><col style="width:17%"><col style="width:22%"><col style="width:28%"></colgroup>
    ${SPACER}
    ${row("Telefon:", e(d.phone), 3)}
    ${row("E-mail:", e(d.email), 3)}
    ${SPACER}
    ${row2("Zdrav. pojišťovna:", e(d.insuranceCompany), "Číslo pojištěnce:", e(d.insuranceNumber))}
    ${row("Číslo účtu:", e(d.bankAccount), 3)}
  </table>
</div>`;
}
