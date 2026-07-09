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
import { roleTypesRouter } from "./routes/roleTypes";
import { handoversRouter } from "./routes/handovers";
import { handoverWarningsRouter } from "./routes/handoverWarnings";
import { walkinsRouter } from "./routes/walkins";
import { taxiRouter } from "./routes/taxi";
import * as clock from "./services/clock";
import { requireAuth, AuthRequest } from "./middleware/auth";
import { requirePermission } from "./auth/permissions";
import { writeAudit, ctxFromReq } from "./services/auditLog";
import { transitionPlanDeadlines } from "./services/planTransitions";
import { createOrUpdatePayrollPeriod } from "./services/payrollCalculator";
import { sweepExpiredMultisport } from "./services/multisportSweep";
import { updateDocumentAlerts, EXPIRY_FIELDS } from "./routes/employees";
import { refreshAllProbationAlerts } from "./services/probationAlerts";
import { runScheduledDeactivations } from "./services/userDeactivation";
import { sweepRecepceRetention } from "./services/recepceRetention";

// All functions run in europe-west3 to co-locate with the Firestore
// database — avoids cross-region latency on every read/write.
const REGION = "europe-west3";
setGlobalOptions({ region: REGION }); // applies to the v2 onSchedule functions

admin.initializeApp();

const app = express();

// CORS: the SPA calls /api through a same-origin Hosting rewrite, so normal
// traffic carries no Origin header (allowed below). Genuine cross-origin browser
// calls are restricted to the known app domains + localhost dev — defense in
// depth on top of the Firebase ID-token check every route already enforces.
const ALLOWED_ORIGIN_PATTERNS = [
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
  /^https:\/\/hotel-hr-app-75581\.web\.app$/,
  /^https:\/\/hotel-hr-app-75581\.firebaseapp\.com$/,
  /^https:\/\/hote-hr-app-staging\.web\.app$/,
  /^https:\/\/hote-hr-app-staging\.firebaseapp\.com$/,
];
app.use(
  cors({
    origin(origin, cb) {
      // No Origin = same-origin (Hosting rewrite), curl, or server-to-server.
      if (!origin || ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(origin))) {
        cb(null, true);
      } else {
        cb(null, false);
      }
    },
  })
);
// 10mb covers contract PDFs that contain embedded base64 images
// (logos, scanned signatures). Base64-encoded blob is ~33% larger
// than the raw PDF, so a 3 MB PDF lands around 4 MB of JSON body.
app.use(express.json({ limit: "10mb" }));

// API responses are dynamic and per-user — never let a cache store them. Crucially
// this stops the Fastly CDN that Firebase Hosting puts in front of the function
// from caching responses (notably 404s, which were then served stale so a
// just-created record looked non-existent — even in incognito, since the CDN
// cache is shared/server-side). Firebase Hosting's firebase.json `headers` config
// does NOT apply to function-rewrite responses, so it must be set here.
app.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

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
app.use("/role-types", roleTypesRouter);
app.use("/handovers", handoversRouter);
app.use("/handover-warnings", handoverWarningsRouter);
app.use("/walkins", walkinsRouter);
app.use("/taxi", taxiRouter);

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
  requirePermission("system.triggers"),
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
  requirePermission("system.triggers"),
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
  requirePermission("system.triggers"),
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
  requirePermission("system.triggers"),
  async (req: AuthRequest, res) => {
    const db = admin.firestore();
    const employeesSnap = await db.collection("employees").get();
    let refreshed = 0;
    for (const empDoc of employeesSnap.docs) {
      const emp = empDoc.data() as Record<string, unknown>;
      const docsSnap = await empDoc.ref.collection("documents").limit(1).get();
      if (docsSnap.empty) continue;
      const docData = docsSnap.docs[0].data() as Record<string, unknown>;
      // Terminated employees get an all-null body → their alerts are deleted.
      // Active and before-start employees keep their document-expiry alerts.
      const terminated = emp.status === "terminated";
      const alertBody: Record<string, unknown> = {};
      for (const { field } of EXPIRY_FIELDS) alertBody[field] = terminated ? null : (docData[field] ?? null);
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
  requirePermission("system.triggers"),
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

app.post(
  "/users/trigger-scheduled-deactivations",
  requireAuth,
  requirePermission("system.triggers"),
  async (req: AuthRequest, res) => {
    const result = await runScheduledDeactivations();
    await writeAudit(ctxFromReq(req), {
      action: "manual-trigger",
      collection: "users",
      extra: { trigger: "runScheduledDeactivations", result },
    });
    res.json(result);
  }
);

app.post(
  "/recepce/trigger-retention-sweep",
  requireAuth,
  requirePermission("system.triggers"),
  async (req: AuthRequest, res) => {
    await clock.refresh(true);
    const result = await sweepRecepceRetention();
    await writeAudit(ctxFromReq(req), {
      action: "manual-trigger",
      collection: "auditLog",
      extra: { trigger: "sweepRecepceRetention", result },
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

// ─── Scheduled function: fire due user auto-deactivations ────────────────────
// Runs every 5 minutes, so a scheduled deactivation takes effect within ~5 min
// of the chosen time. In the emulator, trigger manually via:
//   curl -X POST http://127.0.0.1:5002/.../api/users/trigger-scheduled-deactivations
export const checkScheduledDeactivations = onSchedule("every 5 minutes", async () => {
  const result = await runScheduledDeactivations();
  if (result.deactivated) {
    console.log(`[checkScheduledDeactivations] deactivated ${result.deactivated} of ${result.scanned} due`);
  }
});

// ─── Daily: refresh document expiry alerts for all employees ─────────────────
// Proactively re-checks passport / visa expiry for every employee so that
// alerts appear automatically when a deadline enters the 30-day window,
// without requiring the admin to re-save the employee form.

// ─── Daily: refresh payroll for all published shift plans ─────────────────────
// Picks up any shift edits made after publishing. In the emulator, trigger via:
//   curl -X POST http://127.0.0.1:5002/.../api/payroll/trigger

export const refreshPayroll = onSchedule("every 24 hours", async () => {
  await clock.refresh(true);
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

// ─── Daily at midnight (Europe/Prague): sweep recepce history > 6 months ──────
// Deletes the change history (auditLog for shiftHandovers/walkins/taxiRides +
// the per-protocol history subcollections) once it's 6 months or older. Never
// touches the live tables. Trigger manually via:
//   curl -X POST http://127.0.0.1:5002/.../api/recepce/trigger-retention-sweep
export const sweepRecepceHistory = onSchedule(
  { schedule: "0 0 * * *", timeZone: "Europe/Prague" },
  async () => {
    await clock.refresh(true);
    const res = await sweepRecepceRetention();
    console.log(
      `[sweepRecepceHistory] cutoff ${res.cutoffISO}: deleted ${res.auditDeleted} audit + ${res.historyDeleted} history`
    );
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

    // Build a body-like object containing only the expiry fields. Terminated
    // employees get an all-null body so updateDocumentAlerts deletes any existing
    // alerts and creates none. Active AND before-start (upcoming) employees still
    // get document-expiry alerts.
    const terminated = emp.status === "terminated";
    const alertBody: Record<string, unknown> = {};
    for (const { field } of EXPIRY_FIELDS) {
      alertBody[field] = terminated ? null : (docData[field] ?? null);
    }

    await updateDocumentAlerts(
      empDoc.id,
      emp.firstName as string ?? "",
      emp.lastName as string ?? "",
      alertBody
    );
  }
});
