import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
dotenv.config({ path: path.join(root, ".env"), quiet: true });

function num(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} debe ser un número (recibido "${raw}")`);
  return n;
}

function resolveFromRoot(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(root, p);
}

export const config = {
  root,
  port: num("PORT", 8080),
  host: process.env.HOST ?? "0.0.0.0",
  dataDir: resolveFromRoot(process.env.DATA_DIR ?? "./data"),
  refreshHours: num("REFRESH_HOURS", 24),
  fullVerifyDays: num("FULL_VERIFY_DAYS", 7),
  scrapeConcurrency: Math.max(1, num("SCRAPE_CONCURRENCY", 3)),
  baseUrl: (process.env.EPI_BASE_URL ?? "https://epigijon.uniovi.es").replace(/\/$/, ""),
  pythonBin: resolveFromRoot(process.env.PYTHON_BIN ?? "./engine/.venv/bin/python"),
  engineDir: path.join(root, "engine"),
  academicCalendarPath: resolveFromRoot(process.env.ACADEMIC_CALENDAR ?? "./config/academic-calendar.json"),
  webDir: path.join(root, "web", "dist"),
  adminToken: process.env.ADMIN_TOKEN ?? "",
};

export type Config = typeof config;
