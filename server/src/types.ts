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

/** Un PDF "Calendario de exámenes AAAA-AA" de un grado, ya descargado y procesado. */
export interface CatalogExamPdf {
  /** Id estable del PDF (igual criterio que CatalogPdf.id). */
  id: string;
  /** Descripción tal como la publica la EPI, p.ej. "Calendario de exámenes 2026-27". */
  descripcion: string;
  /** Normalizado "2026-2027", si se pudo leer del propio PDF. */
  academicYear: string | null;
  status: PdfStatus;
  error?: string;
}

export interface CatalogGrado extends Grado {
  /** Literal de la web, p.ej. "2026-27". */
  cursoAcademico: string;
  /** Normalizado "2026-2027" (clave de academic-calendar.json). */
  academicYear: string | null;
  cursos: CatalogCurso[];
  /** Enlaces crudos tal como los publica la EPI (incluye documentos que no se procesan, p.ej. la convocatoria extraordinaria adelantada). */
  examenes: DocumentoPdf[];
  /** Subconjunto de `examenes` ya descargado y con fechas extraídas (ver `public/exams/<id>.json`). */
  examenesParsed: CatalogExamPdf[];
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

// ---------------- Registro de cambios (changes.json) ----------------

/** Qué le pasó a una clase concreta entre el horario anterior y el nuevo. */
export type ChangeDetailKind = "room" | "time" | "new" | "removed";

/**
 * Una clase que cambió dentro de un horario (calculado por `scheduleDiff.ts`, heurístico: empareja por
 * día/hora/asignatura/grupo, no compara semana a semana). `subject` ya viene resuelto a nombre, no acrónimo.
 */
export interface ChangeDetail {
  kind: ChangeDetailKind;
  /** 0=lunes .. 4=viernes */
  day: number;
  hourStart: number;
  hourEnd: number;
  subject: string;
  group: string | null;
  /** Aula nueva (kind "new"/"time"/"room") o la que tenía (kind "removed"). */
  room: string;
  /** Solo en kind "room": aula anterior. */
  previousRoom?: string;
  /** Solo en kind "time": hora anterior. */
  previousHourStart?: number;
  previousHourEnd?: number;
}

/** Un horario que cambió (o apareció) en una actualización. */
export interface ChangeItem {
  pdfId: string;
  kind: "new" | "changed";
  gradoSlug: string;
  gradoNombre: string;
  /** Texto del curso en la web, p.ej. "Tercero". */
  curso: string;
  semestre: string;
  grupo: string | null;
  /** Ruta de la web hacia el horario: /grado/<slug>/<path>. */
  href: string;
  /** Qué clases cambiaron en concreto. Solo cuando se pudo comparar con el horario anterior. */
  detail?: ChangeDetail[];
}

// ---------------- Calendario de exámenes (PDF "Calendario de exámenes AAAA-AA" de cada grado) ----------------

export type ExamType = "teoria" | "practicas" | "teoria_practicas" | "problemas" | "examen" | null;

/** Un examen tal como lo extrae `engine/exams.py` de un PDF, antes de vincularlo a una asignatura conocida. */
export interface ExamEntryRaw {
  curso: number;
  semestre: 1 | 2;
  /** Texto tal como viene en el PDF (puede venir abreviado o partido si el nombre no cupo en la celda). */
  subjectRaw: string;
  tipo: ExamType;
  /** dd/mm/aaaa */
  date: string;
  /** HH:MM, hora de Madrid. */
  hourStart: string;
  /** Aula(s) tal cual se pudo extraer; null si el PDF aún no las trae (curso publicado con antelación) o no se reconocieron. */
  location: string | null;
  /** Etiqueta de la convocatoria tal como aparece en el PDF, p.ej. "diciembre-enero 2025/26", "mayo 2026". */
  convocatoria: string | null;
}

/** Un ExamEntryRaw ya cruzado contra la leyenda de asignaturas del grado (ver `pipeline/exams.ts`). */
export interface ExamEntry extends ExamEntryRaw {
  /** Acrónimo de la asignatura en el horario del mismo grado, si se pudo reconocer; null si no hubo match. */
  subjectAcronym: string | null;
}

/** Salida cruda de `engine/exams.py` para un PDF de exámenes. */
export interface ExamDataRaw {
  /** "2026-2027" */
  academicYear: string;
  exams: ExamEntryRaw[];
  warnings: string[];
}

/** Lo que se publica en `public/exams/<id>.json`: igual que ExamDataRaw pero con `subjectAcronym` ya resuelto. */
export interface ExamData {
  academicYear: string;
  exams: ExamEntry[];
  warnings: string[];
}

/** Un grado cuyo curso académico cambió (p.ej. de 2026-2027 a 2027-2028). Sus PDF no se listan uno a uno en `items`. */
export interface NewCourse {
  gradoSlug: string;
  gradoNombre: string;
  /** Normalizado, p.ej. "2027-2028". */
  academicYear: string;
}

export interface ChangeEntry {
  /** Cuándo terminó la actualización que lo detectó (ISO). */
  at: string;
  items: ChangeItem[];
  /** Grados que estrenan curso académico en esta actualización (ausente si ninguno). */
  newCourses?: NewCourse[];
}

export interface ChangeLog {
  version: 1;
  /** Más reciente primero. */
  entries: ChangeEntry[];
}
