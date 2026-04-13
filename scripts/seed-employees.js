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
 *   6  Vydání pasu      passportIssueDate "DD. MM. YYYY"
 *   7  Platnost pasu    passportExpiry    "DD. MM. YYYY"
 *   8  Vydávající úřad  (not displayed in frontend — ignored)
 *   9  Povolení k pobytu visaNumber
 *  10  Vydání povolení  visaIssueDate
 *  11  Platnost povolení visaExpiry
 *  12  Typ povolení     visaType
 *  13  Trvalé bydliště  permanentAddress
 *  14  Kontaktní adresa contactAddress
 *  15  Rodné příjmení   birthSurname
 *  16  Státní příslušnost nationality
 *  17  Místo narození   placeOfBirth
 *  18  Rodné číslo      birthNumber       SENSITIVE
 *  19  Rodinný stav     maritalStatus
 *  20  Vzdělání         education         Czech KKOV code
 *  21  Telefon          phone
 *  22  E-mail           personalEmail
 *  23  Zdrav. pojišťovna insuranceCompany
 *  24  Číslo pojištěnce insuranceNumber   SENSITIVE
 *  25  Číslo účtu       bankAccount       SENSITIVE
 *  26  Multisport       multisport        ANO / empty
 *  27  HO               homeOffice        ANO / empty
 *  28  Náhrady          allowances        ANO / empty
 *  29  Firma            company           HPM / STP
 *  30  Typ smlouvy      contractType      HPP / DPP / PPP / HPP - mat.
 *  31  Podpis smlouvy   contractSignDate  "DD. MM. YYYY"
 *  32  Prac. pozice     jobPosition
 *  33  Prac. zařazení   department        (always empty in CSV)
 *  34  Mzda (aktuální)  salary            "16 500"
 *  35  Ve firmě od      employedFrom      "DD. MM. YYYY"
 *  36  username         (used by seed-users.js)
 *  37  password         (used by seed-users.js)
 *  38  role             (used by seed-users.js)
 *  39  e-mail           (used by seed-users.js)
 */

process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
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

/** Return the full KKOV education string including the code letter (e.g. "R - vysokoškolské bakalářské vzdělání"). */
function mapEducation(val) {
  return s(val);
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

/** Map CSV marital status variants to the app dropdown values. */
function mapMaritalStatus(val) {
  const str = s(val);
  if (!str) return null;
  const v = str.toLowerCase();
  if (v.includes('svobod') || v.includes('sviobod')) return 'svobodný/á';
  if (v.includes('ženat') || v.includes('vdan'))     return 'ženatý/vdaná';
  if (v.includes('rozved'))                          return 'rozvedený/á';
  if (v.includes('vdov'))                            return 'vdovec/vdova';
  return str; // unknown value — store as-is
}

// ─── CSV parsing ──────────────────────────────────────────────────────────────

function parseCSV(filePath) {
  let text = fs.readFileSync(filePath, 'utf8');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip UTF-8 BOM
  return text.split(/\r?\n/)
    .filter(l => l.trim() !== '')
    .slice(1)              // skip header row
    .map(l => l.split(';'));
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

    const dateOfBirth       = csvDateToISO(r[2]);
    const gender            = s(r[3]);
    const idCardNumber      = s(r[4]);   // SENSITIVE
    const passportNumber    = s(r[5]);
    const passportIssueDate = csvDateToISO(r[6]);
    const passportExpiry    = csvDateToISO(r[7]);
    const passportAuthority = s(r[8]);
    const visaNumber        = s(r[9]);
    const visaIssueDate     = csvDateToISO(r[10]);
    const visaExpiry        = csvDateToISO(r[11]);
    const visaType          = s(r[12]);
    const permanentAddress  = s(r[13]);
    const contactAddress    = s(r[14]);
    const birthSurname      = s(r[15]);
    const nationality       = s(r[16]);
    const placeOfBirth      = s(r[17]);
    const birthNumber       = s(r[18]);  // SENSITIVE
    const maritalStatus     = mapMaritalStatus(r[19]);
    const education         = mapEducation(r[20]);
    const phone             = s(r[21]);
    const personalEmail     = s(r[22]);
    const insuranceCompany  = s(r[23]);
    const insuranceNumber   = s(r[24]);  // SENSITIVE
    const bankAccount       = s(r[25]);  // SENSITIVE
    const multisport        = yesNo(r[26]);
    const homeOfficeRaw     = s(r[27]);
    const homeOffice        = homeOfficeRaw ? (Number(homeOfficeRaw) || null) : null;
    const allowances        = yesNo(r[28]);
    // r[29] company       — not stored (set from employment history)
    // r[30] contractType  — not stored (set from employment history)
    // r[31] contractSignDate — not stored (set from employment history)
    // r[32] jobPosition — not stored (set from employment history)
    // r[33] department  — not stored (set from employment history)
    // r[34] salary      — not stored (set from employment history)
    // r[35] employedFrom — not stored (set from employment history)
    // r[36..39] = user credentials — handled by seed-users.js

    const employeeId = makeEmployeeId(lastName, firstName, dateOfBirth);

    try {
      // ── Root employee document ───────────────────────────────────────────────
      await db.collection('employees').doc(employeeId).set({
        firstName:  firstName ?? '',
        lastName:   lastName ?? '',
        dateOfBirth,
        gender,
        nationality,
        placeOfBirth,
        birthSurname,
        maritalStatus,
        education,
        status:     'active',
        birthNumber:         encrypt(birthNumber),
        createdAt:           new Date().toISOString(),
        updatedAt:           new Date().toISOString(),
      }, { merge: true });

      // ── documents sub-collection ─────────────────────────────────────────────
      await db.collection('employees').doc(employeeId)
        .collection('documents').doc('main').set({
          idCardNumber:    encrypt(idCardNumber),
          idCardExpiry:    null,             // not in CSV
          passportNumber,
          passportIssueDate,
          passportExpiry,
          passportAuthority,
          visaNumber,
          visaType,
          visaIssueDate,
          visaExpiry,
          updatedAt:       new Date().toISOString(),
        }, { merge: true });

      // ── contact sub-collection ────────────────────────────────────────────────
      await db.collection('employees').doc(employeeId)
        .collection('contact').doc('main').set({
          phone,
          email:            personalEmail,
          permanentAddress,
          contactAddressSameAsPermanent: contactAddress === permanentAddress,
          contactAddress:               contactAddress === permanentAddress ? null : contactAddress,
          updatedAt:        new Date().toISOString(),
        }, { merge: true });

      // ── benefits sub-collection ───────────────────────────────────────────────
      await db.collection('employees').doc(employeeId)
        .collection('benefits').doc('main').set({
          insuranceCompany,
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
