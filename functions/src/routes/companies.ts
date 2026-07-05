import { Router, Response } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { requirePermission } from "../auth/permissions";
import { ctxFromReq, logCreate, logUpdate, logDelete } from "../services/auditLog";
import { isReferencedByLiveEmployee } from "../services/lookupGuard";

export const companiesRouter = Router();

const db = () => admin.firestore();

/**
 * GET /api/companies
 * List all companies. Admin + director only.
 *
 * Sorted by displayOrder ascending in memory (not via orderBy) so that
 * legacy docs created before displayOrder existed are never silently
 * dropped from the result by Firestore's missing-field exclusion.
 */
companiesRouter.get(
  "/",
  requireAuth,
  // Read is open to any authenticated user — the company list populates form
  // dropdowns (Nástup, employee views). Mutations below stay admin/director.
  // Mirrors educationLevels (číselníky are non-sensitive reference data).
  async (_req: AuthRequest, res: Response) => {
    const snap = await db().collection("companies").get();
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => {
      const oa = (a as { displayOrder?: number }).displayOrder ?? 0;
      const ob = (b as { displayOrder?: number }).displayOrder ?? 0;
      if (oa !== ob) return oa - ob;
      return a.id.localeCompare(b.id);
    });
    res.json(list);
  }
);

/**
 * GET /api/companies/:id
 * Fetch a single company by code (e.g. "HPM", "STP"). Any authenticated user.
 */
companiesRouter.get(
  "/:id",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    const doc = await db().collection("companies").doc(req.params.id).get();
    if (!doc.exists) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    res.json({ id: doc.id, ...doc.data() });
  }
);

interface CompanyBody {
  abbreviation?: string;
  name?: string;
  address?: string;
  ic?: string;
  dic?: string;
  fileNo?: string;
  displayOrder?: number;
}

/**
 * POST /api/companies
 * Create a new company with an auto-generated doc id. Admin + director only.
 * Body: { abbreviation, name, address, ic, dic, fileNo, displayOrder? }
 */
companiesRouter.post(
  "/",
  requireAuth,
  requirePermission("settings.companies.manage"),
  async (req: AuthRequest, res: Response) => {
    const { abbreviation, name, address, ic, dic, fileNo, displayOrder } = req.body as CompanyBody;
    if (!abbreviation || !abbreviation.trim()) {
      res.status(400).json({ error: "Zkratka je povinná." });
      return;
    }
    const data = {
      abbreviation: abbreviation.trim(),
      name: name ?? "",
      address: address ?? "",
      ic: ic ?? "",
      dic: dic ?? "",
      fileNo: fileNo ?? "",
      displayOrder: typeof displayOrder === "number" ? displayOrder : 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: req.uid,
    };
    const ref = await db().collection("companies").add(data);
    await logCreate(ctxFromReq(req), {
      collection: "companies",
      resourceId: ref.id,
      summary: { abbreviation: data.abbreviation, name: data.name },
    });
    res.json({ id: ref.id });
  }
);

/**
 * PUT /api/companies/:id
 * Upsert a company by id. Admin + director only.
 * Body: { abbreviation, name, address, ic, dic, fileNo, displayOrder? }
 *
 * Kept as an upsert (rather than a strict update) so the two seeded
 * companies — keyed by code "HPM"/"STP" — keep their stable ids while still
 * being fully editable, including their abbreviation.
 */
companiesRouter.put(
  "/:id",
  requireAuth,
  requirePermission("settings.companies.manage"),
  async (req: AuthRequest, res: Response) => {
    const { abbreviation, name, address, ic, dic, fileNo, displayOrder } = req.body as CompanyBody;

    const ref = db().collection("companies").doc(req.params.id);
    const beforeSnap = await ref.get();
    const before = beforeSnap.exists ? (beforeSnap.data() as Record<string, unknown>) : {};
    const after: Record<string, unknown> = {
      // Default the abbreviation to the doc id for legacy docs that never had one.
      abbreviation: (abbreviation ?? (before.abbreviation as string) ?? req.params.id) || req.params.id,
      name: name ?? "",
      address: address ?? "",
      ic: ic ?? "",
      dic: dic ?? "",
      fileNo: fileNo ?? "",
    };
    if (typeof displayOrder === "number") after.displayOrder = displayOrder;
    await ref.set(
      {
        ...after,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: req.uid,
      },
      { merge: true }
    );

    await logUpdate(ctxFromReq(req), {
      collection: "companies",
      resourceId: req.params.id,
      before,
      after: { ...before, ...after },
    });

    res.json({ id: req.params.id });
  }
);

/**
 * DELETE /api/companies/:id
 * Remove a company. Admin + director only. Generated contracts already store
 * their company values inline, so deleting a company never alters past
 * documents — it only removes it from the picker going forward.
 */
companiesRouter.delete(
  "/:id",
  requireAuth,
  requirePermission("settings.companies.manage"),
  async (req: AuthRequest, res: Response) => {
    // Block delete only if an ACTIVE or BEFORE-START employee currently belongs
    // to this company — a terminated employee's stale currentCompanyId must not
    // block cleanup (a reactivation-time banner nudges the admin to fix it if
    // they come back). currentCompanyId is the denormalised current company on
    // the employee root doc; past generated contracts store the company inline
    // and are unaffected. See services/lookupGuard.ts.
    if (await isReferencedByLiveEmployee("currentCompanyId", req.params.id)) {
      res.status(400).json({ error: "Nelze smazat společnost, ve které jsou aktivní zaměstnanci." });
      return;
    }
    const ref = db().collection("companies").doc(req.params.id);
    const beforeSnap = await ref.get();
    const beforeData = beforeSnap.exists ? (beforeSnap.data() as Record<string, unknown>) : {};
    await ref.delete();
    await logDelete(ctxFromReq(req), {
      collection: "companies",
      resourceId: req.params.id,
      summary: { abbreviation: beforeData.abbreviation, name: beforeData.name },
    });
    res.json({ ok: true });
  }
);
