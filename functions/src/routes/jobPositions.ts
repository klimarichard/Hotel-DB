import { Router, Response } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, requireRole, AuthRequest } from "../middleware/auth";

export const jobPositionsRouter = Router();

const db = () => admin.firestore();

/**
 * GET /api/jobPositions
 * List all job positions, ordered by displayOrder ascending.
 * Optional query: ?departmentId=xxx
 */
jobPositionsRouter.get(
  "/",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res: Response) => {
    const { departmentId } = req.query as { departmentId?: string };
    let query: FirebaseFirestore.Query = db().collection("jobPositions");
    if (departmentId) {
      query = query.where("departmentId", "==", departmentId);
    }
    const snap = await query.orderBy("displayOrder", "asc").get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
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
  requireRole("admin", "director"),
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
    res.json({ id: ref.id });
  }
);

interface AffectedEmployee {
  id: string;
  firstName: string;
  lastName: string;
  employmentId: string;
  currentHourlyRate: number | null;
  isManualOverride: boolean;
}

interface AffectedPayroll {
  id: string;
  year: number;
  month: number;
}

/**
 * Find the active employment record (most recent active by startDate) for an
 * employee. Returns null if there is no active row.
 */
async function getActiveEmploymentDoc(
  employeeId: string
): Promise<FirebaseFirestore.QueryDocumentSnapshot | null> {
  const snap = await db()
    .collection("employees")
    .doc(employeeId)
    .collection("employment")
    .where("status", "==", "active")
    .orderBy("startDate", "desc")
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0];
}

/**
 * Analyze the impact of a hourlyRate change on a job position:
 *  - which employees would be re-aligned to the new rate, and
 *  - which unlocked payroll periods include those employees (so the user can
 *    Recount them after the cascade).
 *
 * "Manual override" = the employee's current employment.hourlyRate differs
 * from the position's pre-update hourlyRate, i.e. someone has already moved
 * that employee off the position default.
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

  const affectedEmployees: AffectedEmployee[] = [];
  for (const empDoc of empsSnap.docs) {
    const employmentDoc = await getActiveEmploymentDoc(empDoc.id);
    if (!employmentDoc) continue;
    const empData = empDoc.data() as Record<string, unknown>;
    const employmentData = employmentDoc.data() as Record<string, unknown>;
    const currentHourlyRate = (employmentData.hourlyRate as number | null | undefined) ?? null;
    affectedEmployees.push({
      id: empDoc.id,
      firstName: (empData.firstName as string) ?? "",
      lastName: (empData.lastName as string) ?? "",
      employmentId: employmentDoc.id,
      currentHourlyRate,
      isManualOverride: currentHourlyRate !== currentPositionHourlyRate,
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
 * The cascade overwrites every matching employee's active employment.hourlyRate
 * — by design, even those flagged as `isManualOverride`. Payroll periods are
 * NOT auto-recomputed; affected unlocked periods are listed so the user can
 * trigger Recount manually.
 */
jobPositionsRouter.patch(
  "/:id",
  requireAuth,
  requireRole("admin", "director"),
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

    let cascadeCount = 0;
    if (hourlyRateChanging && confirmCascade === true) {
      const depSnap = await db().collection("departments").doc(currentPos.departmentId).get();
      const departmentName = ((depSnap.data() as { name?: string } | undefined)?.name) ?? "";
      const analysis = await analyzeHourlyRateCascade(currentPos.name, departmentName, oldHourlyRate);
      const batch = db().batch();
      for (const emp of analysis.affectedEmployees) {
        const empRef = db()
          .collection("employees").doc(emp.id)
          .collection("employment").doc(emp.employmentId);
        batch.update(empRef, { hourlyRate: newHourlyRate ?? null });
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
  requireRole("admin", "director"),
  async (req: AuthRequest, res: Response) => {
    await db().collection("jobPositions").doc(req.params.id).delete();
    res.json({ ok: true });
  }
);
