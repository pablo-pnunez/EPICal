import path from "node:path";
import { config } from "./config.js";

/** Distribución de la carpeta de datos (DATA_DIR). Todo lo que hay bajo `public/` se sirve tal cual por HTTP. */
export const paths = {
  state: path.join(config.dataDir, "state.json"),
  pdfDir: path.join(config.dataDir, "pdf"),
  tmpDir: path.join(config.dataDir, "tmp"),
  excelCache: path.join(config.dataDir, "excel-cache"),
  publicDir: path.join(config.dataDir, "public"),
  catalog: path.join(config.dataDir, "public", "catalog.json"),
  scheduleDir: path.join(config.dataDir, "public", "schedules"),
  status: path.join(config.dataDir, "public", "status.json"),
  changes: path.join(config.dataDir, "public", "changes.json"),
  subjectIndex: path.join(config.dataDir, "public", "subjects-index.json"),
  pdfFile: (id: string) => path.join(config.dataDir, "pdf", `${id}.pdf`),
  scheduleFile: (id: string) => path.join(config.dataDir, "public", "schedules", `${id}.json`),
};

/** Los ids salen de la URL del PDF (uuid de Liferay) o de un hash; nunca se aceptan otros caracteres (evita path traversal). */
export const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
