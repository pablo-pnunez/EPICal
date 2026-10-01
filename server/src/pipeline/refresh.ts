import fs from "node:fs/promises";
import { config } from "../config.js";
import { log } from "../log.js";
import { paths } from "../paths.js";
import { downloadPdf, fetchHtml, headPdf } from "../scrape/http.js";
import { parseGradosList } from "../scrape/gradosList.js";
import { parseHorarios } from "../scrape/horarios.js";
import type { Catalog, CatalogGrado, Grado, ScrapedHorarios } from "../types.js";
import { ensureDir, exists, hoursSince, mapLimit, readJsonIfExists, sha256, writeFileAtomic, writeJsonPublic } from "../util.js";
import { refreshCalendars } from "./calendar.js";
import { buildCatalog, buildSubjectIndex, pdfIdFromUrl, semesterHint } from "./catalog.js";
import { parsePdfBatch, type ParseItem } from "./python.js";
import { PARSER_VERSION, loadState, saveState, type PdfState, type RunStats, type State } from "./state.js";

const PARSE_CHUNK = 20;
const FORGET_AFTER_DAYS = 60;

let running: Promise<RunStats> | null = null;

export function isRefreshRunning(): boolean {
  return running !== null;
}

/** Lanza (o se une a) una actualización. Nunca hay dos a la vez. */
export function refresh(trigger: RunStats["trigger"]): Promise<RunStats> {
  if (!running) {
    running = runRefresh(trigger).finally(() => {
      running = null;
    });
  }
  return running;
}

interface PdfEntry {
  id: string;
  url: string;
  hint: 1 | 2 | null;
}

async function runRefresh(trigger: RunStats["trigger"]): Promise<RunStats> {
  const stats: RunStats = {
    startedAt: new Date().toISOString(),
    trigger,
    gradosOk: 0,
    gradosFailed: 0,
    pdfsSeen: 0,
    headChecks: 0,
    downloaded: 0,
    changed: 0,
    parsed: 0,
    parseFailed: 0,
    unchanged: 0,
    errors: [],
  };
  log("refresh", `Inicio (${trigger})`);
  await ensureDir(paths.pdfDir);
  await ensureDir(paths.scheduleDir);
  await ensureDir(paths.tmpDir);

  const state = await loadState();
  const previous = await readJsonIfExists<Catalog>(paths.catalog);

  // ---- 1. Catálogo de grados y sus páginas de horarios (HTML, barato) ----
  let grados: Grado[];
  try {
    grados = parseGradosList(await fetchHtml("/infoacademica/grados"), config.baseUrl);
  } catch (err) {
    stats.errors.push(`Listado de grados: ${(err as Error).message}`);
    log("refresh", `ABORTADO: no se pudo leer el listado de grados: ${(err as Error).message}`);
    return finish(state, stats, previous, null);
  }

  const horarios = new Map<string, ScrapedHorarios>();
  await mapLimit(grados, config.scrapeConcurrency, async (g) => {
    try {
      horarios.set(g.slug, parseHorarios(await fetchHtml(`/infoacademica/grados/${encodeURIComponent(g.slug)}/infoacademica`), config.baseUrl, g.slug));
      stats.gradosOk++;
    } catch (err) {
      stats.gradosFailed++;
      stats.errors.push(`Grado ${g.slug}: ${(err as Error).message}`);
      log("refresh", `Grado ${g.slug} falló (se conserva lo anterior): ${(err as Error).message}`);
    }
  });

  // ---- 2. PDF únicos (algunos se comparten entre grados) ----
  const entries = new Map<string, PdfEntry>();
  for (const h of horarios.values()) {
    for (const c of h.cursos) {
      for (const s of c.semestres) {
        for (const p of s.grupos) {
          const id = pdfIdFromUrl(p.url);
          const hint = semesterHint(s.texto);
          const prev = entries.get(id);
          if (!prev) entries.set(id, { id, url: p.url, hint });
          else if (prev.hint === null && hint !== null) prev.hint = hint;
        }
      }
    }
  }
  stats.pdfsSeen = entries.size;
  log("refresh", `${grados.length} grados, ${entries.size} PDF distintos`);

  // ---- 3. Detección de cambios: HEAD (tamaño) y, de vez en cuando, descarga completa (hash) ----
  const now = new Date().toISOString();
  const toParse: PdfEntry[] = [];
  await mapLimit([...entries.values()], config.scrapeConcurrency, async (e) => {
    try {
      const needsParse = await checkPdf(e, state, stats, now);
      if (needsParse) toParse.push(e);
    } catch (err) {
      stats.errors.push(`PDF ${e.id}: ${(err as Error).message}`);
      log("refresh", `PDF ${e.id} (${e.url}) falló: ${(err as Error).message}`);
    }
  });

  // ---- 4. Extracción (un proceso Python por lote) ----
  for (let i = 0; i < toParse.length; i += PARSE_CHUNK) {
    const chunk = toParse.slice(i, i + PARSE_CHUNK);
    const items: ParseItem[] = chunk.map((e) => ({ id: e.id, pdf: paths.pdfFile(e.id), out: `${paths.tmpDir}/${e.id}.json`, cuatrimestreHint: e.hint }));
    let results;
    try {
      results = await parsePdfBatch(items);
    } catch (err) {
      stats.errors.push(`Extracción: ${(err as Error).message}`);
      log("refresh", `Lote de extracción falló: ${(err as Error).message}`);
      for (const e of chunk) markParseError(state, e.id, (err as Error).message);
      stats.parseFailed += chunk.length;
      continue;
    }
    for (const r of results) {
      const st = state.pdfs[r.id];
      if (!st) continue;
      if (r.ok) {
        const raw = JSON.parse(await fs.readFile(`${paths.tmpDir}/${r.id}.json`, "utf-8")) as Record<string, unknown>;
        delete raw.warnings; // diagnóstico interno: no hace falta enviarlo al público
        await writeJsonPublic(paths.scheduleFile(r.id), raw);
        await fs.rm(`${paths.tmpDir}/${r.id}.json`, { force: true });
        Object.assign(st, { status: "ok", parserVersion: PARSER_VERSION, parsedAt: new Date().toISOString(), cuatrimestre: r.cuatrimestre, subjects: r.subjects, warnings: r.warnings ?? [] });
        delete st.error;
        if (r.calendar) {
          st.calendar = r.calendar;
          delete st.calendarError;
        } else {
          delete st.calendar;
          st.calendarError = r.calendarError ?? "sin calendario";
          log("refresh", `PDF ${r.id}: no se pudo leer el calendario académico: ${st.calendarError}`);
        }
        stats.parsed++;
        if (r.warnings?.length) log("refresh", `PDF ${r.id}: ${r.warnings.length} aviso(s): ${r.warnings.slice(0, 2).join(" | ")}`);
      } else {
        markParseError(state, r.id, r.error ?? "error desconocido");
        stats.parseFailed++;
        stats.errors.push(`Extracción ${r.id}: ${r.error}`);
        log("refresh", `Extracción ${r.id} falló: ${r.error}`);
      }
    }
    await saveState(state); // progreso incremental: si se corta a medias, no se pierde lo ya hecho
  }

  // ---- 5. Limpieza de PDF que ya no aparecen en la web ----
  for (const [id, st] of Object.entries(state.pdfs)) {
    if (!entries.has(id) && hoursSince(st.lastSeenAt) > FORGET_AFTER_DAYS * 24) {
      await fs.rm(paths.pdfFile(id), { force: true });
      await fs.rm(paths.scheduleFile(id), { force: true });
      await fs.rm(`${paths.scheduleFile(id)}.gz`, { force: true });
      delete state.pdfs[id];
    }
  }

  return finish(state, stats, previous, { grados, horarios });
}

/** Devuelve true si el PDF hay que (re)procesar. */
async function checkPdf(e: PdfEntry, state: State, stats: RunStats, now: string): Promise<boolean> {
  const st = state.pdfs[e.id];
  const haveFiles = st ? (await exists(paths.pdfFile(e.id))) && (st.status !== "ok" || (await exists(paths.scheduleFile(e.id)))) : false;

  let reason: string | null = null;
  if (!st || !haveFiles) reason = "nuevo";
  else {
    st.lastSeenAt = now;
    st.url = e.url;
    stats.headChecks++;
    try {
      const head = await headPdf(e.url);
      if (head.contentLength !== null && head.contentLength !== st.contentLength) reason = `tamaño ${st.contentLength} -> ${head.contentLength}`;
    } catch (err) {
      // Si el HEAD falla no asumimos cambio: se conserva lo que hay.
      log("refresh", `HEAD ${e.id} falló (${(err as Error).message}); se conserva la versión actual`);
      return needsReparse(st);
    }
    if (!reason && config.fullVerifyDays > 0 && hoursSince(st.lastFullVerifyAt) >= config.fullVerifyDays * 24) reason = "verificación periódica";
  }

  if (!reason) {
    stats.unchanged++;
    return needsReparse(st!); // reprocesa si cambió el motor o el último intento falló
  }

  const buf = await downloadPdf(e.url);
  stats.downloaded++;
  const hash = sha256(buf);
  const head = { contentLength: buf.byteLength };

  if (st && haveFiles && st.sha256 === hash) {
    // Mismo contenido: sólo se refrescan los metadatos de verificación.
    st.contentLength = head.contentLength;
    st.lastFullVerifyAt = now;
    st.downloadedAt = now;
    stats.unchanged++;
    return needsReparse(st);
  }

  await writeFileAtomic(paths.pdfFile(e.id), buf);
  state.pdfs[e.id] = {
    url: e.url,
    contentLength: head.contentLength,
    sha256: hash,
    downloadedAt: now,
    lastFullVerifyAt: now,
    changedAt: now,
    lastSeenAt: now,
    parserVersion: 0, // pendiente de extraer
    status: "error",
    error: "pendiente de procesar",
  };
  stats.changed++;
  log("refresh", `PDF ${e.id} ${st ? "CAMBIÓ" : "nuevo"} (${reason})`);
  return true;
}

function markParseError(state: State, id: string, message: string): void {
  const st = state.pdfs[id];
  if (!st) return;
  st.status = "error";
  st.error = message.slice(0, 500);
  st.parserVersion = PARSER_VERSION;
  // Mejor no mostrar datos de una versión anterior del PDF que ya no es la vigente.
  void fs.rm(paths.scheduleFile(id), { force: true });
  void fs.rm(`${paths.scheduleFile(id)}.gz`, { force: true });
}

async function finish(state: State, stats: RunStats, previous: Catalog | null, scraped: { grados: Grado[]; horarios: Map<string, ScrapedHorarios> } | null): Promise<RunStats> {
  stats.finishedAt = new Date().toISOString();

  if (scraped) {
    const available = new Set<string>();
    for (const id of Object.keys(state.pdfs)) if (await exists(paths.scheduleFile(id))) available.add(id);

    const catalog = buildCatalog(scraped.grados, scraped.horarios, state.pdfs, available);
    // Grados cuya página falló en esta ejecución: se conserva la entrada anterior (no desaparecen del sitio por un fallo puntual).
    const have = new Set(catalog.grados.map((g) => g.slug));
    const kept: CatalogGrado[] = (previous?.grados ?? []).filter((g) => !have.has(g.slug) && scraped.grados.some((x) => x.slug === g.slug));
    catalog.grados.push(...kept);
    catalog.grados.sort((a, b) => scraped.grados.findIndex((g) => g.slug === a.slug) - scraped.grados.findIndex((g) => g.slug === b.slug));
    await writeJsonPublic(paths.catalog, catalog);
    state.lastSuccessAt = stats.finishedAt;

    // Índice global de asignaturas para el buscador (lee los horarios ya extraídos, ~3 KB cada uno).
    const schedules = [];
    for (const id of available) {
      const sch = await readJsonIfExists<{ id: string; rows: Array<{ subject: string }>; subjects: Array<{ acronym: string; name: string; curso: number | null }> }>(paths.scheduleFile(id));
      if (sch) schedules.push(sch);
    }
    await writeJsonPublic(paths.subjectIndex, buildSubjectIndex(schedules));

    const cal = await refreshCalendars(state);
    for (const n of cal.notes) log("refresh", n);
    const known = new Set(Object.keys(cal.effective));
    const missing = [...new Set(catalog.grados.map((g) => g.academicYear).filter((y): y is string => !!y && !known.has(y)))];
    if (missing.length) log("refresh", `ATENCIÓN: no hay calendario académico (festivos y cuatrimestres) para: ${missing.join(", ")}. Se extrae solo de los PDF; añádelo a mano en config/academic-calendar.json`);
    await writeFileAtomic(paths.status, JSON.stringify(publicStatus(state, stats, missing)));
  }

  state.lastRun = stats;
  await saveState(state);
  log(
    "refresh",
    `Fin: ${stats.pdfsSeen} PDF, ${stats.unchanged} sin cambios, ${stats.changed} cambiados/nuevos, ${stats.parsed} procesados, ${stats.parseFailed} con error, ${stats.errors.length} incidencia(s)`
  );
  return stats;
}

export function publicStatus(state: State, run: RunStats | undefined, missingAcademicYears: string[]) {
  return {
    lastRun: run ? { startedAt: run.startedAt, finishedAt: run.finishedAt, trigger: run.trigger, pdfsSeen: run.pdfsSeen, changed: run.changed, parseFailed: run.parseFailed, errors: run.errors.length } : null,
    lastSuccessAt: state.lastSuccessAt ?? null,
    refreshHours: config.refreshHours,
    missingAcademicYears,
  };
}

function needsReparse(st: PdfState): boolean {
  return st.parserVersion !== PARSER_VERSION || st.status === "error";
}
