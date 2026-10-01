#!/usr/bin/env bash
# Actualización automática de EPIcal desde Git, con retroceso si la versión nueva no funciona.
#
# Lo ejecuta el temporizador `epical-update.timer` (cada ~10 min, como root). Se puede lanzar a mano:
#   systemctl start epical-update.service     # y mira el resultado con: journalctl -u epical-update -n 50
#
# Qué hace:
#   1. `git fetch` en el clon desde el que se instaló (ruta guardada en /opt/epical/.source-dir).
#   2. Si `main` (el upstream de la rama actual) tiene commits nuevos y avanzan limpiamente (fast-forward),
#      hace el merge y vuelve a ejecutar deploy/install.sh (reconstruye y reinicia el servicio).
#   3. Comprueba que el servicio responde (/healthz) y que sigue vivo unos segundos después.
#   4. Si algo falla: vuelve al commit anterior, lo reinstala, y apunta el commit malo para NO reintentarlo
#      hasta que llegue otro commit nuevo. Un ciclo con retroceso sale con error (se ve en `systemctl status`).
#
# Variables EPICAL_* solo para las pruebas (tests/test-update.sh); en producción no hace falta tocarlas.
#
# Todo el script va dentro de una función y la última línea es `main; exit`: así bash lo lee entero antes de
# ejecutar nada, y no se rompe aunque el propio script se sustituya durante el despliegue.

main() {
  local APP_DIR="${EPICAL_APP_DIR:-/opt/epical}"
  local DATA_DIR="${EPICAL_DATA_DIR:-/var/lib/epical}"
  local LOCK="${EPICAL_UPDATE_LOCK:-/run/lock/epical-update.lock}"
  local SRC
  SRC="$(cat "$APP_DIR/.source-dir" 2>/dev/null || true)"

  log() { echo "[epical-update] $*"; }
  g() { git -C "$SRC" -c safe.directory="$SRC" "$@"; }

  if [ -z "$SRC" ] || [ ! -d "$SRC/.git" ]; then
    log "No encuentro el repositorio de origen (${SRC:-sin definir}). Vuelve a ejecutar 'bash deploy/install.sh' desde tu clon de Git."
    return 1
  fi

  # Una sola actualización a la vez (si no hay flock, se sigue sin bloqueo).
  if command -v flock >/dev/null 2>&1; then
    exec 9>"$LOCK"
    flock -n 9 || { log "Ya hay otra actualización en curso."; return 0; }
  fi

  if ! g fetch --quiet; then
    log "git fetch falló (¿sin red?). Se reintentará en el próximo ciclo."
    return 0
  fi

  local upstream current bad prev
  upstream="$(g rev-parse --verify --quiet '@{u}')" || { log "La rama actual no sigue a ninguna rama remota (upstream)."; return 1; }
  current="$(g rev-parse HEAD)"
  [ "$current" = "$upstream" ] && return 0 # nada nuevo

  # Un commit que ya falló no se reintenta hasta que llegue otro.
  bad="$(cat "$DATA_DIR/update-bad-commit" 2>/dev/null || true)"
  [ "$upstream" = "$bad" ] && return 0

  mkdir -p "$DATA_DIR"
  if ! g merge-base --is-ancestor "$current" "$upstream"; then
    log "El historial remoto no continúa el desplegado (¿force-push?). No se actualiza sola; resuélvelo a mano en $SRC."
    echo "$upstream" >"$DATA_DIR/update-bad-commit"
    return 1
  fi

  prev="$current"
  log "Versión nueva: $(g log --oneline -1 "$upstream")"
  if ! g merge --ff-only --quiet "$upstream"; then
    log "No se pudo avanzar el repositorio local (¿cambios locales en conflicto?). No se despliega."
    return 1
  fi

  local install="${EPICAL_INSTALL_SCRIPT:-$SRC/deploy/install.sh}"

  # Comprobación de salud: el servicio responde y no se cae justo después de arrancar.
  ping_health() {
    local port
    port="$(grep -E '^PORT=' "$APP_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2)"
    node -e "fetch('http://127.0.0.1:${port:-8080}/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" 2>/dev/null
  }
  healthy() {
    if [ -n "${EPICAL_HEALTH_CMD:-}" ]; then bash -c "$EPICAL_HEALTH_CMD"; return; fi
    local i
    for i in $(seq 1 30); do
      if ping_health; then
        sleep 5
        systemctl is-active --quiet epical.service && ping_health && return 0
        return 1
      fi
      sleep 2
    done
    return 1
  }

  log "Desplegando $(g rev-parse --short HEAD)…"
  if bash "$install" && healthy; then
    rm -f "$DATA_DIR/update-bad-commit"
    date -u +"%Y-%m-%dT%H:%M:%SZ $(g rev-parse --short HEAD)" >"$DATA_DIR/update-last-ok"
    log "Actualizado correctamente a $(g rev-parse --short HEAD)."
    return 0
  fi

  # ---- Retroceso ----
  log "ERROR: la versión nueva no funciona. Retrocediendo a $(g rev-parse --short "$prev")…"
  echo "$upstream" >"$DATA_DIR/update-bad-commit"
  g reset --hard --quiet "$prev"
  if bash "$install" && healthy; then
    log "Retroceso completado: sigue la versión anterior. No se reintentará $(g rev-parse --short "$upstream") hasta que haya un commit nuevo."
    return 1
  fi
  log "RETROCESO FALLIDO: el servicio no responde ni con la versión anterior. Hace falta intervención manual (journalctl -u epical -n 50)."
  return 2
}

main "$@"; exit $?
