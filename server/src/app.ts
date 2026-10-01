import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import compress from "@fastify/compress";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { config } from "./config.js";
import { ExcelError, buildExcel } from "./excel.js";
import { ID_RE, paths } from "./paths.js";
import { effectiveCalendar } from "./pipeline/calendar.js";
import { isRefreshRunning, refresh } from "./pipeline/refresh.js";
import { ensureDir, exists } from "./util.js";

interface ExcelBody {
  id?: unknown;
  subject?: unknown;
  groups?: unknown;
  academicYear?: unknown;
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, trustProxy: true, bodyLimit: 64 * 1024 });
  await ensureDir(paths.publicDir);

  // Cabeceras de seguridad: la web es estática (sin scripts ni estilos en línea, salvo atributos style de React).
  app.addHook("onSend", async (_req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self'; style-src-attr 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  });

  // La compresión se hace on-the-fly para la API; los JSON de /data/ ya están precomprimidos (.gz).
  await app.register(compress, { global: true, encodings: ["gzip", "deflate"] });
  await app.register(rateLimit, { global: false });

  // ---- Datos públicos: catálogo y horarios ya extraídos ----
  await app.register(fastifyStatic, {
    root: paths.publicDir,
    prefix: "/data/",
    preCompressed: true,
    decorateReply: false,
    // El catálogo cambia como mucho una vez al día: 5 min de caché + revalidación por ETag.
    cacheControl: false,
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "public, max-age=300, must-revalidate");
    },
  });

  // ---- Calendario académico (festivos/cuatrimestres): extraído de los PDF + correcciones manuales opcionales ----
  app.get("/api/academic-calendar", async (req, reply) => {
    const { effective } = await effectiveCalendar();
    const text = JSON.stringify(effective);
    const etag = `"${crypto.createHash("sha1").update(text).digest("hex")}"`;
    reply.header("ETag", etag).header("Cache-Control", "public, max-age=300, must-revalidate");
    if (req.headers["if-none-match"] === etag) return reply.code(304).send();
    return reply.type("application/json; charset=utf-8").send(text);
  });

  app.get("/healthz", async () => ({ ok: true, refreshing: isRefreshRunning() }));

  // ---- Excel por asignatura (Python + caché en disco) ----
  app.post("/api/excel", { config: { rateLimit: { max: 15, timeWindow: "1 minute" } } }, async (req, reply) => {
    const b = (req.body ?? {}) as ExcelBody;
    const id = typeof b.id === "string" ? b.id : "";
    const subject = typeof b.subject === "string" ? b.subject : "";
    const academicYear = typeof b.academicYear === "string" ? b.academicYear : "";
    const groups = Array.isArray(b.groups) ? b.groups.filter((g): g is string => typeof g === "string").slice(0, 100) : [];
    if (!ID_RE.test(id) || !subject || subject.length > 120 || !/^\d{4}-\d{4}$/.test(academicYear)) {
      return reply.code(400).send({ error: "Petición inválida" });
    }
    try {
      const { filename, buffer } = await buildExcel({ id, subject, groups, academicYear });
      return reply
        .header("Content-Type", XLSX_MIME)
        .header("Content-Disposition", `attachment; filename="horario.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`)
        .send(buffer);
    } catch (err) {
      if (err instanceof ExcelError) return reply.code(err.status).send({ error: err.message });
      req.log.error(err);
      return reply.code(500).send({ error: "Error generando el Excel" });
    }
  });

  // ---- Administración: forzar una actualización ----
  app.post("/api/admin/refresh", async (req, reply) => {
    if (!config.adminToken) return reply.code(404).send({ error: "No encontrado" });
    const auth = req.headers.authorization ?? "";
    if (!auth.startsWith("Bearer ") || !safeEqual(auth.slice(7), config.adminToken)) return reply.code(401).send({ error: "No autorizado" });
    if (isRefreshRunning()) return reply.code(409).send({ error: "Ya hay una actualización en curso" });
    void refresh("manual").catch((err) => req.log.error(err));
    return reply.code(202).send({ started: true });
  });

  // ---- Frontend (SPA) ----
  if (await exists(config.webDir)) {
    await app.register(fastifyStatic, {
      root: config.webDir,
      prefix: "/",
      wildcard: false,
      cacheControl: false,
      setHeaders: (res, filePath) => {
        // Los ficheros de /assets llevan hash en el nombre: inmutables. El resto (index.html...) siempre se revalida.
        res.setHeader("Cache-Control", filePath.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache");
      },
    });
    const indexHtml = await fs.readFile(path.join(config.webDir, "index.html"), "utf-8");
    app.setNotFoundHandler((req, reply) => {
      const url = req.raw.url ?? "";
      if (req.method !== "GET" || url.startsWith("/api/") || url.startsWith("/data/")) return reply.code(404).send({ error: "No encontrado" });
      return reply.header("Cache-Control", "no-cache").type("text/html; charset=utf-8").send(indexHtml);
    });
  } else {
    app.log.warn(`No existe ${config.webDir}: el frontend no se servirá (ejecuta "npm run build" en web/).`);
  }

  return app;
}
