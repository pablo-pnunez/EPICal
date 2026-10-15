import { paths } from "../paths.js";
import type { CatalogGrado, ExamData, ExamDataRaw, ExamEntry, ParsedSchedule, SubjectInfo } from "../types.js";
import { readJsonIfExists, writeJsonPublic } from "../util.js";
import type { State } from "./state.js";

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Busca el acrónimo de `subjectRaw` (texto libre del PDF de exámenes, a veces truncado por el
 * ancho de la celda) en la leyenda de asignaturas del grado. Primero igualdad exacta; si no,
 * contención en cualquier sentido (un nombre truncado es prefijo/substring del real) con un
 * mínimo de caracteres para no dar falsos positivos con nombres cortos. Sin match -> null: se
 * muestra igual el texto crudo, pero no se podrá filtrar por asignatura.
 */
function matchSubject(subjectRaw: string, legend: SubjectInfo[]): string | null {
  const q = norm(subjectRaw);
  if (!q) return null;
  for (const s of legend) if (norm(s.name) === q || (s.nameEn && norm(s.nameEn) === q)) return s.acronym;
  if (q.length < 6) return null; // demasiado corto para contención fiable
  const candidates = legend.filter((s) => {
    const n = norm(s.name);
    const en = s.nameEn ? norm(s.nameEn) : "";
    return (n.length >= 6 && (n.includes(q) || q.includes(n))) || (en.length >= 6 && (en.includes(q) || q.includes(en)));
  });
  const uniq = new Set(candidates.map((s) => s.acronym));
  return uniq.size === 1 ? candidates[0]!.acronym : null;
}

function matchExams(raw: ExamDataRaw, legend: SubjectInfo[], warnings: string[]): ExamEntry[] {
  const out: ExamEntry[] = [];
  let unmatched = 0;
  for (const e of raw.exams) {
    const subjectAcronym = legend.length ? matchSubject(e.subjectRaw, legend) : null;
    if (!subjectAcronym) unmatched++;
    out.push({ ...e, subjectAcronym });
  }
  if (unmatched) warnings.push(`${unmatched}/${raw.exams.length} exámenes sin asignatura reconocida en la leyenda del grado`);
  return out;
}

/** Legenda de asignaturas de un grado: unión de las leyendas de todos sus PDF de horario ya procesados. */
async function gradoLegend(grado: CatalogGrado): Promise<SubjectInfo[]> {
  const ids = new Set<string>();
  for (const c of grado.cursos) for (const s of c.semestres) for (const p of s.grupos) if (p.status === "ok") ids.add(p.id);
  const byAcronym = new Map<string, SubjectInfo>();
  for (const id of ids) {
    const sch = await readJsonIfExists<ParsedSchedule>(paths.scheduleFile(id));
    for (const s of sch?.subjects ?? []) byAcronym.set(norm(s.acronym), s);
  }
  return [...byAcronym.values()];
}

/**
 * Vincula cada PDF de exámenes ya descargado (`state.examPdfs`) a su asignatura (cruzando contra
 * la leyenda del grado) y publica `public/exams/<id>.json`. Devuelve, por grado, la lista a
 * incluir en `CatalogGrado.examenesParsed`.
 */
export async function refreshExams(state: State, catalog: CatalogGrado[]): Promise<Map<string, CatalogGrado["examenesParsed"]>> {
  const byGrado = new Map<string, CatalogGrado["examenesParsed"]>();
  const legendCache = new Map<string, SubjectInfo[]>();

  for (const [id, st] of Object.entries(state.examPdfs ?? {})) {
    const grado = catalog.find((g) => g.slug === st.gradoSlug);
    const entry: CatalogGrado["examenesParsed"][number] = { id, descripcion: st.descripcion, academicYear: st.data?.academicYear ?? null, status: st.status };
    if (st.status === "error" && st.error) entry.error = st.error;

    if (st.status === "ok" && st.data) {
      if (!legendCache.has(st.gradoSlug)) legendCache.set(st.gradoSlug, grado ? await gradoLegend(grado) : []);
      const legend = legendCache.get(st.gradoSlug)!;
      const warnings = [...st.data.warnings];
      const exams = matchExams(st.data, legend, warnings);
      const published: ExamData = { academicYear: st.data.academicYear, exams, warnings };
      await writeJsonPublic(paths.examFile(id), published);
    }

    if (!byGrado.has(st.gradoSlug)) byGrado.set(st.gradoSlug, []);
    byGrado.get(st.gradoSlug)!.push(entry);
  }
  return byGrado;
}
