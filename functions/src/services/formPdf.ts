/**
 * Fills the two employee AcroForm PDFs ("Osobní dotazník zaměstnance" and
 * "Prohlášení poplatníka daně") by setting their named form fields and baking
 * the result (flatten) so it prints/looks identical everywhere.
 *
 * The blank fillable PDFs live in `assets/` (copied to `lib/assets/` by the
 * build step). Czech diacritics: AcroForm fields default to a WinAnsi standard
 * font that can't encode č/š/ž/ř/ě/ů/ň/ť/ď, so we embed a Unicode TTF
 * (DejaVu Sans) via @pdf-lib/fontkit and regenerate all field appearances with
 * it BEFORE flattening. `save({ updateFieldAppearances: false })` keeps pdf-lib
 * from re-rendering with the default font on the way out.
 *
 * Sensitive values (rodné číslo, číslo OP, číslo účtu, číslo pojištěnce) arrive
 * already DECRYPTED — the caller handles permission gating + audit logging.
 */
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import * as fs from "fs";
import * as path from "path";

const ASSETS = path.join(__dirname, "..", "assets");
const FONT_PATH = path.join(ASSETS, "DejaVuSans.ttf");
const QUESTIONNAIRE_PDF = path.join(ASSETS, "dotaznik_fillable.pdf");
const PROHLASENI_PDF = path.join(ASSETS, "prohlaseni_fillable.pdf");

/** Czech `D. M. YYYY` from `YYYY-MM-DD`, string-based (avoids the UTC-shift bug). */
function formatDateCZ(iso?: string | null): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return String(iso);
  const [, y, mo, d] = m;
  return `${Number(d)}. ${Number(mo)}. ${y}`;
}

/**
 * Load a fillable PDF, set the given text fields (`{ fieldName: value }`),
 * render appearances with the embedded Unicode font, flatten, and return bytes.
 * Unknown field names and empty values are skipped.
 */
async function fillForm(pdfPath: string, values: Record<string, string>): Promise<Buffer> {
  const doc = await PDFDocument.load(fs.readFileSync(pdfPath));
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fs.readFileSync(FONT_PATH), { subset: true });
  const form = doc.getForm();

  for (const [name, value] of Object.entries(values)) {
    if (!value) continue;
    try {
      form.getTextField(name).setText(value);
    } catch {
      // Field not present in this PDF (or not a text field) — skip silently.
    }
  }

  // Regenerate every field's appearance with the Unicode font, then bake them in.
  form.updateFieldAppearances(font);
  form.flatten();
  const bytes = await doc.save({ updateFieldAppearances: false });
  return Buffer.from(bytes);
}

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
  // "Povolení k pobytu" (residence permit) — sourced from the documents visa* fields.
  residencePermitNumber?: string | null;
  residencePermitType?: string | null;
  residencePermitIssueDate?: string | null; // YYYY-MM-DD
  residencePermitExpiry?: string | null; // YYYY-MM-DD
  passportNumber?: string | null;
  passportAuthority?: string | null;
  passportIssueDate?: string | null; // YYYY-MM-DD
  passportExpiry?: string | null; // YYYY-MM-DD
  phone?: string | null;
  email?: string | null;
  insuranceCompany?: string | null;
  insuranceNumber?: string | null; // decrypted
  bankAccount?: string | null; // decrypted
}

const s = (v?: string | null): string => (v == null ? "" : String(v));

/** Fill the "Osobní dotazník zaměstnance" form. */
export async function fillQuestionnairePdf(d: QuestionnaireData): Promise<Buffer> {
  return fillForm(QUESTIONNAIRE_PDF, {
    pracovni_pozice: s(d.jobTitle),
    den_nastupu: formatDateCZ(d.startDate),
    jmeno: s(d.firstName),
    prijmeni: s(d.lastName),
    rodne_prijmeni: s(d.birthSurname),
    statni_prislusnost: s(d.nationality),
    misto_narozeni: s(d.placeOfBirth),
    datum_narozeni: formatDateCZ(d.dateOfBirth),
    rodne_cislo: s(d.birthNumber),
    rodinny_stav: s(d.maritalStatus),
    vzdelani: s(d.education),
    trvale_bydliste: s(d.permanentAddress),
    kontaktni_adresa: s(d.contactAddress),
    cislo_op: s(d.idCardNumber),
    povoleni_k_pobytu: s(d.residencePermitNumber),
    typ_povoleni: s(d.residencePermitType),
    datum_vydani_povoleni: formatDateCZ(d.residencePermitIssueDate),
    platnost_povoleni: formatDateCZ(d.residencePermitExpiry),
    cislo_pasu: s(d.passportNumber),
    vydavajici_urad: s(d.passportAuthority),
    datum_vydani_pasu: formatDateCZ(d.passportIssueDate),
    platnost_pasu: formatDateCZ(d.passportExpiry),
    telefon: s(d.phone),
    email: s(d.email),
    cislo_uctu: s(d.bankAccount),
    zdrav_pojistovna: s(d.insuranceCompany),
    cislo_pojistence: s(d.insuranceNumber),
  });
}

export interface ProhlaseniData {
  // "Zdaňovací období" — free text entered by the user (e.g. "2026" or "od září 2026").
  taxPeriod?: string | null;
  companyName?: string | null;
  companyAddress?: string | null;
  lastName?: string | null;
  firstName?: string | null;
  birthNumber?: string | null; // decrypted
  // "Adresa bydliště" — trvalá for Czech employees, the resolved Czech contact
  // address for foreigners (whose trvalá address is often abroad). Resolved by
  // the caller.
  residenceAddress?: string | null;
}

/**
 * Fill the "Prohlášení poplatníka daně" form (7 fields). The daňový-nerezident
 * (foreigner) block is not an AcroForm field in the source PDF and is left for
 * the employee to complete by hand.
 */
export async function fillProhlaseniPdf(d: ProhlaseniData): Promise<Buffer> {
  return fillForm(PROHLASENI_PDF, {
    zdanovaci_obdobi: s(d.taxPeriod),
    nazev_platce_dane: s(d.companyName),
    adresa_platce_dane: s(d.companyAddress),
    prijmeni: s(d.lastName),
    jmeno: s(d.firstName),
    rodne_cislo: s(d.birthNumber),
    adresa_bydliste: s(d.residenceAddress),
  });
}
