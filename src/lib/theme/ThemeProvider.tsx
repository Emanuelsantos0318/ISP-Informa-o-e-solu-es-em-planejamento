import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/lib/supabase/AuthProvider";

type Theme = "light" | "dark";
type ThemeContextValue = { theme: Theme; toggleTheme: () => void };
const STORAGE_KEY = "isp.theme";
const ThemeContext = createContext<ThemeContextValue | null>(null);

function storedTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return window.localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { client, profile } = useAuth();
  const [theme, setTheme] = useState<Theme>(storedTheme);

  useEffect(() => {
    if (profile?.theme_preference) {
      setTheme(profile.theme_preference);
      window.localStorage.setItem(STORAGE_KEY, profile.theme_preference);
    }
  }, [profile?.theme_preference, profile?.user_id]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    if (client && profile) {
      void client.rpc("set_own_theme_preference", { p_theme: next });
    }
  }, [client, profile, theme]);

  const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme]);
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value)
    throw new Error("useTheme deve ser usado dentro de ThemeProvider.");
  return value;
}
