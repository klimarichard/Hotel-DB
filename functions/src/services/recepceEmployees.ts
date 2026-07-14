/**
 * The "who did this" employee dropdown shared by the Recepce tables (Walkiny's
 * "Zaměstnanec", Lobby bar's "Prodal").
 *
 * The pool is whoever is on that month's shift plan — the people who could
 * plausibly have been at the desk. When the month has no plan yet (or the plan
 * is empty) it falls back to every non-terminated employee holding a reception
 * position, so a fresh month is never a dropdown with nothing in it.
 */
import * as admin from "firebase-admin";
import * as clock from "./clock";
import { ShiftType } from "./handoverShared";

const db = () => admin.firestore();

export interface RecepceEmployee {
  employeeId: string;
  name: string;
}

/** YYYY-MM-DD in Europe/Prague — guards against a late-shift record past midnight. */
export function todayPrague(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Prague" }).format(new Date());
}

/**
 * The reception shift happening RIGHT NOW in Prague: today's date + den/noc by the
 * hour (den 07:00–18:59, else noc). Mirrors the protokol page's
 * `defaultShiftForNow` so the "who's on shift" default is consistent with the
 * handover sign modal. Uses `clock.now()` so the non-prod test clock can drive it.
 */
export function currentReceptionShiftPrague(): { date: string; shift: ShiftType } {
  const now = clock.now();
  const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Prague" }).format(now);
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Prague", hour: "2-digit", hourCycle: "h23" }).format(now)
  );
  return { date, shift: hour >= 7 && hour < 19 ? "den" : "noc" };
}

/**
 * Positions used for the no-plan fallback, matched case-insensitively against
 * `employees.currentJobTitle`.
 */
const FALLBACK_POSITIONS = new Set<string>([
  "recepční",
  "portýr",
  "noční portýr",
  "noční recepční",
  "front office manager",
  "senior front office manager",
  "director of front office",
  "general manager",
]);

function normalizePosition(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

/** A name-bearing record (an employee doc OR a planEmployees snapshot). */
interface NameParts {
  displayName?: unknown;
  firstName?: unknown;
  lastName?: unknown;
}
const nstr = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Reception display name: the employee's own `displayName` when set, else
 * "First Last". Deliberately first-name-first (unlike the app-wide "Surname
 * First") so the reception pickers and tables read naturally; the pickers still
 * SORT by surname via {@link recepceSortKey}.
 */
export function recepceDisplayName(e: NameParts): string {
  return nstr(e.displayName) || `${nstr(e.firstName)} ${nstr(e.lastName)}`.trim();
}

/** Surname-first key so pickers stay findable by surname while showing "First Last". */
export function recepceSortKey(e: NameParts): string {
  return (`${nstr(e.lastName)} ${nstr(e.firstName)}`.trim() || recepceDisplayName(e)).toLowerCase();
}

/**
 * Batch-resolve employeeId → { name, sortKey } from the LIVE employee records, so
 * a display-name edit propagates everywhere without rewriting stored snapshots.
 * Missing/deleted employees are absent from the map (callers fall back).
 */
export async function resolveEmployeeDisplays(
  ids: readonly string[]
): Promise<Map<string, { name: string; sortKey: string }>> {
  const out = new Map<string, { name: string; sortKey: string }>();
  const uniq = [...new Set(ids.filter((x): x is string => typeof x === "string" && x !== ""))];
  if (uniq.length === 0) return out;
  const snaps = await db().getAll(...uniq.map((id) => db().collection("employees").doc(id)));
  for (const s of snaps) {
    if (!s.exists) continue;
    out.set(s.id, {
      name: recepceDisplayName(s.data() as NameParts),
      sortKey: recepceSortKey(s.data() as NameParts),
    });
  }
  return out;
}

/**
 * Batch-resolve auth uid → linked employeeId (users/{uid}.employeeId). Uids with
 * no user record, or no linked employee, are absent from the map.
 */
export async function resolveEmployeeIdsByUid(
  uids: readonly string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(uids.filter((u): u is string => typeof u === "string" && u !== ""))];
  if (uniq.length === 0) return out;
  const snaps = await db().getAll(...uniq.map((u) => db().collection("users").doc(u)));
  for (const s of snaps) {
    if (!s.exists) continue;
    const empId = (s.data() as { employeeId?: unknown }).employeeId;
    if (typeof empId === "string" && empId !== "") out.set(s.id, empId);
  }
  return out;
}

/**
 * Batch-resolve auth uid → the LIVE reception display name of the linked employee.
 * Uids whose account or employee record is gone are absent from the map, so callers
 * keep their stored snapshot (the only surviving record of who that person was).
 *
 * Used by the surfaces that stamp a signer/actor uid and a name side by side —
 * handover signatures and the derived handover warnings — so the name is a live
 * lookup rather than a string frozen years ago.
 */
export async function resolveDisplayNamesByUid(
  uids: readonly string[]
): Promise<Map<string, string>> {
  const empByUid = await resolveEmployeeIdsByUid(uids);
  const displays = await resolveEmployeeDisplays([...empByUid.values()]);
  const out = new Map<string, string>();
  for (const [uid, empId] of empByUid) {
    const name = displays.get(empId)?.name;
    if (name) out.set(uid, name);
  }
  return out;
}

/**
 * Everyone on `dateStr`'s month shift plan (all planEmployees roster rows, deduped
 * by employeeId), sorted by Czech collation. Falls back to reception-position
 * employees when that month has no plan. Never throws on missing data.
 *
 * Presence in the roster is the eligibility signal, mirroring the handover signer
 * pool: the `active` flag only governs shift-grid row visibility, so an inactive
 * roster row is NOT skipped here — otherwise someone who is on the plan and works
 * shifts would be missing from the Walkiny / Lobby bar "who did this" dropdown.
 */
export async function listRecepceEmployees(dateStr: string): Promise<RecepceEmployee[]> {
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(5, 7));

  const entries: Array<{ employeeId: string; name: string; sortKey: string }> = [];
  const planSnap = await db()
    .collection("shiftPlans")
    .where("year", "==", year)
    .where("month", "==", month)
    .limit(1)
    .get();

  if (!planSnap.empty) {
    const emps = await planSnap.docs[0].ref.collection("planEmployees").get();
    const seen = new Set<string>();
    const snapshotFallback = new Map<string, { name: string; sortKey: string }>();
    const ids: string[] = [];
    for (const d of emps.docs) {
      const data = d.data() as { employeeId?: unknown } & NameParts;
      if (typeof data.employeeId !== "string") continue;
      if (seen.has(data.employeeId)) continue;
      seen.add(data.employeeId);
      ids.push(data.employeeId);
      snapshotFallback.set(data.employeeId, { name: recepceDisplayName(data), sortKey: recepceSortKey(data) });
    }
    const live = await resolveEmployeeDisplays(ids);
    for (const id of ids) {
      const disp = live.get(id) ?? snapshotFallback.get(id)!;
      entries.push({ employeeId: id, name: disp.name || id, sortKey: disp.sortKey });
    }
  }

  // No plan (or an empty one) → fall back to reception-role employees.
  if (entries.length === 0) {
    const empSnap = await db().collection("employees").get();
    for (const d of empSnap.docs) {
      const e = d.data() as { currentJobTitle?: unknown; status?: unknown } & NameParts;
      if (e.status === "terminated") continue;
      if (!FALLBACK_POSITIONS.has(normalizePosition(e.currentJobTitle))) continue;
      entries.push({ employeeId: d.id, name: recepceDisplayName(e) || d.id, sortKey: recepceSortKey(e) });
    }
  }

  entries.sort((a, b) => a.sortKey.localeCompare(b.sortKey, "cs"));
  return entries.map(({ employeeId, name }) => ({ employeeId, name }));
}
