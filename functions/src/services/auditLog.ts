import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { UserRole } from "../middleware/auth";

const db = () => admin.firestore();

export type AuditAction = "create" | "update" | "delete" | "reveal" | "export";

export interface AuditContext {
  uid: string;
  email: string;
  role: UserRole;
}

export interface AuditEntry {
  userId: string;
  userEmail: string;
  userRole: UserRole;
  action: AuditAction;
  collection: string;
  resourceId?: string;
  subResourceId?: string;
  fieldPath?: string;
  oldValue?: unknown;
  newValue?: unknown;
  redacted?: boolean;
  summary?: Record<string, unknown>;
  employeeId?: string;
  // Action-specific extras kept for backwards compatibility with the original
  // inline writers (reveal/export). Free-form bag preserved verbatim.
  extra?: Record<string, unknown>;
  timestamp: FieldValue | Timestamp;
}

// Fields whose values must NEVER be written to the audit log, even encrypted.
// (Encryption-at-rest does not justify storing ciphertext in audit logs —
// rotating the key would break log readability and a key compromise would
// expose every change ever made.)
const SENSITIVE_FIELD_NAMES = new Set<string>([
  "birthNumber",
  "idCardNumber",
  "idCardExpiry",
  "insuranceNumber",
  "bankAccount",
]);

function isSensitive(fieldPath: string, extraSensitive?: readonly string[]): boolean {
  // Match either the leaf name (works for nested paths like "documents.idCardNumber")
  // or the explicit override list passed by the caller.
  const leaf = fieldPath.split(".").pop() ?? fieldPath;
  if (SENSITIVE_FIELD_NAMES.has(leaf)) return true;
  if (extraSensitive && extraSensitive.includes(fieldPath)) return true;
  return false;
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

// Strip sensitive fields from a snapshot before writing it to the audit log.
// Used for create/delete summaries.
function redactSnapshot(
  snapshot: Record<string, unknown> | undefined,
  extraSensitive?: readonly string[]
): Record<string, unknown> | undefined {
  if (!snapshot) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(snapshot)) {
    if (isSensitive(k, extraSensitive)) {
      // Mark presence without leaking value or ciphertext
      if (v !== undefined && v !== null && v !== "") out[k] = "[redacted]";
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function writeEntry(entry: Omit<AuditEntry, "timestamp">): Promise<void> {
  try {
    await db().collection("auditLog").add({
      ...stripUndefined(entry as unknown as Record<string, unknown>),
      timestamp: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    // Audit failures must never abort the user-facing write.
    console.error("[auditLog] failed to write entry", err);
  }
}

function baseEntry(
  ctx: AuditContext,
  action: AuditAction,
  collection: string,
  resourceId?: string,
  subResourceId?: string,
  employeeId?: string
): Omit<AuditEntry, "timestamp"> {
  return {
    userId: ctx.uid,
    userEmail: ctx.email,
    userRole: ctx.role,
    action,
    collection,
    resourceId,
    subResourceId,
    employeeId,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function logCreate(
  ctx: AuditContext,
  args: {
    collection: string;
    resourceId: string;
    subResourceId?: string;
    employeeId?: string;
    summary?: Record<string, unknown>;
    sensitiveFields?: readonly string[];
  }
): Promise<void> {
  await writeEntry({
    ...baseEntry(ctx, "create", args.collection, args.resourceId, args.subResourceId, args.employeeId),
    summary: redactSnapshot(args.summary, args.sensitiveFields),
  });
}

export async function logDelete(
  ctx: AuditContext,
  args: {
    collection: string;
    resourceId: string;
    subResourceId?: string;
    employeeId?: string;
    summary?: Record<string, unknown>;
    sensitiveFields?: readonly string[];
  }
): Promise<void> {
  await writeEntry({
    ...baseEntry(ctx, "delete", args.collection, args.resourceId, args.subResourceId, args.employeeId),
    summary: redactSnapshot(args.summary, args.sensitiveFields),
  });
}

// Compares `before` and `after` and writes one audit entry per changed top-level field.
// For sensitive fields, the entry sets `redacted: true` and omits values.
//
// Ignored: bookkeeping timestamps (always change) and `id` — the frontend
// often re-sends the doc id as a body field after reading it back from the
// API, but the stored doc has no `id` field, so a naive diff flags every
// save as "id changed from undefined to <docId>". The doc id is the path,
// not data.
const IGNORED_FIELD_SUFFIXES = ["updatedAt", "createdAt", "lastLogin"];
const IGNORED_FIELD_NAMES = new Set<string>(["id"]);

// Treat all "absent-ish" values as equivalent so saving an unchanged form
// doesn't flag every blank optional field. A user who explicitly clears a
// previously non-empty value still produces a meaningful diff.
function isNullish(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

export async function logUpdate(
  ctx: AuditContext,
  args: {
    collection: string;
    resourceId: string;
    subResourceId?: string;
    employeeId?: string;
    before: Record<string, unknown> | undefined;
    after: Record<string, unknown>;
    sensitiveFields?: readonly string[];
    fieldPathPrefix?: string; // e.g. "documents." for sub-doc edits
  }
): Promise<void> {
  const before = args.before ?? {};
  const after = args.after;
  const keys = new Set<string>([...Object.keys(before), ...Object.keys(after)]);

  for (const key of keys) {
    if (IGNORED_FIELD_NAMES.has(key)) continue;
    if (IGNORED_FIELD_SUFFIXES.some((s) => key === s || key.endsWith(s))) continue;

    const oldVal = (before as Record<string, unknown>)[key];
    const newVal = (after as Record<string, unknown>)[key];

    if (isNullish(oldVal) && isNullish(newVal)) continue;
    if (deepEqual(oldVal, newVal)) continue;

    const fieldPath = (args.fieldPathPrefix ?? "") + key;
    const sensitive = isSensitive(fieldPath, args.sensitiveFields);

    await writeEntry({
      ...baseEntry(
        ctx,
        "update",
        args.collection,
        args.resourceId,
        args.subResourceId,
        args.employeeId
      ),
      fieldPath,
      oldValue: sensitive ? undefined : sanitizeForLog(oldVal),
      newValue: sensitive ? undefined : sanitizeForLog(newVal),
      redacted: sensitive ? true : undefined,
    });
  }
}

// Free-form audit entry — used to migrate the legacy inline writes (reveal,
// export) without forcing them into the create/update/delete shape.
export async function writeAudit(
  ctx: AuditContext,
  args: {
    action: AuditAction;
    collection?: string;
    resourceId?: string;
    employeeId?: string;
    extra?: Record<string, unknown>;
  }
): Promise<void> {
  await writeEntry({
    ...baseEntry(
      ctx,
      args.action,
      args.collection ?? "",
      args.resourceId,
      undefined,
      args.employeeId
    ),
    extra: args.extra,
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;

  // Treat Firestore sentinels as not-equal — a write request always replaces them.
  if (
    (a && (a as { _methodName?: string })._methodName) ||
    (b && (b as { _methodName?: string })._methodName)
  ) {
    return false;
  }

  // Timestamp comparison
  if (a instanceof Timestamp && b instanceof Timestamp) {
    return a.isEqual(b);
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (Array.isArray(a) !== Array.isArray(b)) return false;

  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ka = Object.keys(ao);
  const kb = Object.keys(bo);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}

// Convert Firestore Timestamps and other non-serializable values into shapes
// safe to store in another Firestore document.
function sanitizeForLog(v: unknown): unknown {
  if (v === undefined) return null;
  if (v instanceof Timestamp) return v;
  if (
    v &&
    typeof v === "object" &&
    (v as { _methodName?: string })._methodName
  ) {
    // FieldValue sentinel — represent as a string label, not an object
    return `[${(v as { _methodName: string })._methodName}]`;
  }
  if (Array.isArray(v)) return v.map(sanitizeForLog);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = sanitizeForLog(val);
    }
    return out;
  }
  return v;
}

// Build an AuditContext from an AuthRequest. Routes call this once at the
// top of each handler (after requireAuth has populated uid/role/userEmail).
export function ctxFromReq(req: {
  uid?: string;
  role?: UserRole;
  userEmail?: string;
}): AuditContext {
  return {
    uid: req.uid ?? "",
    email: req.userEmail ?? "",
    role: req.role ?? "employee",
  };
}
