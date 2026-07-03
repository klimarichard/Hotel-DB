/**
 * User deactivation — shared core + the scheduled auto-deactivation sweep.
 *
 * An admin can either deactivate a user immediately or schedule it for a future
 * instant (stored as `scheduledDeactivationAt` on `users/{uid}`). The scheduled
 * function runScheduledDeactivations() runs every few minutes, finds accounts
 * whose scheduled time has passed, and deactivates them via the same core path
 * as the immediate endpoint — so both routes disable Auth, revoke tokens, flip
 * `active`, and audit-log identically. The only difference is the audit actor:
 * a human admin for the immediate path, SYSTEM_CONTEXT ("Systém") for the job.
 */
import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { AuditContext, SYSTEM_CONTEXT, logUpdate } from "./auditLog";
import * as clock from "./clock";

/**
 * Core deactivation, shared by the immediate endpoint and the scheduled job.
 * Disables the Auth account, revokes refresh tokens, flips
 * users/{uid}.active to false, and clears any pending schedule so a lingering
 * timestamp can't re-fire. Audit-logs the active flip under the given context.
 */
export async function deactivateUserCore(uid: string, ctx: AuditContext): Promise<void> {
  await admin.auth().updateUser(uid, { disabled: true });
  // Revoke refresh tokens so the disabled account can't silently refresh into
  // a new session. The user's CURRENT ID token still verifies until it expires
  // (≤1h); checkRevoked is intentionally left off to avoid a per-request lookup.
  await admin.auth().revokeRefreshTokens(uid);
  await admin.firestore().collection("users").doc(uid).update({
    active: false,
    scheduledDeactivationAt: null,
    scheduledDeactivationBy: null,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await logUpdate(ctx, {
    collection: "users",
    resourceId: uid,
    before: { active: true },
    after: { active: false },
  });
}

export interface ScheduledDeactivationResult {
  scanned: number;
  deactivated: number;
}

/**
 * Sweep: deactivate every account whose `scheduledDeactivationAt` has passed.
 *
 * Uses a single-field range query (`scheduledDeactivationAt <= now`), which
 * needs no composite index — accounts without the field are absent from the
 * index and skipped for free. `active === true` is re-checked in memory (a
 * manually-deactivated account keeps a stale timestamp only until the next
 * write clears it). The comparison uses clock.now() so the test clock can
 * fast-forward the sweep in non-prod.
 */
export async function runScheduledDeactivations(): Promise<ScheduledDeactivationResult> {
  await clock.refresh(true);
  const cutoff = Timestamp.fromDate(clock.now());
  const snap = await admin
    .firestore()
    .collection("users")
    .where("scheduledDeactivationAt", "<=", cutoff)
    .get();

  let deactivated = 0;
  for (const doc of snap.docs) {
    // Skip anything already inactive (stale timestamp on a manually-disabled
    // account) — deactivateUserCore would otherwise log a spurious active flip.
    if (doc.get("active") !== true) continue;
    await deactivateUserCore(doc.id, SYSTEM_CONTEXT);
    deactivated++;
  }
  return { scanned: snap.size, deactivated };
}
