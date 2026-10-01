import { config } from "./config.js";
import { log } from "./log.js";
import { pruneExcelCache } from "./excel.js";
import { isRefreshRunning, refresh } from "./pipeline/refresh.js";
import { loadState } from "./pipeline/state.js";
import { hoursSince } from "./util.js";

const CHECK_EVERY_MS = 10 * 60_000;

/**
 * Planificador interno. En vez de un setInterval de N horas (que se desajusta si el servidor se
 * reinicia o la máquina se suspende) se comprueba cada 10 min si ya toca, mirando cuándo terminó
 * la última ejecución correcta (persistida en state.json). Así un reinicio no repite trabajo ni
 * deja pasar más tiempo del debido.
 */
export function startScheduler(): () => void {
  const tick = async () => {
    if (isRefreshRunning()) return;
    try {
      const state = await loadState();
      // Tras un intento fallido se espera al menos 1 h antes de reintentar (no machacar la web de la EPI).
      const due = hoursSince(state.lastSuccessAt) >= config.refreshHours && hoursSince(state.lastRun?.finishedAt) >= 1;
      if (due) {
        await refresh(state.lastSuccessAt ? "schedule" : "startup");
        await pruneExcelCache();
      }
    } catch (err) {
      log("scheduler", `Error en la actualización: ${(err as Error).message}`);
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), CHECK_EVERY_MS);
  return () => clearInterval(timer);
}
