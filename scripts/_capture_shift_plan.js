/**
 * Captures a shift plan from the emulator into a snapshot JSON file.
 *
 * Usage:
 *   "C:\Program Files\nodejs\node.exe" scripts\_capture_shift_plan.js <year> <month>
 *
 * Example:
 *   "C:\Program Files\nodejs\node.exe" scripts\_capture_shift_plan.js 2026 3
 *
 * Output: scripts/_shift_plan_snapshot_<year>_<MM>.json
 * Emulators must be running.
 */

process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

const admin = require('../functions/node_modules/firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'hotel-hr-app-75581' });
const db = admin.firestore();

const path = require('path');
const fs   = require('fs');

async function capture(year, month) {
  const monthLabel = `${year}-${String(month).padStart(2, '0')}`;

  // Find the plan
  const snap = await db.collection('shiftPlans')
    .where('year', '==', year)
    .where('month', '==', month)
    .get();

  if (snap.empty) {
    console.error(`No plan found for ${monthLabel}`);
    process.exit(1);
  }

  const planDoc = snap.docs[0];
  const planData = planDoc.data();
  console.log(`Found plan ${planDoc.id} — status: ${planData.status}`);

  // planEmployees
  const empSnap = await planDoc.ref.collection('planEmployees').orderBy('displayOrder').get();
  const employees = empSnap.docs.map(d => {
    const { createdAt, updatedAt, ...rest } = d.data();
    return rest;
  });
  console.log(`  ${employees.length} employees`);

  // shifts
  const shiftsSnap = await planDoc.ref.collection('shifts').get();
  const shifts = {};
  for (const d of shiftsSnap.docs) {
    const { updatedAt, ...rest } = d.data();
    shifts[d.id] = rest;
  }
  console.log(`  ${Object.keys(shifts).length} shifts`);

  // modRow
  const modSnap = await planDoc.ref.collection('modRow').get();
  const modRow = {};
  for (const d of modSnap.docs) {
    const { updatedAt, ...rest } = d.data();
    modRow[d.id] = rest;
  }
  console.log(`  ${Object.keys(modRow).length} MOD entries`);

  const snapshot = {
    plan: { year, month, status: planData.status },
    employees,
    shifts,
    modRow,
  };

  const outFile = path.join(__dirname, `_shift_plan_snapshot_${year}_${String(month).padStart(2, '0')}.json`);
  fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 2), 'utf8');
  console.log(`\nSnapshot saved: ${outFile}`);
}

const [,, yearArg, monthArg] = process.argv;
if (!yearArg || !monthArg) {
  console.error('Usage: node _capture_shift_plan.js <year> <month>');
  process.exit(1);
}

capture(parseInt(yearArg), parseInt(monthArg))
  .then(() => process.exit(0))
  .catch(e => { console.error('Capture failed:', e.message); process.exit(1); });
