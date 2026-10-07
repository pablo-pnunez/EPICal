# EPIcal

Web pública de **horarios de la EPI Gijón**. Cada _X_ horas (24 por defecto) revisa la web de la escuela, descarga los PDF de horarios de todos los grados y cursos **solo si han cambiado**, extrae su contenido y lo publica ya procesado, de forma que consultar, personalizar y exportar sea instantáneo para quien lo usa.

## Qué hace

- **Catálogo**: descubre solos los grados y sus PDF (no hay listas hardcodeadas): 11 grados, ~110 PDF distintos.
- **Detección de cambios en dos niveles** (la web de la EPI no envía `ETag` ni `Last-Modified`, así que no sirve el `If-Modified-Since`):
  1. `HEAD` a cada PDF y comparación del `Content-Length` — una pasada completa sin cambios cuesta ~5 s y **cero descargas**.
  2. Cada `FULL_VERIFY_DAYS` (7) se descarga todo una vez y se compara el SHA-256, por si la EPI reemplazara un PDF por otro del mismo tamaño. Si el hash es igual, no se reprocesa.
- **Extracción** (Python, `engine/timetable.py`): lee la tabla por posición de las palabras, soporta PDF con **varias tablas** (itinerarios, «optativas comunes»), tablas que **continúan en una segunda página** y celdas con **actividades apiladas**; además extrae la **leyenda acrónimo → nombre real** de cada PDF. Ver «Cobertura y calidad» más abajo.
- **Web** (React, `web/`): buscador de grados y asignaturas, selección de asignaturas y grupos concretos (PL, PA, TG, teoría…), calendario mensual y semanal, resumen de horas, huecos libres del curso, comparación de grupos de prácticas, y exportación:
  - **`.ics` generado en el navegador** (un único calendario, o uno por asignatura / tipo de actividad / grupo, en un `.zip`), con o sin festivos. No carga al servidor.
  - **Excel** por asignatura (generado en el servidor con Python y cacheado en disco).
  - La selección vive en la URL: «Copiar enlace con mi selección».

## URLs legibles y marcadores

```
/grado/informatica                          todos los horarios del grado
/grado/informatica/2627/tercero/s2/a-eng    grado / curso académico / curso / semestre / grupo
/grado/datos/2627/primero/s1/unico          (sin grupos distintos en el semestre: «unico»)
…/a-eng?s=SIS_INTELIG~A~ENG,ING_REDES       asignaturas y grupos marcados (compartible)
```

El grupo sale de la etiqueta de la web (`B_Eng` → `b-eng`; los asteriscos se ignoran salvo colisión). Las rutas las calcula el servidor al construir el catálogo (`assignPaths`) y **no dependen del PDF**, así que un marcador sigue valiendo cuando la EPI sustituye el fichero. El curso académico del enlace (`2627`) no se usa para buscar: si es de un curso anterior, se redirige al mismo curso/semestre/grupo del curso vigente y se avisa. Los enlaces antiguos `/horario/<id>` también redirigen, y una ruta incompleta lleva a la página del grado. Cada horario muestra cuándo se descargó por última vez una versión distinta del PDF y cuándo se comprobó por última vez (con un aviso si hace demasiado que no se comprueba).

## Arquitectura

```
 epigijon.uniovi.es ──HEAD/GET──▶  server (Node + Fastify)
                                     │  scheduler interno (REFRESH_HOURS)
                                     │  pipeline: scrape HTML → detectar cambios → descargar → Python → publicar
                                     ▼
                              DATA_DIR/
                                state.json            estado por PDF (tamaño, hash, versión del parser…)
                                pdf/<id>.pdf          PDF descargados
                                excel-cache/          Excel ya generados
                                public/               ← lo único que sirve HTTP (JSON + .gz precomprimido)
                                  catalog.json  subjects-index.json  status.json  changes.json  schedules/<id>.json
                                     │
 navegador ◀── /data/*.json, /api/academic-calendar, POST /api/excel, SPA (web/dist)
```

Los datos públicos son ficheros JSON estáticos precomprimidos (≈3 KB cada horario), escritos de forma atómica: la web no se queda a medias mientras se actualiza.

## Despliegue (sin Docker, systemd)

Funciona en cualquier Debian/Ubuntu con systemd: VM, contenedor LXC, equipo físico… (pensado para Debian 12/13 y Ubuntu 22.04+).

**Requisitos:** ~2 GB de disco libre (el motor Python y las dependencias ocupan ~1 GB; los PDF descargados y los datos, otros ~200 MB), 512 MB de RAM y salida a internet hacia `epigijon.uniovi.es`.

### Instalación rápida

Como `root`, en la máquina donde quieres instalarlo:

```bash
apt update && apt install -y git
git clone https://github.com/pablo-pnunez/EPICal.git
cd EPICal
bash deploy/install.sh --install-deps
```

`--install-deps` instala con `apt` lo que falte (`python3`, `python3-venv`, `curl` y **Node.js 22** desde el repositorio oficial NodeSource). El script, además:

1. crea el usuario de sistema `epical`, instala en `/opt/epical` y guarda los datos en `/var/lib/epical`;
2. crea un entorno virtual Python propio e instala el motor de extracción;
3. instala y compila servidor y web, y limpia después las dependencias de desarrollo para ahorrar disco;
4. crea y arranca el servicio `epical.service`, y al terminar te muestra la URL.

La **primera descarga** de los ~110 PDF tarda 1-3 minutos. Mientras tanto la web aún no muestra horarios; puedes seguirla con:

```bash
journalctl -u epical -f
```

Para abrir la web necesitas la IP de la máquina (en Debian mínimo no existe `ifconfig`; usa `hostname -I`) y entrar en `http://<IP>:8080`.

### Instalación manual de los requisitos

Si prefieres no usar `--install-deps`, antes de `bash deploy/install.sh` necesitas:

```bash
apt install -y python3 python3-venv curl ca-certificates
# Node.js >= 20 con npm. Debian 12 trae Node 18 (no vale); Debian 13 trae 20.x pero sin npm.
# La opción más simple y uniforme es NodeSource:
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
```

### Después de instalar

- **Configuración:** edita `/opt/epical/.env` (puerto, cada cuántas horas se revisa la EPI, `ADMIN_TOKEN`…; ver la tabla de abajo) y aplica los cambios con `systemctl restart epical`.
- **HTTPS y dominio:** pon delante un proxy inverso (Caddy, nginx, Nginx Proxy Manager…) hacia `127.0.0.1:8080`. Si el proxy está en la misma máquina, pon `HOST=127.0.0.1` en `.env` para que la web solo sea accesible a través de él. Ejemplo mínimo con Caddy:

  ```
  horarios.ejemplo.es {
      reverse_proxy 127.0.0.1:8080
  }
  ```

  El servidor ya confía en `X-Forwarded-For` para el límite de peticiones.
- **Forzar una actualización ahora** (con `ADMIN_TOKEN` definido en `.env`):

  ```bash
  curl -X POST -H "Authorization: Bearer <tu-token>" http://127.0.0.1:8080/api/admin/refresh
  ```

- **Ver el estado:** `systemctl status epical`, `journalctl -u epical -n 50` y `curl http://127.0.0.1:8080/data/status.json` (última comprobación y cursos sin calendario).

### Actualizar a una versión nueva

```bash
cd EPICal && git pull
bash deploy/install.sh
```

No pisa `.env` ni los datos descargados.

### Actualización automática desde Git (opcional)

Para que cada commit que hagas en `main` llegue solo al servidor, instala (o reinstala) con:

```bash
cd EPICal && bash deploy/install.sh --auto-update
```

Un temporizador de systemd (`epical-update.timer`) mira cada ~10 minutos si hay commits nuevos en la rama que sigue ese clon. Si los hay:

1. avanza el clon (solo si es un avance limpio, nunca reescribe historia),
2. vuelve a ejecutar `deploy/install.sh` (reconstruye y reinicia el servicio),
3. comprueba que el servicio responde (`/healthz`) y que sigue vivo unos segundos después,
4. **si algo falla, vuelve al commit anterior**, lo reinstala y apunta el commit malo para **no reintentarlo** hasta que llegue otro nuevo.

Así, desde que haces `git push` hasta que está desplegado pasan unos 10-15 minutos. Es un modelo `pull`: el servidor consulta a GitHub, así que no hace falta abrirlo a internet ni guardar credenciales (el repositorio es público).

```bash
systemctl list-timers epical-update.timer     # cuándo toca la próxima comprobación
journalctl -u epical-update -n 50 --no-pager  # qué hizo la última vez (versión desplegada, retrocesos…)
systemctl start epical-update.service         # comprobar y desplegar ahora mismo
cat /var/lib/epical/update-last-ok            # fecha y commit de la última actualización correcta
bash deploy/install.sh --disable-auto-update  # desactivarla
```

Cosas que conviene saber:

- **El clon tiene que seguir en su sitio**: la actualización hace el `git pull` en la carpeta desde la que instalaste (queda guardada en `/opt/epical/.source-dir`). No edites archivos dentro de ese clon.
- **Un ciclo con retroceso termina en estado «failed»** (`systemctl status epical-update`) a propósito, para que se note; el servicio web sigue funcionando con la versión anterior.
- **Seguridad**: todo lo que llegue a `main` se despliega solo. Activa la verificación en dos pasos en tu cuenta de GitHub y, si quieres una red de seguridad extra, trabaja en ramas con pull request y fusiona solo lo que revises.
- **Si fuerzas el historial** (`git push --force`) la actualización se detiene y avisa en el log, porque no puede avanzar de forma limpia; en ese caso actualiza a mano (`git reset --hard origin/main` en el clon y `bash deploy/install.sh`).
- La lógica (éxito, retroceso, commit malo sin reintento, force-push) se prueba con repositorios temporales con `npm run test:update`. Lo que no se puede probar así es systemd real: si el temporizador no se dispara, mira `systemctl status epical-update.timer`.

### Desinstalar

```bash
systemctl disable --now epical epical-update.timer
rm -rf /opt/epical /var/lib/epical /etc/systemd/system/epical.service /etc/systemd/system/epical-update.*
userdel epical && systemctl daemon-reload
```

### Problemas frecuentes

| Síntoma | Causa y solución |
|---|---|
| `FALTA: Node.js >= 20 con npm` | No hay Node, o es antiguo (Debian 12 trae Node 18; Debian 13 no incluye npm). Ejecuta `bash deploy/install.sh --install-deps`. |
| `ifconfig: command not found` | Debian mínimo no lo incluye. Usa `hostname -I` (o `ip -br a`). |
| `No space left on device` | La instalación necesita ~1 GB y los datos ~200 MB. Amplía el disco del contenedor o la VM. |
| La web carga pero dice «No se pudo cargar el catálogo» | Aún no ha terminado la primera descarga: espera 1-3 min y mira `journalctl -u epical -f`. Si falla la red, comprueba que la máquina llega a `https://epigijon.uniovi.es`. |
| La actualización automática no despliega | `systemctl list-timers epical-update.timer` (¿está activo?) y `journalctl -u epical-update -n 50`. Causas típicas: se borró el clon, la rama no sigue a `origin`, o el último commit ya falló y espera uno nuevo. |
| El servicio no arranca | `journalctl -u epical -n 50 --no-pager`; casi siempre es un valor inválido en `/opt/epical/.env` o el puerto ya ocupado. |

## Configuración (`.env`)

| Variable | Defecto | Significado |
|---|---|---|
| `PORT`, `HOST` | `8080`, `0.0.0.0` | Dónde escucha |
| `DATA_DIR` | `./data` | Datos persistentes (en producción: `/var/lib/epical`) |
| `REFRESH_HOURS` | `24` | Cada cuántas horas se revisa la web de la EPI |
| `FULL_VERIFY_DAYS` | `7` | Cada cuántos días se fuerza la descarga completa para verificar hashes (`0` = nunca) |
| `SCRAPE_CONCURRENCY` | `3` | Peticiones simultáneas a la EPI |
| `PYTHON_BIN` | `./engine/.venv/bin/python` | Intérprete con `engine/requirements.txt` |
| `ADMIN_TOKEN` | _(vacío)_ | Si se define, `POST /api/admin/refresh` con `Authorization: Bearer <token>` fuerza una actualización |

El planificador comprueba cada 10 min si toca (mirando la última ejecución correcta guardada en disco), así un reinicio ni repite trabajo ni se salta una actualización. Tras un intento fallido espera ≥ 1 h para reintentar.

## Mantenimiento

### Calendario académico (fechas de cuatrimestre y festivos): automático

Los PDF dicen «semana 7 de curso», no la fecha. La última hoja de cada PDF («Calendario semanal») trae el calendario del curso y se **lee sola** (`engine/academic.py`): los cuatrimestres salen de la rejilla de colores (empiezan en el primer día lectivo y acaban en el último anterior a los exámenes), el nº de semana de la columna «Sem», y los festivos de la unión de la lista oficial (con nombres y rangos, p. ej. «22/03 al 28/03 Semana Santa») y de los días laborables pintados como no lectivos. Ambas fuentes se contrastan y cualquier discrepancia sale como aviso.

- Se extrae de **cada** PDF (los 109 actuales dan exactamente el mismo resultado); si algún día difieren, **gana la versión que traen más PDF** y se avisa en el log.
- Se guarda por curso en `state.json` y se **conserva aunque el curso desaparezca de la web** (los marcadores viejos siguen necesitándolo).
- Si el extractor falla o produce algo inverosímil (cuatrimestres desordenados, de duración absurda o fuera del curso), ese PDF se ignora para el calendario y queda en el log; el horario se publica igualmente.
- [`config/academic-calendar.json`](config/academic-calendar.json) es ahora un fichero **opcional de correcciones manuales**: si un curso aparece ahí, ese curso se toma **entero** de ese fichero (formato en su `_comment`) y el log avisa si no coincide con lo extraído. Se lee en cada petición, sin reiniciar. Si la EPI publica un curso del que no hay calendario, la web lo indica y `/data/status.json` lo lista en `missingAcademicYears`.

### Cuando cambie el formato de los PDF

El parser avisa en el log de cualquier cosa rara (acrónimos fuera de la leyenda, semanas ilegibles, columnas deducidas) y **un PDF que falla se marca como error** en la web (con enlace al original) sin afectar a los demás. Tras modificar `engine/timetable.py` sube `PARSER_VERSION` en `server/src/pipeline/state.ts`: en la siguiente pasada se reprocesan **todos los PDF ya descargados**, sin volver a bajarlos.

### Comandos útiles (desarrollo)

Estos comandos son para trabajar con el código clonado (`npm run setup` instala también las dependencias de desarrollo). En un servidor instalado con `install.sh` esas dependencias se eliminan; para actualizar allí usa la llamada a `/api/admin/refresh` descrita arriba.

```bash
npm run refresh                         # una actualización inmediata (sin servidor web)
npm run test:events                     # el cálculo de fechas del navegador == motor Python original (4 zonas horarias)
python engine/test_timetable.py x.pdf   # pruebas del parser (con un PDF real opcional)
python engine/test_academic.py x.pdf    # pruebas del extractor de calendario académico
```

Desarrollo local: `npm run setup`, `.env` con `PYTHON_BIN` apuntando a un Python con las dependencias, `npm run dev:server` y `npm run dev:web` (proxy a :8080).

## Cobertura y calidad

Probado contra los **109 PDF reales** vigentes (curso 2026-27): los 109 se procesan sin errores (≈8.800 clases). Comparado con el algoritmo del proyecto anterior, coincide en 103 de 108 PDF y en los otros 5 los resultados nuevos son mejores: el antiguo **perdía** las clases que pasaban a la segunda página de un PDF, fusionaba dos actividades en una misma celda y solo leía la primera tabla de cada PDF.

Limitaciones conocidas:

- La **leyenda** de algunos PDF tiene erratas de la propia EPI (p. ej. `MECAN_FLUIDOS` en la rejilla vs `MECÁNICA_FLUID` en la leyenda); en esos casos se muestra el acrónimo en vez del nombre. Es un dato de origen, no un fallo del parser.
- El profesorado puede **reprogramar** actividades; la web lo avisa. El horario vigente es el del PDF.
- Los PDF de **exámenes** no se procesan (solo se enlazan).
- El calendario académico se lee de la rejilla de colores de la hoja «Calendario semanal»: si la EPI rediseña esa hoja, la extracción se rechaza (con aviso) y habrá que usar `config/academic-calendar.json` hasta adaptar `engine/academic.py`. El texto en prosa de la hoja («finalizará el 6 de Mayo»…) no se usa y puede contradecir a la rejilla (en 2026-27 dice 6 de mayo y la rejilla marca clase hasta el 7).
