import { auth } from "./firebase";

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
}

export const authApi = {
  listUsers: () => api.get<UserProfile[]>("/auth/users"),
  createUser: (body: { email: string; password: string; name: string; role: UserRole; employeeId?: string }) =>
    api.post<{ uid: string }>("/auth/create-user", body),
  setRole: (uid: string, role: UserRole) =>
    api.post<{ success: boolean }>("/auth/set-role", { uid, role }),
  deactivateUser: (uid: string) =>
    api.patch<{ success: boolean }>(`/auth/deactivate-user/${uid}`, {}),
  reactivateUser: (uid: string) =>
    api.patch<{ success: boolean }>(`/auth/reactivate-user/${uid}`, {}),
  linkEmployee: (uid: string, employeeId: string | null) =>
    api.patch<{ success: boolean }>(`/auth/users/${uid}/employee`, { employeeId }),
  me: () => api.get<UserProfile>("/auth/me"),
  getTheme: () => api.get<{ theme: "light" | "dark" | null }>("/auth/me/theme"),
  setTheme: (theme: "light" | "dark") =>
    api.put<{ theme: "light" | "dark" }>("/auth/me/theme", { theme }),
};
