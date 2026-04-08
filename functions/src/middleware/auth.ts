import * as admin from "firebase-admin";
import { Request, Response, NextFunction } from "express";

export type UserRole = "admin" | "hr" | "manager" | "receptionist";

export interface AuthRequest extends Request {
  uid?: string;
  role?: UserRole;
}

/**
 * Verifies the Firebase ID token from the Authorization header and
 * attaches uid + role to the request. Returns 401/403 on failure.
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
    .then((decoded) => {
      req.uid = decoded.uid;
      req.role = (decoded.role as UserRole) ?? undefined;
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
