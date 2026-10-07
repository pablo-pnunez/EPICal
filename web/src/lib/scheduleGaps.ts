/**
 * Huecos completamente libres en el calendario combinado de TODAS las asignaturas/grupos de un
 * grado y curso (ver SchedulePage, pestaña «Huecos libres»): fechas y horas CONCRETAS (no un patrón
 * semanal genérico) en las que ninguna asignatura/grupo tiene clase — candidatos para mover una
 * clase sin chocar con NINGÚN alumno, dentro del horario habitual (entre la clase más temprana y la
 * más tardía de toda la rejilla), descontando los festivos del cuatrimestre y SIN contar los días
 * de la semana en los que ese grado/curso nunca tiene clase (p.ej. un grado sin clase los viernes).
 *
 * Necesita DOS listas de eventos (ver SchedulePage): los de clase y los de festivo. Los festivos no
 * aparecen dentro de los eventos de clase (ese día simplemente no hay ninguna), así que sin la lista de
 * festivos aparte no habría forma de distinguir "festivo" de "hueco real": ambos casos parecen un día
 * sin ningún evento.
 *
 * NO se distingue por grupo de prácticas (`PL*`): aunque un alumno sólo esté en UNO de ellos, no
 * hay forma de saber qué alumnos concretos hay en cada "PL2"/"PL3" de cada asignatura, así que un
 * hueco sólo cuenta si NINGUNA asignatura/grupo tiene clase ahí — válido para TODOS los alumnos sea cual sea su grupo real.
 */

import type { CalEvent } from "./events";
import type { IcsEvent } from "./ics";

const DAY_MS = 86_400_000;

const MADRID_YMD_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" });
const MADRID_HOUR_FMT = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", hourCycle: "h23" });

/** Índice 0=lunes .. 4=viernes — compartido con ScheduleGapsPanel para las cabeceras de columna. */
export const DAY_LABELS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];

function madridDateKey(date: Date): string {
  return MADRID_YMD_FMT.format(date);
}

function madridHour(date: Date): number {
  return Number(MADRID_HOUR_FMT.format(date));
}

/** La fecha del evento en hora de Madrid, como medianoche UTC "de calendario" — para poder recorrer el rango día a día con `setUTCDate` sin que darse la vuelta el reloj a mitad de la iteración cambie de día. */
function madridCalendarDate(date: Date): Date {
  const [y, m, d] = madridDateKey(date).split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

function madridWeekday(date: Date): number {
  return (madridCalendarDate(date).getUTCDay() + 6) % 7; // 0=lunes .. 6=domingo
}

export interface GapSlot {
  /** "YYYY-MM-DD" (fecha de calendario en Madrid). */
  date: string;
  /** 0=lunes .. 4=viernes — para poder agrupar en una columna por día de la semana (ver ScheduleGapsPanel). */
  day: number;
  hourStart: number;
  /** Exclusivo (p.ej. 12–14 son dos horas, de 12:00 a 14:00). */
  hourEnd: number;
  /** Nº de semana del curso (numeración del PDF) a la que pertenece la fecha. */
  week: number;
}

export interface ScheduleGapsResult {
  windowStart: number;
  windowEnd: number;
  /** Días de la semana (0=lunes..4=viernes) en los que este grado/curso tiene clase alguna vez — el conjunto de columnas a mostrar, aunque alguno acabe sin ningún hueco. */
  weekdays: number[];
  /** Ordenados cronológicamente — una entrada por cada hueco concreto (fecha + franja), no un patrón semanal agregado. */
  slots: GapSlot[];
}

/** `classEvents`/`holidayEvents`: eventos de clase y de festivo ya calculados por `buildEvents` (lib/events.ts) para TODAS las asignaturas y grupos. */
export function findScheduleGaps(classEvents: CalEvent[], holidayEvents: CalEvent[]): ScheduleGapsResult | null {
  if (classEvents.length === 0) return null;

  // Semana de curso de cualquier fecha: por distancia en semanas desde un evento de referencia (un día entero libre no tiene evento propio).
  const ref = classEvents[0]!;
  const refMonday = madridCalendarDate(ref.start).getTime() - madridWeekday(ref.start) * DAY_MS;
  const weekOf = (d: Date): number => {
    const monday = d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY_MS;
    return ref.week + Math.round((monday - refMonday) / (7 * DAY_MS));
  };

  const windowStart = Math.min(...classEvents.map((ev) => madridHour(ev.start)));
  const windowEnd = Math.max(...classEvents.map((ev) => madridHour(ev.end)));
  if (windowEnd <= windowStart) return null;

  const holidayDateKeys = new Set(holidayEvents.map((ev) => madridDateKey(ev.start)));
  // Días de la semana en los que ALGUNA asignatura/grupo tiene clase alguna vez — un grado sin
  // clase los viernes no debe aparecer como "el viernes entero está libre".
  const usedWeekdays = new Set(classEvents.map((ev) => madridWeekday(ev.start)));

  const eventsByDate = new Map<string, IcsEvent[]>();
  for (const ev of classEvents) {
    const key = madridDateKey(ev.start);
    if (!eventsByDate.has(key)) eventsByDate.set(key, []);
    eventsByDate.get(key)!.push(ev);
  }

  // Rango completo del cuatrimestre: de los festivos también, no sólo de las clases — así un
  // festivo en la primera/última semana (sin ninguna clase generada ese día) no recorta el rango.
  const calendarDates = [...classEvents, ...holidayEvents].map((ev) => madridCalendarDate(ev.start));
  const minDate = new Date(Math.min(...calendarDates.map((d) => d.getTime())));
  const maxDate = new Date(Math.max(...calendarDates.map((d) => d.getTime())));

  const slots: GapSlot[] = [];

  for (const d = new Date(minDate); d.getTime() <= maxDate.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
    const day = (d.getUTCDay() + 6) % 7;
    if (day > 4 || !usedWeekdays.has(day)) continue; // fin de semana, o día que este grado/curso nunca usa
    const key = madridDateKey(d);
    if (holidayDateKeys.has(key)) continue; // festivo: no puede ser un hueco

    const dayEvents = eventsByDate.get(key) ?? [];

    // Huecos de ESTA fecha concreta — fusionando horas consecutivas libres en una única franja.
    let runStart: number | null = null;
    for (let h = windowStart; h <= windowEnd; h++) {
      const isFree = h < windowEnd && !dayEvents.some((ev) => madridHour(ev.start) <= h && h < madridHour(ev.end));
      if (isFree && runStart === null) runStart = h;
      if (!isFree && runStart !== null) {
        slots.push({ date: key, day, hourStart: runStart, hourEnd: h, week: weekOf(d) });
        runStart = null;
      }
    }
  }

  const weekdays = Array.from(usedWeekdays)
    .filter((d) => d <= 4)
    .sort((a, b) => a - b);

  return { windowStart, windowEnd, weekdays, slots };
}
