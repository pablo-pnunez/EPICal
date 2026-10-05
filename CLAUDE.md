# EPIcal

Web pública de horarios de la EPI Gijón. Cada `REFRESH_HOURS` (24) revisa epigijon.uniovi.es, descarga los PDF de horarios **solo si cambiaron**, los procesa y sirve JSON ya extraído; el usuario consulta, filtra por asignaturas/grupos y exporta a `.ics` (en el navegador) o Excel (en el servidor). Idioma de código, comentarios y UI: **español**. Sin emojis en la UI: iconos outline de `lucide-react`.

Lee `README.md` para arquitectura, despliegue y mantenimiento; aquí solo lo que no se deduce del código.

## Estructura
- `server/` Node 20 + Fastify + TypeScript. `pipeline/refresh.ts` es el núcleo (scrape HTML → detectar cambios → descargar → Python → publicar). `scheduler.ts` decide cuándo toca (mira `state.json`, no un `setInterval` fijo).
- `engine/` Python: `timetable.py` (extracción del PDF), `parse_batch.py` (lote en un solo proceso), `generate_excel.py` + `excel.py` + `schedule.py` (Excel).
- `web/` React 19 + Vite + react-router. `lib/events.ts` expande semanas de curso a fechas reales (equivale a `subject_to_events` de Python); `lib/ics.ts` escribe el `.ics`. `/mi-horario` (`pages/MySchedulePage.tsx`, `lib/myschedule.ts`) mezcla asignaturas de varios PDF/grados; el estado va en `?m=slug/curso/sem/grupo/ACR~g1~g2,…` (sin año, como las URL de horario; grupos vacíos = todos; `g@1-7.9` limita un grupo a esas semanas del curso, con la numeración del PDF (el 2.º cuatrimestre empieza hacia la 21)) y se copia a `localStorage` (`epical.mihorario`) solo al editar, nunca al abrir un enlace ajeno.
- `engine/academic.py` extrae el calendario académico (cuatrimestres + festivos con nombre) de la hoja «Calendario semanal» de cada PDF; `server/src/pipeline/calendar.ts` lo agrega por mayoría y lo guarda por curso en `state.json`. `config/academic-calendar.json` es solo un fichero **opcional de correcciones manuales** (un curso presente ahí se toma entero de ahí). Ya no hay mantenimiento anual.
- `data/` (gitignored): `data/run1` es la carpeta de datos de desarrollo (`DATA_DIR` en `.env`). En producción, `/var/lib/epical`.
- `deploy/` systemd + `install.sh` (instala Node 22/python3-venv con `--install-deps`; primer despliegue real en Debian 13 LXC, ajustar si aparecen fallos) y la actualización automática por Git con retroceso (`update.sh`, `epical-update.{service,timer}`; opt-in con `install.sh --auto-update`; la lógica se prueba con `npm run test:update`, systemd real no).

## Comandos
```bash
npm run setup            # npm ci en server y web
npm run build            # compila server (dist/) y web (web/dist)
npm run start            # node server/dist/index.js
npm run dev:server       # tsx watch
npm run dev:web          # vite con proxy a :8080
npm run refresh          # una actualización inmediata sin levantar el servidor
npm run typecheck
npm run test:events      # fechas del navegador == motor Python original, en 4 zonas horarias (necesita datos: npm run refresh antes)
python engine/test_timetable.py [x.pdf]   # y engine/test_academic.py [x.pdf]
```
Antes de dar algo por hecho: `npm run typecheck`, `npm run test:events` y, si tocas el parser, probar contra PDF reales (`npm run refresh` los baja a `DATA_DIR`).

## Entorno de desarrollo (Windows)
- No hay `python` en PATH. En `.env` (gitignored; plantilla `.env.example`) `PYTHON_BIN` apunta a un intérprete con las dependencias de `engine/requirements.txt` (aquí, un entorno conda). En el servidor Linux es `engine/.venv/bin/python` (ver `engine/requirements.txt`).
- El servidor de pruebas se arranca con `node server/dist/index.js` en el puerto 8080; **páralo al terminar**.
- Si usas el Bash de Claude Code: los **heredocs grandes fallan** o colapsan `\\` a `\` (ya rompió un regex). Escribe ficheros con Write/Edit, no con `cat <<EOF`. Las capturas del navegador integrado fallan a menudo: verifica con `javascript_tool`/`get_page_text`.

## Cosas no obvias
- **La EPI no manda `ETag` ni `Last-Modified`.** Detección de cambios en dos niveles: `HEAD` por `Content-Length` + descarga completa con SHA-256 cada `FULL_VERIFY_DAYS`. `epigijon.uniovi.es` exige TLS "legacy renegotiation": usar el `fetch` de `undici` con el `Agent` de `scrape/http.ts`, no el `fetch` global de Node.
- **Un PDF no es una tabla.** Puede traer varias tablas (itinerarios, «optativas comunes»), la tabla puede continuar en una 2ª página sin cabecera, y hay páginas de leyenda acrónimo→nombre real y de calendario semanal. Las celdas se alinean abajo: un texto partido en 2 líneas (semanas) pone el fragmento **encima** de la línea principal, por eso los fragmentos huérfanos se anteponen al siguiente evento de su columna. Las erratas de la leyenda de la EPI (p. ej. `MECAN_FLUIDOS` vs `MECÁNICA_FLUID`) son del origen: se cae al acrónimo.
- **Al cambiar `engine/timetable.py`, sube `PARSER_VERSION`** (`server/src/pipeline/state.ts`): reprocesa todos los PDF ya descargados sin volver a bajarlos.
- **Tipos de actividad** (según las instrucciones del propio PDF): A/B/ING/ENG = teoría, PA = prácticas de aula, PL = laboratorio, TG = tutorías grupales. El profesorado puede reprogramar clases; la web lo avisa.
- **Tipos duplicados:** `server/src/types.ts` y `web/src/types.ts` son copias. Si cambias uno, copia al otro.
- **URLs de horario** `/grado/<slug>/<aamm>/<curso>/<sem>/<grupo>` las calcula el servidor (`assignPaths` en `pipeline/catalog.ts`) a partir de curso/semestre/grupo, **no del PDF**, para que los marcadores sobrevivan a un PDF nuevo. El segmento del curso académico no se usa para buscar (redirige al vigente).
- **Horas**: todo es hora de pared de Madrid. `events.ts` convierte a instantes con `Intl` (nunca con la zona del navegador); el `.ics` va en UTC. El Excel en Python usa `_to_madrid_wallclock`. El servidor puede estar en UTC sin problema.
- **Calendario académico**: en la rejilla de la hoja el naranja es el mismo para festivos, vacaciones y fines de semana (los festivos se distinguen por la lista inferior); tras los exámenes de junio la rejilla vuelve a pintar días «lectivos» sin clase, por eso el fin de cuatrimestre es el último día lectivo ANTES del primer examen. La prosa de la hoja puede contradecir a la rejilla (2026-27: «finalizará el 6 de Mayo» vs clase hasta el 7); se usa la rejilla. Subir `PARSER_VERSION` también reextrae el calendario.
- Los PDF de exámenes solo se enlazan, no se procesan.
