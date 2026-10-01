import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ACTIVITY_HUE, activityOf, type Activity } from "../lib/events";
import type { IcsEvent } from "../lib/ics";

const MONTH_YEAR_FMT = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" });
const TIME_FMT = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });
// Truco: "en-CA" formatea fechas como "AAAA-MM-DD" — usado para agrupar eventos por día EN
// Europe/Madrid (el .ics siempre lleva las horas en UTC, ver lib/ics.ts) sin tener que parsear
// el resultado a mano.
const MADRID_DATE_KEY_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" });
// Sólo días lectivos (lunes-viernes) — el calendario de clases nunca tiene nada en fin de semana,
// así que mostrar esas dos columnas siempre vacías sólo restaría sitio útil a la rejilla.
const WEEKDAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie"];

function madridDateKey(date: Date): string {
  return MADRID_DATE_KEY_FMT.format(date);
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** Igual que `madridDateKey`, pero para las celdas de la rejilla — estas se construyen con fecha LOCAL del navegador (no vienen de un `.ics`), así que se formatean con los getters locales, no con Intl+timeZone (mezclar los dos criterios en la misma comparación sería inconsistente). */
function cellDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

/** "septiembre de 2026" -> "Septiembre de 2026" — sólo la primera letra: un `text-transform: capitalize` en CSS pondría en mayúscula también la "de" ("Septiembre De 2026"). */
function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** true si el evento dura 24h o más — así se pinta "FIESTA" sin una hora "00:00" que no significa nada (ver schedule.py#to_ical sobre por qué los festivos se generan como bloque de día completo). */
function isAllDay(ev: IcsEvent): boolean {
  return ev.end.getTime() - ev.start.getTime() >= 23 * 3600 * 1000;
}

/**
 * `SUMMARY` siempre viene como `"Asignatura [Grupo]"` (ver
 * `lib/events.ts#buildEvents`), tanto en el calendario de
 * una sola asignatura como en el combinado "TODAS" (ahí `Asignatura` es la
 * real de cada evento, no un nombre fijo) — salvo los festivos, que no
 * llevan corchetes (`event.name = HOLIDAY`, sin sufijo de grupo).
 */
function splitSummary(summary: string): { subject: string; group: string | null } {
  const m = /^(.*) \[([^\]]+)\]$/.exec(summary);
  return m ? { subject: m[1]!, group: m[2]! } : { subject: summary, group: null };
}

/** Ángulo áureo — reparte los tonos (hue) de forma uniforme por la rueda de color para cualquier nº de categorías, sin necesitar una paleta fija limitada a N colores. */
const GOLDEN_ANGLE = 137.508;
function hueForIndex(i: number): number {
  return Math.round((200 + i * GOLDEN_ANGLE) % 360);
}

/** Colorea por tipo de grupo (A/PL/PA/...) en el calendario de una sola asignatura, o por asignatura en el combinado "TODAS" — mismo criterio que ya usa `to_ical` para etiquetar cada evento (ver `splitSummary`). */
export type CalendarColorBy = "groupType" | "subject";

function colorKeyOf(ev: IcsEvent, colorBy: CalendarColorBy): string | null {
  if (isAllDay(ev)) return null; // festivo: sin colorear, no es ni asignatura ni tipo de grupo
  const { subject, group } = splitSummary(ev.summary);
  if (colorBy === "subject") return subject;
  return group ? activityOf(group) : null;
}

/** Vista de calendario mensual (rejilla semana-a-semana, no tabla/lista) — como pedir que se abra el .ics en un calendario de verdad. Se posiciona sola en el mes del primer evento (la clase puede empezar dentro de varios meses, no tiene sentido abrir en el mes actual del navegador). `colorBy` decide si cada evento se colorea por tipo de grupo o por asignatura (por defecto "groupType"). */
export function CalendarMonthView({ events, colorBy = "groupType" }: { events: IcsEvent[]; colorBy?: CalendarColorBy }) {
  const initialCursor = useMemo(() => {
    if (events.length === 0) {
      const now = new Date();
      return { year: now.getFullYear(), month: now.getMonth() };
    }
    const [y, m] = madridDateKey(events[0]!.start).split("-").map(Number);
    return { year: y!, month: m! - 1 };
  }, [events]);

  const [cursor, setCursor] = useState(initialCursor);
  // Si cambian los eventos (nueva asignatura/grupos/PDF), volver a saltar al mes del primer evento en vez de quedarse en el mes que se estaba mirando del calendario anterior.
  useEffect(() => setCursor(initialCursor), [initialCursor]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, IcsEvent[]>();
    for (const ev of events) {
      const key = madridDateKey(ev.start);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    }
    return map;
  }, [events]);

  const todayKey = madridDateKey(new Date());

  // Un hue estable por clave (orden alfabético, no de aparición) — así el color de "Álgebra" o
  // de "PL" no cambia según qué eventos hayan llegado antes en la respuesta del backend.
  const hueByKey = useMemo(() => {
    const keys = Array.from(new Set(events.map((ev) => colorKeyOf(ev, colorBy)).filter((k): k is string => k !== null))).sort();
    return new Map(keys.map((k, i) => [k, colorBy === "groupType" && k in ACTIVITY_HUE ? ACTIVITY_HUE[k as Activity] : hueForIndex(i)]));
  }, [events, colorBy]);

  const cells = useMemo(() => {
    const firstOfMonth = new Date(cursor.year, cursor.month, 1);
    const firstWeekday = (firstOfMonth.getDay() + 6) % 7; // 0=lunes .. 6=domingo
    const mondayOfFirstWeek = 1 - firstWeekday; // día-del-mes del lunes que abre la rejilla (puede ser <=0, del mes anterior)
    // 6 semanas x 5 días lectivos (lunes-viernes) — se salta el fin de semana calculando el
    // desplazamiento dentro de la semana (0-4) en vez de recorrer los 7 días y descartar 2.
    return Array.from({ length: 30 }, (_, i) => {
      const week = Math.floor(i / 5);
      const weekdayOffset = i % 5;
      const date = new Date(cursor.year, cursor.month, mondayOfFirstWeek + week * 7 + weekdayOffset);
      const key = cellDateKey(date);
      return {
        date,
        key,
        inMonth: date.getMonth() === cursor.month,
        events: (eventsByDay.get(key) ?? []).slice().sort((a, b) => a.start.getTime() - b.start.getTime()),
      };
    });
  }, [cursor, eventsByDay]);

  if (events.length === 0) {
    return <p className="muted">Este calendario no tiene eventos (puede ser el de festivos, si no hay ninguno en el rango del cuatrimestre).</p>;
  }

  return (
    <div className="calendar-month">
      <div className="calendar-month__header">
        <button type="button" className="secondary" onClick={() => setCursor((c) => addMonths(c.year, c.month, -1))}>
          ‹ Anterior
        </button>
        <strong>{capitalizeFirst(MONTH_YEAR_FMT.format(new Date(cursor.year, cursor.month, 1)))}</strong>
        <button type="button" className="secondary" onClick={() => setCursor((c) => addMonths(c.year, c.month, 1))}>
          Siguiente ›
        </button>
      </div>
      <div className="calendar-month__weekdays">
        {WEEKDAY_LABELS.map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>
      <div className="calendar-month__grid">
        {cells.map((cell) => (
          <div
            key={cell.key}
            className={`calendar-day ${cell.inMonth ? "" : "calendar-day--outside"} ${cell.key === todayKey ? "calendar-day--today" : ""}`}
          >
            <div className="calendar-day__number">{cell.date.getDate()}</div>
            {cell.events.map((ev, i) => {
              const hue = hueByKey.get(colorKeyOf(ev, colorBy) ?? "");
              return (
                <div
                  key={i}
                  className="calendar-event"
                  style={hue !== undefined ? ({ "--ev-hue": hue } as CSSProperties) : undefined}
                  title={`${isAllDay(ev) ? "Todo el día" : `${TIME_FMT.format(ev.start)}–${TIME_FMT.format(ev.end)}`} · ${ev.summary}${ev.location ? ` · ${ev.location}` : ""}`}
                >
                  {!isAllDay(ev) && <span className="calendar-event__time">{TIME_FMT.format(ev.start)} </span>}
                  {ev.summary}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {hueByKey.size > 0 && (
        <div className="calendar-legend">
          {Array.from(hueByKey.entries()).map(([key, hue]) => (
            <span key={key} className="calendar-legend__item">
              <span className="calendar-legend__swatch" style={{ "--ev-hue": hue } as CSSProperties} />
              {key}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
