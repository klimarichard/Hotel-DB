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

  const out: RecepceEmployee[] = [];
  const planSnap = await db()
    .collection("shiftPlans")
    .where("year", "==", year)
    .where("month", "==", month)
    .limit(1)
    .get();

  if (!planSnap.empty) {
    const emps = await planSnap.docs[0].ref.collection("planEmployees").get();
    const seen = new Set<string>();
    for (const d of emps.docs) {
      const data = d.data() as {
        employeeId?: unknown;
        displayName?: unknown;
        firstName?: unknown;
        lastName?: unknown;
      };
      if (typeof data.employeeId !== "string") continue;
      if (seen.has(data.employeeId)) continue;
      seen.add(data.employeeId);
      const name =
        typeof data.displayName === "string" && data.displayName.trim() !== ""
          ? data.displayName
          : `${(data.lastName as string) ?? ""} ${(data.firstName as string) ?? ""}`.trim();
      out.push({ employeeId: data.employeeId, name: name || data.employeeId });
    }
  }

  // No plan (or an empty one) → fall back to reception-role employees.
  if (out.length === 0) {
    const empSnap = await db().collection("employees").get();
    for (const d of empSnap.docs) {
      const e = d.data() as {
        currentJobTitle?: unknown;
        status?: unknown;
        displayName?: unknown;
        firstName?: unknown;
        lastName?: unknown;
      };
      if (e.status === "terminated") continue;
      if (!FALLBACK_POSITIONS.has(normalizePosition(e.currentJobTitle))) continue;
      const name =
        typeof e.displayName === "string" && e.displayName.trim() !== ""
          ? e.displayName
          : `${(e.lastName as string) ?? ""} ${(e.firstName as string) ?? ""}`.trim();
      out.push({ employeeId: d.id, name: name || d.id });
    }
  }

  out.sort((a, b) => a.name.localeCompare(b.name, "cs"));
  return out;
}
