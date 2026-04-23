import { Router } from "express";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAuth, requireRole, AuthRequest } from "../middleware/auth";
import { encryptFields, redactFields, decrypt, decryptFields } from "../services/encryption";

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

// ─── EXPORT ──────────────────────────────────────────────────────────────────

/**
 * GET /api/employees/export
 * Returns merged rows (root + contact + documents + benefits + latest employment)
 * for CSV export on the frontend.
 *
 * Query params (all optional):
 *   status, companyId, department, contractType, nationality, jobTitle
 *   includeSensitive=true — decrypts birthNumber / idCardNumber / insuranceNumber
 *                          / bankAccount; writes ONE auditLog entry per export.
 *
 * Must be declared before GET /:id so Express matches "export" as a literal.
 * TODO: When the "accountant" role is introduced, add it to requireRole(...) below.
 */
employeesRouter.get(
  "/export",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res) => {
    const includeSensitive = req.query.includeSensitive === "true";

    let query: admin.firestore.Query = db().collection("employees");
    if (req.query.status) query = query.where("status", "==", req.query.status);
    if (req.query.companyId) query = query.where("currentCompanyId", "==", req.query.companyId);
    if (req.query.department) query = query.where("currentDepartment", "==", req.query.department);
    if (req.query.contractType) query = query.where("currentContractType", "==", req.query.contractType);
    if (req.query.nationality) query = query.where("nationality", "==", req.query.nationality);
    if (req.query.jobTitle) query = query.where("currentJobTitle", "==", req.query.jobTitle);

    const snapshot = await query.get();

    const rows = await Promise.all(
      snapshot.docs.map(async (empDoc) => {
        const empRef = empDoc.ref;
        const [contactSnap, documentsSnap, benefitsSnap, employmentSnap] = await Promise.all([
          empRef.collection("contact").limit(1).get(),
          empRef.collection("documents").limit(1).get(),
          empRef.collection("benefits").limit(1).get(),
          empRef.collection("employment").orderBy("startDate", "desc").limit(1).get(),
        ]);

        let root = empDoc.data() as Record<string, unknown>;
        let documents = documentsSnap.empty
          ? {}
          : (documentsSnap.docs[0].data() as Record<string, unknown>);
        let benefits = benefitsSnap.empty
          ? {}
          : (benefitsSnap.docs[0].data() as Record<string, unknown>);
        const contact = contactSnap.empty
          ? {}
          : (contactSnap.docs[0].data() as Record<string, unknown>);
        const employment = employmentSnap.empty
          ? {}
          : (employmentSnap.docs[0].data() as Record<string, unknown>);

        if (includeSensitive) {
          root = decryptFields(root, [...SENSITIVE_FIELDS]);
          documents = decryptFields(documents, [...DOCUMENT_SENSITIVE_FIELDS]);
          benefits = decryptFields(benefits, [...BENEFITS_SENSITIVE_FIELDS]);
        } else {
          root = redactFields(root, [...SENSITIVE_FIELDS]);
          documents = redactFields(documents, [...DOCUMENT_SENSITIVE_FIELDS]);
          benefits = redactFields(benefits, [...BENEFITS_SENSITIVE_FIELDS]);
        }

        return {
          id: empDoc.id,
          ...root,
          contact,
          documents,
          benefits,
          employment,
        };
      })
    );

    if (includeSensitive) {
      await db().collection("auditLog").add({
        userId: req.uid,
        action: "export",
        fields: [
          ...SENSITIVE_FIELDS,
          ...DOCUMENT_SENSITIVE_FIELDS,
          ...BENEFITS_SENSITIVE_FIELDS,
        ],
        filters: {
          status: req.query.status ?? null,
          companyId: req.query.companyId ?? null,
          department: req.query.department ?? null,
          contractType: req.query.contractType ?? null,
          nationality: req.query.nationality ?? null,
          jobTitle: req.query.jobTitle ?? null,
        },
        employeeCount: rows.length,
        timestamp: FieldValue.serverTimestamp(),
      });
    }

    res.json({ employees: rows });
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
    const now = FieldValue.serverTimestamp();

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
 * Pass clearFields: ["birthNumber"] to explicitly delete a sensitive field.
 */
employeesRouter.patch(
  "/:id",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res) => {
    const body = req.body as Record<string, unknown>;
    const clearFields = Array.isArray(body.clearFields) ? body.clearFields as string[] : [];
    const payload = { ...body };
    delete payload.clearFields;

    const updated = encryptFields(
      { ...payload, updatedAt: FieldValue.serverTimestamp() },
      [...SENSITIVE_FIELDS]
    ) as Record<string, unknown>;

    // Explicitly delete cleared sensitive fields
    for (const f of SENSITIVE_FIELDS) {
      if (clearFields.includes(f)) {
        updated[f] = FieldValue.delete();
      }
    }

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
      timestamp: FieldValue.serverTimestamp(),
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
      updatedAt: FieldValue.serverTimestamp(),
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
    const now = FieldValue.serverTimestamp();
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
 * GET /api/employees/:id/documents
 */
employeesRouter.get(
  "/:id/documents",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res) => {
    const snap = await db()
      .collection("employees")
      .doc(req.params.id)
      .collection("documents")
      .limit(1)
      .get();
    if (snap.empty) { res.json(null); return; }
    const data = snap.docs[0].data() as Record<string, unknown>;
    res.json({ id: snap.docs[0].id, ...redactFields(data, [...DOCUMENT_SENSITIVE_FIELDS]) });
  }
);

// ─── ALERT HELPER ────────────────────────────────────────────────────────────

const EXPIRY_ALERT_DAYS = 30;

export const EXPIRY_FIELDS: { field: string; label: string }[] = [
  { field: "idCardExpiry", label: "Platnost OP" },
  { field: "passportExpiry", label: "Platnost pasu" },
  { field: "visaExpiry", label: "Platnost povolení k pobytu" },
];

export async function updateDocumentAlerts(
  employeeId: string,
  firstName: string,
  lastName: string,
  body: Record<string, unknown>
): Promise<void> {
  const alertsCol = db().collection("alerts");
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const { field, label } of EXPIRY_FIELDS) {
    const docId = `${employeeId}_${field}`;
    const value = body[field] as string | undefined;

    if (!value) {
      // Field cleared — remove any existing alert
      await alertsCol.doc(docId).delete();
      continue;
    }

    const expiry = new Date(value);
    const daysUntilExpiry = Math.ceil(
      (expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysUntilExpiry > EXPIRY_ALERT_DAYS) {
      // Not expiring soon — remove any existing alert
      await alertsCol.doc(docId).delete();
    } else {
      // Expiring soon or already expired — upsert alert
      await alertsCol.doc(docId).set({
        employeeId,
        employeeFirstName: firstName,
        employeeLastName: lastName,
        field,
        fieldLabel: label,
        expiryDate: value,
        daysUntilExpiry,
        status: daysUntilExpiry < 0 ? "expired" : "expiring",
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }
}

/**
 * PUT /api/employees/:id/documents
 * Encrypts idCardNumber and idCardExpiry before writing.
 * Blank sensitive fields are omitted so existing encrypted values are preserved.
 */
employeesRouter.put(
  "/:id/documents",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res) => {
    const body = req.body as Record<string, unknown>;

    const clearFields = Array.isArray(body.clearFields) ? body.clearFields as string[] : [];

    // Build alert body: cleared expiry fields are treated as removed
    const alertBody = { ...body } as Record<string, unknown>;
    for (const f of clearFields) { alertBody[f] = undefined; }

    // Check expiry alerts using plaintext body BEFORE encryption
    const empDoc = await db().collection("employees").doc(req.params.id).get();
    if (empDoc.exists) {
      const emp = empDoc.data() as Record<string, unknown>;
      await updateDocumentAlerts(
        req.params.id,
        emp.firstName as string,
        emp.lastName as string,
        alertBody
      );
    }

    // Strip blank sensitive fields — existing encrypted values will be preserved via update()
    const payload: Record<string, unknown> = { ...body };
    delete payload.clearFields;
    for (const f of DOCUMENT_SENSITIVE_FIELDS) { if (!payload[f]) delete payload[f]; }

    const data = encryptFields(
      { ...payload, updatedAt: FieldValue.serverTimestamp() },
      [...DOCUMENT_SENSITIVE_FIELDS]
    ) as Record<string, unknown>;

    // Explicitly delete cleared sensitive fields
    for (const f of DOCUMENT_SENSITIVE_FIELDS) {
      if (clearFields.includes(f)) {
        data[f] = FieldValue.delete();
      }
    }

    const colRef = db().collection("employees").doc(req.params.id).collection("documents");
    const snap = await colRef.limit(1).get();
    if (snap.empty) {
      await colRef.add(data);
    } else {
      await snap.docs[0].ref.update(data); // update preserves unmentioned fields
    }
    res.json({ success: true });
  }
);

/**
 * GET /api/employees/:id/benefits
 */
employeesRouter.get(
  "/:id/benefits",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res) => {
    const snap = await db()
      .collection("employees")
      .doc(req.params.id)
      .collection("benefits")
      .limit(1)
      .get();
    if (snap.empty) { res.json(null); return; }
    const data = snap.docs[0].data() as Record<string, unknown>;
    res.json({ id: snap.docs[0].id, ...redactFields(data, [...BENEFITS_SENSITIVE_FIELDS]) });
  }
);

/**
 * PUT /api/employees/:id/benefits
 * Encrypts insuranceNumber and bankAccount before writing.
 * Blank sensitive fields are omitted so existing encrypted values are preserved.
 */
employeesRouter.put(
  "/:id/benefits",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res) => {
    const body = req.body as Record<string, unknown>;
    const clearFields = Array.isArray(body.clearFields) ? body.clearFields as string[] : [];
    const payload: Record<string, unknown> = { ...body };
    delete payload.clearFields;
    for (const f of BENEFITS_SENSITIVE_FIELDS) { if (!payload[f]) delete payload[f]; }

    const data = encryptFields(
      { ...payload, updatedAt: FieldValue.serverTimestamp() },
      [...BENEFITS_SENSITIVE_FIELDS]
    ) as Record<string, unknown>;

    // Explicitly delete cleared sensitive fields
    for (const f of BENEFITS_SENSITIVE_FIELDS) {
      if (clearFields.includes(f)) {
        data[f] = FieldValue.delete();
      }
    }

    const colRef = db().collection("employees").doc(req.params.id).collection("benefits");
    const snap = await colRef.limit(1).get();
    if (snap.empty) {
      await colRef.add(data);
    } else {
      await snap.docs[0].ref.update(data);
    }
    res.json({ success: true });
  }
);

/**
 * PATCH /api/employees/:id/employment/:rowId
 * Updates a single employment history record.
 * If status === "active", re-syncs denormalized fields on the employee root doc.
 */
employeesRouter.patch(
  "/:id/employment/:rowId",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res) => {
    const body = req.body as Record<string, unknown>;
    const now = FieldValue.serverTimestamp();
    const empRef = db().collection("employees").doc(req.params.id);
    const rowRef = empRef.collection("employment").doc(req.params.rowId);

    const rowSnap = await rowRef.get();
    if (!rowSnap.exists) {
      res.status(404).json({ error: "Employment record not found" });
      return;
    }

    await rowRef.update({ ...body, updatedAt: now });

    if (body.status === "active") {
      await empRef.update({
        currentCompanyId: body.companyId ?? null,
        currentDepartment: body.department ?? "",
        currentContractType: body.contractType ?? "",
        currentJobTitle: body.jobTitle ?? "",
        updatedAt: now,
      });
    }

    res.json({ success: true });
  }
);

/**
 * GET /api/employees/:id/alerts
 * Returns active expiry alerts for a specific employee.
 */
employeesRouter.get(
  "/:id/alerts",
  requireAuth,
  requireRole("admin", "director"),
  async (req: AuthRequest, res) => {
    const snap = await db()
      .collection("alerts")
      .where("employeeId", "==", req.params.id)
      .get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }
);

/**
 * GET /api/employees/:id/linked-user
 * Returns the user account linked to this employee, or null.
 */
employeesRouter.get(
  "/:id/linked-user",
  requireAuth,
  requireRole("admin", "director"),
  async (req, res) => {
    const snap = await db()
      .collection("users")
      .where("employeeId", "==", req.params.id)
      .limit(1)
      .get();
    if (snap.empty) {
      res.json(null);
      return;
    }
    const data = snap.docs[0].data() as Record<string, unknown>;
    res.json({ uid: snap.docs[0].id, email: data.email, name: data.name });
  }
);

/**
 * DELETE /api/employees/:id
 * Deletes an employee and all their sub-collections.
 * Query param: deleteUser=true → also delete the linked Firebase Auth user.
 *              deleteUser=false (default) → unlink but keep the user account.
 */
employeesRouter.delete(
  "/:id",
  requireAuth,
  requireRole("admin", "director"),
  async (req, res) => {
    const { id } = req.params;
    const deleteUser = req.query.deleteUser === "true";

    // Handle linked user account
    const usersSnap = await db()
      .collection("users")
      .where("employeeId", "==", id)
      .limit(1)
      .get();

    if (!usersSnap.empty) {
      const userDoc = usersSnap.docs[0];
      if (deleteUser) {
        try { await admin.auth().deleteUser(userDoc.id); } catch { /* already deleted */ }
        await userDoc.ref.delete();
      } else {
        await userDoc.ref.update({
          employeeId: null,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }

    const empRef = db().collection("employees").doc(id);

    // Delete sub-collections
    for (const col of ["contact", "employment", "documents", "benefits", "contracts"]) {
      const snap = await empRef.collection(col).get();
      if (!snap.empty) {
        const batch = db().batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    }

    // Delete related top-level documents
    const alertsSnap = await db().collection("alerts").where("employeeId", "==", id).get();
    if (!alertsSnap.empty) {
      const batch = db().batch();
      alertsSnap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }

    const vacSnap = await db().collection("vacationRequests").where("employeeId", "==", id).get();
    if (!vacSnap.empty) {
      const batch = db().batch();
      vacSnap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }

    // Delete the employee document
    await empRef.delete();

    res.json({ ok: true });
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
