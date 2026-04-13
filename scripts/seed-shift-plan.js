/**
 * Seeds a shift plan for the current month into the Firestore emulator.
 * - Queries up to 12 active employees and adds them to the plan.
 * - Generates realistic shifts for days 1 through yesterday using a
 *   rotating D/N/X pattern. Today and future days are left empty.
 * - Creates the plan with status "opened" (employees can submit unavailability).
 *
 * Run with: "C:\Program Files\nodejs\node.exe" scripts\seed-shift-plan.js
 * Emulators must be running first. seed-employees.js should run first.
 * Idempotent — re-running replaces the plan for the same month/year.
 */

process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

const admin = require('../functions/node_modules/firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'hotel-hr-app-75581' });
const db = admin.firestore();

// ─── Config ───────────────────────────────────────────────────────────────────

const now = new Date();
const YEAR  = now.getFullYear();
const MONTH = now.getMonth() + 1; // 1-based
const TODAY_DAY = now.getDate();  // fill shifts up to yesterday

const MAX_EMPLOYEES   = 12;
const HOTELS          = ['A', 'S', 'Q']; // hotel codes assigned to reception

// ─── Section assignment ───────────────────────────────────────────────────────
// Based on employee index within the pool:
//   0-1   → vedoucí       (R shifts, hotel-agnostic)
//   2-9   → recepce       (rotating D/N with hotel, X days off)
//   10-11 → portýři       (D shifts with hotel)

function assignSection(empIndex) {
  if (empIndex <= 1)  return { section: 'vedoucí',  primaryShiftType: 'R',  primaryHotel: null };
  if (empIndex <= 9)  return { section: 'recepce',  primaryShiftType: empIndex % 2 === 0 ? 'D' : 'N', primaryHotel: HOTELS[empIndex % HOTELS.length] };
  return               { section: 'portýři',  primaryShiftType: 'D',  primaryHotel: HOTELS[empIndex % HOTELS.length] };
}

// ─── Shift rotation ───────────────────────────────────────────────────────────
// 6-step cycle, each employee starts at a different offset so the grid
// always has adequate D and N coverage.
//
// Cycle: D D N N X X  (2 days, 2 nights, 2 off)
// Offset per employee: +1 step — prevents all employees landing on X simultaneously.

const CYCLE = ['D', 'D', 'N', 'N', 'X', 'X'];

function getShiftCode(empIndex, sectionInfo, dayOfMonth) {
  const { section, primaryShiftType } = sectionInfo;

  if (section === 'vedoucí') {
    // Leaders: R on weekdays, X on weekends
    const d = new Date(YEAR, MONTH - 1, dayOfMonth);
    const dow = d.getDay(); // 0=Sun, 6=Sat
    return dow === 0 || dow === 6 ? 'X' : 'R';
  }

  if (section === 'portýři') {
    // Porters: D every day, X every 4th day
    return (dayOfMonth + empIndex) % 4 === 0 ? 'X' : 'D';
  }

  // recepce: rotating cycle
  const offset = (empIndex - 2) * 1; // offset by empIndex within recepce group
  return CYCLE[(dayOfMonth - 1 + offset) % CYCLE.length];
}

// ─── Hour mapping ─────────────────────────────────────────────────────────────

const HOURS = { D: 12, N: 12, R: 8, ZD: 8, ZN: 8, DP: 12, NP: 12, X: 0 };

function buildShiftDoc(employeeId, date, shiftCode, hotel) {
  const isX     = shiftCode === 'X';
  const hours   = HOURS[shiftCode] ?? 0;
  const rawInput = isX ? 'X' : (hotel ? `${shiftCode}${hotel}` : shiftCode);

  return {
    employeeId,
    date,
    rawInput,
    segments: [{ code: shiftCode, hotel: isX ? null : (hotel ?? null), hours }],
    hoursComputed: hours,
    isDouble: false,
    status: isX ? 'day_off' : 'assigned',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

// ─── Main seed function ───────────────────────────────────────────────────────

async function run() {
  // 1. Fetch up to MAX_EMPLOYEES active employees
  const snap = await db.collection('employees')
    .where('status', '==', 'active')
    .limit(MAX_EMPLOYEES)
    .get();

  if (snap.empty) {
    console.warn('  ⚠  No active employees found. Run seed-employees.js first.');
    return;
  }

  const employees = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  console.log(`  Found ${employees.length} active employees`);

  // 2. Delete any existing plan for this month/year (keep idempotent)
  const existingSnap = await db.collection('shiftPlans')
    .where('year', '==', YEAR)
    .where('month', '==', MONTH)
    .get();

  if (!existingSnap.empty) {
    for (const doc of existingSnap.docs) {
      // Delete sub-collections first
      for (const sub of ['planEmployees', 'shifts', 'shiftsSnapshot', 'modRow']) {
        const subSnap = await doc.ref.collection(sub).get();
        for (const s of subSnap.docs) await s.ref.delete();
      }
      await doc.ref.delete();
      console.log(`  Deleted existing plan for ${YEAR}-${String(MONTH).padStart(2, '0')}`);
    }
  }

  // 3. Create the plan document
  const planRef = db.collection('shiftPlans').doc();
  await planRef.set({
    year:        YEAR,
    month:       MONTH,
    status:      'opened',
    createdBy:   'seed',
    createdAt:   admin.firestore.FieldValue.serverTimestamp(),
    updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`  ✓ Plan created: ${YEAR}-${String(MONTH).padStart(2, '0')} (id: ${planRef.id})`);

  // 4. Add planEmployees
  const planEmployeeDocs = [];
  for (let i = 0; i < employees.length; i++) {
    const emp = employees[i];
    const sectionInfo = assignSection(i);
    const peRef = planRef.collection('planEmployees').doc();
    const peDoc = {
      employeeId:       emp.id,
      firstName:        emp.firstName ?? '',
      lastName:         emp.lastName ?? '',
      section:          sectionInfo.section,
      primaryShiftType: sectionInfo.primaryShiftType,
      primaryHotel:     sectionInfo.primaryHotel,
      displayOrder:     i,
      active:           true,
      contractType:     emp.currentContractType ?? null,
    };
    await peRef.set(peDoc);
    planEmployeeDocs.push({ ref: peRef, ...peDoc });
    console.log(`  ✓ planEmployee: ${emp.firstName} ${emp.lastName} → ${sectionInfo.section}`);
  }

  // 5. Generate shifts for days 1 … (TODAY_DAY - 1)
  const lastFilledDay = Math.max(0, TODAY_DAY - 1);
  if (lastFilledDay === 0) {
    console.log('  ℹ  Today is the 1st — no past days to fill.');
    return;
  }

  let shiftCount = 0;
  for (let empIdx = 0; empIdx < employees.length; empIdx++) {
    const emp = employees[empIdx];
    const sectionInfo = assignSection(empIdx);

    for (let day = 1; day <= lastFilledDay; day++) {
      const dateStr = `${YEAR}-${String(MONTH).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const shiftCode = getShiftCode(empIdx, sectionInfo, day);
      const hotel = sectionInfo.section !== 'vedoucí' && shiftCode !== 'X'
        ? sectionInfo.primaryHotel
        : null;

      const docId = `${emp.id}_${dateStr}`;
      await planRef.collection('shifts').doc(docId).set(
        buildShiftDoc(emp.id, dateStr, shiftCode, hotel)
      );
      shiftCount++;
    }
  }

  console.log(`  ✓ Shifts written: ${shiftCount} entries (days 1–${lastFilledDay})`);
}

if (require.main === module) {
  run()
    .then(() => {
      console.log(`\nShift plan seeded for ${YEAR}-${String(MONTH).padStart(2, '0')}.`);
      process.exit(0);
    })
    .catch(e => { console.error('Seed failed:', e.message); process.exit(1); });
}

module.exports = { run };
