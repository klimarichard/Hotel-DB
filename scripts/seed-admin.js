/**
 * Seeds an admin user into the Firebase emulators via REST API.
 * Run with: "C:\Program Files\nodejs\node.exe" scripts\seed-admin.js
 * Emulators must be running first.
 */

const http = require('http');

const PROJECT_ID = 'hotel-hr-app-75581';
const AUTH_PORT = 9099;
const FIRESTORE_PORT = 8080;

const EMAIL = 'admin@hotel.local';
const PASSWORD = 'admin123';
const NAME = 'Admin';

function post(port, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let raw = '';
        res.on('data', (c) => raw += c);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode, body: raw }); }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function patch(port, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let raw = '';
        res.on('data', (c) => raw += c);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode, body: raw }); }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function seed() {
  // 1. Create auth user via emulator REST API
  console.log('Creating auth user...');
  const signUpRes = await post(AUTH_PORT,
    `/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    { email: EMAIL, password: PASSWORD, displayName: NAME, returnSecureToken: false }
  );

  let uid;
  if (signUpRes.status !== 200) {
    if (signUpRes.body?.error?.message === 'EMAIL_EXISTS') {
      console.log('User already exists, signing in to get UID...');
      const signInRes = await post(AUTH_PORT,
        `/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
        { email: EMAIL, password: PASSWORD, returnSecureToken: false }
      );
      uid = signInRes.body?.localId;
      if (!uid) {
        console.error('Could not sign in to get UID:', JSON.stringify(signInRes.body));
        process.exit(1);
      }
    } else {
      console.error('Failed to create auth user:', JSON.stringify(signUpRes.body));
      process.exit(1);
    }
  } else {
    uid = signUpRes.body.localId;
    console.log('Auth user created:', uid);
  }
  console.log('User UID:', uid);

  // 3. Set custom claims via emulator admin endpoint
  console.log('Setting role claim...');
  const claimsRes = await post(AUTH_PORT,
    `/emulator/v1/projects/${PROJECT_ID}/accounts/${uid}:setClaims`,
    { customClaims: { role: 'admin' } }
  );
  if (claimsRes.status !== 200) {
    console.error('Failed to set claims:', JSON.stringify(claimsRes.body));
    process.exit(1);
  }
  console.log('Custom claim set: role=admin');

  // 4. Write Firestore document via emulator REST API
  console.log('Writing Firestore document...');
  const fsPath = `/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}`;
  const fsRes = await patch(FIRESTORE_PORT, fsPath, {
    fields: {
      name:       { stringValue: NAME },
      email:      { stringValue: EMAIL },
      role:       { stringValue: 'admin' },
      active:     { booleanValue: true },
      employeeId: { nullValue: null },
      lastLogin:  { nullValue: null },
    }
  });
  if (fsRes.status !== 200) {
    console.error('Failed to write Firestore doc:', JSON.stringify(fsRes.body));
    process.exit(1);
  }
  console.log('Firestore users/ document created');

  console.log('\nAdmin user ready:');
  console.log('  Email:   ', EMAIL);
  console.log('  Password:', PASSWORD);
}

seed().catch((e) => { console.error('Seed failed:', e.message); process.exit(1); });
