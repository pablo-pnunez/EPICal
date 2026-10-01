/** Tipos del catálogo público. `web/src/types.ts` mantiene una copia: si cambias esto, actualiza también aquello. */

export interface Grado {
  slug: string;
  nombre: string;
  rama: string;
  url: string;
}

/** Un PDF tal como aparece en la web (antes de descargarlo). */
export interface ScrapedPdf {
  etiqueta: string | null;
  ingles: boolean;
  url: string;
}

export interface ScrapedSemestre {
  texto: string;
  grupos: ScrapedPdf[];
}

export interface ScrapedCurso {
  curso: string;
  semestres: ScrapedSemestre[];
}

export interface DocumentoPdf {
  descripcion: string;
  url: string;
}

export interface ScrapedHorarios {
  slug: string;
  /** Texto literal de "Horarios AAAA-AA", p.ej. "2026-27". */
  cursoAcademico: string;
  cursos: ScrapedCurso[];
  examenes: DocumentoPdf[];
}

// ---------------- Catálogo publicado ----------------

export type PdfStatus = "ok" | "error" | "pending";

export interface CatalogPdf {
  /** Identificador estable (uuid de Liferay si existe; si no, hash de la URL). */
  id: string;
  etiqueta: string | null;
  ingles: boolean;
  url: string;
  status: PdfStatus;
  error?: string;
  cuatrimestre?: 1 | 2;
  /** Nº de asignaturas con clase en el PDF. */
  subjects?: number;
  /** Cuándo se detectó por última vez un CONTENIDO nuevo del PDF (descarga con cambios; ISO). */
  updatedAt?: string;
  /** Última vez que la web de la EPI se revisó y el PDF seguía publicado (ISO). */
  checkedAt?: string;
  /**
   * Ruta legible y estable bajo /grado/<slug>/, p.ej. "2627/primero/s1/a". Se deriva de curso, semestre y grupo
   * (no del id del PDF), de modo que un marcador sigue funcionando cuando la EPI sustituye el PDF.
   */
  path: string;
}

export interface CatalogSemestre {
  texto: string;
  grupos: CatalogPdf[];
}

export interface CatalogCurso {
  curso: string;
  semestres: CatalogSemestre[];
}

export interface CatalogGrado extends Grado {
  /** Literal de la web, p.ej. "2026-27". */
  cursoAcademico: string;
  /** Normalizado "2026-2027" (clave de academic-calendar.json). */
  academicYear: string | null;
  cursos: CatalogCurso[];
  examenes: DocumentoPdf[];
}

export interface Catalog {
  version: 1;
  generatedAt: string;
  grados: CatalogGrado[];
}

// ---------------- Calendario académico (extraído de la hoja "Calendario semanal" de cada PDF) ----------------

export interface QuarterData {
  /** dd/mm/aaaa */
  start: string;
  end: string;
  /** Nº de semana de curso de la semana que contiene el primer día lectivo. */
  first_week: number;
}

export interface CalendarData {
  /** "2026-2027" */
  academicYear: string;
  q1: QuarterData;
  q2: QuarterData;
  /** dd/mm/aaaa, días laborables sin clase (lista oficial + días pintados como no lectivos). */
  festivos: string[];
  /** Nombre de cada festivo de la lista oficial, p.ej. "29/01/2027": "Sto. Tomás de Aquino". */
  nombres: Record<string, string>;
}

// ---------------- Horario extraído de un PDF ----------------

export interface ScheduleRow {
  /** Índice en `ParsedSchedule.sections` (un PDF puede traer varias tablas: itinerarios, optativas comunes...). */
  section: number;
  /** 0=lunes .. 4=viernes */
  day: number;
  hourStart: number;
  hourEnd: number;
  subject: string;
  group: string;
  room: string;
  weeks: number[];
}

/** Una fila de la leyenda de acrónimos (página extra de cada PDF). */
export interface SubjectInfo {
  /** Acrónimo tal como aparece en la rejilla (clave de `ScheduleRow.subject`, sin tildes). */
  acronym: string;
  name: string;
  nameEn: string | null;
  curso: number | null;
  english: boolean | null;
  /** Código de asignatura (p.ej. GIORGI01-4-001) cuando la leyenda lo trae. */
  id: string | null;
}

export interface ScheduleSection {
  /** Cabecera de la tabla, p.ej. "GRUPO A GITECI (v1.0)" u "OPTATIVAS COMUNES GIIND (v1.0)". */
  title: string;
  pages: number[];
}

export interface ParsedSchedule {
  id: string;
  cuatrimestre: 1 | 2;
  sections: ScheduleSection[];
  rows: ScheduleRow[];
  subjects: SubjectInfo[];
  parsedAt: string;
}
