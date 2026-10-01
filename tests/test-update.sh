#!/usr/bin/env bash
# Prueba de deploy/update.sh (actualización automática con retroceso) SIN tocar el sistema:
# usa repositorios Git temporales y un install.sh falso que "despliega" copiando una marca.
#
#   bash tests/test-update.sh        (o: npm run test:update)
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

APP="$T/app" DATA="$T/data" REMOTE="$T/remote.git" PUSHER="$T/pusher" CLONE="$T/clone"
mkdir -p "$APP/deploy" "$DATA"
git init -q --bare -b main "$REMOTE"
git clone -q "$REMOTE" "$PUSHER" 2>/dev/null
git -C "$PUSHER" checkout -q -B main
mkdir -p "$PUSHER/deploy"

# install.sh falso: copia MARK a "deployed" y falla si existe BREAK_INSTALL.
cat >"$PUSHER/deploy/install.sh" <<'FAKE'
#!/usr/bin/env bash
HERE="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$HERE/BREAK_INSTALL" ] && { echo "install falso: fallo a propósito"; exit 1; }
cp "$HERE/MARK" "$EPICAL_APP_DIR/deployed"
FAKE

push_version() { # <marca> [archivo-extra]
  echo "$1" >"$PUSHER/MARK"
  [ -n "${2:-}" ] && touch "$PUSHER/$2"
  git -C "$PUSHER" add -A && git -C "$PUSHER" commit -q -m "version $1" && git -C "$PUSHER" push -q origin main 2>/dev/null
}
head_of() { git -C "$CLONE" rev-parse HEAD; }
remote_head() { git -C "$PUSHER" rev-parse HEAD; }

push_version v1
git clone -q "$REMOTE" "$CLONE" 2>/dev/null
echo "$CLONE" >"$APP/.source-dir"
cp "$ROOT/deploy/update.sh" "$APP/deploy/update.sh"
cp "$CLONE/MARK" "$APP/deployed"

export EPICAL_APP_DIR="$APP" EPICAL_DATA_DIR="$DATA" EPICAL_UPDATE_LOCK="$T/lock"
# "Sano" = la marca desplegada no es "bad".
export EPICAL_HEALTH_CMD='[ "$(cat "$EPICAL_APP_DIR/deployed")" != "bad" ]'

OUT="" CODE=0
run_update() { OUT="$(bash "$APP/deploy/update.sh" 2>&1)"; CODE=$?; }

fails=0
check() { # <descripción> <condición>
  if eval "$2"; then echo "  ok   $1"; else echo "  FALLA $1"; echo "$OUT" | sed 's/^/        | /'; fails=$((fails + 1)); fi
}

echo "1) Sin cambios"
run_update
check "sale bien y no despliega" '[ $CODE -eq 0 ] && ! grep -q "Desplegando" <<<"$OUT"'
check "sigue en v1" '[ "$(cat "$APP/deployed")" = v1 ]'

echo "2) Versión nueva correcta"
push_version v2
run_update
check "despliega v2" '[ $CODE -eq 0 ] && [ "$(cat "$APP/deployed")" = v2 ] && [ "$(head_of)" = "$(remote_head)" ]'
check "anota la última actualización correcta" '[ -s "$DATA/update-last-ok" ]'
GOOD_V2="$(head_of)"

echo "3) Versión que arranca mal -> retroceso"
push_version bad
BAD_SHA="$(remote_head)"
run_update
check "vuelve a v2 y avisa con código 1" '[ $CODE -eq 1 ] && [ "$(cat "$APP/deployed")" = v2 ] && [ "$(head_of)" = "$GOOD_V2" ]'
check "apunta el commit malo" '[ "$(cat "$DATA/update-bad-commit")" = "$BAD_SHA" ]'

echo "4) El commit malo no se reintenta"
run_update
check "silencio, sin redespliegue" '[ $CODE -eq 0 ] && ! grep -q "Desplegando" <<<"$OUT" && [ "$(cat "$APP/deployed")" = v2 ]'

echo "5) Llega un commit nuevo bueno"
push_version v4
run_update
check "despliega v4 y olvida el commit malo" '[ $CODE -eq 0 ] && [ "$(cat "$APP/deployed")" = v4 ] && [ ! -e "$DATA/update-bad-commit" ]'
GOOD_V4="$(head_of)"

echo "6) La instalación falla -> retroceso"
push_version v5 BREAK_INSTALL
run_update
check "vuelve a v4 y avisa con código 1" '[ $CODE -eq 1 ] && [ "$(cat "$APP/deployed")" = v4 ] && [ "$(head_of)" = "$GOOD_V4" ]'

echo "7) Force-push en el remoto"
git -C "$PUSHER" reset -q --hard HEAD~3
git -C "$PUSHER" push -q -f origin main 2>/dev/null
run_update
check "no toca nada y avisa" '[ $CODE -eq 1 ] && grep -q "historial" <<<"$OUT" && [ "$(cat "$APP/deployed")" = v4 ]'

echo "8) Sin repositorio de origen"
rm "$APP/.source-dir"
run_update
check "falla con un mensaje claro" '[ $CODE -eq 1 ] && grep -q "repositorio de origen" <<<"$OUT"'

echo
if [ "$fails" -eq 0 ]; then echo "OK: todos los escenarios de actualización pasan."; else echo "$fails comprobación(es) fallida(s)."; exit 1; fi
