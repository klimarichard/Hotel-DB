/**
 * Cross-hotel Recepce SUMMARY — a single admin-only aggregation over all four
 * hotels, gated by `recepce.summary.view`. Every other Recepce route is
 * `/:hotel`-scoped; this one deliberately spans hotels and has no `:hotel` param.
 *
 * GET /api/recepce-summary?from=&to= returns, for the range:
 *   - walkins:              every walk-in across the four hotels (hotel-tagged),
 *   - taxiProvisionByHotel: Σ provision per hotel,
 *   - employees:            per-receptionist shift counts by hotel + walk-in
 *                           totals PER (employee, hotel) split by currency, so
 *                           the client can floor the 10 % provision at the same
 *                           granularity in both the per-employee and per-hotel
 *                           views (their grand totals then match by construction).
 *
 * SHIFT COUNTING RULES:
 *   - Only DESK day/night codes count, keyed by hotel: DA NA DS NS DQ NQ DK NK.
 *     Porter (DP/NP → …) and trainee (ZD/ZN) codes never count.
 *   - A DOUBLE cell (`DA²`, `isDouble`) counts as 0.
 *   - A numeric cell TAGGED with a counted desk type counts hoursComputed / 12.
 *
 * Also hosts the persistent "Provize minus" table (a small cross-hotel
 * collection of manual per-employee deductions) and a range-wide employee
 * dropdown for it. All routes require `recepce.summary.view`.
 */
import { Router, Response } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { requirePermission } from "../auth/permissions";
import { ctxFromReq, logCreate, logUpdate, logDelete } from "../services/auditLog";
import { HOTEL_SLUGS, HotelSlug, HOTEL_LABELS, SLUG_TO_CODE } from "../services/hotels";
import { walkinCol, WalkinDoc, isDateStr } from "../services/walkinShared";
import { taxiRideCol, TaxiRideDoc } from "../services/taxiShared";
import { resolveEmployeeDisplays, listRecepceEmployees, RecepceEmployee } from "../services/recepceEmployees";
import { sanitizeTypeTag } from "../services/shiftParser";

export const recepceSummaryRouter = Router();

const SUMMARY_PERM = "recepce.summary.view";

/** Reception desk hotel letter → slug (A/S/Q/K only; P/M are non-Recepce hotels). */
const CODE_TO_SLUG: Record<string, HotelSlug> = Object.fromEntries(
  HOTEL_SLUGS.map((slug) => [SLUG_TO_CODE[slug], slug])
) as Record<string, HotelSlug>;

/** The only type-tags that count toward a hotel (desk day/night; no porters/trainees). */
const COUNTED_TAGS = new Set(["DA", "DS", "DQ", "DK", "NA", "NS", "NQ", "NK"]);

/** A full reception shift is 12h; a tagged numeric cell counts as hours/12 of one. */
const FULL_SHIFT_HOURS = 12;

/** Manual per-employee deductions ("Provize minus"), cross-hotel. */
function provizeMinusCol(): admin.firestore.CollectionReference {
  return admin.firestore().collection("recepceProvizeMinus");
}

interface WalkinTotals {
  czk: number;
  eur: number;
}
interface EmployeeAgg {
  byHotel: Record<HotelSlug, number>;
  walkinByHotel: Record<HotelSlug, WalkinTotals>;
}

function zeroByHotel(): Record<HotelSlug, number> {
  return HOTEL_SLUGS.reduce((acc, slug) => {
    acc[slug] = 0;
    return acc;
  }, {} as Record<HotelSlug, number>);
}
function zeroWalkinByHotel(): Record<HotelSlug, WalkinTotals> {
  return HOTEL_SLUGS.reduce((acc, slug) => {
    acc[slug] = { czk: 0, eur: 0 };
    return acc;
  }, {} as Record<HotelSlug, WalkinTotals>);
}

/** First-of-month anchor strings ("YYYY-MM-01") for every month the range spans. */
function monthAnchorsInRange(from: string, to: string): string[] {
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const ty = Number(to.slice(0, 4));
  const tm = Number(to.slice(5, 7));
  const out: string[] = [];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}-01`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Union of the shift-plan rosters across every month the range touches, surname-sorted. */
async function rangeEmployees(from: string, to: string): Promise<RecepceEmployee[]> {
  const ids = new Set<string>();
  const snapshotName = new Map<string, string>();
  for (const anchor of monthAnchorsInRange(from, to)) {
    const roster = await listRecepceEmployees(anchor);
    for (const e of roster) {
      ids.add(e.employeeId);
      if (e.name) snapshotName.set(e.employeeId, e.name);
    }
  }
  const idList = [...ids];
  const displays = await resolveEmployeeDisplays(idList);
  return idList
    .map((id) => {
      const disp = displays.get(id);
      return {
        employeeId: id,
        name: disp?.name || snapshotName.get(id) || id,
        sortKey: disp?.sortKey || (snapshotName.get(id) || id).toLowerCase(),
      };
    })
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey, "cs"))
    .map(({ employeeId, name }) => ({ employeeId, name }));
}

/** Validate the from/to query pair. Returns the bounds or writes a 400 and returns null. */
function readRange(req: AuthRequest, res: Response): { from: string; to: string } | null {
  const from = isDateStr(req.query.from) ? (req.query.from as string) : null;
  const to = isDateStr(req.query.to) ? (req.query.to as string) : null;
  if (!from || !to) {
    res.status(400).json({ error: "Zadejte platné období (from, to ve formátu YYYY-MM-DD)." });
    return null;
  }
  if (from > to) {
    res.status(400).json({ error: "Počáteční datum musí být před koncovým." });
    return null;
  }
  return { from, to };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET / — the whole summary in one call (shift counts + per-hotel walk-in/taxi).
// ─────────────────────────────────────────────────────────────────────────────
recepceSummaryRouter.get("/", requireAuth, requirePermission(SUMMARY_PERM), async (req: AuthRequest, res: Response) => {
  const range = readRange(req, res);
  if (!range) return;
  const { from, to } = range;

  const db = admin.firestore();
  const agg = new Map<string, EmployeeAgg>();
  const ensure = (id: string): EmployeeAgg => {
    let e = agg.get(id);
    if (!e) {
      e = { byHotel: zeroByHotel(), walkinByHotel: zeroWalkinByHotel() };
      agg.set(id, e);
    }
    return e;
  };
  const snapshotNames = new Map<string, string>();

  // ── Walk-ins across all four hotels (accumulated per employee × hotel) ──────
  const walkinSnaps = await Promise.all(
    HOTEL_SLUGS.map((slug) => walkinCol(slug).where("date", ">=", from).where("date", "<=", to).get())
  );
  const walkins: Array<{
    hotel: HotelSlug;
    hotelCode: string;
    hotelLabel: string;
    date: string;
    employeeId: string;
    employeeName: string;
    resNo: string;
    amount: number;
    currency: string;
  }> = [];
  HOTEL_SLUGS.forEach((slug, i) => {
    for (const doc of walkinSnaps[i].docs) {
      const d = doc.data() as WalkinDoc;
      walkins.push({
        hotel: slug,
        hotelCode: SLUG_TO_CODE[slug],
        hotelLabel: HOTEL_LABELS[slug],
        date: d.date,
        employeeId: d.employeeId,
        employeeName: d.employeeName,
        resNo: d.resNo,
        amount: d.amount,
        currency: d.currency,
      });
      if (typeof d.employeeId === "string" && d.employeeId !== "") {
        const t = ensure(d.employeeId).walkinByHotel[slug];
        if (d.currency === "EUR") t.eur += d.amount;
        else t.czk += d.amount;
        if (d.employeeName) snapshotNames.set(d.employeeId, d.employeeName);
      }
    }
  });

  // ── Taxi provisions per hotel ───────────────────────────────────────────────
  const taxiSnaps = await Promise.all(
    HOTEL_SLUGS.map((slug) => taxiRideCol(slug).where("date", ">=", from).where("date", "<=", to).get())
  );
  const taxiProvisionByHotel = zeroByHotel();
  HOTEL_SLUGS.forEach((slug, i) => {
    for (const doc of taxiSnaps[i].docs) {
      const d = doc.data() as TaxiRideDoc;
      if (typeof d.provision === "number" && Number.isFinite(d.provision)) {
        taxiProvisionByHotel[slug] += d.provision;
      }
    }
  });

  // ── Shift counts per employee per hotel (all monthly plans in range) ────────
  const shiftSnap = await db.collectionGroup("shifts").where("date", ">=", from).where("date", "<=", to).get();
  for (const doc of shiftSnap.docs) {
    const d = doc.data() as {
      employeeId?: unknown;
      segments?: Array<{ code?: unknown; hotel?: unknown }>;
      isDouble?: unknown;
      typeTag?: unknown;
      hoursComputed?: unknown;
    };
    const empId = typeof d.employeeId === "string" ? d.employeeId : "";
    if (empId === "") continue;

    if (d.isDouble !== true && Array.isArray(d.segments)) {
      for (const seg of d.segments) {
        if ((seg.code === "D" || seg.code === "N") && typeof seg.hotel === "string") {
          const slug = CODE_TO_SLUG[seg.hotel];
          if (slug) ensure(empId).byHotel[slug] += 1;
        }
      }
    }

    const tag = sanitizeTypeTag(d.typeTag);
    if (tag && COUNTED_TAGS.has(tag)) {
      const slug = CODE_TO_SLUG[tag[tag.length - 1]];
      const hrs = typeof d.hoursComputed === "number" && Number.isFinite(d.hoursComputed) ? d.hoursComputed : 0;
      if (slug && hrs > 0) ensure(empId).byHotel[slug] += hrs / FULL_SHIFT_HOURS;
    }
  }

  // ── Resolve live names + assemble the employee rows ─────────────────────────
  const ids = [...agg.keys()];
  const displays = await resolveEmployeeDisplays(ids);
  const employees = ids
    .map((id) => {
      const e = agg.get(id)!;
      const disp = displays.get(id);
      const name = disp?.name || snapshotNames.get(id) || id;
      const sortKey = disp?.sortKey || (snapshotNames.get(id) || id).toLowerCase();
      const totalShifts = HOTEL_SLUGS.reduce((sum, slug) => sum + e.byHotel[slug], 0);
      return { employeeId: id, name, sortKey, byHotel: e.byHotel, totalShifts, walkinByHotel: e.walkinByHotel };
    })
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey, "cs"))
    .map(({ sortKey, ...rest }) => rest);

  walkins.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  res.json({
    from,
    to,
    hotels: HOTEL_SLUGS.map((slug) => ({ slug, code: SLUG_TO_CODE[slug], label: HOTEL_LABELS[slug] })),
    walkins,
    taxiProvisionByHotel,
    employees,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /employees — the union of shift-plan rosters across the range's months,
// for the "Provize minus" employee dropdown.
// ─────────────────────────────────────────────────────────────────────────────
recepceSummaryRouter.get(
  "/employees",
  requireAuth,
  requirePermission(SUMMARY_PERM),
  async (req: AuthRequest, res: Response) => {
    const range = readRange(req, res);
    if (!range) return;
    res.json({ employees: await rangeEmployees(range.from, range.to) });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// "Provize minus" — persistent manual per-employee deductions (cross-hotel).
// ─────────────────────────────────────────────────────────────────────────────
interface ProvizeMinusDoc {
  date: string;
  employeeId: string;
  employeeName: string;
  amount: number;
  note: string;
}

/** Validate + normalize a Provize-minus entry. amount 0 is allowed ("to be decided"). */
function parseProvizeMinus(raw: unknown): ProvizeMinusDoc | { error: string } {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!isDateStr(b.date)) return { error: "Neplatné datum (YYYY-MM-DD)." };
  const employeeId = typeof b.employeeId === "string" ? b.employeeId.trim() : "";
  if (employeeId === "") return { error: "Vyberte zaměstnance." };
  const employeeName = typeof b.employeeName === "string" ? b.employeeName.trim() : "";
  const amount = typeof b.amount === "number" && Number.isFinite(b.amount) ? b.amount : NaN;
  if (!Number.isFinite(amount) || amount < 0) return { error: "Neplatná částka (0 nebo více)." };
  const note = typeof b.note === "string" ? b.note.trim() : "";
  if (note === "") return { error: "Poznámka je povinná." };
  return { date: b.date as string, employeeId, employeeName, amount, note };
}

/** GET /provize-minus?from=&to= — entries whose date is in range, newest first. */
recepceSummaryRouter.get(
  "/provize-minus",
  requireAuth,
  requirePermission(SUMMARY_PERM),
  async (req: AuthRequest, res: Response) => {
    const range = readRange(req, res);
    if (!range) return;
    const snap = await provizeMinusCol()
      .where("date", ">=", range.from)
      .where("date", "<=", range.to)
      .orderBy("date", "desc")
      .get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as ProvizeMinusDoc) }));
    // Re-resolve names live (like walkins) so a display-name edit propagates.
    const displays = await resolveEmployeeDisplays(rows.map((r) => r.employeeId));
    res.json(rows.map((r) => (displays.has(r.employeeId) ? { ...r, employeeName: displays.get(r.employeeId)!.name } : r)));
  }
);

recepceSummaryRouter.post(
  "/provize-minus",
  requireAuth,
  requirePermission(SUMMARY_PERM),
  async (req: AuthRequest, res: Response) => {
    const parsed = parseProvizeMinus(req.body);
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const ref = await provizeMinusCol().add({
      ...parsed,
      createdBy: req.uid,
      updatedBy: req.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const saved = await ref.get();
    await logCreate(ctxFromReq(req), {
      collection: "recepceProvizeMinus",
      resourceId: ref.id,
      summary: { date: parsed.date, employeeName: parsed.employeeName, amount: parsed.amount, note: parsed.note },
    });
    res.json({ id: ref.id, ...saved.data() });
  }
);

recepceSummaryRouter.put(
  "/provize-minus/:id",
  requireAuth,
  requirePermission(SUMMARY_PERM),
  async (req: AuthRequest, res: Response) => {
    const ref = provizeMinusCol().doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Záznam nenalezen." });
      return;
    }
    const before = snap.data() as ProvizeMinusDoc;
    const parsed = parseProvizeMinus(req.body);
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    await ref.set({ ...parsed, updatedBy: req.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    const saved = await ref.get();
    await logUpdate(ctxFromReq(req), {
      collection: "recepceProvizeMinus",
      resourceId: ref.id,
      before: before as unknown as Record<string, unknown>,
      after: { ...(before as unknown as Record<string, unknown>), ...parsed },
    });
    res.json({ id: ref.id, ...saved.data() });
  }
);

recepceSummaryRouter.delete(
  "/provize-minus/:id",
  requireAuth,
  requirePermission(SUMMARY_PERM),
  async (req: AuthRequest, res: Response) => {
    const ref = provizeMinusCol().doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Záznam nenalezen." });
      return;
    }
    const before = snap.data() as ProvizeMinusDoc;
    await ref.delete();
    await logDelete(ctxFromReq(req), {
      collection: "recepceProvizeMinus",
      resourceId: req.params.id,
      summary: { date: before.date, employeeName: before.employeeName, amount: before.amount, note: before.note },
    });
    res.json({ ok: true });
  }
);
