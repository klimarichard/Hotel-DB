import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { encrypt, decrypt } from "./encryption";
import { AuditContext, logUpdate } from "./auditLog";
import { updateDocumentAlerts, EXPIRY_FIELDS } from "../routes/employees";

const db = () => admin.firestore();

/**
 * Self-service employee data edits go through an approval queue: an employee
 * proposes changes to their own record, an admin/director approves, and only
 * then is the change written to the live record. This module is the shared
 * core used by both the employee-facing router (routes/selfService.ts) and the
 * admin review router (routes/employeeChangeRequests.ts).
 *
 * Top-level collection: `employeeChangeRequests/{reqId}`.
 */

export type Section = "root" | "contact" | "documents" | "benefits";

/**
 * Whitelist of fields an employee may propose edits to, with the sub-resource
 * that holds each one and whether it is AES-256-GCM encrypted at rest.
 * Employment/contract terms are intentionally absent — those flow through the
 * Nástup/Dodatek employment workflow, not self-service.
 *
 * The frontend mirrors this list (with labels + input kinds) in
 * `frontend/src/lib/selfEditFields.ts`; keep the two in sync.
 */
export const EDITABLE_FIELDS: Record<string, { section: Section; sensitive: boolean }> = {
  // root (employees/{id})
  birthSurname:      { section: "root", sensitive: false },
  maritalStatus:     { section: "root", sensitive: false },
  education:         { section: "root", sensitive: false },
  nationality:       { section: "root", sensitive: false },
  placeOfBirth:      { section: "root", sensitive: false },
  birthNumber:       { section: "root", sensitive: true },
  // contact (single doc in employees/{id}/contact)
  phone:             { section: "contact", sensitive: false },
  email:             { section: "contact", sensitive: false },
  permanentAddress:  { section: "contact", sensitive: false },
  contactAddress:    { section: "contact", sensitive: false },
  // documents (single doc in employees/{id}/documents)
  idCardNumber:      { section: "documents", sensitive: true },
  idCardExpiry:      { section: "documents", sensitive: true },
  passportNumber:    { section: "documents", sensitive: false },
  passportIssueDate: { section: "documents", sensitive: false },
  passportExpiry:    { section: "documents", sensitive: false },
  passportAuthority: { section: "documents", sensitive: false },
  visaNumber:        { section: "documents", sensitive: false },
  visaType:          { section: "documents", sensitive: false },
  visaIssueDate:     { section: "documents", sensitive: false },
  visaExpiry:        { section: "documents", sensitive: false },
  // benefits (single doc in employees/{id}/benefits)
  insuranceNumber:   { section: "benefits", sensitive: true },
  insuranceCompany:  { section: "benefits", sensitive: false },
  bankAccount:       { section: "benefits", sensitive: true },
};

/** One proposed field change as stored on the change-request document. */
export interface StoredChange {
  field: string;
  section: Section;
  sensitive: boolean;
  label: string;
  /** Non-sensitive: the proposed plaintext value (or null to clear). Sensitive: always null. */
  newValue: string | null;
  /** Sensitive only: the proposed value encrypted with the same key as the live field (null to clear). */
  newValueEnc?: string | null;
  /** Non-sensitive only: the value at submit time, kept for reviewer context. Omitted for sensitive fields. */
  oldValue?: string | null;
}

/** Resolve the employee record linked to a login account, or null if unlinked. */
export async function getCallerEmployeeId(uid: string): Promise<string | null> {
  const snap = await db().collection("users").doc(uid).get();
  if (!snap.exists) return null;
  const empId = (snap.data() as Record<string, unknown>).employeeId;
  return typeof empId === "string" && empId ? empId : null;
}

/** Look up a user's display name (for denormalising onto the request). */
export async function getUserName(uid: string): Promise<string> {
  const snap = await db().collection("users").doc(uid).get();
  const name = snap.exists ? (snap.data() as Record<string, unknown>).name : undefined;
  return typeof name === "string" ? name : "";
}

/**
 * Validate + normalise a raw change list from the client into StoredChange[].
 * Unknown fields are dropped. Sensitive values are encrypted here so plaintext
 * never rests on the change-request document. Returns [] if nothing valid.
 */
export function buildStoredChanges(
  raw: Array<{ field?: unknown; newValue?: unknown; label?: unknown; oldValue?: unknown }>
): StoredChange[] {
  const out: StoredChange[] = [];
  for (const item of raw) {
    const field = typeof item.field === "string" ? item.field : "";
    const def = EDITABLE_FIELDS[field];
    if (!def) continue;
    const label = typeof item.label === "string" && item.label ? item.label : field;
    const newRaw = item.newValue == null ? null : String(item.newValue);
    const newValue = newRaw === "" ? null : newRaw;

    if (def.sensitive) {
      out.push({
        field,
        section: def.section,
        sensitive: true,
        label,
        newValue: null,
        newValueEnc: newValue === null ? null : encrypt(newValue),
      });
    } else {
      out.push({
        field,
        section: def.section,
        sensitive: false,
        label,
        newValue,
        oldValue: item.oldValue == null ? null : String(item.oldValue),
      });
    }
  }
  return out;
}

/** Decrypt a single proposed sensitive value for reviewer reveal. */
export function revealProposedValue(change: StoredChange): string | null {
  if (!change.sensitive || !change.newValueEnc) return null;
  return decrypt(change.newValueEnc);
}

/**
 * Strip ciphertext out of a stored change before returning it over the API.
 * Sensitive proposed values become a presence marker; reviewers decrypt them
 * on demand via the dedicated reveal endpoint (which is audit-logged).
 */
export function redactChangeForResponse(change: StoredChange): Record<string, unknown> {
  if (change.sensitive) {
    const hasValue = !!change.newValueEnc;
    return {
      field: change.field,
      section: change.section,
      sensitive: true,
      label: change.label,
      newValue: hasValue ? "••••••••" : null,
    };
  }
  return {
    field: change.field,
    section: change.section,
    sensitive: false,
    label: change.label,
    newValue: change.newValue ?? null,
    oldValue: change.oldValue ?? null,
  };
}

/** Resolve the stored value to write to the live field (ciphertext or plaintext). */
function resolveStored(c: StoredChange): string | null {
  return c.sensitive ? c.newValueEnc ?? null : c.newValue ?? null;
}

/**
 * Apply an approved set of changes to the live employee record. Writes the
 * root doc and each affected single-doc sub-collection, deletes cleared fields,
 * refreshes document expiry alerts, and writes one audit `update` entry per
 * changed field (sensitive values redacted by the audit layer).
 */
export async function applyApprovedChanges(
  ctx: AuditContext,
  employeeId: string,
  changes: StoredChange[]
): Promise<void> {
  const now = FieldValue.serverTimestamp();
  const empRef = db().collection("employees").doc(employeeId);

  const bySection = new Map<Section, StoredChange[]>();
  for (const c of changes) {
    const list = bySection.get(c.section) ?? [];
    list.push(c);
    bySection.set(c.section, list);
  }

  // ── root ──
  const rootChanges = bySection.get("root");
  if (rootChanges && rootChanges.length) {
    const snap = await empRef.get();
    const before = snap.exists ? (snap.data() as Record<string, unknown>) : {};
    const patch: Record<string, unknown> = { updatedAt: now };
    const afterForLog: Record<string, unknown> = { ...before };
    const sensitiveFields: string[] = [];
    for (const c of rootChanges) {
      if (c.sensitive) sensitiveFields.push(c.field);
      const stored = resolveStored(c);
      if (stored === null) {
        patch[c.field] = FieldValue.delete();
        afterForLog[c.field] = null;
      } else {
        patch[c.field] = stored;
        afterForLog[c.field] = stored;
      }
    }
    await empRef.update(patch);
    await logUpdate(ctx, {
      collection: "employees",
      resourceId: employeeId,
      employeeId,
      before,
      after: afterForLog,
      sensitiveFields,
    });
  }

  // ── single-doc sub-collections ──
  for (const section of ["contact", "documents", "benefits"] as const) {
    const list = bySection.get(section);
    if (!list || !list.length) continue;
    await applySubcollection(ctx, empRef, employeeId, section, list, now);
  }
}

async function applySubcollection(
  ctx: AuditContext,
  empRef: admin.firestore.DocumentReference,
  employeeId: string,
  section: Section,
  changes: StoredChange[],
  now: FirebaseFirestore.FieldValue
): Promise<void> {
  const colRef = empRef.collection(section);
  const snap = await colRef.limit(1).get();
  const before = snap.empty ? {} : (snap.docs[0].data() as Record<string, unknown>);

  const patch: Record<string, unknown> = { updatedAt: now };
  const afterForLog: Record<string, unknown> = { ...before };
  const sensitiveFields: string[] = [];
  for (const c of changes) {
    if (c.sensitive) sensitiveFields.push(c.field);
    const stored = resolveStored(c);
    if (stored === null) {
      patch[c.field] = FieldValue.delete();
      afterForLog[c.field] = null;
    } else {
      patch[c.field] = stored;
      afterForLog[c.field] = stored;
    }
  }

  if (snap.empty) {
    // No doc yet — create one. FieldValue.delete() is illegal on create, so a
    // "clear" of a never-set field is simply skipped.
    const addData: Record<string, unknown> = { updatedAt: now };
    for (const c of changes) {
      const stored = resolveStored(c);
      if (stored !== null) addData[c.field] = stored;
    }
    await colRef.add(addData);
  } else {
    await snap.docs[0].ref.update(patch);
  }

  // Documents drive the passport/visa/ID expiry alerts — refresh them from the
  // merged plaintext state (idCardExpiry is encrypted, so decrypt for the check).
  if (section === "documents") {
    await refreshDocumentExpiryAlerts(empRef, employeeId, before, changes);
  }

  await logUpdate(ctx, {
    collection: `employees/${section}`,
    resourceId: employeeId,
    employeeId,
    before,
    after: afterForLog,
    sensitiveFields,
  });
}

async function refreshDocumentExpiryAlerts(
  empRef: admin.firestore.DocumentReference,
  employeeId: string,
  before: Record<string, unknown>,
  changes: StoredChange[]
): Promise<void> {
  const empSnap = await empRef.get();
  const emp = empSnap.exists ? (empSnap.data() as Record<string, unknown>) : {};
  const changeByField = new Map(changes.map((c) => [c.field, c]));

  const alertBody: Record<string, unknown> = {};
  for (const { field } of EXPIRY_FIELDS) {
    const def = EDITABLE_FIELDS[field];
    const ch = changeByField.get(field);
    let plain: string | undefined;
    if (ch) {
      const stored = resolveStored(ch);
      plain = stored === null ? undefined : (def?.sensitive ? safeDecrypt(stored) : stored);
    } else {
      const existing = before[field];
      if (typeof existing === "string" && existing) {
        plain = def?.sensitive ? safeDecrypt(existing) : existing;
      }
    }
    alertBody[field] = plain;
  }
  await updateDocumentAlerts(
    employeeId,
    (emp.firstName as string) ?? "",
    (emp.lastName as string) ?? "",
    alertBody
  );
}

function safeDecrypt(value: string): string | undefined {
  try {
    return decrypt(value);
  } catch {
    return undefined;
  }
}
