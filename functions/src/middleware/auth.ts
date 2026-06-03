import * as admin from "firebase-admin";
import { Request, Response, NextFunction } from "express";
import { resolveEffectivePermissions } from "../auth/permissions";

export type UserRole = "admin" | "director" | "manager" | "employee" | "accountant" | "hr";

export interface AuthRequest extends Request {
  uid?: string;
  role?: UserRole;
  userEmail?: string;
  /** Effective permission set resolved from the token claim (roleType + per-user
   *  overrides), attached by requireAuth. requirePermission checks against this. */
  permissions?: Set<string>;
}

/**
 * Verifies the Firebase ID token from the Authorization header and
 * attaches uid + role + email to the request. Returns 401/403 on failure.
 */
export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const idToken = authHeader.split("Bearer ")[1];
  admin
    .auth()
    .verifyIdToken(idToken)
    .then(async (decoded) => {
      req.uid = decoded.uid;
      req.role = (decoded.role as UserRole) ?? undefined;
      req.userEmail = decoded.email ?? "";
      // Resolve the effective permission set once per request from the claim.
      // roleType + per-user grants/revokes are optional claims (Phase 5); legacy
      // accounts carry only `role`, which defaults roleType to the role id.
      req.permissions = await resolveEffectivePermissions({
        role: req.role,
        roleType: typeof decoded.roleType === "string" ? decoded.roleType : undefined,
        extra: Array.isArray(decoded.extraPermissions) ? (decoded.extraPermissions as string[]) : [],
        revoked: Array.isArray(decoded.revokedPermissions) ? (decoded.revokedPermissions as string[]) : [],
      });
      next();
    })
    .catch(() => {
      res.status(401).json({ error: "Invalid or expired token" });
    });
}

/**
 * Middleware factory — restricts access to one or more roles.
 * Call requireAuth first, then requireRole(...).
 */
export function requireRole(...roles: UserRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.role || !roles.includes(req.role)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}
