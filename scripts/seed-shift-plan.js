/**
 * Seeds the April 2026 shift plan from a hardcoded snapshot.
 *
 * The snapshot (scripts/_shift_plan_snapshot.json) was captured from the
 * emulator after the plan was manually configured. Re-running this script
 * replays that exact state — employees, sections, and all shift cells.
 *
 * To update the snapshot: configure the plan in the app, then run
 *   node scripts/_capture_shift_plan.js   (or capture manually via the emulator)
 *
 * Run with: "C:\Program Files\nodejs\node.exe" scripts\seed-shift-plan.js
 * Emulators must be running. seed-employees.js should run first.
 * Idempotent — re-running replaces the plan for the same month/year.
 */

process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

const admin = require('../functions/node_modules/firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'hotel-hr-app-75581' });
const db = admin.firestore();

const path = require('path');
const snapshot = require('./_shift_plan_snapshot.json');

async function run() {
  const { plan, employees, shifts } = snapshot;
  const { year, month, status } = plan;
  const monthLabel = `${year}-${String(month).padStart(2, '0')}`;

  // 1. Delete any existing plan for this month/year
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
    console.log(`  Deleted existing plan for ${monthLabel}`);
  }

  // 2. Create the plan document
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

  // 3. Write planEmployees
  for (const emp of employees) {
    await planRef.collection('planEmployees').doc().set({
      ...emp,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`  ✓ planEmployee: ${emp.firstName} ${emp.lastName} → ${emp.section}`);
  }

  // 4. Write shifts (preserve composite doc IDs: employeeId_date)
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
}

if (require.main === module) {
  const { plan } = snapshot;
  const monthLabel = `${plan.year}-${String(plan.month).padStart(2, '0')}`;
  run()
    .then(() => {
      console.log(`\nShift plan seeded for ${monthLabel}.`);
      process.exit(0);
    })
    .catch(e => { console.error('Seed failed:', e.message); process.exit(1); });
}

module.exports = { run };
