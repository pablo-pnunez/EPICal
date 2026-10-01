// Test de equivalencia: eventos del navegador (TypeScript) == eventos del motor Python original.
// Requiere haber ejecutado al menos una vez la actualización (`npm run refresh`) para tener horarios reales.
// Se ejecuta con distintas zonas horarias para comprobar que el resultado NO depende de la del navegador.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "../server/node_modules/dotenv/lib/main.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env"), quiet: true });
const resolve = (p, def) => (path.isAbsolute(p ?? def) ? (p ?? def) : path.resolve(root, p ?? def));
const dataDir = resolve(process.env.DATA_DIR, "./data");
const python = resolve(process.env.PYTHON_BIN, "./engine/.venv/bin/python");
const oracle = path.join(root, "tests", ".py_events.json");

if (!fs.existsSync(path.join(dataDir, "public", "schedules"))) {
  console.error(`No hay horarios en ${dataDir}. Ejecuta antes: npm run refresh`);
  process.exit(2);
}

let r = spawnSync(python, [path.join(root, "tests", "py_events.py"), dataDir, oracle], { stdio: "inherit", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
if (r.status !== 0) process.exit(r.status ?? 1);

const tsx = path.join(root, "web", "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
for (const tz of ["Europe/Madrid", "UTC", "America/Los_Angeles", "Asia/Tokyo"]) {
  r = spawnSync(tsx, [path.join(root, "web", "src", "lib", "events.test.ts")], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, TZ: tz, EPICAL_DATA_DIR: dataDir, EPICAL_ORACLE: oracle },
  });
  if (r.status !== 0) {
    console.error(`FALLO con TZ=${tz}`);
    process.exit(r.status ?? 1);
  }
}
fs.rmSync(oracle, { force: true });
console.log("OK: equivalencia verificada en 4 zonas horarias");
