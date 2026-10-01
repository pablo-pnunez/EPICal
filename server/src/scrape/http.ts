import { constants } from "node:crypto";
import { Agent, fetch } from "undici";
import { config } from "../config.js";

/**
 * epigijon.uniovi.es exige TLS "legacy renegotiation", que el OpenSSL 3 de Node
 * deshabilita por defecto: sin este Agent, cualquier fetch falla antes de enviar nada.
 * Hay que usar el `fetch` del paquete `undici` (no el global de Node): mezclar el Agent
 * de una versión con el fetch empaquetado en Node revienta en tiempo de ejecución.
 */
const agent = new Agent({ connect: { secureOptions: constants.SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION } });

const USER_AGENT = "EPIcal/0.1 (+horarios EPI Gijón; revisión diaria)";

export class UpstreamError extends Error {}

export async function fetchHtml(pathOrUrl: string): Promise<string> {
  const url = new URL(pathOrUrl, config.baseUrl).toString();
  let res;
  try {
    res = await fetch(url, { redirect: "follow", headers: { Accept: "text/html", "User-Agent": USER_AGENT }, dispatcher: agent });
  } catch (err) {
    throw new UpstreamError(`No se pudo contactar con ${url}: ${(err as Error).message}`);
  }
  // Liferay no da 404 real: redirige a /notfound con 200.
  if (res.url.includes("/notfound")) throw new UpstreamError(`La página ${url} no existe`);
  if (!res.ok) throw new UpstreamError(`HTTP ${res.status} en ${url}`);
  return res.text();
}

/** HEAD barato: el servidor de la EPI no manda ETag ni Last-Modified, pero sí Content-Length. */
export async function headPdf(url: string): Promise<{ contentLength: number | null; etag: string | null; lastModified: string | null }> {
  let res;
  try {
    res = await fetch(url, { method: "HEAD", redirect: "follow", headers: { "User-Agent": USER_AGENT }, dispatcher: agent });
  } catch (err) {
    throw new UpstreamError(`HEAD ${url}: ${(err as Error).message}`);
  }
  if (!res.ok) throw new UpstreamError(`HEAD ${url} -> HTTP ${res.status}`);
  const len = res.headers.get("content-length");
  return { contentLength: len ? Number(len) : null, etag: res.headers.get("etag"), lastModified: res.headers.get("last-modified") };
}

const MAX_PDF_BYTES = 30 * 1024 * 1024;

export async function downloadPdf(url: string): Promise<Buffer> {
  let res;
  try {
    res = await fetch(url, { redirect: "follow", headers: { "User-Agent": USER_AGENT }, dispatcher: agent });
  } catch (err) {
    throw new UpstreamError(`GET ${url}: ${(err as Error).message}`);
  }
  if (!res.ok) throw new UpstreamError(`GET ${url} -> HTTP ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/pdf")) throw new UpstreamError(`${url} no devolvió un PDF (Content-Type: ${ct})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_PDF_BYTES) throw new UpstreamError(`${url} supera el tamaño máximo (${MAX_PDF_BYTES} bytes)`);
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new UpstreamError(`${url} no empieza por %PDF-`);
  return buf;
}
