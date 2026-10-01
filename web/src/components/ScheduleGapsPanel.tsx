import { DAY_LABELS, type GapSlot, type ScheduleGapsResult } from "../lib/scheduleGaps";

const MONTH_LABEL_FMT = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", month: "long", year: "numeric" });

function formatHour(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

/** "2026-09-27" -> "27" — dentro de una sección ya encabezada por el mes, repetir "de septiembre" en cada tarjeta sería ruido. */
function dayOfMonth(date: string): string {
  return String(Number(date.slice(8, 10)));
}

/** "2026-09" -> "Septiembre 2026". */
function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  const label = MONTH_LABEL_FMT.format(new Date(Date.UTC(y!, m! - 1, 1)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Agrupa los huecos por mes ("YYYY-MM", clave de `slot.date`) preservando el orden cronológico en el que ya vienen. */
function groupByMonth(slots: GapSlot[]): [string, GapSlot[]][] {
  const map = new Map<string, GapSlot[]>();
  for (const slot of slots) {
    const key = slot.date.slice(0, 7);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(slot);
  }
  return Array.from(map.entries());
}

/** Huecos concretos (fecha + hora) del calendario combinado (ver lib/scheduleGaps.ts), agrupados por mes y con una columna por día de la semana dentro de cada mes — candidatos para mover una clase sin chocar con ninguna otra asignatura/grupo del curso. */
export function ScheduleGapsPanel({ result }: { result: ScheduleGapsResult }) {
  const { windowStart, windowEnd, weekdays, slots } = result;
  const months = groupByMonth(slots);

  return (
    <div>
      <p className="muted" style={{ marginBottom: "0.75rem" }}>
        Fechas y horas concretas en las que NINGUNA asignatura/grupo tiene clase, dentro del horario habitual del curso ({formatHour(windowStart)}–{formatHour(windowEnd)}), sólo en los días de la semana en los que hay clase de alguna asignatura, y sin contar los festivos.
      </p>

      {months.length === 0 ? (
        <p className="muted">No se ha encontrado ningún hueco dentro de ese horario — el horario del curso está completo.</p>
      ) : (
        months.map(([monthKey, monthSlots]) => (
          <div key={monthKey} style={{ marginTop: "1rem" }}>
            <h3 style={{ fontSize: "0.9rem", marginBottom: "0.5rem" }}>{monthLabel(monthKey)}</h3>
            <div style={{ overflowX: "auto" }}>
              <div className="gaps-columns" style={{ gridTemplateColumns: `repeat(${weekdays.length}, minmax(150px, 1fr))` }}>
                {weekdays.map((day) => {
                  const daySlots = monthSlots.filter((s) => s.day === day);
                  return (
                    <div key={day} className="gaps-day">
                      <div className="gaps-day__header">{DAY_LABELS[day]}</div>
                      {daySlots.length === 0 ? (
                        <p className="muted" style={{ fontSize: "0.78rem" }}>
                          Sin huecos
                        </p>
                      ) : (
                        daySlots.map((slot, i) => (
                          <div key={i} className="gaps-slot">
                            <span className="gaps-slot__date">{dayOfMonth(slot.date)}</span>
                            <span className="gaps-slot__hours">
                              {formatHour(slot.hourStart)}–{formatHour(slot.hourEnd)}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
