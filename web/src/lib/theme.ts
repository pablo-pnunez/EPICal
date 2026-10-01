export type Theme = "light" | "dark";

const KEY = "epical-theme";

/** Tema guardado en este navegador; claro por defecto (no se sigue el modo del sistema operativo). */
export function getTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light"; // almacenamiento bloqueado (modo privado, etc.)
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function saveTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* sin persistencia: el cambio vale sólo para esta visita */
  }
}
