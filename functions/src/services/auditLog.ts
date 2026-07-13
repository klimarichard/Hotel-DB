import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

const db = () => admin.firestore();

export type AuditAction = "create" | "update" | "delete" | "reveal" | "export" | "manual-trigger";

/**
 * Page category — which area of the app the action was performed in. Drives the
 * change-log page's per-page filter (see TODO_change_log.md). Written at log time
 * from a `collection → category` default map (override per call where the same
 * collection serves two pages, e.g. employeeChangeRequests is `mujProfil` on
 * submit but `zamestnanci` on review). `system` is the automatic-actions bucket.
 */
export type AuditCategory =
  | "smeny"
  | "dovolena"
  | "zamestnanci"
  | "mzdy"
  | "sablony"
  | "navody"
  | "mujProfil"
  | "nastaveni"
  | "system";

/** Settings sub-area, for the Nastavení per-tab filter. */
export type SettingsArea =
  | "uzivatele"
  | "spolecnosti"
  | "oddeleni"
  | "pozice"
  | "vzdelani"
  | "mzdy";

/**
 * Denormalized filter keys the change-log page needs but that aren't already on
 * the entry. Stored so Firestore can filter on them server-side (it can't filter
 * on values derived in the render layer). All optional — callers pass what their
 * handler has in hand.
 */
export interface AuditFilterKeys {
  /** Page bucket; defaults from COLLECTION_CATEGORY when omitted. */
  category?: AuditCategory;
  /** Semantic event id (e.g. "vacation.approve") — the render layer maps it to a Czech verb. */
  event?: string;
  /** Year/month for Směny / Mzdy / Dovolená period filters. */
  year?: number;
  month?: number;
  /** Šablony filter. */
  templateId?: string;
  /** Nastavení sub-tab filter. */
  settingsArea?: SettingsArea;
}

/** Default page category per top-level collection. Overridable per call. */
const COLLECTION_CATEGORY: Record<string, AuditCategory> = {
  shiftPlans: "smeny",
  vacationRequests: "dovolena",
  employees: "zamestnanci",
  "employees/employment": "zamestnanci",
  "employees/contact": "zamestnanci",
  "employees/documents": "zamestnanci",
  "employees/benefits": "zamestnanci",
  contracts: "zamestnanci",
  otherDocuments: "zamestnanci",
  payrollPeriods: "mzdy",
  contractTemplates: "sablony",
  guides: "navody",
  guideCategories: "navody",
  employeeChangeRequests: "mujProfil",
  users: "nastaveni",
  roleTypes: "nastaveni",
  companies: "nastaveni",
  departments: "nastaveni",
  jobPositions: "nastaveni",
  educationLevels: "nastaveni",
  settings: "nastaveni",
};

/**
 * Page category for a collection — exported so the one-time backfill derives the
 * same value as live writes. Tries the full path, then the parent segment.
 */
export function categoryForCollection(
  collection: string,
  override?: AuditCategory
): AuditCategory | undefined {
  // Sub-doc collections ("shiftPlans/unavailabilityRequests", "employees/benefits",
  // …) inherit their parent's page category without enumerating every sub-path.
  return override ?? COLLECTION_CATEGORY[collection] ?? COLLECTION_CATEGORY[collection.split("/")[0]];
}

/** Default Nastavení sub-area per collection (the Nastavení per-tab filter). */
const SETTINGS_AREA_BY_COLLECTION: Record<string, SettingsArea> = {
  users: "uzivatele",
  roleTypes: "uzivatele",
  "settings/menuOrder": "uzivatele",
  companies: "spolecnosti",
  departments: "oddeleni",
  jobPositions: "pozice",
  educationLevels: "vzdelani",
  settings: "mzdy", // settings/payroll
};

/**
 * Nastavení sub-area for a collection — exported for the backfill. Full path
 * first (so "settings/menuOrder" beats the "settings"→mzdy parent fallback).
 */
export function settingsAreaForCollection(collection: string): SettingsArea | undefined {
  return SETTINGS_AREA_BY_COLLECTION[collection] ?? SETTINGS_AREA_BY_COLLECTION[collection.split("/")[0]];
}

export interface AuditContext {
  uid: string;
  email: string;
  /** The actor's user-type id at the time of the change (for forensics). */
  roleType: string;
  /**
   * Shared-terminal attribution. When `uid` was resolved to the person actually
   * on shift (rather than the account that holds the session — see
   * services/recepceActor.ts), these record the session account the write
   * physically came through. Absent for ordinary logins.
   */
  viaUid?: string;
  viaEmail?: string;
}

/**
 * Sentinel context for automatic ("Systém") actions — scheduled jobs and
 * date-driven transitions with no human actor. The render layer shows the
 * `system` userId as "Systém".
 */
export const SYSTEM_CONTEXT: AuditContext = {
  uid: "system",
  email: "",
  roleType: "system",
};

export interface AuditEntry {
  userId: string;
  userEmail: string;
  /** Stored field name kept as `userRole` for back-compat; holds the type id. */
  userRole: string;
  /** Shared-terminal session account, when `userId` is the resolved on-shift person. */
  viaUid?: string;
  viaEmail?: string;
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
  // Change-log overhaul (TODO #27) — semantic event id + denormalized page
  // category and per-page filter keys. All optional; legacy entries lack them
  // and are render-derived on the frontend.
  event?: string;
  category?: AuditCategory;
  year?: number;
  month?: number;
  templateId?: string;
  settingsArea?: SettingsArea;
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
    userRole: ctx.roleType,
    // Dropped by stripUndefined at write time when this is an ordinary login.
    viaUid: ctx.viaUid,
    viaEmail: ctx.viaEmail,
    action,
    collection,
    resourceId,
    subResourceId,
    employeeId,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

// Spread the resolved page category + the denormalized filter keys onto an
// entry. `category`, `settingsArea` and `templateId` default from the collection
// (+ resourceId) so call sites never have to pass them; `year`/`month`/`event`
// are passed by handlers that have them. Undefined keys are dropped by
// stripUndefined at write time, so legacy call sites that pass nothing are
// unaffected.
function filterKeyFields(
  collection: string,
  resourceId: string | undefined,
  keys?: AuditFilterKeys
): Partial<AuditEntry> {
  return {
    category: categoryForCollection(collection, keys?.category),
    event: keys?.event,
    year: keys?.year,
    month: keys?.month,
    // The contract-template id IS the doc id, so derive it from resourceId.
    templateId:
      keys?.templateId ?? (collection === "contractTemplates" ? resourceId : undefined),
    settingsArea: keys?.settingsArea ?? settingsAreaForCollection(collection),
  };
}

export async function logCreate(
  ctx: AuditContext,
  args: {
    collection: string;
    resourceId: string;
    subResourceId?: string;
    employeeId?: string;
    summary?: Record<string, unknown>;
    sensitiveFields?: readonly string[];
  } & AuditFilterKeys
): Promise<void> {
  await writeEntry({
    ...baseEntry(ctx, "create", args.collection, args.resourceId, args.subResourceId, args.employeeId),
    ...filterKeyFields(args.collection, args.resourceId, args),
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
  } & AuditFilterKeys
): Promise<void> {
  await writeEntry({
    ...baseEntry(ctx, "delete", args.collection, args.resourceId, args.subResourceId, args.employeeId),
    ...filterKeyFields(args.collection, args.resourceId, args),
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
  } & AuditFilterKeys
): Promise<void> {
  const before = args.before ?? {};
  const after = args.after;
  const keys = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
  const filterFields = filterKeyFields(args.collection, args.resourceId, args);

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
      ...filterFields,
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
  } & AuditFilterKeys
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
    ...filterKeyFields(args.collection ?? "", args.resourceId, args),
    extra: args.extra,
  });
}

/**
 * Audit a fully-automatic ("Systém") action — scheduled jobs and date-driven
 * transitions with no human actor. Writes with the SYSTEM_CONTEXT sentinel and
 * a semantic `event` id; `action` defaults to "update" (the render layer keys
 * off `event`, not `action`, for system rows). Use for plan auto-transitions,
 * auto-termination, Multisport auto-end, etc.
 */
export async function logSystemEvent(args: {
  event: string;
  collection: string;
  resourceId?: string;
  subResourceId?: string;
  employeeId?: string;
  action?: AuditAction;
  category?: AuditCategory;
  year?: number;
  month?: number;
  summary?: Record<string, unknown>;
  sensitiveFields?: readonly string[];
}): Promise<void> {
  await writeEntry({
    ...baseEntry(
      SYSTEM_CONTEXT,
      args.action ?? "update",
      args.collection,
      args.resourceId,
      args.subResourceId,
      args.employeeId
    ),
    ...filterKeyFields(args.collection, args.resourceId, {
      // Automatic actions land in the "Systém" page-filter bucket by default;
      // they stay findable by employee / month via the denormalized keys below.
      category: args.category ?? "system",
      event: args.event,
      year: args.year,
      month: args.month,
    }),
    summary: redactSnapshot(args.summary, args.sensitiveFields),
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
// top of each handler (after requireAuth has populated uid/roleType/userEmail).
export function ctxFromReq(req: {
  uid?: string;
  roleType?: string;
  userEmail?: string;
}): AuditContext {
  return {
    uid: req.uid ?? "",
    email: req.userEmail ?? "",
    roleType: req.roleType ?? "",
  };
}
