import { Router, Response } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { requirePermission, hasPermission } from "../auth/permissions";
import { ctxFromReq, logCreate, logUpdate, logDelete } from "../services/auditLog";
import { isReferencedByLiveEmployee } from "../services/lookupGuard";
import { effectiveCompAsOf, EmploymentRowLite } from "../services/payrollCalculator";
import * as clock from "../services/clock";

export const jobPositionsRouter = Router();

const db = () => admin.firestore();

/**
 * GET /api/jobPositions
 * List all job positions, ordered by displayOrder ascending.
 * Optional query: ?departmentId=xxx
 */
/**
 * Pay-bearing fields on a jobPosition. These are compensation data, not list
 * metadata, and are stripped for callers who have no business seeing them.
 */
const JOB_POSITION_PAY_FIELDS = [
  "defaultSalary",
  "hourlyRate",
  "clothingAllowance",
  "homeOfficeAllowance",
] as const;

jobPositionsRouter.get(
  "/",
  requireAuth,
  // Read stays open to any authenticated user — the position list populates form
  // dropdowns all over the app, and the NAMES are not sensitive. Mutations below
  // stay behind settings.jobPositions.manage (mirrors educationLevels).
  //
  // ⚠️ What is NOT open is the pay data. This handler used to `...d.data()` the
  // whole document, so every logged-in user — including a shared-terminal Recepce
  // login — could read defaultSalary / hourlyRate / clothingAllowance /
  // homeOfficeAllowance for every position straight off the API, while the UI kept
  // those same numbers behind an eye toggle inside a settings.jobPositions.manage
  // section. Only the two surfaces that genuinely need them get them:
  //   • settings.jobPositions.manage → the Nastavení → Pracovní pozice table/form
  //   • employment.manage           → the employee-detail Nástup/Dodatek modal,
  //                                    which prefills salary from defaultSalary
  // Server-side payroll is unaffected: `loadPositionHourlyRates` reads Firestore
  // through the Admin SDK, never through this endpoint.
  async (req: AuthRequest, res: Response) => {
    const { departmentId } = req.query as { departmentId?: string };
    let query: FirebaseFirestore.Query = db().collection("jobPositions");
    if (departmentId) {
      query = query.where("departmentId", "==", departmentId);
    }
    const snap = await query.orderBy("displayOrder", "asc").get();

    const perms = req.permissions ?? new Set<string>();
    const maySeePay =
      hasPermission(perms, "settings.jobPositions.manage") ||
      hasPermission(perms, "employment.manage");

    res.json(
      snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        if (!maySeePay) {
          for (const f of JOB_POSITION_PAY_FIELDS) delete data[f];
        }
        return { id: d.id, ...data };
      })
    );
  }
);

/**
 * POST /api/jobPositions
 * Create a new job position.
 * Body: { name, departmentId, defaultSalary, displayOrder? }
 */
jobPositionsRouter.post(
  "/",
  requireAuth,
  requirePermission("settings.jobPositions.manage"),
  async (req: AuthRequest, res: Response) => {
    const { name, departmentId, defaultSalary, hourlyRate, clothingAllowance, homeOfficeAllowance, displayOrder } = req.body as {
      name: string;
      departmentId: string;
      defaultSalary: number;
      hourlyRate?: number | null;
      clothingAllowance?: number | null;
      homeOfficeAllowance?: number | null;
      displayOrder?: number;
    };
    if (!name || !departmentId) {
      res.status(400).json({ error: "Název a oddělení jsou povinné." });
      return;
    }
    const ref = await db().collection("jobPositions").add({
      name,
      departmentId,
      defaultSalary: Number(defaultSalary) || 0,
      hourlyRate: hourlyRate != null ? Number(hourlyRate) : null,
      clothingAllowance: clothingAllowance != null ? Number(clothingAllowance) : null,
      homeOfficeAllowance: homeOfficeAllowance != null ? Number(homeOfficeAllowance) : null,
      displayOrder: typeof displayOrder === "number" ? displayOrder : 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await logCreate(ctxFromReq(req), {
      collection: "jobPositions",
      resourceId: ref.id,
      summary: { name, departmentId, defaultSalary, hourlyRate, clothingAllowance, homeOfficeAllowance },
    });
    res.json({ id: ref.id });
  }
);

interface AffectedEmployee {
  id: string;
  firstName: string;
  lastName: string;
  /**
   * Employment row(s) that actually CARRY this employee's hourlyRate for the
   * session in force today — the session's Nástup, plus any already-applicable
   * Dodatek that holds a hourlyRate of its own (see analyzeHourlyRateCascade).
   * Replaces the old single `employmentId`, which pointed at "the most recent
   * active row" and therefore, for anyone with an amendment, at a Dodatek.
   * Server-internal: the frontend's PosCascadePreview type never read it.
   */
  rateRowIds: string[];
  currentHourlyRate: number | null;
  isManualOverride: boolean;
}

interface AffectedPayroll {
  id: string;
  year: number;
  month: number;
}

interface EmploymentRowWithId {
  id: string;
  data: EmploymentRowLite & { status?: string };
}

/**
 * Load an employee's WHOLE employment history (rows + doc ids). The cascade
 * needs the whole session, not one row — the effective hourly rate is a fold of
 * Nástup + applicable Dodatky, and the row that stores it is the Nástup.
 */
async function getEmploymentRows(employeeId: string): Promise<EmploymentRowWithId[]> {
  const snap = await db()
    .collection("employees")
    .doc(employeeId)
    .collection("employment")
    .get();
  return snap.docs.map((d) => ({
    id: d.id,
    data: d.data() as EmploymentRowLite & { status?: string },
  }));
}

/**
 * Analyze the impact of a hourlyRate change on a job position:
 *  - which employees would be re-aligned to the new rate, and
 *  - which unlocked payroll periods include those employees (so the user can
 *    Recount them after the cascade).
 *
 * "Manual override" = the employee's EFFECTIVE hourly rate (the session fold, not
 * a single row) differs from the position's pre-update hourlyRate, i.e. someone
 * has already moved that employee off the position default.
 */
async function analyzeHourlyRateCascade(
  positionName: string,
  departmentName: string,
  currentPositionHourlyRate: number | null
): Promise<{ affectedEmployees: AffectedEmployee[]; affectedUnlockedPayrolls: AffectedPayroll[] }> {
  const empsSnap = await db()
    .collection("employees")
    .where("currentJobTitle", "==", positionName)
    .where("currentDepartment", "==", departmentName)
    .get();

  const today = clock.today();
  const affectedEmployees: AffectedEmployee[] = [];
  for (const empDoc of empsSnap.docs) {
    const rows = await getEmploymentRows(empDoc.id);
    // Unchanged gate: an employee with no ACTIVE employment row is skipped. This
    // used to be a .where("status","==","active") query; it is now the same test
    // in memory over the same rows, so the set of affected employees is exactly
    // what it was. The gate is deliberately NOT relaxed — row-level `status` is
    // known to lag the derived employee status here (nothing flips a Nástup row
    // to "inactive" when an Ukončení row is added), and widening it would pull
    // more people into a cascade that bulk-overwrites pay.
    if (!rows.some((r) => r.data.status === "active")) continue;
    const empData = empDoc.data() as Record<string, unknown>;

    // Fold the session instead of reading hourlyRate off the most recent active
    // row. That row is a Dodatek for anyone who has ever had an amendment, and a
    // Dodatek carries its payload in changes[] with NO hourlyRate of its own —
    // so the old read came back null for employees who do have a real rate, and
    // `isManualOverride` (null !== rate) then flagged every one of them as
    // "ručně upraveno" in the confirmation dialog. Measured on production: 21
    // active employees misreported this way. Same bug, same fix as
    // effectiveCompFromRows in services/payrollCalculator.ts.
    const comp = effectiveCompAsOf(rows.map((r) => r.data), today);
    // null = no Nástup row at all, so there is no row that can hold a rate and
    // nothing for the cascade to write. Such an employee could not have matched
    // the currentJobTitle/currentDepartment filter above anyway (root fields are
    // folded from sessions), so this is a corrupt-data guard, not a filter.
    if (!comp) continue;

    // The rate lives on the session's Nástup row. `nastupStartDate` is the fold's
    // own answer for which session is in force today, so the Nástup is found by
    // it rather than by re-implementing the session grouping here.
    const nastupRow = rows.find(
      (r) => r.data.changeType === "nástup" && r.data.startDate === comp.nastupStartDate
    );
    if (!nastupRow) continue;

    // A Dodatek of the SAME session that already carries a hourlyRate would win
    // the fold over the Nástup (later applicable row overrides), so writing only
    // the Nástup would report success and change nothing. Such rows exist only
    // because the old apply path put them there — it wrote to whatever single
    // row this function returned. Rewrite them alongside the Nástup so the fold
    // genuinely yields the new rate. Bounded to [nastupStartDate .. today]: no
    // other Nástup can fall inside that window (effectiveCompAsOf would have
    // picked it as the session), and future-dated rows are left untouched.
    const rateRowIds = [
      nastupRow.id,
      ...rows
        .filter(
          (r) =>
            r.data.changeType === "změna smlouvy" &&
            r.data.hourlyRate != null &&
            (r.data.startDate ?? "") >= comp.nastupStartDate &&
            (r.data.startDate ?? "") <= today
        )
        .map((r) => r.id),
    ];

    affectedEmployees.push({
      id: empDoc.id,
      firstName: (empData.firstName as string) ?? "",
      lastName: (empData.lastName as string) ?? "",
      rateRowIds,
      currentHourlyRate: comp.hourlyRate,
      isManualOverride: comp.hourlyRate !== currentPositionHourlyRate,
    });
  }

  const affectedIds = new Set(affectedEmployees.map((e) => e.id));
  const affectedUnlockedPayrolls: AffectedPayroll[] = [];
  if (affectedIds.size > 0) {
    const periodsSnap = await db()
      .collection("payrollPeriods")
      .where("locked", "==", false)
      .get();
    for (const periodDoc of periodsSnap.docs) {
      const entriesSnap = await periodDoc.ref.collection("entries").get();
      if (entriesSnap.docs.some((d) => affectedIds.has(d.id))) {
        const data = periodDoc.data() as Record<string, unknown>;
        affectedUnlockedPayrolls.push({
          id: periodDoc.id,
          year: data.year as number,
          month: data.month as number,
        });
      }
    }
    affectedUnlockedPayrolls.sort((a, b) => a.year - b.year || a.month - b.month);
  }

  return { affectedEmployees, affectedUnlockedPayrolls };
}

/**
 * PATCH /api/jobPositions/:id
 * Update a job position. Optionally cascades the new hourlyRate to all
 * employees currently assigned to this position+department.
 *
 * If hourlyRate is changing and `confirmCascade !== true`, returns 409 with
 * an impact preview so the UI can show a confirmation dialog. The caller
 * must re-PATCH with `confirmCascade: true` to actually apply the cascade.
 *
 * The cascade overwrites the hourlyRate on every matching employee's current
 * employment SESSION — by design, even those flagged as `isManualOverride`
 * (the dialog's "Potvrdit a přepsat"). Payroll periods are
 * NOT auto-recomputed; affected unlocked periods are listed so the user can
 * trigger Recount manually.
 */
jobPositionsRouter.patch(
  "/:id",
  requireAuth,
  requirePermission("settings.jobPositions.manage"),
  async (req: AuthRequest, res: Response) => {
    const {
      name, departmentId, defaultSalary, hourlyRate, clothingAllowance, homeOfficeAllowance,
      displayOrder, confirmCascade,
    } = req.body as {
      name?: string;
      departmentId?: string;
      defaultSalary?: number;
      hourlyRate?: number | null;
      clothingAllowance?: number | null;
      homeOfficeAllowance?: number | null;
      displayOrder?: number;
      confirmCascade?: boolean;
    };
    const positionRef = db().collection("jobPositions").doc(req.params.id);
    const positionSnap = await positionRef.get();
    if (!positionSnap.exists) {
      res.status(404).json({ error: "Pozice neexistuje." });
      return;
    }
    const currentPos = positionSnap.data() as {
      name: string;
      departmentId: string;
      hourlyRate?: number | null;
    };

    const newHourlyRate = hourlyRate !== undefined
      ? (hourlyRate != null ? Number(hourlyRate) : null)
      : undefined;
    const oldHourlyRate = currentPos.hourlyRate ?? null;
    const hourlyRateChanging = newHourlyRate !== undefined && newHourlyRate !== oldHourlyRate;

    if (hourlyRateChanging && confirmCascade !== true) {
      const depSnap = await db().collection("departments").doc(currentPos.departmentId).get();
      const departmentName = ((depSnap.data() as { name?: string } | undefined)?.name) ?? "";
      const analysis = await analyzeHourlyRateCascade(currentPos.name, departmentName, oldHourlyRate);
      if (analysis.affectedEmployees.length > 0) {
        res.status(409).json({
          requiresConfirmation: true,
          fieldChange: { hourlyRate: { from: oldHourlyRate, to: newHourlyRate ?? null } },
          ...analysis,
        });
        return;
      }
      // No employees on this position — fall through, no cascade needed.
    }

    const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (typeof name === "string") update.name = name;
    if (typeof departmentId === "string") update.departmentId = departmentId;
    if (defaultSalary !== undefined) update.defaultSalary = Number(defaultSalary) || 0;
    if (newHourlyRate !== undefined) update.hourlyRate = newHourlyRate;
    if (clothingAllowance !== undefined) update.clothingAllowance = clothingAllowance != null ? Number(clothingAllowance) : null;
    if (homeOfficeAllowance !== undefined) update.homeOfficeAllowance = homeOfficeAllowance != null ? Number(homeOfficeAllowance) : null;
    if (typeof displayOrder === "number") update.displayOrder = displayOrder;
    await positionRef.update(update);

    await logUpdate(ctxFromReq(req), {
      collection: "jobPositions",
      resourceId: req.params.id,
      before: currentPos as unknown as Record<string, unknown>,
      after: { ...(currentPos as unknown as Record<string, unknown>), ...update },
    });

    let cascadeCount = 0;
    if (hourlyRateChanging && confirmCascade === true) {
      const depSnap = await db().collection("departments").doc(currentPos.departmentId).get();
      const departmentName = ((depSnap.data() as { name?: string } | undefined)?.name) ?? "";
      const analysis = await analyzeHourlyRateCascade(currentPos.name, departmentName, oldHourlyRate);
      const batch = db().batch();
      for (const emp of analysis.affectedEmployees) {
        // Write to the row(s) that actually carry the rate for the session in
        // force today — never to "the most recent active row", which for an
        // amended employee is a Dodatek. Writing there invented a hourlyRate
        // field on an amendment row and pinned the new rate to that Dodatek's
        // start date, so a recount of an earlier unlocked period still used the
        // old Nástup rate. See analyzeHourlyRateCascade for how rateRowIds is
        // built (usually exactly one id: the Nástup).
        for (const rowId of emp.rateRowIds) {
          const rowRef = db()
            .collection("employees").doc(emp.id)
            .collection("employment").doc(rowId);
          batch.update(rowRef, { hourlyRate: newHourlyRate ?? null });
        }
      }
      if (analysis.affectedEmployees.length > 0) {
        await batch.commit();
        cascadeCount = analysis.affectedEmployees.length;
      }
    }

    res.json({ ok: true, cascadeCount });
  }
);

/**
 * DELETE /api/jobPositions/:id
 */
jobPositionsRouter.delete(
  "/:id",
  requireAuth,
  requirePermission("settings.jobPositions.manage"),
  async (req: AuthRequest, res: Response) => {
    const ref = db().collection("jobPositions").doc(req.params.id);
    const beforeSnap = await ref.get();
    const beforeData = beforeSnap.exists ? (beforeSnap.data() as Record<string, unknown>) : {};
    // Block delete only if an ACTIVE or BEFORE-START employee currently holds
    // this position (a terminated employee's stale currentJobTitle must not
    // block cleanup). Positions are referenced by NAME (jobTitle), and the DPP
    // hourly rate is resolved by the employee's CURRENT position name at every
    // payroll recompute — deleting a position an active employee still holds
    // would silently zero DPP pay on the next nightly run, so that case stays
    // blocked. See services/lookupGuard.ts.
    const posName = beforeData.name;
    if (typeof posName === "string" && posName) {
      if (await isReferencedByLiveEmployee("currentJobTitle", posName)) {
        res.status(400).json({ error: "Nelze smazat pracovní pozici, kterou mají aktivní zaměstnanci ve smlouvě." });
        return;
      }
    }
    await ref.delete();
    await logDelete(ctxFromReq(req), {
      collection: "jobPositions",
      resourceId: req.params.id,
      summary: { name: beforeData.name, departmentId: beforeData.departmentId },
    });
    res.json({ ok: true });
  }
);
