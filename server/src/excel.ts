import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { paths } from "./paths.js";
import { effectiveCalendar } from "./pipeline/calendar.js";
import { runPython } from "./pipeline/python.js";
import type { ParsedSchedule } from "./types.js";
import { ensureDir, exists, readJsonIfExists, sha256, writeFileAtomic } from "./util.js";

export class ExcelError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export interface ExcelRequest {
  id: string;
  subject: string;
  groups: string[];
  academicYear: string;
}

const MAX_PARALLEL = 2;
let active = 0;
const waiting: Array<() => void> = [];
async function acquire(): Promise<void> {
  if (active < MAX_PARALLEL) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
}
function release(): void {
  const next = waiting.shift();
  if (next) next();
  else active--;
}

/** Misma normalización que usa el motor al emparejar acrónimos de la rejilla con los de la leyenda (sin tildes, mayúsculas). */
export function normalizeAcronym(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase();
}

const inflight = new Map<string, Promise<{ filename: string; buffer: Buffer }>>();

/** Genera (o recupera de caché) el Excel de una asignatura. Las peticiones idénticas simultáneas comparten una sola generación. */
export function buildExcel(req: ExcelRequest): Promise<{ filename: string; buffer: Buffer }> {
  const key = cacheKeyOf(req);
  let p = inflight.get(key);
  if (!p) {
    p = doBuild(req).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

function cacheKeyOf(req: ExcelRequest): string {
  return `${req.id}|${req.subject}|${[...req.groups].sort().join(",")}|${req.academicYear}`;
}

async function doBuild(req: ExcelRequest): Promise<{ filename: string; buffer: Buffer }> {
  const schedule = await readJsonIfExists<ParsedSchedule>(paths.scheduleFile(req.id));
  if (!schedule) throw new ExcelError("Horario no encontrado", 404);
  if (!schedule.rows.some((r) => r.subject === req.subject)) throw new ExcelError("La asignatura no existe en este horario", 404);

  const { effective: calendar } = await effectiveCalendar();
  const calendarText = JSON.stringify(calendar);
  if (!calendar[req.academicYear]) throw new ExcelError(`No hay festivos configurados para el curso ${req.academicYear}`, 422);

  const legend = schedule.subjects.find((s) => normalizeAcronym(s.acronym) === normalizeAcronym(req.subject));
  const displayName = legend?.name || req.subject;

  // La clave incluye el contenido del horario y del calendario: si cualquiera cambia, la caché se invalida sola.
  const hash = sha256(JSON.stringify([cacheKeyOf(req), schedule.parsedAt, sha256(calendarText)])).slice(0, 32);
  await ensureDir(paths.excelCache);
  const xlsxPath = path.join(paths.excelCache, `${hash}.xlsx`);
  const namePath = path.join(paths.excelCache, `${hash}.name`);
  if ((await exists(xlsxPath)) && (await exists(namePath))) {
    return { filename: await fs.readFile(namePath, "utf-8"), buffer: await fs.readFile(xlsxPath) };
  }

  await acquire();
  try {
    await ensureDir(paths.tmpDir);
    const reqFile = path.join(paths.tmpDir, `excel-${hash}-${process.pid}.json`);
    const calFile = path.join(paths.tmpDir, `calendar-${hash}-${process.pid}.json`);
    await fs.writeFile(calFile, calendarText, "utf-8");
    await fs.writeFile(
      reqFile,
      JSON.stringify({
        rows: schedule.rows,
        cuatrimestre: schedule.cuatrimestre,
        academicYear: req.academicYear,
        subjectName: req.subject,
        displayName,
        groups: req.groups,
      }),
      "utf-8"
    );
    try {
      const { stdout, stderr, code } = await runPython("generate_excel.py", [reqFile], { EPICAL_ACADEMIC_CALENDAR: calFile }, 120_000);
      let out: { filename?: string; contentBase64?: string; error?: string };
      try {
        out = JSON.parse(stdout);
      } catch {
        throw new ExcelError(`El generador de Excel falló (código ${code}): ${stderr.slice(-300)}`, 500);
      }
      if (out.error || !out.contentBase64 || !out.filename) throw new ExcelError(out.error ?? "No se pudo generar el Excel", 422);
      const buffer = Buffer.from(out.contentBase64, "base64");
      await writeFileAtomic(xlsxPath, buffer);
      await writeFileAtomic(namePath, out.filename);
      return { filename: out.filename, buffer };
    } finally {
      await fs.rm(reqFile, { force: true });
      await fs.rm(calFile, { force: true });
    }
  } finally {
    release();
  }
}

/** Borra del caché los Excel no tocados en `maxAgeDays` días. */
export async function pruneExcelCache(maxAgeDays = 14): Promise<void> {
  if (!(await exists(paths.excelCache))) return;
  const limit = Date.now() - maxAgeDays * 86_400_000;
  for (const f of await fs.readdir(paths.excelCache)) {
    const p = path.join(paths.excelCache, f);
    const st = await fs.stat(p);
    if (st.mtimeMs < limit) await fs.rm(p, { force: true });
  }
}
