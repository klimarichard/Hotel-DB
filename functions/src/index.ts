import * as functions from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions } from "firebase-functions/v2";
import * as admin from "firebase-admin";
import express from "express";
import cors from "cors";

import { authRouter } from "./routes/auth";
import { employeesRouter, refreshEffectiveRootForAllActive } from "./routes/employees";
import { alertsRouter } from "./routes/alerts";
import { companiesRouter } from "./routes/companies";
import { departmentsRouter } from "./routes/departments";
import { jobPositionsRouter } from "./routes/jobPositions";
import { educationLevelsRouter } from "./routes/educationLevels";
import { contractTemplatesRouter } from "./routes/contractTemplates";
import { contractsRouter } from "./routes/contracts";
import { shiftsRouter } from "./routes/shifts";
import { vacationRouter } from "./routes/vacation";
import { payrollRouter } from "./routes/payroll";
import { statsRouter } from "./routes/stats";
import { auditLogRouter } from "./routes/auditLog";
import { menuOrderRouter } from "./routes/menuOrder";
import { timeOverrideRouter } from "./routes/timeOverride";
import { selfServiceRouter } from "./routes/selfService";
import { employeeChangeRequestsRouter } from "./routes/employeeChangeRequests";
import * as clock from "./services/clock";
import { requireAuth, requireRole, AuthRequest } from "./middleware/auth";
import { writeAudit, ctxFromReq } from "./services/auditLog";
import { transitionPlanDeadlines } from "./services/planTransitions";
import { createOrUpdatePayrollPeriod } from "./services/payrollCalculator";
import { sweepExpiredMultisport } from "./services/multisportSweep";
import { updateDocumentAlerts, EXPIRY_FIELDS } from "./routes/employees";
import { refreshAllProbationAlerts } from "./services/probationAlerts";

// All functions run in europe-west3 to co-locate with the Firestore
// database — avoids cross-region latency on every read/write.
const REGION = "europe-west3";
setGlobalOptions({ region: REGION }); // applies to the v2 onSchedule functions

admin.initializeApp();

const app = express();

app.use(cors({ origin: true }));
// 10mb covers contract PDFs that contain embedded base64 images
// (logos, scanned signatures). Base64-encoded blob is ~33% larger
// than the raw PDF, so a 3 MB PDF lands around 4 MB of JSON body.
app.use(express.json({ limit: "10mb" }));

// Pull the latest test-clock override before each request. TTL-cached, so it
// only re-reads Firestore every ~30s, and it's a no-op in production (the
// override is never honoured there). Keeps clock.now() current for handlers.
app.use((_req, _res, next) => {
  clock.refresh().then(() => next()).catch(() => next());
});

// Routes
app.use("/auth", authRouter);
app.use("/employees", employeesRouter);
app.use("/alerts", alertsRouter);
app.use("/companies", companiesRouter);
app.use("/departments", departmentsRouter);
app.use("/jobPositions", jobPositionsRouter);
app.use("/educationLevels", educationLevelsRouter);
app.use("/contractTemplates", contractTemplatesRouter);
app.use("/", contractsRouter);
app.use("/shifts", shiftsRouter);
app.use("/vacation", vacationRouter);
app.use("/payroll", payrollRouter);
app.use("/stats", statsRouter);
app.use("/audit", auditLogRouter);
app.use("/settings/menu-order", menuOrderRouter);
app.use("/settings/time-override", timeOverrideRouter);
app.use("/me", selfServiceRouter);
app.use("/employee-change-requests", employeeChangeRequestsRouter);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// HTTP triggers below mirror the scheduled functions and exist for admins to
// re-run a job after a missed/failed scheduled execution. Admin-only, and
// every successful call writes a `manual-trigger` audit entry.
app.post(
  "/shifts/trigger-deadlines",
  requireAuth,
  requireRole("admin"),
  async (req: AuthRequest, res) => {
    const result = await transitionPlanDeadlines();
    await writeAudit(ctxFromReq(req), {
      action: "manual-trigger",
      collection: "shiftPlans",
      extra: { trigger: "transitionPlanDeadlines", result },
    });
    res.json(result);
  }
);

app.post(
  "/benefits/trigger-multisport-sweep",
  requireAuth,
  requireRole("admin"),
  async (req: AuthRequest, res) => {
    const result = await sweepExpiredMultisport();
    await writeAudit(ctxFromReq(req), {
      action: "manual-trigger",
      collection: "benefits",
      extra: { trigger: "sweepExpiredMultisport", result },
    });
    res.json(result);
  }
);

app.post(
  "/employees/trigger-probation-refresh",
  requireAuth,
  requireRole("admin"),
  async (req: AuthRequest, res) => {
    const result = await refreshAllProbationAlerts();
    await writeAudit(ctxFromReq(req), {
      action: "manual-trigger",
      collection: "probationAlerts",
      extra: { trigger: "refreshAllProbationAlerts", result },
    });
    res.json(result);
  }
);

app.post(
  "/employees/trigger-alert-refresh",
  requireAuth,
  requireRole("admin"),
  async (req: AuthRequest, res) => {
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
    await writeAudit(ctxFromReq(req), {
      action: "manual-trigger",
      collection: "documentAlerts",
      extra: { trigger: "refreshDocumentAlerts", result: { refreshed } },
    });
    res.json({ refreshed });
  }
);

app.post(
  "/employees/trigger-effective-refresh",
  requireAuth,
  requireRole("admin"),
  async (req: AuthRequest, res) => {
    // Backfill the denormalized current* root fields by re-folding every active
    // employee's latest session. Mirrors the daily refreshEmployeeEffective job;
    // also repairs any record whose cache drifted (e.g. blanked by the old
    // raw-copy bug in PATCH/POST /employment).
    const result = await refreshEffectiveRootForAllActive();
    await writeAudit(ctxFromReq(req), {
      action: "manual-trigger",
      collection: "employees",
      extra: { trigger: "refreshEffectiveRootForAllActive", result },
    });
    res.json(result);
  }
);

// Catch-all error handler — turns a thrown error (or an explicit next(err))
// into a JSON 500 instead of letting the request hang with no response. Async
// handlers in Express 4 must still try/catch their own rejections to reach
// this (an un-awaited rejection won't); this is the safety net for synchronous
// throws and any handler that forwards via next(err).
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled route error:", err);
  if (res.headersSent) return;
  res.status(500).json({ error: (err as Error)?.message ?? "Internal server error" });
});

// Mount the app at both `/api` and `/`. Firebase Hosting rewrites the
// `/api/**` prefix through to the function verbatim, whereas the direct
// function URL and the Vite dev proxy deliver paths without it — mounting
// at both points makes every access path resolve to the same routes.
const root = express();
root.use("/api", app);
root.use("/", app);

// Bumped memory + timeout to fit Puppeteer's Chromium launch
// (~500 MB resident, ~3–5s cold start). Other endpoints share the
// same instance; the cost is amortised.
//
// ENCRYPTION_KEY is sourced from Google Secret Manager (not a .env file):
// declaring it here makes the secret a hard deploy requirement and injects
// it as process.env.ENCRYPTION_KEY at runtime. Only the `api` function
// decrypts (services/encryption.ts, used solely by routes/employees.ts);
// the scheduled functions never touch encrypted fields, so they don't need
// it. Local emulator still reads functions/.env unchanged.
export const api = functions
  .region(REGION)
  .runWith({ memory: "1GB", timeoutSeconds: 60, secrets: ["ENCRYPTION_KEY"] })
  .https.onRequest(root);

// ─── Scheduled function: auto-transition plans at their deadlines ─────────────
// Runs every 5 minutes in production. In the emulator, trigger manually via:
//   curl -X POST http://127.0.0.1:5002/hotel-hr-app-75581/europe-west3/api/shifts/trigger-deadlines

export const checkPlanDeadlines = onSchedule("every 5 minutes", async () => {
  await clock.refresh(true);
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
  await clock.refresh(true);
  await sweepExpiredMultisport();
});

// ─── Daily: refresh document expiry alerts for all employees ─────────────────

export const refreshProbationAlerts = onSchedule("every 24 hours", async () => {
  await clock.refresh(true);
  await refreshAllProbationAlerts();
});

// ─── Daily at midnight (Europe/Prague): refresh employees' effective root ────
// fields (date-aware Dodatky). A future-dated Dodatek flips position / úvazek /
// department (and thus the Zaměstnanci list + payroll contract type) on its
// validity date — recompute otherwise only runs on employment writes. Runs at
// 00:00 Prague time so the change shows from midnight, matching the frontend's
// live as-of-today effective state (TODO lines 16/18). The detail header is
// always live; this keeps the cached list/root in step at the day boundary.
export const refreshEmployeeEffective = onSchedule(
  { schedule: "0 0 * * *", timeZone: "Europe/Prague" },
  async () => {
    await clock.refresh(true);
    const res = await refreshEffectiveRootForAllActive();
    console.log(`[refreshEmployeeEffective] scanned ${res.scanned}, updated ${res.updated}`);
  }
);

export const refreshDocumentAlerts = onSchedule("every 24 hours", async () => {
  await clock.refresh(true);
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
