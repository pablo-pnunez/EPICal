import { FilePen, FilePlus } from "lucide-react";
import { Link } from "react-router-dom";
import { ErrorBox, Loading } from "../components/Status";
import { getChanges, useAsync } from "../lib/api";
import type { ChangeItem } from "../types";

const DAY_FMT = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Madrid" });
const DAY_KEY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }); // aaaa-mm-dd
const TIME_FMT = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });

interface Change {
  at: string;
  item: ChangeItem;
}

interface Day {
  key: string;
  label: string;
  changes: Change[];
}

/** Aplana las ejecuciones y las agrupa por día (hora de Madrid), lo más reciente primero. */
function groupByDay(entries: Array<{ at: string; items: ChangeItem[] }>): Day[] {
  const days = new Map<string, Day>();
  for (const e of entries) {
    const d = new Date(e.at);
    const key = DAY_KEY.format(d);
    let day = days.get(key);
    if (!day) days.set(key, (day = { key, label: DAY_FMT.format(d), changes: [] }));
    for (const item of e.items) day.changes.push({ at: e.at, item });
  }
  return [...days.values()];
}

function itemLabel(it: ChangeItem): string {
  return [it.curso, it.semestre, it.grupo ? `grupo ${it.grupo}` : null].filter(Boolean).join(" · ");
}

function ChangeRow({ change }: { change: Change }) {
  const { item, at } = change;
  const isNew = item.kind === "new";
  const Icon = isNew ? FilePlus : FilePen;
  return (
    <li className="changelog__item">
      <span className={`changelog__dot${isNew ? " changelog__dot--new" : ""}`}>
        <Icon size={16} aria-hidden />
      </span>
      <div className="changelog__body">
        <p className="changelog__text">
          <Link to={`/grado/${item.gradoSlug}`}>{item.gradoNombre}</Link>
          <span className="muted"> {isNew ? "· horario nuevo" : "· horario actualizado"}</span>
        </p>
        <p className="changelog__what">
          <Link to={item.href}>{itemLabel(item)}</Link>
        </p>
        {item.detail?.length ? (
          <ul className="changelog__detail">
            {item.detail.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        ) : null}
        <time className="muted changelog__time" dateTime={at}>
          {TIME_FMT.format(new Date(at))}
        </time>
      </div>
    </li>
  );
}

export function ChangesPage() {
  const changes = useAsync(getChanges, []);
  const days = changes.data ? groupByDay(changes.data.entries) : [];
  return (
    <div className="changelog">
      <nav className="crumbs" aria-label="Ruta">
        <Link to="/">Inicio</Link> / <span>Cambios</span>
      </nav>
      <h1>Cambios en los horarios</h1>
      <p className="muted">Cada vez que la EPI publica un PDF distinto del que teníamos, se anota aquí. De momento solo se indica qué horario cambió, no qué clases.</p>
      {changes.error ? (
        <ErrorBox>{changes.error}</ErrorBox>
      ) : !changes.data ? (
        <Loading label="Cargando cambios…" />
      ) : days.length ? (
        days.map((day) => (
          <section key={day.key} className="panel changelog__day" aria-label={day.label}>
            <h2 className="changelog__date">{day.label}</h2>
            <ul className="changelog__list">
              {day.changes.map((c) => (
                <ChangeRow key={`${c.at}-${c.item.pdfId}-${c.item.href}`} change={c} />
              ))}
            </ul>
          </section>
        ))
      ) : (
        <p className="muted">Todavía no se ha detectado ningún cambio en los horarios.</p>
      )}
    </div>
  );
}
