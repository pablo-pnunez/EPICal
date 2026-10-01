#!/usr/bin/env bash
# Instalación de EPIcal en Debian/Ubuntu (VM, contenedor LXC o equipo físico).
#
# Ejecutar COMO ROOT desde la carpeta del proyecto (p. ej. tras `git clone`):
#
#   bash deploy/install.sh --install-deps      # instala también lo que falte (python3-venv, Node.js 22)
#   bash deploy/install.sh                     # solo comprueba requisitos e instala EPIcal
#   bash deploy/install.sh --auto-update       # además, se actualiza sola cuando haya commits nuevos en Git
#
# Es seguro volver a ejecutarlo para actualizar: no pisa `.env` ni los datos.
set -euo pipefail

APP_DIR=/opt/epical
DATA_DIR=/var/lib/epical
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL_DEPS=0
AUTO_UPDATE=keep # keep = no tocar la configuración actual | on | off

usage() {
  cat <<'EOF'
Uso: bash deploy/install.sh [--install-deps] [--auto-update | --disable-auto-update]

  --install-deps         Instala con apt lo que falte: python3, python3-venv, curl y Node.js 22
                         (este último desde el repositorio oficial NodeSource).
  --auto-update          Activa la actualización automática: cada ~10 min mira si hay commits nuevos en
                         la rama que sigue este clon y, si los hay, los despliega (con retroceso si falla).
  --disable-auto-update  Desactiva la actualización automática.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --install-deps) INSTALL_DEPS=1 ;;
    --auto-update) AUTO_UPDATE=on ;;
    --disable-auto-update) AUTO_UPDATE=off ;;
    -h | --help) usage; exit 0 ;;
    *) echo "Opción desconocida: $arg"; usage; exit 1 ;;
  esac
done

[ "$(id -u)" -eq 0 ] || { echo "Ejecuta este script como root (o con sudo)."; exit 1; }
command -v systemctl >/dev/null || { echo "Este instalador necesita systemd (systemctl)."; exit 1; }

node_ok() {
  command -v node >/dev/null && command -v npm >/dev/null && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)'
}
python_ok() {
  command -v python3 >/dev/null && python3 -c 'import sys, venv, ensurepip; sys.exit(0 if sys.version_info >= (3, 9) else 1)' 2>/dev/null
}

# ---- Dependencias del sistema ----
if [ "$INSTALL_DEPS" = 1 ]; then
  command -v apt-get >/dev/null || { echo "--install-deps solo funciona con apt (Debian/Ubuntu)."; exit 1; }
  echo ">> Instalando python3, python3-venv, curl y certificados…"
  apt-get update -qq
  apt-get install -y -qq python3 python3-venv curl ca-certificates
  if ! node_ok; then
    echo ">> Instalando Node.js 22 (repositorio NodeSource)…"
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y -qq nodejs
  fi
fi

missing=0
if ! node_ok; then
  echo "FALTA: Node.js >= 20 con npm (versión actual: $(node -v 2>/dev/null || echo 'no instalado'))."
  missing=1
fi
if ! python_ok; then
  echo "FALTA: python3 >= 3.9 con el módulo venv (en Debian/Ubuntu: apt install python3 python3-venv)."
  missing=1
fi
if [ "$missing" = 1 ]; then
  echo
  echo "Puedes dejar que el instalador lo resuelva con:   bash deploy/install.sh --install-deps"
  exit 1
fi

# Aviso de espacio: venv de Python (~300 MB) + dependencias Node + datos descargados (~200 MB).
free_kb=$(df -Pk / | awk 'NR==2 {print $4}')
if [ "${free_kb:-0}" -lt 1500000 ]; then
  echo "AVISO: quedan menos de 1,5 GB libres en /. EPIcal necesita ~1 GB para instalarse y ~200 MB para los datos."
fi

# ---- Usuario, carpetas y copia del proyecto ----
id -u epical >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin epical
mkdir -p "$APP_DIR" "$DATA_DIR"

# Copia el proyecto (sin dependencias ni datos locales de desarrollo).
if [ "$SRC_DIR" != "$APP_DIR" ]; then
  # El código fuente se reemplaza entero: tar no borra, y un fichero eliminado en Git seguiría compilándose.
  rm -rf "$APP_DIR/server/src" "$APP_DIR/web/src"
  tar -C "$SRC_DIR" --exclude=node_modules --exclude=.venv --exclude=data --exclude=dist --exclude=.git --exclude=.env -cf - . | tar -C "$APP_DIR" -xf -
fi

# Configuración: solo se crea la primera vez (no pisa cambios).
if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  sed -i "s#^DATA_DIR=.*#DATA_DIR=$DATA_DIR#" "$APP_DIR/.env"
  echo ">> Creado $APP_DIR/.env (puedes ajustar PORT, HOST, REFRESH_HOURS y ADMIN_TOKEN)."
fi

# ---- Motor Python en un entorno virtual propio ----
echo ">> Instalando el motor Python (puede tardar un par de minutos)…"
python3 -m venv "$APP_DIR/engine/.venv"
"$APP_DIR/engine/.venv/bin/pip" install --quiet --no-cache-dir --upgrade pip
"$APP_DIR/engine/.venv/bin/pip" install --quiet --no-cache-dir -r "$APP_DIR/engine/requirements.txt"

# ---- Servidor y web: dependencias + compilación ----
echo ">> Compilando servidor y web…"
(cd "$APP_DIR" && npm run setup && npm run build)

# Tras compilar sobran las dependencias de desarrollo y la caché de npm (ahorra ~300 MB en contenedores pequeños).
rm -rf "$APP_DIR/web/node_modules"
(cd "$APP_DIR/server" && npm prune --omit=dev --silent)
npm cache clean --force >/dev/null 2>&1 || true

# Clon de Git desde el que se instaló: la actualización automática hace ahí el git pull.
echo "$SRC_DIR" >"$APP_DIR/.source-dir"
chmod 755 "$APP_DIR/deploy/update.sh"

chown -R epical:epical "$DATA_DIR"
chown -R root:root "$APP_DIR"
chmod 640 "$APP_DIR/.env" && chgrp epical "$APP_DIR/.env"

# ---- Servicio systemd ----
install -m 644 "$APP_DIR/deploy/epical.service" /etc/systemd/system/epical.service
install -m 644 "$APP_DIR/deploy/epical-update.service" /etc/systemd/system/epical-update.service
install -m 644 "$APP_DIR/deploy/epical-update.timer" /etc/systemd/system/epical-update.timer
systemctl daemon-reload
case "$AUTO_UPDATE" in
  on)
    if [ ! -d "$SRC_DIR/.git" ]; then
      echo "AVISO: $SRC_DIR no es un clon de Git, así que la actualización automática no puede funcionar. Instala desde un git clone."
    elif ! git -C "$SRC_DIR" -c safe.directory="$SRC_DIR" rev-parse --verify --quiet "@{u}" >/dev/null; then
      echo "AVISO: la rama actual de $SRC_DIR no sigue a ninguna rama remota; la actualización automática no podrá consultar cambios."
    else
      systemctl enable --now epical-update.timer >/dev/null
      echo ">> Actualización automática ACTIVADA (cada ~10 min, con retroceso si una versión falla)."
    fi
    ;;
  off)
    systemctl disable --now epical-update.timer >/dev/null 2>&1 || true
    echo ">> Actualización automática desactivada."
    ;;
esac
systemctl enable epical.service >/dev/null
systemctl restart epical.service
sleep 3
if ! systemctl is-active --quiet epical.service; then
  echo
  echo "El servicio no ha arrancado. Revisa:   journalctl -u epical -n 50 --no-pager"
  exit 1
fi

port=$(grep -E '^PORT=' "$APP_DIR/.env" | tail -1 | cut -d= -f2)
ip=$(hostname -I 2>/dev/null | awk '{print $1}')
echo
echo "EPIcal instalado y en marcha."
echo "  Web:       http://${ip:-<IP-de-esta-máquina>}:${port:-8080}"
echo "  Estado:    systemctl status epical"
echo "  Logs:      journalctl -u epical -f"
if systemctl is-enabled --quiet epical-update.timer 2>/dev/null; then
  echo "  Actualización automática: activada (journalctl -u epical-update -n 50)"
else
  echo "  Actualización automática: desactivada (actívala con: bash deploy/install.sh --auto-update)"
fi
echo "La primera descarga de PDF tarda 1-3 minutos; hasta entonces la web mostrará que no hay horarios."
echo "Después se revisa la web de la EPI cada REFRESH_HOURS horas (24 por defecto)."
