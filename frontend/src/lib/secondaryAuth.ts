import { initializeApp, getApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
} from "firebase/auth";
import { ApiError } from "./api";
import { pickSignErrorCode, signErrorMessage } from "./signErrors";

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
 * secondary instance out. Throws on invalid credentials – the caller renders the
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

/** Every login of a picker entry: the server's `emails`, else the single `email`. */
export function signerEmails(signer: { email: string; emails?: readonly string[] }): string[] {
  const list = signer.emails && signer.emails.length ? signer.emails : [signer.email];
  return Array.from(new Set(list.filter((e) => typeof e === "string" && e.trim() !== "")));
}

/** Every linked account failed the password check. `code` is the most informative. */
export class CredentialError extends Error {
  readonly code: string;
  readonly triedEmails: string[];
  constructor(code: string, triedEmails: string[]) {
    super(signErrorMessage(code));
    this.name = "CredentialError";
    this.code = code;
    this.triedEmails = triedEmails;
  }
}

/**
 * Verify a password against EVERY login linked to the picked person, in order;
 * the first that accepts it wins. One employee can have several accounts (an
 * admin's test account re-linked for testing), and the person typing knows the
 * password of THEIR account, not necessarily of whichever came first – the
 * Oksana Smolyak incident, 2026-10. Throws a {@link CredentialError} only when
 * all of them failed, carrying the most useful reason (see signErrors.ts).
 */
export async function verifyAnyCredential(
  emails: readonly string[],
  password: string
): Promise<{ uid: string; idToken: string; email: string }> {
  const codes: string[] = [];
  const tried: string[] = [];
  for (const email of emails) {
    tried.push(email);
    try {
      return await verifyCredential(email, password);
    } catch (err) {
      const code = (err as { code?: unknown })?.code;
      const c = typeof code === "string" ? code : "unknown";
      codes.push(c);
      // Offline: every further attempt would fail the same way – stop here.
      if (c === "auth/network-request-failed") break;
    }
  }
  if (tried.length === 0) codes.push("auth/missing-email");
  throw new CredentialError(pickSignErrorCode(codes), tried);
}

/** Message for any failure in a signing dialog: password check or server reply. */
export function credentialFlowErrorMessage(err: unknown, fallback = "Ověření se nezdařilo."): string {
  if (err instanceof CredentialError) return err.message;
  if (err instanceof ApiError) return err.message || fallback;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
