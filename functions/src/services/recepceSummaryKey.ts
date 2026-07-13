/**
 * Pass-key (PIN) gate for the cross-hotel Recepce summary page (`/4d`).
 *
 * The summary is already gated by the `recepce.summary.view` permission; this is
 * a deliberate SECOND layer, so that holding the permission (or an unattended
 * logged-in session) is not by itself enough to read the numbers.
 *
 * Design:
 *   - The pass-key is NEVER stored in plaintext. `settings/recepceSummaryKey`
 *     holds a random 16-byte salt and a scrypt hash of the PIN. Comparison is
 *     timing-safe. The hash never leaves the server.
 *   - Unlocking is server-side (`verifyPin`) and returns a short-lived HMAC
 *     token bound to the caller's uid. The token is signed with a key DERIVED
 *     from ENCRYPTION_KEY (a separate derivation, so the token secret is not the
 *     field-encryption key itself) and carries its own expiry.
 *   - Every summary DATA route runs `requireSummaryKey`, which demands that
 *     token in `X-Summary-Key`. A permitted user who calls the API directly,
 *     bypassing the page, gets 401 — the PIN is real access control, not just a
 *     screen in front of the UI.
 *   - Brute force is bounded: MAX_ATTEMPTS consecutive wrong PINs per uid lock
 *     that uid out for LOCKOUT_MINUTES (`recepceSummaryAttempts/{uid}`).
 */
import * as crypto from "crypto";
import * as admin from "firebase-admin";
import { Response, NextFunction } from "express";
import { FieldValue } from "firebase-admin/firestore";
import { AuthRequest } from "../middleware/auth";

/** PIN format: digits only, 4–10 of them. */
const PIN_RE = /^\d{4,10}$/;

/** How long an unlock lasts before the page must ask again. */
const TOKEN_TTL_MS = 60 * 60 * 1000;

/** Consecutive wrong PINs allowed per user before a lockout kicks in. */
const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 10;

const SCRYPT_KEYLEN = 32;

const KEY_DOC = () => admin.firestore().collection("settings").doc("recepceSummaryKey");
const ATTEMPTS_DOC = (uid: string) =>
  admin.firestore().collection("recepceSummaryAttempts").doc(uid);

export interface SummaryKeyDoc {
  salt: string;
  hash: string;
  updatedAt?: unknown;
  updatedBy?: string;
}

export function isValidPinFormat(pin: unknown): pin is string {
  return typeof pin === "string" && PIN_RE.test(pin);
}

/** scrypt(pin, salt) as hex. Same params must be used for write and verify. */
function scryptHex(pin: string, saltHex: string): string {
  return crypto.scryptSync(pin, Buffer.from(saltHex, "hex"), SCRYPT_KEYLEN).toString("hex");
}

/** Constant-time string compare that tolerates length mismatch. */
function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Token-signing secret, derived from ENCRYPTION_KEY (never the raw key). */
function tokenSecret(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error("ENCRYPTION_KEY environment variable is not set");
  return crypto.createHmac("sha256", Buffer.from(key, "hex")).update("recepce-summary-token").digest();
}

export async function isKeyConfigured(): Promise<boolean> {
  const snap = await KEY_DOC().get();
  const data = snap.data() as SummaryKeyDoc | undefined;
  return !!(data && data.salt && data.hash);
}

/**
 * Verifies a PIN against the stored hash. Returns false when no key is
 * configured — callers must check `isKeyConfigured()` first to tell the two
 * cases apart (the page shows a different message for "not set yet").
 */
export async function verifyPin(pin: string): Promise<boolean> {
  const snap = await KEY_DOC().get();
  const data = snap.data() as SummaryKeyDoc | undefined;
  if (!data?.salt || !data.hash) return false;
  return timingSafeEqualHex(scryptHex(pin, data.salt), data.hash);
}

/** Writes a new pass-key. The plaintext PIN is never persisted. */
export async function setPin(pin: string, uid: string): Promise<void> {
  const salt = crypto.randomBytes(16).toString("hex");
  await KEY_DOC().set(
    { salt, hash: scryptHex(pin, salt), updatedAt: FieldValue.serverTimestamp(), updatedBy: uid },
    { merge: true }
  );
}

// ---- Lockout -------------------------------------------------------------

interface AttemptsDoc {
  fails?: number;
  lockedUntil?: number; // epoch ms
}

/** Null when not locked; otherwise the instant the lockout expires. */
export async function getLockout(uid: string): Promise<Date | null> {
  const snap = await ATTEMPTS_DOC(uid).get();
  const data = snap.data() as AttemptsDoc | undefined;
  const until = data?.lockedUntil;
  if (typeof until !== "number") return null;
  return until > Date.now() ? new Date(until) : null;
}

/**
 * Records a failed attempt. Returns how many attempts remain before a lockout,
 * and the lockout instant once it triggers.
 */
export async function recordFailure(
  uid: string
): Promise<{ attemptsLeft: number; lockedUntil: Date | null }> {
  const ref = ATTEMPTS_DOC(uid);
  const nowMs = Date.now();
  return admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = (snap.data() as AttemptsDoc | undefined) ?? {};
    const fails = (data.fails ?? 0) + 1;
    if (fails >= MAX_ATTEMPTS) {
      const lockedUntil = nowMs + LOCKOUT_MINUTES * 60 * 1000;
      tx.set(ref, { fails: 0, lockedUntil }, { merge: true });
      return { attemptsLeft: 0, lockedUntil: new Date(lockedUntil) };
    }
    tx.set(ref, { fails, lockedUntil: FieldValue.delete() }, { merge: true });
    return { attemptsLeft: MAX_ATTEMPTS - fails, lockedUntil: null };
  });
}

export async function clearFailures(uid: string): Promise<void> {
  await ATTEMPTS_DOC(uid).set({ fails: 0, lockedUntil: FieldValue.delete() }, { merge: true });
}

// ---- Unlock token --------------------------------------------------------

/**
 * `<expiryMs>.<hmac>` — the uid is signed into the MAC but not carried in the
 * token, so a token minted for one user cannot be replayed by another.
 */
export function issueToken(uid: string): { token: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  const exp = String(expiresAt.getTime());
  const mac = crypto.createHmac("sha256", tokenSecret()).update(`${uid}.${exp}`).digest("hex");
  return { token: `${exp}.${mac}`, expiresAt };
}

export function verifyToken(token: unknown, uid: string): boolean {
  if (typeof token !== "string") return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const exp = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expMs = Number(exp);
  if (!Number.isFinite(expMs) || expMs <= Date.now()) return false;
  const expected = crypto.createHmac("sha256", tokenSecret()).update(`${uid}.${exp}`).digest("hex");
  return timingSafeEqualHex(mac, expected);
}

/**
 * Express guard for the summary DATA routes. Runs AFTER requireAuth +
 * requirePermission: the permission says "may see this page at all", the
 * pass-key token says "has unlocked it in the last hour".
 */
export function requireSummaryKey(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.header("X-Summary-Key");
  if (!req.uid || !verifyToken(header, req.uid)) {
    res.status(401).json({
      error: "Přístupový klíč je vyžadován.",
      code: "SUMMARY_KEY_REQUIRED",
    });
    return;
  }
  next();
}
