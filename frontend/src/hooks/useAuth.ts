import { useState, useEffect } from "react";
import { User, onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { api } from "@/lib/api";

export type UserRole = "admin" | "director" | "manager" | "employee";

interface AuthState {
  user: User | null;
  role: UserRole | null;
  employeeId: string | null;
  loading: boolean;
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    user: null,
    role: null,
    employeeId: null,
    loading: true,
  });

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      if (user) {
        const tokenResult = await user.getIdTokenResult();
        const profile = await api
          .get<{ employeeId: string | null }>("/auth/me")
          .catch(() => ({ employeeId: null }));
        setState({
          user,
          role: (tokenResult.claims.role as UserRole) ?? null,
          employeeId: profile.employeeId ?? null,
          loading: false,
        });
      } else {
        setState({ user: null, role: null, employeeId: null, loading: false });
      }
    });
  }, []);

  return state;
}
