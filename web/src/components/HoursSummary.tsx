import { useMemo } from "react";
import { ACTIVITY_LABEL, ACTIVITY_ORDER, activityOf, type CalEvent } from "../lib/events";

/** Porcentaje que representa `part` sobre `total`, listo para mostrar junto a las horas impartidas. */
function pct(part: number, total: number): string {
  return total > 0 ? `${Math.round((part / total) * 100)}%` : "0%";
}

/** Clases y horas reales (descontados festivos) por asignatura y por grupo en el cuatrimestre, con las que ya se han impartido. */
export function HoursSummary({ classes, nameOf }: { classes: CalEvent[]; nameOf: (subject: string) => string }) {
  const now = Date.now();
  const rows = useMemo(() => {
    const bySubject = new Map<string, Map<string, { n: number; h: number; hGiven: number }>>();
    for (const ev of classes) {
      if (!bySubject.has(ev.subject)) bySubject.set(ev.subject, new Map());
      const g = bySubject.get(ev.subject)!;
      const cur = g.get(ev.group) ?? { n: 0, h: 0, hGiven: 0 };
      cur.n++;
      cur.h += ev.hours;
      if (ev.end.getTime() <= now) cur.hGiven += ev.hours;
      g.set(ev.group, cur);
    }
    return [...bySubject.entries()].sort((a, b) => nameOf(a[0]).localeCompare(nameOf(b[0]), "es"));
  }, [classes, nameOf, now]);

  if (rows.length === 0) return <p className="muted">Selecciona alguna asignatura para ver el resumen de horas.</p>;

  const total = classes.reduce((n, e) => n + e.hours, 0);
  const totalGiven = classes.filter((e) => e.end.getTime() <= now).reduce((n, e) => n + e.hours, 0);
  const byActivity = ACTIVITY_ORDER.map((a) => [a, classes.filter((e) => activityOf(e.group) === a).reduce((n, e) => n + e.hours, 0)] as const).filter(([, h]) => h > 0);

  return (
    <div>
      <p className="muted">
        Horas de clase del cuatrimestre según el horario, sin contar festivos. Total: <strong>{total} h</strong>
        {byActivity.length > 0 && <> ({byActivity.map(([a, h]) => `${ACTIVITY_LABEL[a]} ${h} h`).join(" · ")})</>}. Impartidas: <strong>{totalGiven} h</strong> <small>({pct(totalGiven, total)})</small>.
      </p>
      <table>
        <thead>
          <tr>
            <th>Asignatura</th>
            <th>Grupo</th>
            <th>Clases</th>
            <th>Horas</th>
            <th>Impartidas</th>
          </tr>
        </thead>
        <tbody>
          {rows.flatMap(([subject, groups]) => {
            const sorted = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], "es", { numeric: true }));
            return sorted.map(([group, v], i) => (
              <tr key={`${subject}|${group}`}>
                <td>{i === 0 ? nameOf(subject) : ""}</td>
                <td>{group}</td>
                <td>{v.n}</td>
                <td>{v.h}</td>
                <td>
                  {v.hGiven} <small className="muted">({pct(v.hGiven, v.h)})</small>
                </td>
              </tr>
            ));
          })}
        </tbody>
      </table>
    </div>
  );
}
