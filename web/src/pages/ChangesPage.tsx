import { CalendarPlus, FilePen, FilePlus } from "lucide-react";
import { Link } from "react-router-dom";
import { ErrorBox, Loading } from "../components/Status";
import { getChanges, useAsync } from "../lib/api";
import type { ChangeEntry, ChangeItem, NewCourse } from "../types";

const DAY_FMT = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Madrid" });
const DAY_KEY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }); // aaaa-mm-dd
const TIME_FMT = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });

type Change = { at: string; item: ChangeItem } | { at: string; course: string; grados: NewCourse[] };

interface Day {
  key: string;
  label: string;
  changes: Change[];
}

/** "2027-2028" -> "2027-28" */
function shortYear(year: string): string {
  return year.replace(/^(\d{4})-\d{2}(\d{2})$/, "$1-$2");
}

/** Los grados que estrenan curso, agrupados por curso académico (normalmente uno solo). */
function courseChanges(e: ChangeEntry): Change[] {
  const byYear = new Map<string, NewCourse[]>();
  for (const n of e.newCourses ?? []) byYear.set(n.academicYear, [...(byYear.get(n.academicYear) ?? []), n]);
  return [...byYear].map(([course, grados]) => ({ at: e.at, course, grados }));
}

/** Aplana las ejecuciones y las agrupa por día (hora de Madrid), lo más reciente primero. */
function groupByDay(entries: ChangeEntry[]): Day[] {
  const days = new Map<string, Day>();
  for (const e of entries) {
    const d = new Date(e.at);
    const key = DAY_KEY.format(d);
    let day = days.get(key);
    if (!day) days.set(key, (day = { key, label: DAY_FMT.format(d), changes: [] }));
    day.changes.push(...courseChanges(e));
    for (const item of e.items) day.changes.push({ at: e.at, item });
  }
  return [...days.values()];
}

function itemLabel(it: ChangeItem): string {
  return [it.curso, it.semestre, it.grupo ? `grupo ${it.grupo}` : null].filter(Boolean).join(" · ");
}

function CourseRow({ at, course, grados }: { at: string; course: string; grados: NewCourse[] }) {
  return (
    <li className="changelog__item">
      <span className="changelog__dot changelog__dot--course">
        <CalendarPlus size={16} aria-hidden />
      </span>
      <div className="changelog__body">
        <p className="changelog__text">Publicados los horarios del curso {shortYear(course)}</p>
        <p className="changelog__what">
          {grados.map((g, i) => (
            <span key={g.gradoSlug}>
              {i > 0 ? " · " : null}
              <Link to={`/grado/${g.gradoSlug}`}>{g.gradoNombre}</Link>
            </span>
          ))}
        </p>
        <time className="muted changelog__time" dateTime={at}>
          {TIME_FMT.format(new Date(at))}
        </time>
      </div>
    </li>
  );
}

function ChangeRow({ item, at }: { item: ChangeItem; at: string }) {
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
              {day.changes.map((c) =>
                "course" in c ? <CourseRow key={`${c.at}-${c.course}`} {...c} /> : <ChangeRow key={`${c.at}-${c.item.pdfId}-${c.item.href}`} item={c.item} at={c.at} />
              )}
            </ul>
          </section>
        ))
      ) : (
        <p className="muted">Todavía no se ha detectado ningún cambio en los horarios.</p>
      )}
    </div>
  );
}
