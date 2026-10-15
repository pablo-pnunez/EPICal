import type { ChangeDetail, ParsedSchedule, ScheduleRow, SubjectInfo } from "../types.js";

const MAX_DETALLES = 20;

function claveSlot(r: Pick<ScheduleRow, "day" | "hourStart" | "hourEnd" | "subject" | "group">): string {
  return `${r.day}|${r.hourStart}|${r.hourEnd}|${r.subject}|${r.group}`;
}

function claveGrupo(r: Pick<ScheduleRow, "day" | "subject" | "group">): string {
  return `${r.day}|${r.subject}|${r.group}`;
}

/** Una fila por slot (día+hora+asignatura+grupo); si está partida en varios tramos de semanas se queda con el de más semanas. */
function porSlot(rows: ScheduleRow[]): Map<string, ScheduleRow> {
  const map = new Map<string, ScheduleRow>();
  for (const r of rows) {
    const k = claveSlot(r);
    const prev = map.get(k);
    if (!prev || r.weeks.length > prev.weeks.length) map.set(k, r);
  }
  return map;
}

function nombreAsignatura(subjects: SubjectInfo[], acronimo: string): string {
  return subjects.find((s) => s.acronym === acronimo)?.name ?? acronimo;
}

/**
 * Compara el horario extraído antes y después de que la EPI sustituyera el PDF y devuelve, por cada clase que
 * cambió, los datos para que la web lo muestre (icono/tarjeta por tipo). Empareja clases por (día, hora,
 * asignatura, grupo); lo que no encaja así se reintenta por (día, asignatura, grupo) para distinguir un cambio
 * de hora de una clase añadida o eliminada. Es heurístico (no compara semana a semana): basta para avisar de
 * qué mirar, no es una auditoría exhaustiva.
 */
export function diffSchedule(before: ParsedSchedule, after: ParsedSchedule): ChangeDetail[] {
  const subjects = [...(after.subjects ?? []), ...(before.subjects ?? [])];
  const nombre = (acronimo: string) => nombreAsignatura(subjects, acronimo);

  const antes = porSlot(before.rows ?? []);
  const despues = porSlot(after.rows ?? []);
  const antesRestante = new Map(antes);
  const despuesRestante = new Map(despues);
  const detalles: ChangeDetail[] = [];

  for (const [k, nueva] of despues) {
    const vieja = antes.get(k);
    if (!vieja) continue;
    antesRestante.delete(k);
    despuesRestante.delete(k);
    if (vieja.room !== nueva.room) {
      detalles.push({
        kind: "room",
        day: nueva.day,
        hourStart: nueva.hourStart,
        hourEnd: nueva.hourEnd,
        subject: nombre(nueva.subject),
        group: nueva.group || null,
        room: nueva.room,
        previousRoom: vieja.room,
      });
    }
  }

  // Lo que no emparejó por hora exacta: probar por (día, asignatura, grupo) para detectar cambios de hora.
  const antesPorGrupo = new Map<string, ScheduleRow[]>();
  for (const r of antesRestante.values()) {
    const k = claveGrupo(r);
    antesPorGrupo.set(k, [...(antesPorGrupo.get(k) ?? []), r]);
  }
  for (const nueva of [...despuesRestante.values()]) {
    const k = claveGrupo(nueva);
    const candidatas = antesPorGrupo.get(k);
    const vieja = candidatas?.length === 1 ? candidatas[0] : undefined;
    if (vieja) {
      detalles.push({
        kind: "time",
        day: nueva.day,
        hourStart: nueva.hourStart,
        hourEnd: nueva.hourEnd,
        subject: nombre(nueva.subject),
        group: nueva.group || null,
        room: nueva.room,
        previousHourStart: vieja.hourStart,
        previousHourEnd: vieja.hourEnd,
        ...(vieja.room !== nueva.room ? { previousRoom: vieja.room } : {}),
      });
      antesRestante.delete(claveSlot(vieja));
      despuesRestante.delete(claveSlot(nueva));
    }
  }

  for (const r of antesRestante.values())
    detalles.push({ kind: "removed", day: r.day, hourStart: r.hourStart, hourEnd: r.hourEnd, subject: nombre(r.subject), group: r.group || null, room: r.room });
  for (const r of despuesRestante.values())
    detalles.push({ kind: "new", day: r.day, hourStart: r.hourStart, hourEnd: r.hourEnd, subject: nombre(r.subject), group: r.group || null, room: r.room });

  detalles.sort((a, b) => a.day - b.day || a.hourStart - b.hourStart);
  return detalles.slice(0, MAX_DETALLES);
}
