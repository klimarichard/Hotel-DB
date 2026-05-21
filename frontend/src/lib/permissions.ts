import type { UserRole } from "@/hooks/useAuth";

/**
 * Frontend capability helpers for the employee + contract surfaces. These only
 * drive which buttons/sections the UI shows; the backend enforces the same
 * rules independently (every endpoint is role-gated).
 *
 *   accountant — read-only viewer: sees ALL employees incl. sensitive reveal,
 *                views + downloads contracts, and can bulk-export. No editing.
 *   hr         — full employee + contract management, EXCEPT records of
 *                admin/director/manager users (enforced server-side: the list
 *                omits them and the detail/sub-resource endpoints 403).
 */
export const canViewEmployees = (r: UserRole | null): boolean =>
  r === "admin" || r === "director" || r === "hr" || r === "accountant";

export const canEditEmployees = (r: UserRole | null): boolean =>
  r === "admin" || r === "director" || r === "hr";

export const canRevealSensitive = (r: UserRole | null): boolean => canViewEmployees(r);
export const canExportEmployees = (r: UserRole | null): boolean => canViewEmployees(r);
export const canDownloadContracts = (r: UserRole | null): boolean => canViewEmployees(r);
export const canManageContracts = (r: UserRole | null): boolean => canEditEmployees(r);
export const canDeleteEmployees = (r: UserRole | null): boolean => canEditEmployees(r);
