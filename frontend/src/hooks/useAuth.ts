import { useState, useEffect, useCallback } from "react";
import { User, onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { api } from "@/lib/api";
import { hasPermission, type Permission } from "@/lib/permissions/catalog";

export type UserRole = "admin" | "director" | "manager" | "employee" | "accountant";

interface AuthState {
  user: User | null;
  role: UserRole | null;
  /** The user's configurable type id (roleType). For built-in types this equals
   *  the legacy role name ("employee", "manager", …). Null when unset. Prefer
   *  this over `role` – type-based users created post-RBAC carry no role claim. */
  roleType: string | null;
  employeeId: string | null;
  /** Display name from users/{uid}.name (via /auth/me); null when unset. */
  name: string | null;
  /** Display name of the user's type (roleType), for the sidebar label. */
  roleTypeName: string | null;
  /** Effective permission set from /auth/me (resolved server-side from role). */
  permissions: ReadonlySet<string>;
  loading: boolean;
}

const EMPTY_PERMS: ReadonlySet<string> = new Set();

export interface AuthValue extends AuthState {
  /**
   * Permission check – the frontend mirror of the backend gate. Honours the
   * system.admin superuser key. Use this to show/hide UI; the backend enforces
   * the same permission independently on every endpoint.
   */
  can: (perm: Permission) => boolean;
}

export function useAuth(): AuthValue {
  const [state, setState] = useState<AuthState>({
    user: null,
    role: null,
    roleType: null,
    employeeId: null,
    name: null,
    roleTypeName: null,
    permissions: EMPTY_PERMS,
    loading: true,
  });

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      if (user) {
        const tokenResult = await user.getIdTokenResult();
        const profile = await api
          .get<{ employeeId: string | null; name?: string | null; permissions?: string[]; roleTypeName?: string | null; roleType?: string | null }>("/auth/me")
          .catch(() => ({ employeeId: null, name: null, permissions: [] as string[], roleTypeName: null, roleType: null }));
        setState({
          user,
          role: (tokenResult.claims.role as UserRole) ?? null,
          roleType: profile.roleType ?? null,
          employeeId: profile.employeeId ?? null,
          name: profile.name ?? null,
          roleTypeName: profile.roleTypeName ?? null,
          permissions: new Set(profile.permissions ?? []),
          loading: false,
        });
      } else {
        setState({ user: null, role: null, roleType: null, employeeId: null, name: null, roleTypeName: null, permissions: EMPTY_PERMS, loading: false });
      }
    });
  }, []);

  // Stable across renders; changes identity only when the permission set does.
  const can = useCallback(
    (perm: Permission) => hasPermission(state.permissions, perm),
    [state.permissions]
  );

  return { ...state, can };
}
