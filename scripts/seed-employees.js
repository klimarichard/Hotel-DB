/**
 * Seeds employees from DTB.csv into the Firestore emulator.
 *
 * Run with:
 *   "C:\Program Files\nodejs\node.exe" scripts\seed-employees.js
 *
 * Prerequisites:
 *   1. Firebase emulators must be running
 *   2. DTB.csv must be present at project root
 *   3. ENCRYPTION_KEY must be in functions/.env (64-char hex)
 *
 * Idempotent — re-running overwrites existing docs with the same IDs.
 *
 * Column mapping (0-indexed, semicolon-delimited):
 *   0  Příjmení         lastName
 *   1  Jméno            firstName
 *   2  Datum narození   birthDate         "DD. MM. YYYY"
 *   3  Pohlaví          gender            f / m
 *   4  Číslo OP         idCardNumber      SENSITIVE
 *   5  Číslo pasu       passportNumber    SENSITIVE
 *   6  Vydání pasu      passportIssued    "DD. MM. YYYY"
 *   7  (duplicate of 6 — ignored)
 *   8  Platnost pasu    passportExpiry    "DD. MM. YYYY"
 *   9  Vydávající úřad  passportAuthority
 *  10  Povolení č.      (permit reference number — not stored)
 *  11  Vydání povolení  residencePermitIssued
 *  12  Platnost povolení residencePermitExpiry
 *  13  Typ povolení     residencePermitType
 *  14  Trvalé bydliště  permanentAddress
 *  15  Kontaktní adresa contactAddress
 *  16  Rodné příjmení   birthSurname
 *  17  Státní příslušnost nationality
 *  18  Místo narození   placeOfBirth
 *  19  Rodné číslo      birthNumber       SENSITIVE
 *  20  Rodinný stav     maritalStatus
 *  21  Vzdělání         education         Czech KKOV code
 *  22  Telefon          phone
 *  23  E-mail           personalEmail
 *  24  Zdrav. pojišťovna healthInsurance
 *  25  Číslo pojištěnce insuranceNumber   SENSITIVE
 *  26  Číslo účtu       bankAccount       SENSITIVE
 *  27  Multisport       multisport        ANO / empty
 *  28  HO               homeOffice        ANO / empty
 *  29  Náhrady          allowances        ANO / empty
 *  30  Firma            company           HPM / STP
 *  31  Typ smlouvy      contractType      HPP / DPP / PPP / HPP - mat.
 *  32  Podpis smlouvy   contractSignDate  "DD. MM. YYYY"
 *  33  Prac. pozice     jobPosition
 *  34  Prac. zařazení   department        (always empty in CSV)
 *  35  Mzda (aktuální)  salary            "16 500"
 *  36  Ve firmě od      employedFrom      "DD. MM. YYYY"
 *  37  username         (used by seed-users.js)
 *  38  password         (used by seed-users.js)
 *  39  role             (used by seed-users.js)
 *  40  e-mail           (used by seed-users.js)
 */

process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const iconv  = require('../functions/node_modules/iconv-lite');
const admin  = require('../functions/node_modules/firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'hotel-hr-app-75581' });
const db = admin.firestore();

// ─── Encryption (mirrors functions/src/services/encryption.ts) ───────────────

const envPath    = path.join(__dirname, '../functions/.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const envMatch   = envContent.match(/ENCRYPTION_KEY\s*=\s*([0-9a-fA-F]+)/);
if (!envMatch) { console.error('ERROR: ENCRYPTION_KEY not found in functions/.env'); process.exit(1); }
process.env.ENCRYPTION_KEY = envMatch[1];

function encrypt(plaintext) {
  if (!plaintext || String(plaintext).trim() === '') return null;
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  const iv      = crypto.randomBytes(12);
  const cipher  = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc     = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag     = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Safe string: trim or null. */
function s(v) {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
}

/** Parse Czech date "DD. MM. YYYY" → ISO "YYYY-MM-DD", or null. */
function csvDateToISO(val) {
  const str = s(val);
  if (!str) return null;
  const m = str.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** Parse salary "16 500" or "16500" → number, or null. */
function parseSalary(val) {
  const str = s(val);
  if (!str) return null;
  const n = Number(str.replace(/\s/g, ''));
  return isNaN(n) ? null : n;
}

/**
 * Map Czech KKOV education code to app enum.
 * The CSV stores codes like "R - vysokoškolské bakalářské vzdělání".
 * We extract the leading letter since the rest may contain garbled chars.
 */
function mapEducation(val) {
  const str = s(val);
  if (!str) return null;
  const code = str[0].toUpperCase();
  const MAP = {
    'C': 'základní',
    'Z': 'základní',
    'H': 'středoškolské',
    'E': 'středoškolské',
    'K': 'středoškolské s maturitou',
    'M': 'středoškolské s maturitou',
    'L': 'středoškolské s maturitou',
    'G': 'středoškolské s maturitou',
    'N': 'vyšší odborné',
    'R': 'vysokoškolské',
    'T': 'vysokoškolské',
    'V': 'vysokoškolské',
  };
  return MAP[code] ?? str;
}

/** Normalize contract type. */
function mapContractType(val) {
  const str = s(val);
  if (!str) return null;
  if (str.startsWith('HPP')) return 'HPP';
  if (str === 'DPP') return 'DPP';
  if (str === 'PPP') return 'PPP';
  return str;
}

/** ANO / anything → boolean. */
function yesNo(val) {
  const str = s(val);
  return str === 'ANO' || str === '1' || str === 'yes';
}

/**
 * Generate a stable, deterministic employee document ID.
 * Must stay in sync with the same function in seed-users.js.
 */
function makeEmployeeId(lastName, firstName, birthDateISO) {
  const base = `${lastName ?? ''}_${firstName ?? ''}_${birthDateISO ?? ''}`
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 40);
  return `dtb_${base}`;
}

// ─── CSV parsing ──────────────────────────────────────────────────────────────

function parseCSV(filePath) {
  const raw  = fs.readFileSync(filePath);
  const text = iconv.decode(raw, 'cp1250');
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  // Skip header (row 0)
  return lines.slice(1).map(l => l.split(';'));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  const csvPath = path.join(__dirname, '../DTB.csv');
  if (!fs.existsSync(csvPath)) {
    console.error('ERROR: DTB.csv not found at project root');
    process.exit(1);
  }

  const rows = parseCSV(csvPath);
  console.log(`Found ${rows.length} data rows in DTB.csv`);

  let created = 0, skipped = 0, errors = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];

    const lastName  = s(r[0]);
    const firstName = s(r[1]);
    if (!lastName && !firstName) { skipped++; continue; }

    const birthDate        = csvDateToISO(r[2]);
    const gender           = s(r[3]);
    const idCardNumber     = s(r[4]);   // SENSITIVE
    const passportNumber   = s(r[5]);   // SENSITIVE
    const passportIssued   = csvDateToISO(r[6]);
    const passportExpiry   = csvDateToISO(r[8]);
    const passportAuthority = s(r[9]);
    // r[10] = permit reference number (not stored in schema)
    const residencePermitIssued   = csvDateToISO(r[11]);
    const residencePermitExpiry   = csvDateToISO(r[12]);
    const residencePermitType     = s(r[13]);
    const permanentAddress  = s(r[14]);
    const contactAddress    = s(r[15]);
    const birthSurname      = s(r[16]);
    const nationality       = s(r[17]);
    const placeOfBirth      = s(r[18]);
    const birthNumber       = s(r[19]);  // SENSITIVE
    const maritalStatus     = s(r[20]);
    const education         = mapEducation(r[21]);
    const phone             = s(r[22]);
    const personalEmail     = s(r[23]);
    const healthInsurance   = s(r[24]);
    const insuranceNumber   = s(r[25]);  // SENSITIVE
    const bankAccount       = s(r[26]);  // SENSITIVE
    const multisport        = yesNo(r[27]);
    const homeOffice        = yesNo(r[28]);
    const allowances        = yesNo(r[29]);
    const company           = s(r[30]);
    const contractType      = mapContractType(r[31]);
    const contractSignDate  = csvDateToISO(r[32]);
    const jobPosition       = s(r[33]);
    // r[34] = department — always empty in CSV
    const salary            = parseSalary(r[35]);
    const employedFrom      = csvDateToISO(r[36]);
    // r[37..40] = user credentials — handled by seed-users.js

    const employeeId = makeEmployeeId(lastName, firstName, birthDate);

    try {
      // ── Root employee document ───────────────────────────────────────────────
      await db.collection('employees').doc(employeeId).set({
        firstName:           firstName ?? '',
        lastName:            lastName ?? '',
        birthDate,
        gender,
        nationality,
        placeOfBirth,
        birthSurname,
        maritalStatus,
        education,
        currentCompanyId:    company,
        currentDepartment:   null,           // always empty in CSV
        currentJobTitle:     jobPosition,
        currentContractType: contractType,
        status:              'active',       // no end-date column in CSV
        birthNumber:         encrypt(birthNumber),
        createdAt:           new Date().toISOString(),
        updatedAt:           new Date().toISOString(),
      }, { merge: true });

      // ── documents sub-collection ─────────────────────────────────────────────
      await db.collection('employees').doc(employeeId)
        .collection('documents').doc('main').set({
          idCardNumber:           encrypt(idCardNumber),
          idCardExpiry:           null,             // not in CSV
          passportNumber:         encrypt(passportNumber),
          passportIssued,
          passportExpiry,
          passportAuthority,
          residencePermitType,
          residencePermitCategory: null,            // not in CSV
          residencePermitIssued,
          residencePermitExpiry,
          visaNumber:             null,
          visaExpiry:             null,
          laborOffice:            null,
          updatedAt:              new Date().toISOString(),
        }, { merge: true });

      // ── contact sub-collection ────────────────────────────────────────────────
      await db.collection('employees').doc(employeeId)
        .collection('contact').doc('main').set({
          phone,
          email:            personalEmail,
          permanentAddress,
          contactAddress,
          updatedAt:        new Date().toISOString(),
        }, { merge: true });

      // ── employment sub-collection (initial hire record) ───────────────────────
      const empHistoryId = employedFrom ? `hire_${employedFrom}` : 'hire_unknown';
      await db.collection('employees').doc(employeeId)
        .collection('employment').doc(empHistoryId).set({
          type:             'new_hire',
          companyId:        company,
          contractType,
          jobPosition,
          department:       null,
          salary,
          startDate:        employedFrom,
          endDate:          null,
          contractSignDate,
          note:             null,
          createdAt:        new Date().toISOString(),
        }, { merge: true });

      // ── benefits sub-collection ───────────────────────────────────────────────
      await db.collection('employees').doc(employeeId)
        .collection('benefits').doc('main').set({
          healthInsurance,
          insuranceNumber:  encrypt(insuranceNumber),
          bankAccount:      encrypt(bankAccount),
          multisport,
          homeOffice,
          allowances,
          updatedAt:        new Date().toISOString(),
        }, { merge: true });

      created++;
      if (created % 10 === 0) process.stdout.write(`  Seeded ${created} employees...\r`);
    } catch (e) {
      console.error(`\nERROR row ${i + 2} (${lastName} ${firstName}): ${e.message}`);
      errors++;
    }
  }

  console.log(`\n\nSeeding complete:`);
  console.log(`  Created/updated: ${created}`);
  console.log(`  Skipped (empty): ${skipped}`);
  console.log(`  Errors:          ${errors}`);
  if (errors > 0) process.exit(1);
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch(e => { console.error('Fatal:', e.message); process.exit(1); });
}

module.exports = { run };
