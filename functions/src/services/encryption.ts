import * as crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits recommended for GCM
const TAG_LENGTH = 16;

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error("ENCRYPTION_KEY environment variable is not set");
  const buf = Buffer.from(key, "hex");
  if (buf.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes (64 hex chars)");
  return buf;
}

/**
 * Encrypts a plaintext string.
 * Returns a base64-encoded string: iv + tag + ciphertext
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv) as crypto.CipherGCM;
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Pack: iv (12) + tag (16) + ciphertext
  const combined = Buffer.concat([iv, tag, encrypted]);
  return combined.toString("base64");
}

/**
 * Decrypts a base64-encoded encrypted string produced by encrypt().
 */
export function decrypt(encoded: string): string {
  const key = getKey();
  const combined = Buffer.from(encoded, "base64");
  const iv = combined.subarray(0, IV_LENGTH);
  const tag = combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv) as crypto.DecipherGCM;
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final("utf8");
}

/**
 * Encrypts an object's specified fields in-place, returns a new object.
 * Fields that are null/undefined are left as-is.
 */
export function encryptFields<T extends Record<string, unknown>>(
  obj: T,
  fields: string[]
): T {
  const result = { ...obj };
  for (const field of fields) {
    const val = result[field];
    if (typeof val === "string" && val.length > 0) {
      (result as Record<string, unknown>)[field as string] = encrypt(val);
    }
  }
  return result;
}

/**
 * Decrypts an object's specified fields in-place, returns a new object.
 * Fields that are null/undefined/empty are left as-is.
 */
export function decryptFields<T extends Record<string, unknown>>(
  obj: T,
  fields: string[]
): T {
  const result = { ...obj };
  for (const field of fields) {
    const val = result[field];
    if (typeof val === "string" && val.length > 0) {
      try {
        (result as Record<string, unknown>)[field as string] = decrypt(val);
      } catch {
        // Leave as-is if decryption fails (corrupted or not encrypted)
      }
    }
  }
  return result;
}

/**
 * Redacts an object's specified fields, replacing with "••••••••".
 * Used when returning data to the frontend without revealing sensitive values.
 */
export function redactFields<T extends Record<string, unknown>>(
  obj: T,
  fields: string[]
): T {
  const result = { ...obj };
  for (const field of fields) {
    if (result[field] != null && result[field] !== "") {
      (result as Record<string, unknown>)[field as string] = "••••••••";
    }
  }
  return result;
}
