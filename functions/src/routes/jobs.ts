import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../auth/permissions";
import { listJobHealth, isAlerting, OVERDUE_FACTOR } from "../services/jobRuns";

/**
 * Health of the scheduled maintenance jobs, for Upozornění → Úlohy.
 *
 * Gated on `system.triggers` — the same key that gates Nastavení → Úlohy and the
 * manual re-run buttons. Deliberately no new permission: whoever may re-run a job
 * by hand is exactly who needs to know it failed, and the response carries no
 * employee data, only job names, timestamps and error text.
 *
 * Read-only. The health rule (error, or no success within 1.5 × the schedule)
 * lives server-side in services/jobRuns.ts so the tab cannot drift from it.
 */
export const jobsRouter = Router();

// GET /api/jobs — every scheduled job with its last outcome and computed health.
jobsRouter.get(
  "/",
  requireAuth,
  requirePermission("system.triggers"),
  async (_req, res) => {
    const jobs = await listJobHealth();
    res.json({
      jobs,
      alertCount: jobs.filter((j) => isAlerting(j.health)).length,
      overdueFactor: OVERDUE_FACTOR,
    });
  }
);

// GET /api/jobs/alert-count — badge count only (failing + overdue).
//
// Split from GET / for the same reason as /handover-warnings/unread-count: the
// sidebar badge polls this every 60s on every navigation, and it must not pull
// the full job list (with error stacks) to render a number.
jobsRouter.get(
  "/alert-count",
  requireAuth,
  requirePermission("system.triggers"),
  async (_req, res) => {
    const jobs = await listJobHealth();
    res.json({ count: jobs.filter((j) => isAlerting(j.health)).length });
  }
);
