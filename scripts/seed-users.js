/**
 * Seeds all users from DTB.csv into Firebase Auth + Firestore.
 *
 * Creates one Auth user per CSV row that has a username (cols 37-40).
 * Each user is automatically linked to their employee record via employeeId.
 * The employeeId generation uses the exact same algorithm as seed-employees.js.
 *
 * Run with: "C:\Program Files\nodejs\node.exe" scripts\seed-users.js
 * Emulators must be running. seed-employees.js should run first.
 * Idempotent — safe to re-run.
 */

process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

const path  = require('path');
const fs    = require('fs');
const iconv = require('../functions/node_modules/iconv-lite');
const admin = require('../functions/node_modules/firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'hotel-hr-app-75581' });
const db   = admin.firestore();
const auth = admin.auth();

// ─── Helpers (must stay in sync with seed-employees.js) ──────────────────────

function s(v) {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
}

function csvDateToISO(val) {
  const str = s(val);
  if (!str) return null;
  const m = str.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** Must stay identical to seed-employees.js makeEmployeeId. */
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
  return text.split(/\r?\n/)
    .filter(l => l.trim() !== '')
    .slice(1)                       // skip header
    .map(l => l.split(';'));
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

async function getOrCreate(email, password, displayName) {
  try {
    return await auth.getUserByEmail(email);
  } catch {
    return await auth.createUser({ email, password, displayName });
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  const csvPath = path.join(__dirname, '../DTB.csv');
  if (!fs.existsSync(csvPath)) {
    console.error('ERROR: DTB.csv not found at project root');
    process.exit(1);
  }

  const rows = parseCSV(csvPath);

  // Collect only rows that have user credentials
  const userRows = rows.filter(r => s(r[37]) && s(r[40]));
  console.log(`Found ${userRows.length} user rows in DTB.csv`);

  let created = 0, errors = 0;

  for (const r of userRows) {
    const lastName  = s(r[0]);
    const firstName = s(r[1]);
    const birthDate = csvDateToISO(r[2]);
    // Firebase Auth requires passwords ≥ 6 chars; pad short ones
    const rawPw     = s(r[38]) ?? 'changeme';
    const password  = rawPw.length >= 6 ? rawPw : rawPw.padEnd(6, '1');
    const role      = s(r[39]) ?? 'employee';
    const email     = s(r[40]);
    const name      = s(r[37]);  // username column
    const employeeId = makeEmployeeId(lastName, firstName, birthDate);

    if (!email) continue;

    try {
      const fbUser = await getOrCreate(email, password, name);
      await auth.setCustomUserClaims(fbUser.uid, { role });
      await db.collection('users').doc(fbUser.uid).set({
        name,
        email,
        role,
        active:     true,
        employeeId,
        lastLogin:  null,
        createdAt:  new Date().toISOString(),
      }, { merge: true });

      console.log(`  ✓ ${role.padEnd(10)} ${email.padEnd(35)} → ${employeeId}`);
      created++;
    } catch (e) {
      console.error(`  ✗ ${email}: ${e.message}`);
      errors++;
    }
  }

  console.log(`\nUsers seeded: ${created} created/updated, ${errors} errors`);
  if (errors > 0) process.exit(1);
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch(e => { console.error('Fatal:', e.message); process.exit(1); });
}

module.exports = { run };
