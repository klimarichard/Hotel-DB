import * as admin from "firebase-admin";
import { Request, Response, NextFunction } from "express";
import { resolveEffectivePermissions } from "../auth/permissions";

export interface AuthRequest extends Request {
  uid?: string;
  /** Configurable user-type id from the `roleType` claim. */
  roleType?: string;
  userEmail?: string;
  /** Effective permission set resolved from the token claim (roleType + per-user
   *  overrides), attached by requireAuth. requirePermission checks against this. */
  permissions?: Set<string>;
}

/**
 * Verifies the Firebase ID token from the Authorization header and attaches
 * uid + roleType + email + resolved permissions. Returns 401 on failure.
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
      req.roleType = typeof decoded.roleType === "string" ? decoded.roleType : undefined;
      req.userEmail = decoded.email ?? "";
      // Resolve the effective permission set once per request from the claim:
      // the configurable user-type id + per-user grants/revokes.
      req.permissions = await resolveEffectivePermissions({
        roleType: req.roleType,
        extra: Array.isArray(decoded.extraPermissions) ? (decoded.extraPermissions as string[]) : [],
        revoked: Array.isArray(decoded.revokedPermissions) ? (decoded.revokedPermissions as string[]) : [],
      });
      next();
    })
    .catch(() => {
      res.status(401).json({ error: "Invalid or expired token" });
    });
}
