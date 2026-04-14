import * as functions from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import express from "express";
import cors from "cors";

import { authRouter } from "./routes/auth";
import { employeesRouter } from "./routes/employees";
import { alertsRouter } from "./routes/alerts";
import { companiesRouter } from "./routes/companies";
import { contractTemplatesRouter } from "./routes/contractTemplates";
import { contractsRouter } from "./routes/contracts";
import { shiftsRouter } from "./routes/shifts";
import { vacationRouter } from "./routes/vacation";
import { transitionPlanDeadlines } from "./services/planTransitions";

admin.initializeApp();

const app = express();

app.use(cors({ origin: true }));
app.use(express.json());

// Routes
app.use("/auth", authRouter);
app.use("/employees", employeesRouter);
app.use("/alerts", alertsRouter);
app.use("/companies", companiesRouter);
app.use("/contractTemplates", contractTemplatesRouter);
app.use("/", contractsRouter);
app.use("/shifts", shiftsRouter);
app.use("/vacation", vacationRouter);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// HTTP trigger for manual/emulator testing of deadline transitions
app.post("/shifts/trigger-deadlines", async (_req, res) => {
  const result = await transitionPlanDeadlines();
  res.json(result);
});

export const api = functions.https.onRequest(app);

// ─── Scheduled function: auto-transition plans at their deadlines ─────────────
// Runs every 5 minutes in production. In the emulator, trigger manually via:
//   curl -X POST http://127.0.0.1:5002/hotel-hr-app-75581/us-central1/api/shifts/trigger-deadlines

export const checkPlanDeadlines = onSchedule("every 5 minutes", async () => {
  await transitionPlanDeadlines();
});
