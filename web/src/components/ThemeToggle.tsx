import { Moon, Sun } from "lucide-react";
import { useState } from "react";
import { getTheme, saveTheme, type Theme } from "../lib/theme";

/** Botón sol/luna de la barra superior: alterna entre tema claro y oscuro (se recuerda en este navegador). */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getTheme);
  const next: Theme = theme === "light" ? "dark" : "light";
  return (
    <button
      type="button"
      className="secondary icon-button theme-toggle"
      onClick={() => {
        saveTheme(next);
        setTheme(next);
      }}
      aria-label={next === "dark" ? "Cambiar a tema oscuro" : "Cambiar a tema claro"}
      title={next === "dark" ? "Tema oscuro" : "Tema claro"}
    >
      {theme === "light" ? <Moon size={16} aria-hidden /> : <Sun size={16} aria-hidden />}
    </button>
  );
}
