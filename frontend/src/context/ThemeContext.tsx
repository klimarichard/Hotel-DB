import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { authApi } from "@/lib/api";

type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const GUEST_THEME_KEY = "hotel_hr_theme_guest";

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const storageKey = user ? `hotel_hr_theme_${user.uid}` : null;

  const [theme, setTheme] = useState<Theme>(() => {
    const guestSaved = localStorage.getItem(GUEST_THEME_KEY);
    return guestSaved === "light" ? "light" : "dark";
  });

  // On login, seed from the localStorage cache to avoid a flash, then fetch
  // the authoritative preference from the backend (Firestore via Cloud Function).
  useEffect(() => {
    if (!storageKey || !user) {
      const guestSaved = localStorage.getItem(GUEST_THEME_KEY);
      setTheme(guestSaved === "light" ? "light" : "dark");
      return;
    }

    const cached = localStorage.getItem(storageKey);
    if (cached === "light" || cached === "dark") {
      setTheme(cached);
    }

    let cancelled = false;
    authApi
      .getTheme()
      .then(({ theme: remote }) => {
        if (cancelled) return;
        if (remote === "light" || remote === "dark") {
          setTheme(remote);
          localStorage.setItem(storageKey, remote);
        }
      })
      .catch((e) => console.error("Failed to load theme:", e));
    return () => {
      cancelled = true;
    };
  }, [storageKey, user]);

  // Apply the theme attribute to <html> so CSS variables take effect
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((prev) => {
      const next = prev === "light" ? "dark" : "light";
      if (storageKey && user) {
        localStorage.setItem(storageKey, next);
        authApi
          .setTheme(next)
          .catch((e) => console.error("Failed to persist theme:", e));
      } else {
        localStorage.setItem(GUEST_THEME_KEY, next);
      }
      return next;
    });
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
