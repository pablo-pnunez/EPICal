import crypto from "node:crypto";
import type { Catalog, CatalogGrado, CatalogPdf, Grado, ScrapedHorarios } from "../types.js";
import type { PdfState } from "./state.js";

/** Id estable de un PDF: el uuid de Liferay de su URL (no cambia aunque cambie el contenido); si no hay, un hash de la URL. */
export function pdfIdFromUrl(url: string): string {
  try {
    const uuid = new URL(url).searchParams.get("uuid");
    if (uuid && /^[A-Za-z0-9-]{8,64}$/.test(uuid)) return uuid.toLowerCase();
  } catch {
    /* URL inválida: cae al hash */
  }
  return crypto.createHash("sha1").update(url).digest("hex").slice(0, 24);
}

/** "2026-27" | "2026-2027" | "2026/27" -> "2026-2027" (clave de academic-calendar.json). null si no se reconoce. */
export function normalizeAcademicYear(literal: string): string | null {
  const m = /(\d{4})\s*[-/]\s*(\d{2,4})/.exec(literal);
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2]!.length === 2 ? Math.floor(start / 100) * 100 + Number(m[2]) : Number(m[2]);
  return end === start + 1 ? `${start}-${end}` : null;
}

/** "Semestre 1 (Mañanas)" -> 1 */
export function semesterHint(text: string): 1 | 2 | null {
  const m = /semestre\s*(\d)/i.exec(text);
  return m?.[1] === "1" ? 1 : m?.[1] === "2" ? 2 : null;
}

export function buildCatalog(grados: Grado[], horarios: Map<string, ScrapedHorarios>, pdfs: Record<string, PdfState>, schedulesAvailable: Set<string>): Catalog {
  const out: CatalogGrado[] = [];
  for (const g of grados) {
    const h = horarios.get(g.slug);
    if (!h) continue; // sin datos de este grado en esta ejecución ni en la anterior
    out.push({
      ...g,
      cursoAcademico: h.cursoAcademico,
      academicYear: normalizeAcademicYear(h.cursoAcademico),
      cursos: h.cursos.map((c) => ({
        curso: c.curso,
        semestres: c.semestres.map((s) => ({
          texto: s.texto,
          grupos: s.grupos.map((p): CatalogPdf => {
            const id = pdfIdFromUrl(p.url);
            const st = pdfs[id];
            const pdf: CatalogPdf = { id, etiqueta: p.etiqueta, ingles: p.ingles, url: p.url, status: "pending", path: "" };
            if (st) pdf.checkedAt = st.lastSeenAt;
            if (st) {
              if (st.status === "ok" && schedulesAvailable.has(id)) {
                pdf.status = "ok";
                if (st.cuatrimestre) pdf.cuatrimestre = st.cuatrimestre;
                if (st.subjects !== undefined) pdf.subjects = st.subjects;
                pdf.updatedAt = st.changedAt;
              } else if (st.status === "error") {
                pdf.status = "error";
                if (st.error) pdf.error = st.error;
              }
            }
            return pdf;
          }),
        })),
      })),
      examenes: h.examenes,
    });
  }
  for (const g of out) assignPaths(g);
  return { version: 1, generatedAt: new Date().toISOString(), grados: out };
}

/** Entrada del índice global de asignaturas (buscador de la portada). Claves cortas: el fichero lo descarga todo visitante. */
export interface SubjectIndexEntry {
  /** Id del PDF (/horario/:id). */
  p: string;
  /** Acrónimo tal cual en la rejilla. */
  a: string;
  /** Nombre real (leyenda) o el acrónimo si no está. */
  n: string;
  /** Curso (1-4) según la leyenda, si lo hay. */
  c: number | null;
}

export function buildSubjectIndex(schedules: Array<{ id: string; rows: Array<{ subject: string }>; subjects: Array<{ acronym: string; name: string; curso: number | null }> }>): SubjectIndexEntry[] {
  const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase();
  const out: SubjectIndexEntry[] = [];
  for (const s of schedules) {
    const legend = new Map(s.subjects.map((x) => [norm(x.acronym), x]));
    for (const acr of new Set(s.rows.map((r) => r.subject))) {
      const l = legend.get(norm(acr));
      out.push({ p: s.id, a: acr, n: l?.name || acr, c: l?.curso ?? null });
    }
  }
  return out;
}

const CURSO_SLUGS: Array<[RegExp, string]> = [
  [/primer/i, "primero"],
  [/segund/i, "segundo"],
  [/tercer/i, "tercero"],
  [/cuart/i, "cuarto"],
  [/quint/i, "quinto"],
];

function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function cursoSlug(curso: string): string {
  return CURSO_SLUGS.find(([re]) => re.test(curso))?.[1] ?? (slugify(curso) || "curso");
}

export function semesterSlug(texto: string): string {
  const n = semesterHint(texto);
  return n ? `s${n}` : slugify(texto) || "semestre";
}

/** "2026-2027" -> "2627". */
export function yearSlug(academicYear: string | null): string {
  const m = academicYear ? /^(\d{4})-(\d{4})$/.exec(academicYear) : null;
  return m ? `${m[1]!.slice(2)}${m[2]!.slice(2)}` : "actual";
}

/**
 * Asigna `pdf.path` = "<aamm>/<curso>/<semestre>/<grupo>" a todos los PDF de un grado. El grupo sale de la
 * etiqueta ("A" -> "a", "B_Eng" -> "b-eng", sin etiqueta -> "unico"). Los asteriscos de la web ("A*") se
 * ignoran salvo que haya dos grupos que sólo difieran en eso; si aun así colisionan, se numeran.
 */
export function assignPaths(g: CatalogGrado): void {
  const year = yearSlug(g.academicYear);
  const all: Array<{ pdf: CatalogPdf; prefix: string; group: string; fallback: string }> = [];
  for (const c of g.cursos) {
    for (const s of c.semestres) {
      for (const pdf of s.grupos) {
        const base = pdf.etiqueta ?? "";
        all.push({
          pdf,
          prefix: `${year}/${cursoSlug(c.curso)}/${semesterSlug(s.texto)}`,
          group: slugify(base.replace(/\*/g, "")) || "unico",
          fallback: slugify(base.replace(/\*/g, "x")) || "unico",
        });
      }
    }
  }
  const count = (key: (e: (typeof all)[number]) => string) => {
    const m = new Map<string, number>();
    for (const e of all) m.set(key(e), (m.get(key(e)) ?? 0) + 1);
    return m;
  };
  const first = count((e) => `${e.prefix}/${e.group}`);
  const used = new Map<string, number>();
  for (const e of all) {
    let path = `${e.prefix}/${first.get(`${e.prefix}/${e.group}`)! > 1 ? e.fallback : e.group}`;
    const n = (used.get(path) ?? 0) + 1;
    used.set(path, n);
    if (n > 1) path = `${path}-${n}`;
    e.pdf.path = path;
  }
}
