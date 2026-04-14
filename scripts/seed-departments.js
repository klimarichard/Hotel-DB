/**
 * Seeds departments from oddeleni.csv into Firestore emulator.
 *
 * Run with: "C:\Program Files\nodejs\node.exe" scripts\seed-departments.js
 * Emulators must be running first.
 * oddeleni.csv must be present at project root (UTF-8, one department name per line).
 */

process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

const fs = require('fs');
const path = require('path');
const admin = require('../functions/node_modules/firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'hotel-hr-app-75581' });
const db = admin.firestore();

const CSV_PATH = path.join(__dirname, '..', 'oddeleni.csv');

function readCsv() {
  let raw = fs.readFileSync(CSV_PATH, 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1); // strip BOM
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

async function deleteCollection(name) {
  const snap = await db.collection(name).get();
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  if (snap.size > 0) await batch.commit();
}

async function run() {
  const names = readCsv();
  console.log(`Read ${names.length} departments from oddeleni.csv`);

  await deleteCollection('departments');
  console.log('  ✓ Cleared existing departments collection');

  const FieldValue = admin.firestore.FieldValue;
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const ref = await db.collection('departments').add({
      name,
      displayOrder: i,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log(`  ✓ departments/${ref.id} — ${name}`);
  }
}

if (require.main === module) {
  run()
    .then(() => { console.log('\nDepartments seeded.'); process.exit(0); })
    .catch((e) => { console.error('Seed failed:', e.message); process.exit(1); });
}

module.exports = { run };
