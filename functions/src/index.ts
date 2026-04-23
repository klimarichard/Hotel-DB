import * as functions from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import express from "express";
import cors from "cors";

import { authRouter } from "./routes/auth";
import { employeesRouter } from "./routes/employees";
import { alertsRouter } from "./routes/alerts";
import { companiesRouter } from "./routes/companies";
import { departmentsRouter } from "./routes/departments";
import { jobPositionsRouter } from "./routes/jobPositions";
import { contractTemplatesRouter } from "./routes/contractTemplates";
import { contractsRouter } from "./routes/contracts";
import { shiftsRouter } from "./routes/shifts";
import { vacationRouter } from "./routes/vacation";
import { payrollRouter } from "./routes/payroll";
import { statsRouter } from "./routes/stats";
import { transitionPlanDeadlines } from "./services/planTransitions";
import { createOrUpdatePayrollPeriod } from "./services/payrollCalculator";
import { sweepExpiredMultisport } from "./services/multisportSweep";
import { updateDocumentAlerts, EXPIRY_FIELDS } from "./routes/employees";

admin.initializeApp();

const app = express();

app.use(cors({ origin: true }));
app.use(express.json());

// Routes
app.use("/auth", authRouter);
app.use("/employees", employeesRouter);
app.use("/alerts", alertsRouter);
app.use("/companies", companiesRouter);
app.use("/departments", departmentsRouter);
app.use("/jobPositions", jobPositionsRouter);
app.use("/contractTemplates", contractTemplatesRouter);
app.use("/", contractsRouter);
app.use("/shifts", shiftsRouter);
app.use("/vacation", vacationRouter);
app.use("/payroll", payrollRouter);
app.use("/stats", statsRouter);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// HTTP trigger for manual/emulator testing of deadline transitions
app.post("/shifts/trigger-deadlines", async (_req, res) => {
  const result = await transitionPlanDeadlines();
  res.json(result);
});

// HTTP trigger for manual/emulator testing of Multisport auto-untick sweep
app.post("/benefits/trigger-multisport-sweep", async (_req, res) => {
  const result = await sweepExpiredMultisport();
  res.json(result);
});

// HTTP trigger for manual/emulator testing of document alert refresh
app.post("/employees/trigger-alert-refresh", async (_req, res) => {
  const db = admin.firestore();
  const employeesSnap = await db.collection("employees").get();
  let refreshed = 0;
  for (const empDoc of employeesSnap.docs) {
    const emp = empDoc.data() as Record<string, unknown>;
    const docsSnap = await empDoc.ref.collection("documents").limit(1).get();
    if (docsSnap.empty) continue;
    const docData = docsSnap.docs[0].data() as Record<string, unknown>;
    const alertBody: Record<string, unknown> = {};
    for (const { field } of EXPIRY_FIELDS) alertBody[field] = docData[field] ?? null;
    await updateDocumentAlerts(empDoc.id, (emp.firstName as string) ?? "", (emp.lastName as string) ?? "", alertBody);
    refreshed++;
  }
  res.json({ refreshed });
});

export const api = functions.https.onRequest(app);

// ─── Scheduled function: auto-transition plans at their deadlines ─────────────
// Runs every 5 minutes in production. In the emulator, trigger manually via:
//   curl -X POST http://127.0.0.1:5002/hotel-hr-app-75581/us-central1/api/shifts/trigger-deadlines

export const checkPlanDeadlines = onSchedule("every 5 minutes", async () => {
  await transitionPlanDeadlines();
});

// ─── Daily: refresh document expiry alerts for all employees ─────────────────
// Proactively re-checks passport / visa expiry for every employee so that
// alerts appear automatically when a deadline enters the 30-day window,
// without requiring the admin to re-save the employee form.

// ─── Daily: refresh payroll for all published shift plans ─────────────────────
// Picks up any shift edits made after publishing. In the emulator, trigger via:
//   curl -X POST http://127.0.0.1:5002/.../api/payroll/trigger

export const refreshPayroll = onSchedule("every 24 hours", async () => {
  const db = admin.firestore();
  const snap = await db.collection("shiftPlans").where("status", "==", "published").get();
  for (const doc of snap.docs) {
    const data = doc.data() as { year: number; month: number };
    await createOrUpdatePayrollPeriod(doc.id, data.year, data.month);
  }
});

// ─── Daily: auto-untick Multisport once multisportTo has passed ──────────────
// Trigger manually via:
//   curl -X POST http://127.0.0.1:5002/.../api/benefits/trigger-multisport-sweep

export const sweepMultisport = onSchedule("every 24 hours", async () => {
  await sweepExpiredMultisport();
});

// ─── Daily: refresh document expiry alerts for all employees ─────────────────

export const refreshDocumentAlerts = onSchedule("every 24 hours", async () => {
  const db = admin.firestore();
  const employeesSnap = await db.collection("employees").get();

  for (const empDoc of employeesSnap.docs) {
    const emp = empDoc.data() as Record<string, unknown>;
    const docsSnap = await empDoc.ref.collection("documents").limit(1).get();
    if (docsSnap.empty) continue;

    const docData = docsSnap.docs[0].data() as Record<string, unknown>;

    // Build a body-like object containing only the expiry fields
    const alertBody: Record<string, unknown> = {};
    for (const { field } of EXPIRY_FIELDS) {
      alertBody[field] = docData[field] ?? null;
    }

    await updateDocumentAlerts(
      empDoc.id,
      emp.firstName as string ?? "",
      emp.lastName as string ?? "",
      alertBody
    );
  }
});
