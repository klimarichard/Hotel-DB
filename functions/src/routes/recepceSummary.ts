/**
 * Cross-hotel Recepce SUMMARY — a single admin-only aggregation over all four
 * hotels, gated by `recepce.summary.view`. Every other Recepce route is
 * `/:hotel`-scoped; this one deliberately spans hotels and has no `:hotel` param.
 *
 * GET /api/recepce-summary?from=YYYY-MM-DD&to=YYYY-MM-DD returns, for the range:
 *   - walkins:              every walk-in across the four hotels (hotel-tagged),
 *   - taxiProvisionByHotel: Σ provision per hotel,
 *   - employees:            per-receptionist shift counts by hotel + walk-in
 *                           totals per currency (so the client can derive the
 *                           10 % walk-in provision at its own, page-local rate).
 *
 * SHIFT COUNTING RULES (per the summary spec):
 *   - Only the DESK day/night codes count, keyed by hotel: DA NA DS NS DQ NQ DK NK.
 *     Porter variants (DP/NP → DPA/NPA/…) and trainee codes (ZD/ZN) never count.
 *   - A DOUBLE cell (`DA²`, `isDouble`) counts as 0 — excluded entirely.
 *   - A numeric "worked hours" cell TAGGED with a counted desk type (#29 typeTag)
 *     counts as a FRACTION of a shift: hoursComputed / 12 (6h → 0.5, 4h → 0.33…).
 * A full shift is 12h, hence the /12 denominator.
 */
import { Router, Response } from "express";
import * as admin from "firebase-admin";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { requirePermission } from "../auth/permissions";
import { HOTEL_SLUGS, HotelSlug, HOTEL_LABELS, SLUG_TO_CODE } from "../services/hotels";
import { walkinCol, WalkinDoc, isDateStr } from "../services/walkinShared";
import { taxiRideCol, TaxiRideDoc } from "../services/taxiShared";
import { resolveEmployeeDisplays } from "../services/recepceEmployees";
import { sanitizeTypeTag } from "../services/shiftParser";

export const recepceSummaryRouter = Router();

/** Reception desk hotel letter → slug (A/S/Q/K only; P/M are non-Recepce hotels). */
const CODE_TO_SLUG: Record<string, HotelSlug> = Object.fromEntries(
  HOTEL_SLUGS.map((slug) => [SLUG_TO_CODE[slug], slug])
) as Record<string, HotelSlug>;

/** The only type-tags that count toward a hotel (desk day/night; no porters/trainees). */
const COUNTED_TAGS = new Set(["DA", "DS", "DQ", "DK", "NA", "NS", "NQ", "NK"]);

/** A full reception shift is 12h; a tagged numeric cell counts as hours/12 of one. */
const FULL_SHIFT_HOURS = 12;

interface EmployeeAgg {
  byHotel: Record<HotelSlug, number>;
  walkinCzk: number;
  walkinEur: number;
}

function zeroByHotel(): Record<HotelSlug, number> {
  return HOTEL_SLUGS.reduce((acc, slug) => {
    acc[slug] = 0;
    return acc;
  }, {} as Record<HotelSlug, number>);
}

/**
 * GET /api/recepce-summary?from=&to= — the whole page's data in one call.
 * Both bounds are required (inclusive). Shift counts + provisions are computed
 * server-side; walk-in provision is left to the client (rate is page-local).
 */
recepceSummaryRouter.get(
  "/",
  requireAuth,
  requirePermission("recepce.summary.view"),
  async (req: AuthRequest, res: Response) => {
    const from = isDateStr(req.query.from) ? (req.query.from as string) : null;
    const to = isDateStr(req.query.to) ? (req.query.to as string) : null;
    if (!from || !to) {
      res.status(400).json({ error: "Zadejte platné období (from, to ve formátu YYYY-MM-DD)." });
      return;
    }
    if (from > to) {
      res.status(400).json({ error: "Počáteční datum musí být před koncovým." });
      return;
    }

    const db = admin.firestore();

    // Per-employee accumulator, created lazily as ids are seen.
    const agg = new Map<string, EmployeeAgg>();
    const ensure = (id: string): EmployeeAgg => {
      let e = agg.get(id);
      if (!e) {
        e = { byHotel: zeroByHotel(), walkinCzk: 0, walkinEur: 0 };
        agg.set(id, e);
      }
      return e;
    };
    // Fallback names from walk-in snapshots for employees whose record is gone.
    const snapshotNames = new Map<string, string>();

    // ── Walk-ins across all four hotels ──────────────────────────────────────
    const walkinSnaps = await Promise.all(
      HOTEL_SLUGS.map((slug) =>
        walkinCol(slug).where("date", ">=", from).where("date", "<=", to).get()
      )
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
          const e = ensure(d.employeeId);
          if (d.currency === "EUR") e.walkinEur += d.amount;
          else e.walkinCzk += d.amount;
          if (d.employeeName) snapshotNames.set(d.employeeId, d.employeeName);
        }
      }
    });

    // ── Taxi provisions per hotel ────────────────────────────────────────────
    const taxiSnaps = await Promise.all(
      HOTEL_SLUGS.map((slug) =>
        taxiRideCol(slug).where("date", ">=", from).where("date", "<=", to).get()
      )
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

    // ── Shift counts per employee per hotel (all monthly plans in range) ──────
    // One collection-group range query sweeps every shiftPlans/*/shifts cell.
    const shiftSnap = await db
      .collectionGroup("shifts")
      .where("date", ">=", from)
      .where("date", "<=", to)
      .get();
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

      // Whole reception cells: +1 per desk segment. Doubles (DA²) count as 0.
      if (d.isDouble !== true && Array.isArray(d.segments)) {
        for (const seg of d.segments) {
          if ((seg.code === "D" || seg.code === "N") && typeof seg.hotel === "string") {
            const slug = CODE_TO_SLUG[seg.hotel];
            if (slug) ensure(empId).byHotel[slug] += 1;
          }
        }
      }

      // Numeric "worked hours" cell tagged with a desk type: hours/12 of a shift.
      const tag = sanitizeTypeTag(d.typeTag);
      if (tag && COUNTED_TAGS.has(tag)) {
        const slug = CODE_TO_SLUG[tag[tag.length - 1]];
        const hrs = typeof d.hoursComputed === "number" && Number.isFinite(d.hoursComputed) ? d.hoursComputed : 0;
        if (slug && hrs > 0) ensure(empId).byHotel[slug] += hrs / FULL_SHIFT_HOURS;
      }
    }

    // ── Resolve live names + assemble the employee rows ──────────────────────
    const ids = [...agg.keys()];
    const displays = await resolveEmployeeDisplays(ids);
    const employees = ids
      .map((id) => {
        const e = agg.get(id)!;
        const disp = displays.get(id);
        const name = disp?.name || snapshotNames.get(id) || id;
        const sortKey = disp?.sortKey || (snapshotNames.get(id) || id).toLowerCase();
        const totalShifts = HOTEL_SLUGS.reduce((sum, slug) => sum + e.byHotel[slug], 0);
        return {
          employeeId: id,
          name,
          sortKey,
          byHotel: e.byHotel,
          totalShifts,
          walkinCzk: e.walkinCzk,
          walkinEur: e.walkinEur,
        };
      })
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey, "cs"))
      .map(({ sortKey, ...rest }) => rest); // drop the internal sort key

    // Newest walk-ins first, matching the per-hotel Walkiny tab.
    walkins.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    res.json({
      from,
      to,
      hotels: HOTEL_SLUGS.map((slug) => ({ slug, code: SLUG_TO_CODE[slug], label: HOTEL_LABELS[slug] })),
      walkins,
      taxiProvisionByHotel,
      employees,
    });
  }
);
