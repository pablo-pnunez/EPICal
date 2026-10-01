import { paths } from "../paths.js";
import type { CalendarData } from "../types.js";
import { readJsonIfExists, writeFileAtomic } from "../util.js";

/** Súbela cuando cambie el motor de extracción (engine/timetable.py): fuerza a reprocesar todos los PDF ya descargados. */
export const PARSER_VERSION = 2;

export interface PdfState {
  url: string;
  /** Content-Length visto en el último HEAD/descarga (primer nivel de detección de cambios). */
  contentLength: number | null;
  /** Hash del contenido descargado (segundo nivel: confirma si de verdad cambió). */
  sha256: string;
  downloadedAt: string;
  /** Última descarga completa para verificar el hash (aunque el tamaño no hubiera cambiado). */
  lastFullVerifyAt: string;
  /** Cuándo cambió el contenido por última vez. */
  changedAt: string;
  /** Última vez que el PDF apareció en la web. */
  lastSeenAt: string;
  parserVersion: number;
  parsedAt?: string;
  status: "ok" | "error";
  error?: string;
  cuatrimestre?: 1 | 2;
  subjects?: number;
  warnings?: string[];
  /** Calendario académico leído de la hoja "Calendario semanal" de este PDF. */
  calendar?: CalendarData;
  calendarError?: string;
}

export interface RunStats {
  startedAt: string;
  finishedAt?: string;
  trigger: "startup" | "schedule" | "manual";
  gradosOk: number;
  gradosFailed: number;
  pdfsSeen: number;
  headChecks: number;
  downloaded: number;
  changed: number;
  parsed: number;
  parseFailed: number;
  unchanged: number;
  errors: string[];
}

export interface State {
  version: 1;
  pdfs: Record<string, PdfState>;
  lastRun?: RunStats;
  /** Última ejecución que terminó sin abortar (aunque algún PDF fallara). */
  lastSuccessAt?: string;
  /** Calendario académico VIGENTE de cada curso ("2026-2027"), por votación entre PDF. Se conserva aunque el curso desaparezca de la web. */
  calendars?: Record<string, { data: CalendarData; updatedAt: string }>;
}

export async function loadState(): Promise<State> {
  return (await readJsonIfExists<State>(paths.state)) ?? { version: 1, pdfs: {} };
}

export async function saveState(state: State): Promise<void> {
  await writeFileAtomic(paths.state, JSON.stringify(state, null, 1));
}
