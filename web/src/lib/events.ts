/**
 * Expande la rejilla semanal de un PDF (día de la semana + nº de semana de curso) a eventos con
 * fecha real. Es el equivalente en TypeScript de `subject_to_events` del motor Python original:
 * se hace en el navegador para que activar/desactivar PL, PA... sea instantáneo y
 * no cargue al servidor público.
 *
 * Diferencia deliberada con el original: el nº de semana de curso se calcula por distancia en
 * semanas desde el primer día del cuatrimestre (`first_week + semanas transcurridas`) en vez de
 * por número de semana ISO + desfase. Dan lo mismo salvo si el cuatrimestre cruza el cambio de
 * año ISO (semana 52/53 -> 1), caso en el que el original se rompería.
 */

import type { ScheduleRow } from "../types";

export interface QuarterConfig {
  /** dd/mm/aaaa */
  start: string;
  end: string;
  first_week: number;
}

export interface CourseCalendar {
  /** dd/mm/aaaa */
  festivos: string[];
  /** Nombre de cada festivo ("dd/mm/aaaa" -> "Sto. Tomás de Aquino"), si se conoce. */
  nombres?: Record<string, string>;
  q1?: QuarterConfig;
  q2?: QuarterConfig;
}

export type AcademicCalendar = Record<string, CourseCalendar | string>;

/** Compatible con los componentes de calendario: `summary`/`location`/`start`/`end` + metadatos propios. */
export interface CalEvent {
  summary: string;
  location: string;
  start: Date;
  end: Date;
  subject: string;
  group: string;
  /** Festivo: bloque de día completo. */
  allDay: boolean;
  /** Nº de semana de curso. */
  week: number;
  /** Hora de inicio en Madrid (entera); 0 para festivos. */
  startHour: number;
  /** Día de la semana: 0=lunes .. 6=domingo. */
  weekday: number;
  /** "aaaa-mm-dd" (fecha de calendario en Madrid). */
  date: string;
  hours: number;
}

export const HOLIDAY_LABEL = "FIESTA";

const MADRID = "Europe/Madrid";
const offsetFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: MADRID,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

/** Desfase (minutos) de Madrid respecto a UTC en un instante dado. */
function madridOffsetMinutes(utcMs: number): number {
  const p = Object.fromEntries(offsetFmt.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
}

const offsetByDay = new Map<string, number>();
function offsetForDay(y: number, m: number, d: number): number {
  const key = `${y}-${m}-${d}`;
  let off = offsetByDay.get(key);
  if (off === undefined) {
    // Se mide a mediodía UTC: los cambios de hora ocurren de madrugada, así que todo el horario lectivo del día comparte desfase.
    off = madridOffsetMinutes(Date.UTC(y, m - 1, d, 12));
    offsetByDay.set(key, off);
  }
  return off;
}

/** Hora de pared de Madrid (aaaa-mm-dd hh:00) -> instante real. Independiente de la zona horaria del navegador. */
export function madridWallToDate(y: number, m: number, d: number, hour: number): Date {
  return new Date(Date.UTC(y, m - 1, d, hour) - offsetForDay(y, m, d) * 60000);
}

function parseDMY(s: string): { y: number; m: number; d: number } {
  const [d, m, y] = s.split("/").map(Number);
  if (!d || !m || !y) throw new Error(`Fecha inválida en el calendario académico: "${s}"`);
  return { y, m, d };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function isCourseCalendar(v: CourseCalendar | string | undefined): v is CourseCalendar {
  return typeof v === "object" && v !== null && Array.isArray(v.festivos);
}

export interface BuildOptions {
  /** Nombre a mostrar de una asignatura a partir de su acrónimo. */
  nameOf: (subject: string) => string;
}

export interface BuiltEvents {
  classes: CalEvent[];
  holidays: CalEvent[];
}

const DAY_MS = 86_400_000;

export function buildEvents(rows: ScheduleRow[], cuatrimestre: 1 | 2, cal: CourseCalendar, opts: BuildOptions): BuiltEvents {
  const q = cuatrimestre === 1 ? cal.q1 : cal.q2;
  if (!q) throw new Error(`El curso no tiene configurado el cuatrimestre ${cuatrimestre}`);

  const first = parseDMY(q.start);
  const last = parseDMY(q.end);
  const firstUtc = Date.UTC(first.y, first.m - 1, first.d);
  const lastUtc = Date.UTC(last.y, last.m - 1, last.d);
  const festivos = new Set(
    cal.festivos.map((f) => {
      const x = parseDMY(f);
      return `${x.y}-${pad(x.m)}-${pad(x.d)}`;
    })
  );

  const holidayNames = new Map<string, string>();
  for (const [dmy, name] of Object.entries(cal.nombres ?? {})) {
    const x = parseDMY(dmy);
    holidayNames.set(`${x.y}-${pad(x.m)}-${pad(x.d)}`, name);
  }

  const mondayOffset = (new Date(firstUtc).getUTCDay() + 6) % 7;
  const firstMondayUtc = firstUtc - mondayOffset * DAY_MS;

  const byDay: ScheduleRow[][] = [[], [], [], [], []];
  for (const r of rows) byDay[r.day]?.push(r);

  type Raw = { subject: string; group: string; room: string; week: number; day: number; y: number; m: number; d: number; sh: number; eh: number };
  const raws: Raw[] = [];
  const holidays: CalEvent[] = [];

  for (let t = firstUtc; t <= lastUtc; t += DAY_MS) {
    const dt = new Date(t);
    const y = dt.getUTCFullYear();
    const m = dt.getUTCMonth() + 1;
    const d = dt.getUTCDate();
    const dayKey = `${y}-${pad(m)}-${pad(d)}`;
    const week = q.first_week + Math.floor((t - firstMondayUtc) / (7 * DAY_MS));
    const weekday = (dt.getUTCDay() + 6) % 7;

    if (festivos.has(dayKey)) {
      const start = madridWallToDate(y, m, d, 0);
      const end = madridWallToDate(y, m, d + 1, 0);
      holidays.push({ summary: holidayNames.get(dayKey) ?? HOLIDAY_LABEL, location: "", start, end, subject: "", group: HOLIDAY_LABEL, allDay: true, week, startHour: 0, weekday, date: dayKey, hours: 0 });
      continue;
    }
    if (weekday > 4) continue;
    for (const r of byDay[weekday]!) {
      if (r.weeks.includes(week)) raws.push({ subject: r.subject, group: r.group, room: r.room, week, day: weekday, y, m, d, sh: r.hourStart, eh: r.hourEnd });
    }
  }

  // Fusiona tramos consecutivos de la misma clase (misma semana/día/asignatura/grupo) en un único evento.
  const groups = new Map<string, Raw[]>();
  for (const r of raws) {
    const k = `${r.week}|${r.day}|${r.subject}|${r.group}`;
    const arr = groups.get(k);
    if (arr) arr.push(r);
    else groups.set(k, [r]);
  }
  const classes: CalEvent[] = [];
  for (const arr of groups.values()) {
    arr.sort((a, b) => a.sh - b.sh);
    let cur = { ...arr[0]! };
    const flush = () => {
      const start = madridWallToDate(cur.y, cur.m, cur.d, cur.sh);
      const end = madridWallToDate(cur.y, cur.m, cur.d, cur.eh);
      classes.push({
        summary: `${opts.nameOf(cur.subject)} [${cur.group}]`,
        location: cur.room,
        start,
        end,
        subject: cur.subject,
        group: cur.group,
        allDay: false,
        week: cur.week,
        startHour: cur.sh,
        weekday: cur.day,
        date: `${cur.y}-${pad(cur.m)}-${pad(cur.d)}`,
        hours: cur.eh - cur.sh,
      });
    };
    for (const next of arr.slice(1)) {
      if (next.sh === cur.eh) cur.eh = next.eh;
      else {
        flush();
        cur = { ...next };
      }
    }
    flush();
  }

  classes.sort((a, b) => a.start.getTime() - b.start.getTime() || a.summary.localeCompare(b.summary));
  return { classes, holidays };
}

export type Activity = "Teoría" | "PA" | "PL" | "TG";

export const ACTIVITY_ORDER: Activity[] = ["Teoría", "PA", "PL", "TG"];

export const ACTIVITY_LABEL: Record<Activity, string> = {
  Teoría: "Teoría",
  PA: "Prácticas de aula",
  PL: "Prácticas de laboratorio",
  TG: "Tutorías grupales",
};

/**
 * Tipo de actividad de un grupo según las instrucciones oficiales de los propios PDF de la EPI:
 * PAx = prácticas de aula, PLx = prácticas de laboratorio, TGx = tutorías grupales; el resto
 * (A, B, ING, INGA, ENG...) son clases de teoría.
 */
export function activityOf(group: string): Activity {
  const g = group.trim().toUpperCase();
  if (g.startsWith("PL")) return "PL";
  if (g.startsWith("PA")) return "PA";
  if (g.startsWith("TG")) return "TG";
  return "Teoría";
}

/** Docencia en inglés: lo indica la propia etiqueta del grupo (ENG, ING, A-Eng, PL-ENG1...). */
export function isEnglishGroup(group: string): boolean {
  return /ENG|ING/i.test(group);
}

/** Colores fijos por tipo de actividad, parecidos a los de los PDF originales (teoría verde/negro, PA azul, PL rojo, TG rosa). */
export const ACTIVITY_HUE: Record<Activity, number> = { Teoría: 165, PA: 215, PL: 8, TG: 320 };
