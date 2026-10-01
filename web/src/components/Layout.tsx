import { CalendarDays } from "lucide-react";
import { Link, Outlet } from "react-router-dom";
import { getStatus, useAsync } from "../lib/api";
import { ThemeToggle } from "./ThemeToggle";

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `hace ${mins} min`;
  const h = Math.round(mins / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

export function Layout() {
  const status = useAsync(getStatus, []);
  const last = status.data?.lastSuccessAt;
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          <CalendarDays size={22} aria-hidden />
          <span>EPIcal</span>
        </Link>
        <span className="topbar__tag">Horarios de la EPI Gijón</span>
        <ThemeToggle />
      </header>
      <main className="content">
        <Outlet />
      </main>
      <footer className="footer">
        <p>
          Datos extraídos de los PDF oficiales de{" "}
          <a href="https://epigijon.uniovi.es/infoacademica/grados" target="_blank" rel="noreferrer">
            epigijon.uniovi.es
          </a>
          {last ? <> · revisados {ago(last)}</> : null}. Proyecto no oficial.
        </p>
      </footer>
    </div>
  );
}
