import * as admin from "firebase-admin";
import { HotelSlug, SLUG_TO_CODE } from "./hotels";
import { ShiftType } from "./handoverShared";

interface ShiftSegment {
  code: string;
  hotel: string | null;
  hours: number;
}

// Reception day shift = D or its substitution ZD; night = N / ZN. Porter shifts
// (DP/NP) are deliberately excluded — they aren't reception handover shifts.
const DAY_CODES = new Set(["D", "ZD"]);
const NIGHT_CODES = new Set(["N", "ZN"]);

/**
 * The employeeId scheduled for a reception shift (hotel + date + den/noc) in the
 * monthly shift plan, or null if no one is assigned. Finds the plan by
 * (year, month), then scans that date's `assigned` cells for a segment matching
 * the reception code + hotel. No login is required — this is just the employee on
 * the plan, used both to default the handover signer and the "who's on shift"
 * default in the Walkiny / Lobby bar entry forms.
 */
export async function scheduledEmployeeId(
  hotel: HotelSlug,
  shiftDate: string,
  shiftType: ShiftType
): Promise<string | null> {
  const [yStr, mStr] = shiftDate.split("-");
  const year = Number(yStr);
  const month = Number(mStr);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;

  const db = admin.firestore();
  const planSnap = await db
    .collection("shiftPlans")
    .where("year", "==", year)
    .where("month", "==", month)
    .limit(1)
    .get();
  if (planSnap.empty) return null;

  const shiftsSnap = await planSnap.docs[0].ref
    .collection("shifts")
    .where("date", "==", shiftDate)
    .get();

  const expectedHotel = SLUG_TO_CODE[hotel];
  const wanted = shiftType === "den" ? DAY_CODES : NIGHT_CODES;

  for (const d of shiftsSnap.docs) {
    const data = d.data() as { status?: string; employeeId?: string; segments?: ShiftSegment[] };
    if (data.status !== "assigned") continue;
    const segs = data.segments ?? [];
    if (segs.some((s) => wanted.has(s.code) && s.hotel === expectedHotel)) {
      return data.employeeId ?? null;
    }
  }
  return null;
}

/**
 * Who is scheduled for a reception shift, resolved to their linked login user, or
 * null if no one is scheduled / they have no login. Used to default the signer in
 * the handover sign modal (which needs an auth uid + a username).
 */
export async function scheduledSigner(
  hotel: HotelSlug,
  shiftDate: string,
  shiftType: ShiftType
): Promise<{ uid: string; name: string } | null> {
  const employeeId = await scheduledEmployeeId(hotel, shiftDate, shiftType);
  if (!employeeId) return null;

  const db = admin.firestore();
  const userSnap = await db.collection("users").where("employeeId", "==", employeeId).limit(1).get();
  if (userSnap.empty) return null;
  const u = userSnap.docs[0];
  const name = (u.data().name as string | undefined) ?? "";
  if (name.trim() === "") return null; // no username → can't be a signer
  return { uid: u.id, name };
}
