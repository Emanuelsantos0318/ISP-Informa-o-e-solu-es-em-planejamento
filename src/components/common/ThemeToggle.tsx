import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme/ThemeProvider";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const nextLabel =
    theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro";
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={nextLabel}
      title={nextLabel}
      onClick={toggleTheme}
    >
      {theme === "dark" ? (
        <Sun className="size-4" />
      ) : (
        <Moon className="size-4" />
      )}
    </Button>
  );
}
