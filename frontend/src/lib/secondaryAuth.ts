import { initializeApp, getApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
} from "firebase/auth";
import { auth as primaryAuth } from "./firebase";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// A separate FirebaseApp instance ("secondary") so signing in for a
// password-confirm prompt doesn't replace the primary auth.currentUser.
// Lazily created on first use; reused across calls.
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

/**
 * Verify an email + password without disturbing the active session. Signs in on
 * a secondary FirebaseApp, captures the ID token, then signs out of the
 * secondary instance immediately so it doesn't keep credentials around.
 *
 * Throws on invalid credentials — caller renders the error in the calling
 * modal instead of showing a global toast.
 */
export async function verifyCredential(
  email: string,
  password: string
): Promise<{ uid: string; idToken: string; email: string; displayName: string | null }> {
  const auth = getSecondaryAuth();
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const idToken = await cred.user.getIdToken();
    return {
      uid: cred.user.uid,
      idToken,
      email: cred.user.email ?? email,
      displayName: cred.user.displayName ?? null,
    };
  } finally {
    // Always release the secondary session, even if we threw.
    try {
      await signOut(auth);
    } catch {
      // ignore — we never want secondary cleanup to mask the original error
    }
  }
}

/**
 * Replace the active primary session with the given credentials. Used for the
 * "Přihlásit jako [incoming]?" follow-up after Převzato.
 */
export async function signInPrimary(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(primaryAuth, email, password);
}
