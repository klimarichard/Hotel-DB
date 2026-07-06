import { initializeApp, getApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// A separate FirebaseApp instance ("secondary") so verifying a colleague's
// password for a Předat/Převzít signature doesn't replace the primary
// auth.currentUser. Lazily created on first use; reused across calls.
let cached: Auth | null = null;
function getSecondaryAuth(): Auth {
  if (cached) return cached;
  let app;
  try {
    app = getApp("secondary");
  } catch {
    app = initializeApp(firebaseConfig, "secondary");
  }
  const auth = getAuth(app);
  if (import.meta.env.DEV) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  }
  cached = auth;
  return auth;
}

/** Turn a reception username into its login email (same convention as LoginPage). */
export function usernameToEmail(username: string): string {
  return username.includes("@") ? username : `${username}@hotel.local`;
}

/**
 * Verify an email/username + password WITHOUT disturbing the active session.
 * Signs in on the secondary app, captures the ID token, then always signs the
 * secondary instance out. Throws on invalid credentials — the caller renders the
 * error in the sign modal.
 */
export async function verifyCredential(
  emailOrUsername: string,
  password: string
): Promise<{ uid: string; idToken: string; email: string }> {
  const auth = getSecondaryAuth();
  const email = usernameToEmail(emailOrUsername);
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const idToken = await cred.user.getIdToken();
    return { uid: cred.user.uid, idToken, email: cred.user.email ?? email };
  } finally {
    try {
      await signOut(auth);
    } catch {
      // never let secondary cleanup mask the original error
    }
  }
}
