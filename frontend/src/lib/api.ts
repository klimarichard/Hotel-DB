import { auth } from "./firebase";
import { getDemoResponse } from "@/lib/tours/demoData";

const BASE_URL = "/api";

async function getAuthHeader(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated");
  const token = await user.getIdToken();
  return { Authorization: `Bearer ${token}` };
}

/**
 * Error thrown by the api helper on a non-2xx response. Carries the HTTP
 * status and the parsed JSON body so callers can branch on structured
 * error payloads (e.g. 409 shift-collision details) instead of relying on
 * the message string.
 */
export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Maps any error from the api helper to a user-facing message.
 *
 * For **403** we deliberately show a generic permission message instead of the
 * backend's concern-specific string: that string can belong to an unrelated
 * endpoint (a misrouted/global guard), which is exactly how a contracts-guard
 * message once surfaced on the vacation form. The raw error is logged so the
 * real reason stays diagnosable. 401 maps to a re-login hint. For other statuses
 * the backend message is normally action-appropriate, so it is used when
 * present; `fallback` covers the no-message case.
 */
export function errorMessage(err: unknown, fallback = "Operace se nezdařila."): string {
  if (err instanceof ApiError) {
    if (err.status === 403) {
      console.error("[api] 403 Forbidden:", err.message, err.body);
      return "K této akci nemáte oprávnění.";
    }
    if (err.status === 401) return "Vaše přihlášení vypršelo. Přihlaste se prosím znovu.";
    return err.message || fallback;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  // Guided-tour demo: serve mock fixtures (no backend, no Firestore) for the
  // sentinel demo employee and – while a demo route is mounted – the self /
  // payroll / shifts / recepce endpoints for the active scenario. See
  // lib/tours/demoData.ts. A `status >= 400` means the fixture wants to simulate
  // an error response (e.g. a 404 so the protokol "empty → create" state renders).
  const demo = getDemoResponse(method, path);
  if (demo.hit) {
    if (typeof demo.status === "number" && demo.status >= 400) {
      throw new ApiError(demo.status, { error: "demo" }, "demo");
    }
    return demo.value as T;
  }

  const headers: Record<string, string> = {
    ...(await getAuthHeader()),
    "Content-Type": "application/json",
  };
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    // Never read from / write to the browser HTTP cache. API responses are
    // dynamic; without this the browser can serve a stale response for a URL
    // (notably a 404 cached before a doc was created, which then makes a
    // just-created record look like it doesn't exist).
    cache: "no-store",
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: res.statusText }));
    const message =
      (errBody && typeof errBody === "object" && "error" in errBody
        ? String((errBody as { error?: unknown }).error)
        : "") || res.statusText;
    throw new ApiError(res.status, errBody, message);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};

// ---- Auth helpers --------------------------------------------------------

import type { UserRole } from "@/hooks/useAuth";

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  employeeId: string | null;
  /** Surname-first name of the linked employee (resolved server-side; null if none). */
  employeeName?: string | null;
  createdAt: unknown;
  lastLogin: unknown;
  /** Assigned user type (defaults to `role` when unset). */
  roleType?: string | null;
  /** Czech display name of the user's type (resolved server-side from roleType). */
  roleTypeName?: string | null;
  /** Per-user permission grants/revokes on top of the type. */
  extraPermissions?: string[];
  revokedPermissions?: string[];
  /** ISO instant of a pending scheduled auto-deactivation, or null if none. */
  scheduledDeactivationAt?: string | null;
}

export interface RoleType {
  id: string;
  name: string;
  permissions: string[];
  management: boolean;
  system: boolean;
}

export const roleTypesApi = {
  // Always alphabetical by name (cs) – every consumer (type dropdowns, the
  // user-types list, menu-order cards) expects the same ordering.
  list: () =>
    api
      .get<RoleType[]>("/role-types")
      .then((l) => [...l].sort((a, b) => a.name.localeCompare(b.name, "cs"))),
  create: (body: { name: string; permissions?: string[]; management?: boolean; cloneFrom?: string }) =>
    api.post<{ id: string }>("/role-types", body),
  update: (id: string, body: { name?: string; permissions?: string[]; management?: boolean }) =>
    api.patch<{ ok: boolean }>(`/role-types/${id}`, body),
  remove: (id: string) => api.delete<{ ok: boolean }>(`/role-types/${id}`),
};

export const authApi = {
  listUsers: () => api.get<UserProfile[]>("/auth/users"),
  // password optional: omit to create the account without one and get back a
  // reset link the admin can send (resetLink is null only if link generation failed).
  createUser: (body: { email: string; password?: string; name: string; roleType: string; employeeId?: string }) =>
    api.post<{ uid: string; resetLink: string | null }>("/auth/create-user", body),
  updateUser: (uid: string, body: { name?: string; email?: string }) =>
    api.patch<{ success: boolean }>(`/auth/users/${uid}`, body),
  deactivateUser: (uid: string) =>
    api.patch<{ success: boolean }>(`/auth/deactivate-user/${uid}`, {}),
  /** Schedule an automatic deactivation for a future instant (ISO string). */
  scheduleDeactivation: (uid: string, at: string) =>
    api.patch<{ success: boolean; scheduledDeactivationAt: string }>(
      `/auth/schedule-deactivation/${uid}`,
      { at }
    ),
  /** Clear a pending scheduled deactivation. */
  cancelScheduledDeactivation: (uid: string) =>
    api.patch<{ success: boolean }>(`/auth/cancel-scheduled-deactivation/${uid}`, {}),
  reactivateUser: (uid: string) =>
    api.patch<{ success: boolean }>(`/auth/reactivate-user/${uid}`, {}),
  linkEmployee: (uid: string, employeeId: string | null) =>
    api.patch<{ success: boolean }>(`/auth/users/${uid}/employee`, { employeeId }),
  setUserPermissions: (
    uid: string,
    body: { roleType?: string | null; extraPermissions?: string[]; revokedPermissions?: string[] }
  ) => api.patch<{ success: boolean }>(`/auth/users/${uid}/permissions`, body),
  me: () => api.get<UserProfile>("/auth/me"),
  getTheme: () => api.get<{ theme: "light" | "dark" | null }>("/auth/me/theme"),
  setTheme: (theme: "light" | "dark") =>
    api.put<{ theme: "light" | "dark" }>("/auth/me/theme", { theme }),
  getTours: () => api.get<{ toursSeen: Record<string, number> }>("/auth/me/tours"),
  markTourSeen: (tourId: string, version: number) =>
    api.put<{ ok: boolean }>("/auth/me/tours", { tourId, version }),
};
