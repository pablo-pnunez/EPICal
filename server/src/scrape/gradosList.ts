import * as cheerio from "cheerio";
import { UpstreamError as ScrapeError } from "./http.js";
import type { Grado } from "../types.js";

/**
 * Parsea https://epigijon.uniovi.es/infoacademica/grados: un único bloque de
 * contenido con encabezados `<h4>Rama</h4>` (Datos, Informática,
 * Telecomunicación, Industrial, Dobles Grados...) cada uno seguido
 * INMEDIATAMENTE por un `<div class="enlaces"><ul><li><a href="...">Nombre</a></li>...`.
 * Esa adyacencia es justo lo que distingue una "rama de verdad" de otros
 * `<h4>` de la misma página que no lo son ("Algunas materias", "Documentos
 * relacionados" — ninguno va seguido de un `div.enlaces`), así que no hace
 * falta una lista de ramas conocida de antemano: se descubren dinámicamente,
 * igual que Nexus no hardcodea sus aulas.
 *
 * El slug se extrae del propio href (segmento tras "/infoacademica/grados/")
 * en vez de asumir un sufijo fijo: se ha visto que unos enlaces terminan en
 * "/info" y otros no (p.ej. "/infoacademica/grados/datos" a secas), y ambos
 * apuntan a la misma página.
 */
export function parseGradosList(html: string, baseUrl: string): Grado[] {
  const $ = cheerio.load(html);
  const grados: Grado[] = [];

  const headings = $("h4").toArray();
  for (const heading of headings) {
    const rama = $(heading).text().trim();
    const enlaces = $(heading).next("div.enlaces");
    if (enlaces.length === 0) continue;

    enlaces.find("li > a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;

      const absolute = new URL(href, baseUrl);
      const slug = extractSlug(absolute.pathname);
      if (!slug) return;

      const nombre = $(el).text().replace(/\s+/g, " ").trim();
      grados.push({ slug, nombre, rama, url: absolute.toString() });
    });
  }

  if (grados.length === 0) {
    throw new ScrapeError(`No se encontró ningún grado en ${baseUrl}/infoacademica/grados — la estructura de la página puede haber cambiado.`);
  }

  return grados;
}

/** Extrae el segmento tras "/infoacademica/grados/" de una ruta como "/infoacademica/grados/informatica/info" -> "informatica". */
function extractSlug(pathname: string): string | null {
  const match = pathname.match(/\/infoacademica\/grados\/([^/]+)/);
  return match?.[1] ?? null;
}
