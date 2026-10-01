/**
 * Descompensación entre grupos de prácticas de una asignatura: cuenta cuántas clases/horas ha
 * tenido cada grupo `PL*` a lo largo del cuatrimestre y las compara semana a semana — pensado para
 * detectar el caso típico de que un festivo se coma la clase de un grupo concreto sin que se
 * recupere en otra parte del calendario, dejando a ese grupo por detrás de los demás.
 *
 * Trabaja sobre los eventos YA generados por el motor (`IcsEvent[]`, con fecha real y festivos ya
 * excluidos, ver CalendarioPage#handleCompareBalance) — no vuelve a tocar `weeks`/festivos por su
 * cuenta, así hereda gratis la misma lógica de fechas que el resto del calendario.
 */

import type { IcsEvent } from "./ics";

/** Convención de nombrado de los PDF de horario de la EPI: los grupos de prácticas empiezan literalmente por "PL" (p.ej. "PL-ENG1", "PL1"). */
export function isPracticeGroup(group: string): boolean {
  return group.startsWith("PL");
}

const MADRID_PARTS_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" });
const WEEK_LABEL_FMT = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "short" });

/** La fecha (Y-M-D) del evento en hora de Madrid, como medianoche UTC "de calendario" — sólo se usa para calcular la semana ISO, nunca como hora real de nada. */
function madridCalendarDate(date: Date): Date {
  const [y, m, d] = MADRID_PARTS_FMT.format(date).split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

/** Nº de semana ISO-8601 (lunes-domingo, semana 1 = la que contiene el primer jueves del año) de una fecha de calendario ya en medianoche UTC. Algoritmo estándar (no depende de `Intl`, que no expone semana ISO). */
function isoWeekNumber(calendarDate: Date): { isoYear: number; week: number } {
  const d = new Date(calendarDate);
  const dayNum = (d.getUTCDay() + 6) % 7; // 0=lunes .. 6=domingo
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // jueves de esa semana
  const isoYear = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return { isoYear, week };
}

export interface PracticeWeekRow {
  key: string;
  /** "22 sep – 28 sep" */
  label: string;
  /** grupo -> nº de clases esa semana (0 si no tuvo ninguna). */
  counts: Record<string, number>;
  /** grupo -> nº de clases ACUMULADAS desde el inicio del cuatrimestre hasta el fin de esta semana — el dato que importa para saber si a estas alturas todos los grupos van igualados (p.ej. antes de poner un examen). */
  cumulative: Record<string, number>;
  maxCumulative: number;
}

export interface PracticeGroupTotals {
  classes: number;
  hours: number;
}

export interface PracticeBalance {
  groups: string[];
  weeks: PracticeWeekRow[];
  totals: Record<string, PracticeGroupTotals>;
  maxClasses: number;
}

interface WeekAccumulator {
  key: string;
  label: string;
  counts: Record<string, number>;
}

/** `eventsByGroup`: un grupo puede faltar como clave o venir con array vacío si el motor no generó ningún evento para él (caso extremo de descompensación total) — ambos se tratan igual, como 0 clases. */
export function computePracticeBalance(eventsByGroup: Record<string, IcsEvent[]>): PracticeBalance {
  const groups = Object.keys(eventsByGroup).sort();
  const weekMap = new Map<string, WeekAccumulator>();
  const totals: Record<string, PracticeGroupTotals> = {};
  for (const group of groups) totals[group] = { classes: 0, hours: 0 };

  for (const group of groups) {
    for (const ev of eventsByGroup[group] ?? []) {
      const calDate = madridCalendarDate(ev.start);
      const { isoYear, week } = isoWeekNumber(calDate);
      const key = `${isoYear}-W${String(week).padStart(2, "0")}`;

      if (!weekMap.has(key)) {
        const monday = new Date(calDate);
        monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
        const sunday = new Date(monday);
        sunday.setUTCDate(sunday.getUTCDate() + 6);
        weekMap.set(key, {
          key,
          label: `${WEEK_LABEL_FMT.format(monday)} – ${WEEK_LABEL_FMT.format(sunday)}`,
          counts: Object.fromEntries(groups.map((g) => [g, 0])),
        });
      }

      const row = weekMap.get(key)!;
      row.counts[group] = (row.counts[group] ?? 0) + 1;
      totals[group]!.classes += 1;
      totals[group]!.hours += (ev.end.getTime() - ev.start.getTime()) / 3_600_000;
    }
  }

  // El acumulado se va sumando semana a semana EN ORDEN CRONOLÓGICO — por eso se ordena antes de
  // recorrerlo, no al construir `weekMap` (que se rellena en el orden en que aparecen los eventos).
  const weeksSorted = Array.from(weekMap.values()).sort((a, b) => (a.key < b.key ? -1 : 1));
  const running: Record<string, number> = Object.fromEntries(groups.map((g) => [g, 0]));
  const weeks: PracticeWeekRow[] = weeksSorted.map((w) => {
    for (const group of groups) running[group] = (running[group] ?? 0) + (w.counts[group] ?? 0);
    const cumulative = { ...running };
    const maxCumulative = Math.max(0, ...groups.map((g) => cumulative[g] ?? 0));
    return { key: w.key, label: w.label, counts: w.counts, cumulative, maxCumulative };
  });

  const maxClasses = Math.max(0, ...groups.map((g) => totals[g]!.classes));

  return { groups, weeks, totals, maxClasses };
}
