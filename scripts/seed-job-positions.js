/**
 * Seeds job positions from pozice.csv into Firestore emulator.
 *
 * Run with: "C:\Program Files\nodejs\node.exe" scripts\seed-job-positions.js
 * Emulators must be running first.
 * pozice.csv must be present at project root (UTF-8 BOM, semicolon-delimited).
 * Requires departments to be seeded first (lookup by lowercase name).
 */

process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

const fs = require('fs');
const path = require('path');
const admin = require('../functions/node_modules/firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'hotel-hr-app-75581' });
const db = admin.firestore();

const CSV_PATH = path.join(__dirname, '..', 'pozice.csv');

function readCsv() {
  let raw = fs.readFileSync(CSV_PATH, 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1); // strip BOM
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  // drop header
  const header = lines.shift();
  if (!header) return [];
  return lines.map((line) => {
    const cols = line.split(';').map((c) => c.trim());
    return { name: cols[0], salary: cols[1], department: cols[2] };
  });
}

async function deleteCollection(name) {
  const snap = await db.collection(name).get();
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  if (snap.size > 0) await batch.commit();
}

async function run() {
  const rows = readCsv();
  console.log(`Read ${rows.length} job positions from pozice.csv`);

  // Build departmentId lookup (lowercase name → doc ID)
  const depSnap = await db.collection('departments').get();
  const depLookup = new Map();
  depSnap.docs.forEach((d) => {
    const data = d.data();
    if (data.name) depLookup.set(String(data.name).toLowerCase(), d.id);
  });
  if (depLookup.size === 0) {
    throw new Error('No departments found — run seed-departments.js first.');
  }

  await deleteCollection('jobPositions');
  console.log('  ✓ Cleared existing jobPositions collection');

  const FieldValue = admin.firestore.FieldValue;
  let skipped = 0;
  for (let i = 0; i < rows.length; i++) {
    const { name, salary, department } = rows[i];
    if (!name) { skipped++; continue; }
    const depKey = (department ?? '').toLowerCase();
    const departmentId = depLookup.get(depKey);
    if (!departmentId) {
      console.warn(`  ⚠ Skipping "${name}" — department "${department}" not found`);
      skipped++;
      continue;
    }
    const ref = await db.collection('jobPositions').add({
      name,
      departmentId,
      defaultSalary: Number(salary) || 0,
      displayOrder: i,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log(`  ✓ jobPositions/${ref.id} — ${name} (${department}, ${salary})`);
  }
  if (skipped > 0) console.log(`  (${skipped} skipped)`);
}

if (require.main === module) {
  run()
    .then(() => { console.log('\nJob positions seeded.'); process.exit(0); })
    .catch((e) => { console.error('Seed failed:', e.message); process.exit(1); });
}

module.exports = { run };
