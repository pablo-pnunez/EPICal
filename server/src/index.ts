import { buildApp } from "./app.js";
import { config } from "./config.js";
import { log } from "./log.js";
import { startScheduler } from "./scheduler.js";

const app = await buildApp();
await app.listen({ port: config.port, host: config.host });
log("epical", `Escuchando en http://${config.host}:${config.port} — datos en ${config.dataDir}`);
log("epical", `Actualización cada ${config.refreshHours} h (verificación completa de PDF cada ${config.fullVerifyDays} días)`);

const stopScheduler = startScheduler();

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    log("epical", `${sig}: cerrando…`);
    stopScheduler();
    await app.close();
    process.exit(0);
  });
}
