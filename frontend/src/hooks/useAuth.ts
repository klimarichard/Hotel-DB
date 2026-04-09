import { useState, useEffect } from "react";
import { User, onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";

export type UserRole = "admin" | "director" | "manager" | "employee";

interface AuthState {
  user: User | null;
  role: UserRole | null;
  loading: boolean;
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    user: null,
    role: null,
    loading: true,
  });

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      if (user) {
        const tokenResult = await user.getIdTokenResult();
        setState({
          user,
          role: (tokenResult.claims.role as UserRole) ?? null,
          loading: false,
        });
      } else {
        setState({ user: null, role: null, loading: false });
      }
    });
  }, []);

  return state;
}
