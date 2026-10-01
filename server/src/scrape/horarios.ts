import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { UpstreamError as ScrapeError } from "./http.js";
import type { DocumentoPdf, ScrapedCurso as CursoHorario, ScrapedHorarios as HorariosGrado, ScrapedPdf as GrupoHorario, ScrapedSemestre as SemestreHorario } from "../types.js";

/**
 * Icono "English" que la web pone junto a los grupos con docencia parcial o
 * total en inglés. Se ha visto en dos posiciones distintas del marcado
 * (dentro del propio `<a>`, tras el `<strong>` de la etiqueta, O como
 * hermano del `<a>` justo después de cerrarlo) — se comprueban ambas.
 * Segunda señal, independiente: la propia etiqueta suele contener "Eng"
 * ("B_Eng", "Eng", "A-Eng"). Ninguna de las dos por separado se ha visto
 * fallar en los casos reales inspeccionados, pero se combinan con OR por
 * si alguna página concreta sólo usa una de las dos.
 */
function hasEnglishIcon($: cheerio.CheerioAPI, a: cheerio.Cheerio<AnyNode>): boolean {
  return a.find('img[src*="image_gallery"]').length > 0 || a.next("img").length > 0;
}

/** Texto de un elemento quitando todo el contenido de sus `<a>` descendientes — para aislar el texto "propio" de un `<li>` (p.ej. "Semestre 1 (Mañanas):") del de sus enlaces. */
function textWithoutLinks($: cheerio.CheerioAPI, el: cheerio.Cheerio<AnyNode>): string {
  const clone = el.clone();
  clone.find("a").remove();
  return clone
    .text()
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/:$/, "")
    .trim();
}

function parseSemestre($: cheerio.CheerioAPI, li: cheerio.Cheerio<AnyNode>, baseUrl: string): SemestreHorario {
  const enlaces = li.find("a[href]");
  const grupos: GrupoHorario[] = enlaces.toArray().map((a) => {
    const $a = $(a);
    const href = $a.attr("href") ?? "";
    const url = new URL(href, baseUrl).toString();
    const strong = $a.find("strong").first();
    const etiqueta = strong.length > 0 ? strong.text().trim() : null;
    const ingles = hasEnglishIcon($, $a) || (etiqueta !== null && /eng/i.test(etiqueta));
    return { etiqueta, ingles, url };
  });

  let texto = textWithoutLinks($, li);
  // Variante sin grupos diferenciados (p.ej. dobles grados): el <li> no
  // tiene más texto propio que el del único enlace ("Semestre 1" es a la
  // vez el texto del <a> y la única etiqueta disponible) — se usa como
  // `texto` del semestre y el grupo se deja sin etiqueta propia (ya está
  // reflejada ahí, duplicarla sería redundante).
  if (!texto && grupos.length === 1 && grupos[0]?.etiqueta === null) {
    texto = enlaces.eq(0).text().trim();
  }

  return { texto, grupos };
}

function parseCurso($: cheerio.CheerioAPI, li: cheerio.Cheerio<AnyNode>, baseUrl: string): CursoHorario {
  // A diferencia de `textWithoutLinks` (usada para el <li> de semestre, que
  // no anida más listas), aquí hay que quitar el <ul> anidado ENTERO antes
  // de leer el texto — si sólo quitáramos los <a> (como hace
  // `textWithoutLinks`), el texto de los semestres hijos (que sí cuelgan de
  // ese <ul>) se colaría mezclado con el nombre del curso.
  const curso = li
    .clone()
    .children("ul")
    .remove()
    .end()
    .text()
    .replace(/\s+/g, " ")
    .trim();
  const semestres = li
    .children("ul")
    .children("li")
    .toArray()
    .map((semestreLi) => parseSemestre($, $(semestreLi), baseUrl))
    // CONFIRMADO EN VIVO (grado "Ciencia e Ingeniería de Datos"): algunos
    // grados no incluyen "Semestre N" en el texto del <li>, sólo el turno
    // ("(Tardes)", "(Tardes)" en los dos <li> del mismo curso) — a
    // diferencia de la mayoría, que sí trae "Semestre 1 (Mañanas)" literal.
    // Sin el número, nada aguas abajo puede saber a qué semestre pertenece
    // cada bloque. Se antepone "Semestre N" por POSICIÓN (1º hijo -> 1,
    // 2º -> 2...) sólo cuando el texto no lo indica ya explícitamente —
    // mismo criterio de "inferir sólo lo que no rompe nada" que usa
    // `parseSemestre` para el caso de dobles grados sin grupos propios.
    .map((semestre, i) =>
      /^semestre\s+\d/i.test(semestre.texto) ? semestre : { ...semestre, texto: `Semestre ${i + 1}${semestre.texto ? ` ${semestre.texto}` : ""}` }
    );
  return { curso, semestres };
}

function parseDocumentos($: cheerio.CheerioAPI, div: cheerio.Cheerio<AnyNode>, baseUrl: string): DocumentoPdf[] {
  return div
    .find("li > a[href]")
    .toArray()
    .map((a) => {
      const $a = $(a);
      const href = $a.attr("href") ?? "";
      return { descripcion: $a.text().trim(), url: new URL(href, baseUrl).toString() };
    });
}

/**
 * Parsea https://epigijon.uniovi.es/infoacademica/grados/<slug>/infoacademica.
 * Estructura real (dos variantes observadas, ambas soportadas):
 *
 * `<h5>Horarios AAAA-AA</h5>` ... `<div class="documentos"><ul>
 *   <li>Primer curso <ul>
 *     <li>Semestre 1 (Mañanas): <a href="...pdf1"><strong>A</strong></a> | <a href="...pdf2"><strong>B_Eng</strong><img .../></a></li>
 *   </ul></li>
 * </ul></div>`
 *
 * — o, cuando el grado no distingue grupos dentro del semestre (dobles grados):
 *
 * `<li>Primer curso <ul><li><a href="...pdf1">Semestre 1</a></li></ul></li>`
 *
 * Seguido de `<h5>Exámenes</h5>` con otro `div.documentos`, esta vez plano
 * (sin agrupar por curso/semestre).
 */
export function parseHorarios(html: string, baseUrl: string, slug: string): HorariosGrado {
  const $ = cheerio.load(html);

  const horariosH5 = $("h5")
    .toArray()
    .map((el) => $(el))
    .find((el) => /^horarios\b/i.test(el.text().trim()));
  if (!horariosH5) {
    throw new ScrapeError(`No se encontró la sección "Horarios" en la página de horarios de "${slug}" — la estructura de la página puede haber cambiado.`);
  }

  const cursoAcademicoMatch = horariosH5.text().trim().match(/horarios\s+(.+)/i);
  const cursoAcademico = cursoAcademicoMatch?.[1]?.trim() || horariosH5.text().trim();

  const horariosDiv = horariosH5.nextAll("div.documentos").first();
  if (horariosDiv.length === 0) {
    throw new ScrapeError(`La sección "Horarios" de "${slug}" no tiene el bloque de documentos esperado (div.documentos) — la estructura de la página puede haber cambiado.`);
  }

  const cursos = horariosDiv
    .children("ul")
    .children("li")
    .toArray()
    .map((li) => parseCurso($, $(li), baseUrl));

  const examenesH5 = $("h5")
    .toArray()
    .map((el) => $(el))
    .find((el) => /^ex[aá]menes\b/i.test(el.text().trim()));
  const examenesDiv = examenesH5?.nextAll("div.documentos").first();
  const examenes = examenesDiv && examenesDiv.length > 0 ? parseDocumentos($, examenesDiv, baseUrl) : [];

  return { slug, cursoAcademico, cursos, examenes };
}
