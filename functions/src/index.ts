import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import express from "express";
import cors from "cors";

import { authRouter } from "./routes/auth";
import { employeesRouter } from "./routes/employees";
import { alertsRouter } from "./routes/alerts";
import { companiesRouter } from "./routes/companies";
import { contractTemplatesRouter } from "./routes/contractTemplates";
import { contractsRouter } from "./routes/contracts";

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

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

export const api = functions.https.onRequest(app);
