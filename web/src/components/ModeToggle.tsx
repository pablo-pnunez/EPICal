import type { Mode } from "../lib/selection";

/** Conmutador Profesor | Alumno (se pinta en la barra superior, ver SchedulePage). */
export function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  return (
    <div className="segmented" role="group" aria-label="Modo de selección de grupos">
      <button type="button" className={mode === "profesor" ? "on" : ""} aria-pressed={mode === "profesor"} onClick={() => onChange("profesor")} title="Marca los grupos que quieras, varios por tipo">
        Profesor
      </button>
      <button type="button" className={mode === "alumno" ? "on" : ""} aria-pressed={mode === "alumno"} onClick={() => onChange("alumno")} title="Un único grupo de cada tipo (el tuyo)">
        Alumno
      </button>
    </div>
  );
}
