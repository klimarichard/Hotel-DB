/**
 * Seeds shift plans from snapshot files.
 *
 * Loads every scripts/_shift_plan_snapshot_<YYYY>_<MM>.json and replays
 * it into the emulator. Plans are seeded in chronological order.
 *
 * To add a new month:
 *   1. Configure the plan in the app.
 *   2. Run: "C:\Program Files\nodejs\node.exe" scripts\_capture_shift_plan.js <year> <month>
 *   3. Commit the new snapshot file — it will be picked up automatically.
 *
 * Run with: "C:\Program Files\nodejs\node.exe" scripts\seed-shift-plan.js
 * Emulators must be running. seed-employees.js should run first.
 * Idempotent — re-running replaces plans for the same month/year.
 */

process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

const admin = require('../functions/node_modules/firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'hotel-hr-app-75581' });
const db = admin.firestore();

const path = require('path');
const fs   = require('fs');

function loadSnapshots() {
  const dir = __dirname;
  return fs.readdirSync(dir)
    .filter(f => /^_shift_plan_snapshot_\d{4}_\d{2}\.json$/.test(f))
    .sort()  // chronological order by filename
    .map(f => ({ file: f, data: require(path.join(dir, f)) }));
}

async function seedPlan(snapshot) {
  const { plan, employees, shifts, modRow = {} } = snapshot;
  const { year, month, status } = plan;
  const monthLabel = `${year}-${String(month).padStart(2, '0')}`;

  // Delete any existing plan for this month/year
  const existingSnap = await db.collection('shiftPlans')
    .where('year', '==', year)
    .where('month', '==', month)
    .get();

  for (const doc of existingSnap.docs) {
    for (const sub of ['planEmployees', 'shifts', 'shiftsSnapshot', 'modRow']) {
      const subSnap = await doc.ref.collection(sub).get();
      for (const s of subSnap.docs) await s.ref.delete();
    }
    await doc.ref.delete();
  }

  // Create plan document
  const planRef = db.collection('shiftPlans').doc();
  await planRef.set({
    year,
    month,
    status,
    createdBy: 'seed',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`  ✓ Plan created: ${monthLabel} (id: ${planRef.id})`);

  // Write planEmployees
  for (const emp of employees) {
    await planRef.collection('planEmployees').doc().set({
      ...emp,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`  ✓ planEmployee: ${emp.firstName} ${emp.lastName} → ${emp.section}`);
  }

  // Write shifts (preserve composite doc IDs: employeeId_date)
  const shiftEntries = Object.entries(shifts);
  let written = 0;
  for (const [docId, shiftData] of shiftEntries) {
    await planRef.collection('shifts').doc(docId).set({
      ...shiftData,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    written++;
    if (written % 50 === 0) process.stdout.write(`  Shifts written: ${written}/${shiftEntries.length}...\r`);
  }
  console.log(`  ✓ Shifts written: ${written} entries`);

  // Write MOD row
  const modEntries = Object.entries(modRow);
  for (const [date, modData] of modEntries) {
    await planRef.collection('modRow').doc(date).set({
      ...modData,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  if (modEntries.length > 0) {
    console.log(`  ✓ MOD row written: ${modEntries.length} entries`);
  }

  console.log(`\nShift plan seeded for ${monthLabel}.`);
}

async function run() {
  const snapshots = loadSnapshots();
  if (snapshots.length === 0) {
    console.log('No snapshot files found (scripts/_shift_plan_snapshot_YYYY_MM.json)');
    return;
  }
  for (const { file, data } of snapshots) {
    console.log(`\nSeeding from ${file}…`);
    await seedPlan(data);
  }
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch(e => { console.error('Seed failed:', e.message); process.exit(1); });
}

module.exports = { run };
