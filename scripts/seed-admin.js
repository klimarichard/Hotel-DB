/**
 * Seeds an admin user into the Firebase emulators using the Admin SDK.
 * Run with: "C:\Program Files\nodejs\node.exe" scripts\seed-admin.js
 * Emulators must be running first.
 */

process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

const admin = require('../functions/node_modules/firebase-admin');

admin.initializeApp({ projectId: 'hotel-hr-app-75581' });

const EMAIL = 'admin@hotel.local';
const PASSWORD = 'admin123';
const NAME = 'Admin';

async function seed() {
  // 1. Create or retrieve the auth user
  let user;
  try {
    user = await admin.auth().getUserByEmail(EMAIL);
    console.log('Auth user already exists:', user.uid);
  } catch {
    user = await admin.auth().createUser({ email: EMAIL, password: PASSWORD, displayName: NAME });
    console.log('Auth user created:', user.uid);
  }

  // 2. Set custom claim
  await admin.auth().setCustomUserClaims(user.uid, { role: 'admin' });
  console.log('Custom claim set: role=admin');

  // 3. Write Firestore document
  await admin.firestore().collection('users').doc(user.uid).set({
    name: NAME,
    email: EMAIL,
    role: 'admin',
    active: true,
    employeeId: null,
    lastLogin: null,
    createdAt: new Date().toISOString(),
  }, { merge: true });
  console.log('Firestore users/ document written');

  console.log('\nAdmin user ready:');
  console.log('  Email:   ', EMAIL);
  console.log('  Password:', PASSWORD);
  process.exit(0);
}

seed().catch((e) => { console.error('Seed failed:', e.message); process.exit(1); });
