import { useState, useEffect } from "react";
import { User, onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { api } from "@/lib/api";

export type UserRole = "admin" | "director" | "manager" | "employee" | "accountant" | "hr";

interface AuthState {
  user: User | null;
  role: UserRole | null;
  employeeId: string | null;
  /** Display name from users/{uid}.name (via /auth/me); null when unset. */
  name: string | null;
  loading: boolean;
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    user: null,
    role: null,
    employeeId: null,
    name: null,
    loading: true,
  });

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      if (user) {
        const tokenResult = await user.getIdTokenResult();
        const profile = await api
          .get<{ employeeId: string | null; name?: string | null }>("/auth/me")
          .catch(() => ({ employeeId: null, name: null }));
        setState({
          user,
          role: (tokenResult.claims.role as UserRole) ?? null,
          employeeId: profile.employeeId ?? null,
          name: profile.name ?? null,
          loading: false,
        });
      } else {
        setState({ user: null, role: null, employeeId: null, name: null, loading: false });
      }
    });
  }, []);

  return state;
}
