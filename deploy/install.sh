#!/usr/bin/env bash
# Instalación de EPIcal en un Debian/Ubuntu (VM, contenedor LXC o equipo físico). Ejecutar como root desde la
# carpeta del proyecto ya copiada al servidor:   sudo bash deploy/install.sh
#
# Requisitos previos: Node.js >= 20 (https://nodejs.org o NodeSource) y python3 con venv.
#   apt install -y python3 python3-venv
set -euo pipefail

APP_DIR=/opt/epical
DATA_DIR=/var/lib/epical
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"

command -v node >/dev/null || { echo "Falta Node.js >= 20"; exit 1; }
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' || { echo "Node.js debe ser >= 20"; exit 1; }
python3 -c 'import venv' 2>/dev/null || { echo "Falta python3-venv (apt install python3-venv)"; exit 1; }

id -u epical >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin epical
mkdir -p "$APP_DIR" "$DATA_DIR"

# Copia el proyecto (sin dependencias ni datos locales de desarrollo).
if [ "$SRC_DIR" != "$APP_DIR" ]; then
  tar -C "$SRC_DIR" --exclude=node_modules --exclude=.venv --exclude=data --exclude=dist --exclude=.git --exclude=.env -cf - . | tar -C "$APP_DIR" -xf -
fi

# Configuración: solo se crea la primera vez (no pisa cambios).
if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  sed -i "s#^DATA_DIR=.*#DATA_DIR=$DATA_DIR#" "$APP_DIR/.env"
  echo ">> Creado $APP_DIR/.env (revisa PORT, HOST, REFRESH_HOURS y ADMIN_TOKEN)."
fi

# Motor Python en un entorno virtual propio.
python3 -m venv "$APP_DIR/engine/.venv"
"$APP_DIR/engine/.venv/bin/pip" install --quiet --upgrade pip
"$APP_DIR/engine/.venv/bin/pip" install --quiet -r "$APP_DIR/engine/requirements.txt"

# Dependencias y compilación (servidor + web).
(cd "$APP_DIR" && npm run setup && npm run build)

chown -R epical:epical "$DATA_DIR"
chown -R root:root "$APP_DIR"
chmod 640 "$APP_DIR/.env" && chgrp epical "$APP_DIR/.env"

install -m 644 "$APP_DIR/deploy/epical.service" /etc/systemd/system/epical.service
systemctl daemon-reload
systemctl enable --now epical.service

echo
echo "EPIcal instalado. Estado:   systemctl status epical"
echo "Logs:                       journalctl -u epical -f"
echo "La primera descarga tarda ~1 min (ver los logs); despues se revisa cada REFRESH_HOURS horas."
