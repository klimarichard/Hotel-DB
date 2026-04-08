import { Router } from "express";
import * as admin from "firebase-admin";
import { requireAuth, requireRole, AuthRequest } from "../middleware/auth";
import { encryptFields, redactFields, decrypt } from "../services/encryption";

export const employeesRouter = Router();

const db = () => admin.firestore();

// Sensitive fields that must be encrypted at rest and redacted in responses
const SENSITIVE_FIELDS = ["birthNumber"] as const;
const DOCUMENT_SENSITIVE_FIELDS = ["idCardNumber", "idCardExpiry"] as const;
const BENEFITS_SENSITIVE_FIELDS = ["insuranceNumber", "bankAccount"] as const;

// ─── LIST ────────────────────────────────────────────────────────────────────

/**
 * GET /api/employees
 * Query params: status, companyId, department, contractType, nationality
 * Admin + HR only
 */
employeesRouter.get(
  "/",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res) => {
    let query: admin.firestore.Query = db().collection("employees");

    if (req.query.status) query = query.where("status", "==", req.query.status);
    if (req.query.companyId) query = query.where("currentCompanyId", "==", req.query.companyId);
    if (req.query.department) query = query.where("currentDepartment", "==", req.query.department);
    if (req.query.contractType) query = query.where("currentContractType", "==", req.query.contractType);
    if (req.query.nationality) query = query.where("nationality", "==", req.query.nationality);

    const snapshot = await query.get();
    const employees = snapshot.docs.map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      return { id: doc.id, ...redactFields(data, [...SENSITIVE_FIELDS]) };
    });

    res.json(employees);
  }
);

// ─── GET ONE ─────────────────────────────────────────────────────────────────

/**
 * GET /api/employees/:id
 * Admin + HR only. Sensitive fields are redacted (use /reveal endpoints to expose).
 */
employeesRouter.get(
  "/:id",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res) => {
    const doc = await db().collection("employees").doc(req.params.id).get();
    if (!doc.exists) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }
    const data = doc.data() as Record<string, unknown>;
    res.json({ id: doc.id, ...redactFields(data, [...SENSITIVE_FIELDS]) });
  }
);

// ─── CREATE ───────────────────────────────────────────────────────────────────

/**
 * POST /api/employees
 * Creates employee + empty sub-documents (contact, benefits, documents).
 * Admin + HR only.
 */
employeesRouter.post(
  "/",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res) => {
    const body = req.body as Record<string, unknown>;
    const now = admin.firestore.FieldValue.serverTimestamp();

    const employeeData = encryptFields(
      {
        firstName: body.firstName ?? "",
        lastName: body.lastName ?? "",
        dateOfBirth: body.dateOfBirth ?? null,
        gender: body.gender ?? null,
        birthSurname: body.birthSurname ?? "",
        birthNumber: body.birthNumber ?? "",
        maritalStatus: body.maritalStatus ?? "",
        education: body.education ?? "",
        nationality: body.nationality ?? "",
        placeOfBirth: body.placeOfBirth ?? "",
        status: "active",
        currentCompanyId: body.currentCompanyId ?? null,
        currentDepartment: body.currentDepartment ?? "",
        currentContractType: body.currentContractType ?? "",
        currentJobTitle: body.currentJobTitle ?? "",
        createdAt: now,
        updatedAt: now,
      },
      [...SENSITIVE_FIELDS]
    );

    const ref = await db().collection("employees").add(employeeData);
    res.status(201).json({ id: ref.id });
  }
);

// ─── UPDATE ───────────────────────────────────────────────────────────────────

/**
 * PATCH /api/employees/:id
 * Partial update. Re-encrypts sensitive fields if included.
 */
employeesRouter.patch(
  "/:id",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res) => {
    const body = req.body as Record<string, unknown>;
    const updated = encryptFields(
      { ...body, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      [...SENSITIVE_FIELDS]
    );
    await db().collection("employees").doc(req.params.id).update(updated);
    res.json({ success: true });
  }
);

// ─── REVEAL SENSITIVE FIELD ───────────────────────────────────────────────────

/**
 * POST /api/employees/:id/reveal
 * Body: { field: "birthNumber" | "idCardNumber" | ... }
 * Returns decrypted value and logs the reveal event.
 * Admin + HR only.
 */
employeesRouter.post(
  "/:id/reveal",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res) => {
    const { field } = req.body as { field: string };
    const allSensitive = [
      ...SENSITIVE_FIELDS,
      ...DOCUMENT_SENSITIVE_FIELDS,
      ...BENEFITS_SENSITIVE_FIELDS,
    ] as string[];

    if (!allSensitive.includes(field)) {
      res.status(400).json({ error: "Field is not a sensitive field or does not exist" });
      return;
    }

    // Determine which collection/doc holds this field
    let encryptedValue: string | undefined;
    const empDoc = await db().collection("employees").doc(req.params.id).get();
    if (!empDoc.exists) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }

    if ((SENSITIVE_FIELDS as readonly string[]).includes(field)) {
      encryptedValue = (empDoc.data() as Record<string, string>)[field];
    } else if ((DOCUMENT_SENSITIVE_FIELDS as readonly string[]).includes(field)) {
      const docsSnap = await db()
        .collection("employees")
        .doc(req.params.id)
        .collection("documents")
        .limit(1)
        .get();
      if (!docsSnap.empty) {
        encryptedValue = (docsSnap.docs[0].data() as Record<string, string>)[field];
      }
    } else if ((BENEFITS_SENSITIVE_FIELDS as readonly string[]).includes(field)) {
      const benefitsSnap = await db()
        .collection("employees")
        .doc(req.params.id)
        .collection("benefits")
        .limit(1)
        .get();
      if (!benefitsSnap.empty) {
        encryptedValue = (benefitsSnap.docs[0].data() as Record<string, string>)[field];
      }
    }

    if (!encryptedValue) {
      res.status(404).json({ error: "Field value not found" });
      return;
    }

    const plaintext = decrypt(encryptedValue);

    // Audit log
    await db().collection("auditLog").add({
      userId: req.uid,
      employeeId: req.params.id,
      fieldName: field,
      action: "reveal",
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ value: plaintext });
  }
);

// ─── SUB-RESOURCES ────────────────────────────────────────────────────────────

/**
 * GET /api/employees/:id/contact
 */
employeesRouter.get(
  "/:id/contact",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res) => {
    const snap = await db()
      .collection("employees")
      .doc(req.params.id)
      .collection("contact")
      .limit(1)
      .get();
    res.json(snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() });
  }
);

/**
 * PUT /api/employees/:id/contact
 */
employeesRouter.put(
  "/:id/contact",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res) => {
    const colRef = db().collection("employees").doc(req.params.id).collection("contact");
    const snap = await colRef.limit(1).get();
    const data = {
      ...req.body,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (snap.empty) {
      await colRef.add(data);
    } else {
      await snap.docs[0].ref.set(data);
    }
    res.json({ success: true });
  }
);

/**
 * GET /api/employees/:id/employment
 * Returns full employment history ordered by startDate desc.
 */
employeesRouter.get(
  "/:id/employment",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res) => {
    const snap = await db()
      .collection("employees")
      .doc(req.params.id)
      .collection("employment")
      .orderBy("startDate", "desc")
      .get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json(rows);
  }
);

/**
 * POST /api/employees/:id/employment
 * Adds a new employment history row and updates denormalized fields on the employee doc.
 */
employeesRouter.post(
  "/:id/employment",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res) => {
    const body = req.body as Record<string, unknown>;
    const now = admin.firestore.FieldValue.serverTimestamp();
    const empRef = db().collection("employees").doc(req.params.id);

    const employmentData = {
      ...body,
      createdBy: req.uid,
      createdAt: now,
    };

    const newRow = await empRef.collection("employment").add(employmentData);

    // Update denormalized fields on the employee root doc
    if (body.status === "active") {
      await empRef.update({
        currentCompanyId: body.companyId ?? null,
        currentDepartment: body.department ?? "",
        currentContractType: body.contractType ?? "",
        currentJobTitle: body.jobTitle ?? "",
        updatedAt: now,
      });
    }

    res.status(201).json({ id: newRow.id });
  }
);

/**
 * GET /api/employees/:id/contracts
 */
employeesRouter.get(
  "/:id/contracts",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res) => {
    const snap = await db()
      .collection("employees")
      .doc(req.params.id)
      .collection("contracts")
      .orderBy("generatedAt", "desc")
      .get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }
);
