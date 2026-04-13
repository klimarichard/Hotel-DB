/**
 * Seeds employees from DTB.xlsx into the Firestore emulator.
 *
 * Run with:
 *   "C:\Program Files\nodejs\node.exe" scripts\seed-employees.js
 *
 * Prerequisites:
 *   1. Firebase emulators must be running
 *   2. DTB.xlsx must be present at project root
 *   3. ENCRYPTION_KEY must be in functions/.env (64-char hex)
 *
 * The script is idempotent — re-running it will overwrite existing docs.
 */

process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Load ENCRYPTION_KEY from functions/.env
const envPath = path.join(__dirname, '../functions/.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const envMatch = envContent.match(/ENCRYPTION_KEY\s*=\s*([0-9a-fA-F]+)/);
if (!envMatch) {
  console.error('ERROR: ENCRYPTION_KEY not found in functions/.env');
  process.exit(1);
}
process.env.ENCRYPTION_KEY = envMatch[1];

// Load xlsx — must be installed at project root (npm install xlsx --no-save)
let XLSX;
try {
  XLSX = require('./node_modules/xlsx');
} catch {
  XLSX = require('../node_modules/xlsx');
}

const admin = require('../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: 'hotel-hr-app-75581' });
const db = admin.firestore();

// ─── Encryption (mirrors functions/src/services/encryption.ts) ──────────────

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey() {
  const key = process.env.ENCRYPTION_KEY;
  const buf = Buffer.from(key, 'hex');
  if (buf.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  return buf;
}

function encrypt(plaintext) {
  if (!plaintext || plaintext.toString().trim() === '') return null;
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, tag, encrypted]);
  return combined.toString('base64');
}

// ─── Helper: Excel serial date → ISO date string ─────────────────────────────

function excelDateToISO(serial) {
  if (!serial || typeof serial !== 'number') return null;
  // Excel serial: days since 1900-01-01 (with Lotus 1-2-3 leap year bug)
  const ms = (serial - 25569) * 86400000;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// ─── Helper: safe string from cell value ─────────────────────────────────────

function str(val) {
  if (val === undefined || val === null) return null;
  const s = String(val).trim();
  return s === '' ? null : s;
}

function num(val) {
  if (val === undefined || val === null) return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

// ─── Company ID mapping ───────────────────────────────────────────────────────

function mapCompany(firmaVal) {
  const s = str(firmaVal);
  if (!s) return null;
  if (s.includes('HPM') || s.toLowerCase().includes('hotel property')) return 'HPM';
  if (s.includes('STP') || s.toLowerCase().includes('special tours')) return 'STP';
  return str(firmaVal);
}

// ─── Contract type mapping ────────────────────────────────────────────────────

function mapContractType(typVal) {
  const s = str(typVal);
  if (!s) return null;
  const map = {
    'HPP': 'HPP',
    'DPP': 'DPP',
    'PPP': 'PPP',
    'HPP - mat.': 'HPP',   // maternity leave variant — store as HPP
    'HPP-mat.': 'HPP',
  };
  return map[s] ?? s;
}

// ─── Main seed function ───────────────────────────────────────────────────────

async function seed() {
  const xlsxPath = path.join(__dirname, '../DTB.xlsx');
  if (!fs.existsSync(xlsxPath)) {
    console.error('ERROR: DTB.xlsx not found at project root');
    process.exit(1);
  }

  const workbook = XLSX.readFile(xlsxPath);
  const sheet = workbook.Sheets['DTB'];
  if (!sheet) {
    console.error('ERROR: Sheet "DTB" not found in DTB.xlsx');
    process.exit(1);
  }

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  // Row 0 is the header row; data starts at row 1
  const dataRows = rows.slice(1).filter(row => {
    // Only include rows that have a last name or first name (cols 2 & 3)
    const lastName  = row[2];
    const firstName = row[3];
    return (lastName && String(lastName).trim() !== '') ||
           (firstName && String(firstName).trim() !== '');
  });

  console.log(`Found ${dataRows.length} data rows in DTB.xlsx`);

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];

    const lastName  = str(row[2]);
    const firstName = str(row[3]);

    if (!lastName && !firstName) {
      skipped++;
      continue;
    }

    // Column mapping (0-indexed per analysis):
    // 0  = CHYBY (data quality flag)
    // 2  = Příjmení (last name)
    // 3  = Jméno (first name)
    // 5  = Datum narození (Excel serial date)
    // 7  = Pohlaví
    // 8  = Číslo OP (ID card number) — SENSITIVE
    // 9  = Číslo pasu (passport number) — SENSITIVE
    // 10 = Vydání pasu (passport issue date, Excel serial)
    // 11 = Platnost pasu (passport expiry date, Excel serial)
    // 12 = Vydávající úřad (issuing authority)
    // 13 = Povolení k pobytu (residence permit type)
    // 14 = Vydání povolení (permit issue date, Excel serial)
    // 15 = Platnost povolení (permit expiry date, Excel serial)
    // 16 = Typ povolení
    // 18 = Trvalé bydliště (permanent address)
    // 19 = Kontaktní adresa (contact address)
    // 20 = Rodné příjmení (birth surname)
    // 21 = Státní příslušnost (nationality)
    // 22 = Místo narození (place of birth)
    // 23 = Rodné číslo (birth number) — SENSITIVE
    // 24 = Rodinný stav (marital status)
    // 25 = Vzdělání (education level)
    // 26 = Telefon (phone)
    // 27 = E-mail
    // 28 = Zdrav. pojišťovna (health insurance provider)
    // 29 = Číslo pojištěnce (insurance number) — SENSITIVE
    // 30 = Číslo účtu (bank account) — SENSITIVE
    // 31 = Multisport (card)
    // 32 = HO (home office)
    // 34 = Firma (company)
    // 35 = Typ smlouvy (contract type)
    // 36 = Podpis smlouvy (contract signature date, Excel serial)
    // 37 = Pracovní pozice (job position)
    // 38 = Pracovní zařazení (department)
    // 39 = Mzda (salary)
    // 40 = Ve firmě od (employment start date, Excel serial)
    // 41 = Ve firmě do (employment end date — null for active)
    // 43 = Úřad práce (labor office registration)

    const chyby           = num(row[0]);
    const birthDate       = excelDateToISO(row[5]);
    const gender          = str(row[7]);
    const idCardNumber    = str(row[8]);    // SENSITIVE
    const passportNumber  = str(row[9]);    // SENSITIVE
    const passportIssued  = excelDateToISO(row[10]);
    const passportExpiry  = excelDateToISO(row[11]);
    const passportAuthority = str(row[12]);
    const residencePermitType = str(row[13]);
    const residencePermitIssued = excelDateToISO(row[14]);
    const residencePermitExpiry = excelDateToISO(row[15]);
    const residencePermitCategory = str(row[16]);
    const permanentAddress = str(row[18]);
    const contactAddress  = str(row[19]);
    const birthSurname    = str(row[20]);
    const nationality     = str(row[21]);
    const placeOfBirth    = str(row[22]);
    const birthNumber     = str(row[23]);   // SENSITIVE
    const maritalStatus   = str(row[24]);
    const education       = str(row[25]);
    const phone           = str(row[26]);
    const email           = str(row[27]);
    const healthInsurance = str(row[28]);
    const insuranceNumber = str(row[29]);   // SENSITIVE
    const bankAccount     = str(row[30]);   // SENSITIVE
    const multisport      = str(row[31]);
    const homeOffice      = str(row[32]);
    const company         = mapCompany(row[34]);
    const contractType    = mapContractType(row[35]);
    const contractSignDate = excelDateToISO(row[36]);
    const jobPosition     = str(row[37]);
    const department      = str(row[38]);
    const salary          = num(row[39]);
    const employedFrom    = excelDateToISO(row[40]);
    const employedTo      = excelDateToISO(row[41]);
    const laborOffice     = str(row[43]);

    // Generate a deterministic-ish employee ID from name + birth date
    // (so re-running the script updates the same doc)
    const idBase = `${lastName}_${firstName}_${birthDate ?? i}`.toLowerCase()
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, 40);
    const employeeId = `dtb_${idBase}`;

    try {
      // ── Root employee document ─────────────────────────────────────────────
      const employeeDoc = {
        firstName:            firstName ?? '',
        lastName:             lastName ?? '',
        birthDate:            birthDate,
        gender:               gender,
        nationality:          nationality,
        placeOfBirth:         placeOfBirth,
        birthSurname:         birthSurname,
        maritalStatus:        maritalStatus,
        education:            education,
        currentCompanyId:     company,
        currentDepartment:    department,
        currentJobTitle:      jobPosition,
        currentContractType:  contractType,
        status:               employedTo === null ? 'active' : 'terminated',
        hasDataIssues:        chyby === 1,
        createdAt:            new Date().toISOString(),
        updatedAt:            new Date().toISOString(),
        // Encrypted field stored on root (required for decryption in employees API)
        birthNumber:          encrypt(birthNumber),
      };

      const empRef = db.collection('employees').doc(employeeId);
      await empRef.set(employeeDoc, { merge: true });

      // ── documents sub-collection ───────────────────────────────────────────
      const docData = {
        idCardNumber:             encrypt(idCardNumber),
        idCardExpiry:             null,   // not in DTB (separate expiry column not present)
        passportNumber:           encrypt(passportNumber),
        passportIssued:           passportIssued,
        passportExpiry:           passportExpiry,
        passportAuthority:        passportAuthority,
        residencePermitType:      residencePermitType,
        residencePermitCategory:  residencePermitCategory,
        residencePermitIssued:    residencePermitIssued,
        residencePermitExpiry:    residencePermitExpiry,
        laborOffice:              laborOffice,
        updatedAt:                new Date().toISOString(),
      };
      await empRef.collection('documents').doc('main').set(docData, { merge: true });

      // ── contact sub-collection ─────────────────────────────────────────────
      const contactData = {
        phone:            phone,
        email:            email,
        permanentAddress: permanentAddress,
        contactAddress:   contactAddress,
        updatedAt:        new Date().toISOString(),
      };
      await empRef.collection('contact').doc('main').set(contactData, { merge: true });

      // ── employment sub-collection (history entry) ──────────────────────────
      const employmentData = {
        type:              'new_hire',
        companyId:         company,
        contractType:      contractType,
        jobPosition:       jobPosition,
        department:        department,
        salary:            salary,
        startDate:         employedFrom,
        endDate:           employedTo,
        contractSignDate:  contractSignDate,
        note:              null,
        createdAt:         new Date().toISOString(),
      };
      // Use employedFrom as a stable doc ID so re-seeding doesn't duplicate
      const empHistoryId = employedFrom ? `hire_${employedFrom}` : 'hire_unknown';
      await empRef.collection('employment').doc(empHistoryId).set(employmentData, { merge: true });

      // ── benefits sub-collection ────────────────────────────────────────────
      const benefitsData = {
        healthInsurance:  healthInsurance,
        insuranceNumber:  encrypt(insuranceNumber),
        bankAccount:      encrypt(bankAccount),
        multisport:       multisport === '1' || multisport === 'yes' || multisport === 'ano' || multisport === 'TRUE' || multisport === '1' ? true : (multisport ? Boolean(multisport) : false),
        homeOffice:       homeOffice === '1' || homeOffice === 'yes' || homeOffice === 'ano' || homeOffice === 'TRUE' ? true : false,
        updatedAt:        new Date().toISOString(),
      };
      await empRef.collection('benefits').doc('main').set(benefitsData, { merge: true });

      created++;
      if (created % 10 === 0) {
        process.stdout.write(`  Seeded ${created} employees...\r`);
      }
    } catch (e) {
      console.error(`\nERROR seeding row ${i + 2} (${lastName} ${firstName}):`, e.message);
      errors++;
    }
  }

  console.log(`\n\nSeeding complete:`);
  console.log(`  Created/updated: ${created}`);
  console.log(`  Skipped (empty): ${skipped}`);
  console.log(`  Errors:          ${errors}`);

  if (errors > 0) {
    console.log('\nSome rows failed — check the errors above.');
    process.exit(1);
  }

  process.exit(0);
}

seed().catch((e) => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
