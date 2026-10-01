import { config } from "../config.js";
import type { CalendarData } from "../types.js";
import { readJsonIfExists } from "../util.js";
import { loadState, PARSER_VERSION, type State } from "./state.js";

/** Lo que consumen la web y el generador de Excel: el calendario de un curso (sin el campo academicYear, que es la clave). */
export type CourseCalendarJson = Omit<CalendarData, "academicYear">;
export type EffectiveCalendar = Record<string, CourseCalendarJson>;

function signature(c: CalendarData): string {
  return JSON.stringify({ q1: c.q1, q2: c.q2, festivos: [...c.festivos].sort(), nombres: c.nombres });
}

function strip(c: CalendarData): CourseCalendarJson {
  return { q1: c.q1, q2: c.q2, festivos: c.festivos, nombres: c.nombres };
}

/**
 * Agrega los calendarios leídos de cada PDF: por cada curso académico gana la versión que traen más PDF
 * (en empate, la del PDF modificado más recientemente). Si la EPI corrige el calendario, durante unos días
 * convivirán PDF antiguos y nuevos; la mayoría decide y los avisos lo dejan registrado. El resultado se guarda
 * en `state.calendars` y se CONSERVA aunque el curso desaparezca de la web (los marcadores viejos lo siguen necesitando).
 */
export function aggregateCalendars(state: State): string[] {
  const notes: string[] = [];
  const byYear = new Map<string, Map<string, { data: CalendarData; count: number; latest: string }>>();
  for (const st of Object.values(state.pdfs)) {
    if (st.status !== "ok" || st.parserVersion !== PARSER_VERSION || !st.calendar) continue;
    const year = st.calendar.academicYear;
    const variants = byYear.get(year) ?? new Map();
    const sig = signature(st.calendar);
    const cur = variants.get(sig) ?? { data: st.calendar, count: 0, latest: "" };
    cur.count++;
    if (st.changedAt > cur.latest) cur.latest = st.changedAt;
    variants.set(sig, cur);
    byYear.set(year, variants);
  }

  state.calendars ??= {};
  const now = new Date().toISOString();
  for (const [year, variants] of byYear) {
    const ranked = [...variants.values()].sort((a, b) => b.count - a.count || b.latest.localeCompare(a.latest));
    const winner = ranked[0]!;
    if (ranked.length > 1) notes.push(`Calendario ${year}: ${ranked.length} versiones distintas en los PDF (${ranked.map((v) => v.count).join(" / ")}); se usa la mayoritaria.`);
    const prev = state.calendars[year];
    if (!prev || signature(prev.data) !== signature(winner.data)) {
      if (prev) notes.push(`Calendario ${year}: CAMBIÓ respecto al anterior (revisa festivos y cuatrimestres).`);
      state.calendars[year] = { data: winner.data, updatedAt: now };
    }
  }
  return notes;
}

/**
 * Calendario efectivo = calendarios extraídos de los PDF + correcciones manuales de config/academic-calendar.json
 * (si un curso está en el fichero manual, ese curso se toma ENTERO de ahí).
 */
export async function effectiveCalendar(state?: State): Promise<{ effective: EffectiveCalendar; notes: string[] }> {
  const st = state ?? (await loadState());
  const notes: string[] = [];
  const effective: EffectiveCalendar = {};
  for (const [year, v] of Object.entries(st.calendars ?? {})) effective[year] = strip(v.data);

  const manual = (await readJsonIfExists<Record<string, unknown>>(config.academicCalendarPath)) ?? {};
  for (const [year, value] of Object.entries(manual)) {
    if (!/^\d{4}-\d{4}$/.test(year) || typeof value !== "object" || value === null) continue;
    const m = value as CourseCalendarJson;
    const auto = effective[year];
    if (auto && signature({ academicYear: year, ...auto }) !== signature({ academicYear: year, ...m, nombres: auto.nombres })) {
      notes.push(`Calendario ${year}: config/academic-calendar.json SOBREESCRIBE al extraído de los PDF y no coinciden.`);
    }
    effective[year] = { ...m, nombres: m.nombres ?? auto?.nombres ?? {} };
  }
  return { effective, notes };
}

/** Recalcula la agregación (tras procesar PDF) y devuelve el calendario efectivo. */
export async function refreshCalendars(state: State): Promise<{ effective: EffectiveCalendar; notes: string[] }> {
  const aggNotes = aggregateCalendars(state);
  const { effective, notes } = await effectiveCalendar(state);
  return { effective, notes: [...aggNotes, ...notes] };
}
