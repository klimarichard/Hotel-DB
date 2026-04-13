/**
 * Seeds non-admin users into the Firebase Auth emulator and Firestore.
 * Creates one director, one manager, and two employee-role users.
 * The two employee users are automatically linked to the first two active
 * employees found in Firestore (so seed-employees must run first).
 *
 * Run with: "C:\Program Files\nodejs\node.exe" scripts\seed-users.js
 * Emulators must be running first.
 * Idempotent — safe to re-run.
 */

process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

const admin = require('../functions/node_modules/firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'hotel-hr-app-75581' });
const db = admin.firestore();
const auth = admin.auth();

// Static users (director + manager never linked to an employee record)
const STATIC_USERS = [
  {
    email: 'director@hotel.local',
    password: 'director123',
    name: 'Viktor Vondra',
    role: 'director',
    employeeId: null,
  },
  {
    email: 'manager@hotel.local',
    password: 'manager123',
    name: 'Kateřina Zezulková',
    role: 'manager',
    employeeId: null,
  },
];

async function getOrCreateUser(email, password, displayName) {
  try {
    return await auth.getUserByEmail(email);
  } catch {
    return await auth.createUser({ email, password, displayName });
  }
}

async function run() {
  // ── 1. Find first two active employees to link to employee-role users ────────
  const snap = await db.collection('employees')
    .where('status', '==', 'active')
    .limit(2)
    .get();

  const linkedEmployees = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (linkedEmployees.length < 2) {
    console.warn('  ⚠  Fewer than 2 active employees found — employee users will have no link.');
    console.warn('     Run seed-employees.js first for full linking.');
  }

  const employeeUsers = linkedEmployees.map((emp, i) => ({
    email: `employee${i + 1}@hotel.local`,
    password: 'employee123',
    name: `${emp.firstName ?? 'Zaměstnanec'} ${emp.lastName ?? String(i + 1)}`,
    role: 'employee',
    employeeId: emp.id,
  }));

  // Pad to 2 entries if not enough employees were found
  while (employeeUsers.length < 2) {
    const n = employeeUsers.length + 1;
    employeeUsers.push({
      email: `employee${n}@hotel.local`,
      password: 'employee123',
      name: `Testovací Zaměstnanec ${n}`,
      role: 'employee',
      employeeId: null,
    });
  }

  const ALL_USERS = [...STATIC_USERS, ...employeeUsers];

  // ── 2. Create / update each user ─────────────────────────────────────────────
  for (const u of ALL_USERS) {
    const fbUser = await getOrCreateUser(u.email, u.password, u.name);

    await auth.setCustomUserClaims(fbUser.uid, { role: u.role });

    await db.collection('users').doc(fbUser.uid).set({
      name: u.name,
      email: u.email,
      role: u.role,
      active: true,
      employeeId: u.employeeId ?? null,
      lastLogin: null,
      createdAt: new Date().toISOString(),
    }, { merge: true });

    const linked = u.employeeId ? ` → employee ${u.employeeId}` : '';
    console.log(`  ✓ ${u.role.padEnd(10)} ${u.email}${linked}`);
  }

  console.log('\nCredentials:');
  for (const u of ALL_USERS) {
    console.log(`  ${u.email.padEnd(28)} ${u.password}`);
  }
}

if (require.main === module) {
  run()
    .then(() => { console.log('\nUsers seeded.'); process.exit(0); })
    .catch(e => { console.error('Seed failed:', e.message); process.exit(1); });
}

module.exports = { run };
