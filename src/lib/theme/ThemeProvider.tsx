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

function storedTheme(): Theme | null {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "dark" || stored === "light" ? stored : null;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { client, profile, ready } = useAuth();
  const [theme, setTheme] = useState<Theme>(() => storedTheme() ?? "light");
  const [preferenceLoaded, setPreferenceLoaded] = useState(false);

  useEffect(() => {
    // Carrega a preferência do perfil apenas quando ainda não há escolha local.
    if (!ready) return;
    const localTheme = storedTheme();
    if (localTheme) setTheme(localTheme);
    else if (profile?.theme_preference) setTheme(profile.theme_preference);
    setPreferenceLoaded(true);
  }, [ready, profile?.theme_preference, profile?.user_id]);

  useEffect(() => {
    if (!preferenceLoaded) return;
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [preferenceLoaded, theme]);

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
