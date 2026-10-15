import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { ensureDir } from "../util.js";
import { paths } from "../paths.js";
import type { CalendarData } from "../types.js";

export interface ParseItem {
  id: string;
  pdf: string;
  out: string;
  kind?: "horario" | "exam";
  /** Solo "horario". */
  cuatrimestreHint?: 1 | 2 | null;
  /** Solo "exam": año académico de referencia ("2026-2027") si el PDF no trae título legible. */
  academicYearHint?: string | null;
}

export interface ParseResult {
  id: string;
  ok: boolean;
  error?: string;
  // ---- "horario" ----
  cuatrimestre?: 1 | 2;
  subjects?: number;
  rows?: number;
  calendar?: CalendarData | null;
  calendarError?: string | null;
  // ---- "exam" ----
  exams?: number;
  // ---- comunes ----
  warnings?: string[];
}

export function runPython(script: string, args: string[], env: Record<string, string> = {}, timeoutMs = 15 * 60_000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.pythonBin, [path.join(config.engineDir, script), ...args], {
      cwd: config.engineDir,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", PYTHONDONTWRITEBYTECODE: "1", ...env },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString("utf-8")));
    child.stderr.on("data", (d) => (stderr += d.toString("utf-8")));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${script} superó el tiempo máximo (${timeoutMs / 1000}s)`));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`No se pudo ejecutar Python (${config.pythonBin}): ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? -1 });
    });
  });
}

/** Procesa un lote de PDF en un único proceso Python. */
export async function parsePdfBatch(items: ParseItem[]): Promise<ParseResult[]> {
  if (items.length === 0) return [];
  await ensureDir(paths.tmpDir);
  const manifest = path.join(paths.tmpDir, `manifest-${process.pid}-${Date.now()}.json`);
  await fs.writeFile(manifest, JSON.stringify({ items }), "utf-8");
  try {
    const { stdout, stderr, code } = await runPython("parse_batch.py", [manifest]);
    let parsed: { results?: ParseResult[]; error?: string };
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new Error(`parse_batch.py no devolvió JSON (código ${code}). stderr: ${stderr.slice(-800)}`);
    }
    if (!parsed.results) throw new Error(parsed.error ?? "parse_batch.py no devolvió resultados");
    return parsed.results;
  } finally {
    await fs.rm(manifest, { force: true });
  }
}
