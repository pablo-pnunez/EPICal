import { computePracticeBalance } from "../lib/practiceBalance";
import type { IcsEvent } from "../lib/ics";

/** Comparador de descompensación entre grupos de prácticas (`PL*`) de una asignatura: totales de clases/horas por grupo + desglose semana a semana, para localizar en qué semana concreta se ha perdido una clase (típicamente un festivo) sin recuperarla. */
export function PracticeGroupBalance({ eventsByGroup }: { eventsByGroup: Record<string, IcsEvent[]> }) {
  const { groups, weeks, totals, maxClasses } = computePracticeBalance(eventsByGroup);

  if (groups.length < 2) return null;

  return (
    <div>
      <p className="muted" style={{ marginBottom: "0.5rem" }}>
        Clases y horas totales por grupo de prácticas en todo el cuatrimestre. El grupo con menos clases que el máximo puede tener pendiente recuperar alguna (por ejemplo, si un festivo se le comió una sesión que a los demás no).
      </p>
      <table>
        <thead>
          <tr>
            <th>Grupo</th>
            <th>Clases</th>
            <th>Horas</th>
            <th>Diferencia</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const total = totals[group]!;
            const diff = total.classes - maxClasses;
            return (
              <tr key={group}>
                <td>{group}</td>
                <td>{total.classes}</td>
                <td>{total.hours}</td>
                <td>{diff === 0 ? <span className="badge badge--ok">Al día</span> : <span className="badge badge--err">{diff} clase{diff === -1 ? "" : "s"}</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="muted" style={{ marginTop: "1rem", marginBottom: "0.3rem" }}>
        Clases acumuladas hasta el final de cada semana (semana ISO, hora de Madrid; entre paréntesis, las dadas esa semana en concreto) — en rojo, las semanas en las que un grupo va por detrás del que más lleva. Útil para elegir una semana "en verde" (todos igualados) para poner un examen.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Semana</th>
              {groups.map((group) => (
                <th key={group}>{group}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week.key}>
                <td>{week.label}</td>
                {groups.map((group) => {
                  const cumulative = week.cumulative[group] ?? 0;
                  const count = week.counts[group] ?? 0;
                  const behind = cumulative < week.maxCumulative;
                  return (
                    <td key={group} className={behind ? "practice-balance-cell--short" : undefined}>
                      {cumulative}
                      {count > 0 && (
                        <span className="muted" style={{ fontSize: "0.75rem" }}>
                          {" "}
                          (+{count})
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
