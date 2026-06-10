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

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  // Guided-tour demo: serve mock fixtures (no backend, no Firestore) for the
  // sentinel demo employee and — while a demo route is mounted — the self /
  // payroll / shifts endpoints for the active scenario. See lib/tours/demoData.ts.
  const demo = getDemoResponse(method, path);
  if (demo.hit) return demo.value as T;

  const headers: Record<string, string> = {
    ...(await getAuthHeader()),
    "Content-Type": "application/json",
  };
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
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
  createdAt: unknown;
  lastLogin: unknown;
  /** Assigned user type (defaults to `role` when unset). */
  roleType?: string | null;
  /** Czech display name of the user's type (resolved server-side from roleType). */
  roleTypeName?: string | null;
  /** Per-user permission grants/revokes on top of the type. */
  extraPermissions?: string[];
  revokedPermissions?: string[];
}

export interface RoleType {
  id: string;
  name: string;
  permissions: string[];
  management: boolean;
  system: boolean;
}

export const roleTypesApi = {
  // Always alphabetical by name (cs) — every consumer (type dropdowns, the
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
