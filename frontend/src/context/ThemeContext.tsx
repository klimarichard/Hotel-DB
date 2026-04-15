import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";

type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const storageKey = user ? `hotel_hr_theme_${user.uid}` : null;

  const [theme, setTheme] = useState<Theme>("light");

  // Load the user's saved preference whenever the logged-in user changes
  useEffect(() => {
    if (!storageKey) {
      setTheme("light");
      return;
    }
    const saved = localStorage.getItem(storageKey);
    setTheme(saved === "dark" ? "dark" : "light");
  }, [storageKey]);

  // Apply the theme attribute to <html> so CSS variables take effect
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((prev) => {
      const next = prev === "light" ? "dark" : "light";
      if (storageKey) localStorage.setItem(storageKey, next);
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
