/**
 * Seeds company records into Firestore emulator.
 * Creates companies/HPM and companies/STP.
 *
 * Run with: "C:\Program Files\nodejs\node.exe" scripts\seed-companies.js
 * Emulators must be running first.
 * Idempotent — safe to re-run.
 */

process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

const admin = require('../functions/node_modules/firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'hotel-hr-app-75581' });
const db = admin.firestore();

const COMPANIES = [
  {
    id: 'HPM',
    name: 'Hotel Property Management s.r.o.',
    address: 'Panská 897/12, Praha 1, 110 00',
    ic: '06947697',
    dic: 'CZ06947697',
  },
  {
    id: 'STP',
    name: 'Special Tours Prague spol. s r.o.',
    address: 'Panská 897/12, Praha 1, 110 00',
    ic: '00553557',
    dic: 'CZ00553557',
  },
];

async function run() {
  for (const { id, ...data } of COMPANIES) {
    await db.collection('companies').doc(id).set(
      { ...data, updatedAt: new Date().toISOString(), updatedBy: 'seed' },
      { merge: true }
    );
    console.log(`  ✓ companies/${id} — ${data.name}`);
  }
}

if (require.main === module) {
  run()
    .then(() => { console.log('\nCompanies seeded.'); process.exit(0); })
    .catch(e => { console.error('Seed failed:', e.message); process.exit(1); });
}

module.exports = { run };
