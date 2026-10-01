import type { Catalog, CatalogCurso, CatalogGrado, CatalogPdf, CatalogSemestre } from "../types";

export interface PdfLocation {
  grado: CatalogGrado;
  curso: CatalogCurso;
  semestre: CatalogSemestre;
  pdf: CatalogPdf;
  /** Otros grados donde aparece el mismo PDF (dobles grados comparten horarios). */
  alsoIn: CatalogGrado[];
}

export function indexPdfs(catalog: Catalog): Map<string, PdfLocation> {
  const map = new Map<string, PdfLocation>();
  for (const grado of catalog.grados) {
    for (const curso of grado.cursos) {
      for (const semestre of curso.semestres) {
        for (const pdf of semestre.grupos) {
          const prev = map.get(pdf.id);
          if (prev) {
            if (!prev.alsoIn.includes(grado) && prev.grado !== grado) prev.alsoIn.push(grado);
          } else map.set(pdf.id, { grado, curso, semestre, pdf, alsoIn: [] });
        }
      }
    }
  }
  return map;
}

/** "Primer curso" -> "1º"; si no se reconoce, el texto tal cual. */
export function shortCurso(curso: string): string {
  const ord: Array<[RegExp, string]> = [
    [/primer/i, "1º"],
    [/segundo/i, "2º"],
    [/tercer/i, "3º"],
    [/cuarto/i, "4º"],
    [/quinto/i, "5º"],
  ];
  return ord.find(([re]) => re.test(curso))?.[1] ?? curso;
}

export function pdfTitle(loc: PdfLocation): string {
  return `${loc.grado.nombre} · ${shortCurso(loc.curso.curso)} curso · ${loc.semestre.texto}${loc.pdf.etiqueta ? ` · Grupo ${loc.pdf.etiqueta}` : ""}`;
}

/** URL legible y estable de un horario: /grado/informatica/2627/tercero/s2/a */
export function pdfHref(grado: CatalogGrado, pdf: CatalogPdf): string {
  return `/grado/${grado.slug}/${pdf.path}`;
}

/**
 * Localiza un horario por su ruta legible. El primer segmento (curso académico, p.ej. "2627") NO se usa para
 * buscar: un marcador guardado el curso pasado sigue resolviendo al horario vigente del mismo curso/semestre/grupo.
 */
export function findByPath(catalog: Catalog, slug: string, curso: string, sem: string, grupo: string): PdfLocation | null {
  const grado = catalog.grados.find((g) => g.slug === slug);
  if (!grado) return null;
  const suffix = `/${curso}/${sem}/${grupo}`;
  for (const c of grado.cursos) {
    for (const s of c.semestres) {
      for (const pdf of s.grupos) {
        if (pdf.path.endsWith(suffix)) return { grado, curso: c, semestre: s, pdf, alsoIn: [] };
      }
    }
  }
  return null;
}

/** Quita tildes y pasa a minúsculas, para búsquedas que no distingan acentos. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}
