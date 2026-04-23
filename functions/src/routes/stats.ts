import { Router } from "express";
import * as admin from "firebase-admin";
import { requireAuth, requireRole, AuthRequest } from "../middleware/auth";

export const statsRouter = Router();
const db = () => admin.firestore();

type AgeBucket = "<20" | "20-30" | "30-40" | "40-50" | "50+" | "Nezadáno";
type TenureBucket = "<1m" | "1-3m" | "3-6m" | "6-12m" | "1-2y" | "2-5y" | "5-10y" | "10+y";

const AGE_ORDER: AgeBucket[] = ["<20", "20-30", "30-40", "40-50", "50+"];
const TENURE_ORDER: TenureBucket[] = ["<1m", "1-3m", "3-6m", "6-12m", "1-2y", "2-5y", "5-10y", "10+y"];

// ─── GET /stats/headcount ─────────────────────────────────────────────────────
// Aggregate headcount stats for the admin/director dashboard. Always returns
// active employees only (status == "active"); terminated employees are out of
// scope for every slice. All slices reconcile: sum(byJobPosition) ==
// sum(byNationality) == sum(byAge) == sum(byTenure) == total.

statsRouter.get(
  "/headcount",
  requireAuth,
  requireRole("admin", "director"),
  async (_req: AuthRequest, res) => {
    const [empSnap, historySnap] = await Promise.all([
      db().collection("employees").where("status", "==", "active").get(),
      // collectionGroup across every employee's `employment` subcollection in
      // a single read. Cheaper than N+1 per-employee queries.
      db().collectionGroup("employment").get(),
    ]);

    const activeIds = new Set(empSnap.docs.map((d) => d.id));

    // Group employment events by their parent employee id. Events are small
    // transition records: { startDate, status: "active" | "inactive", ... }.
    const episodesByEmp = new Map<string, { startDate: string; status: string }[]>();
    for (const doc of historySnap.docs) {
      const empId = doc.ref.parent.parent?.id;
      if (!empId || !activeIds.has(empId)) continue;
      const data = doc.data() as Record<string, unknown>;
      const startDate = typeof data.startDate === "string" ? data.startDate : null;
      const status = typeof data.status === "string" ? data.status : null;
      if (!startDate || !status) continue;
      const arr = episodesByEmp.get(empId) ?? [];
      arr.push({ startDate, status });
      episodesByEmp.set(empId, arr);
    }

    const todayYMD = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Prague",
    }).format(new Date());

    const byPos: Record<string, number> = {};
    const byNat: Record<string, number> = {};
    const byAge: Record<AgeBucket, number> = {
      "<20": 0, "20-30": 0, "30-40": 0, "40-50": 0, "50+": 0, "Nezadáno": 0,
    };
    const byTen: Record<TenureBucket, number> = {
      "<1m": 0, "1-3m": 0, "3-6m": 0, "6-12m": 0,
      "1-2y": 0, "2-5y": 0, "5-10y": 0, "10+y": 0,
    };

    let total = 0;
    for (const doc of empSnap.docs) {
      total++;
      const emp = doc.data() as Record<string, unknown>;

      const posRaw = typeof emp.currentJobTitle === "string" ? emp.currentJobTitle.trim() : "";
      const pos = posRaw || "Nezadáno";
      byPos[pos] = (byPos[pos] ?? 0) + 1;

      const natRaw = typeof emp.nationality === "string" ? emp.nationality.trim() : "";
      const nat = natRaw || "Nezadáno";
      byNat[nat] = (byNat[nat] ?? 0) + 1;

      const dob = typeof emp.dateOfBirth === "string" ? emp.dateOfBirth : "";
      if (!dob) {
        byAge["Nezadáno"]++;
      } else {
        byAge[ageBucket(computeAge(dob, todayYMD))]++;
      }

      const episodes = (episodesByEmp.get(doc.id) ?? [])
        .slice()
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
      byTen[tenureBucket(computeTenureDays(episodes, todayYMD))]++;
    }

    const byJobPosition = Object.entries(byPos)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const byNationality = Object.entries(byNat)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const byAgeArr: { bucket: AgeBucket; count: number }[] =
      AGE_ORDER.map((bucket) => ({ bucket, count: byAge[bucket] }));
    if (byAge["Nezadáno"] > 0) byAgeArr.push({ bucket: "Nezadáno", count: byAge["Nezadáno"] });

    const byTenureArr: { bucket: TenureBucket; count: number }[] =
      TENURE_ORDER.map((bucket) => ({ bucket, count: byTen[bucket] }));

    res.json({
      total,
      byJobPosition,
      byNationality,
      byAge: byAgeArr,
      byTenure: byTenureArr,
    });
  }
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeAge(dobYMD: string, todayYMD: string): number {
  const [y1, m1, d1] = dobYMD.split("-").map(Number);
  const [y2, m2, d2] = todayYMD.split("-").map(Number);
  if (!y1 || !y2) return 0;
  let age = y2 - y1;
  if (m2 < m1 || (m2 === m1 && d2 < d1)) age--;
  return age;
}

function ageBucket(age: number): AgeBucket {
  if (age < 20) return "<20";
  if (age < 30) return "20-30";
  if (age < 40) return "30-40";
  if (age < 50) return "40-50";
  return "50+";
}

function daysBetweenYMD(startYMD: string, endYMD: string): number {
  const [ys, ms, ds] = startYMD.split("-").map(Number);
  const [ye, me, de] = endYMD.split("-").map(Number);
  const start = Date.UTC(ys, ms - 1, ds);
  const end = Date.UTC(ye, me - 1, de);
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

// The `employment` subcollection stores transition events, not intervals. An
// event with status=="active" marks the start (or continuation) of employment;
// status=="inactive" marks a termination. Contract-change events also carry
// status=="active" and must NOT restart the clock. Tenure = sum of days between
// each active->inactive pair, plus any still-open active run up to today.
function computeTenureDays(
  events: { startDate: string; status: string }[],
  todayYMD: string,
): number {
  let total = 0;
  let activeStart: string | null = null;
  for (const ev of events) {
    if (ev.status === "active") {
      if (activeStart === null) activeStart = ev.startDate;
    } else if (ev.status === "inactive") {
      if (activeStart !== null) {
        total += daysBetweenYMD(activeStart, ev.startDate);
        activeStart = null;
      }
    }
  }
  if (activeStart !== null) total += daysBetweenYMD(activeStart, todayYMD);
  return total;
}

function tenureBucket(days: number): TenureBucket {
  if (days < 30) return "<1m";
  if (days < 90) return "1-3m";
  if (days < 180) return "3-6m";
  if (days < 365) return "6-12m";
  if (days < 730) return "1-2y";
  if (days < 1825) return "2-5y";
  if (days < 3650) return "5-10y";
  return "10+y";
}
