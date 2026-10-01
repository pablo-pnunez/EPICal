# EPIcal

Web pública de **horarios de la EPI Gijón**. Cada _X_ horas (24 por defecto) revisa la web de la escuela, descarga los PDF de horarios de todos los grados y cursos **solo si han cambiado**, extrae su contenido y lo publica ya procesado, de forma que consultar, personalizar y exportar sea instantáneo para quien lo usa.

Es un programa **independiente** del panel SIES API: no comparte código en ejecución ni toca nada de él (se reutilizó y adaptó su conocimiento del sitio de la EPI y del motor de calendarios).

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
                                  catalog.json  subjects-index.json  status.json  schedules/<id>.json
                                     │
 navegador ◀── /data/*.json, /api/academic-calendar, POST /api/excel, SPA (web/dist)
```

Los datos públicos son ficheros JSON estáticos precomprimidos (≈3 KB cada horario), escritos de forma atómica: la web no se queda a medias mientras se actualiza.

## Despliegue en Proxmox (sin Docker, systemd)

En un contenedor LXC o VM con Debian/Ubuntu:

```bash
apt install -y python3 python3-venv          # y Node.js >= 20
# copia esta carpeta al servidor (git clone, scp…) y, desde ella:
sudo bash deploy/install.sh
```

Crea el usuario `epical`, instala en `/opt/epical`, datos en `/var/lib/epical`, un entorno virtual Python propio, compila servidor y web y arranca `epical.service`. Después:

```bash
systemctl status epical
journalctl -u epical -f          # la primera descarga completa tarda ~1 minuto
```

Escucha en `HOST:PORT` (8080 por defecto). Para publicarla con HTTPS pon delante un proxy inverso (Caddy, nginx, Nginx Proxy Manager…) apuntando a ese puerto; el servidor ya confía en `X-Forwarded-For` para el límite de peticiones.

> `deploy/install.sh` se escribió y revisó pero **no se ha ejecutado en un Debian real** (el desarrollo se hizo en Windows). Léelo antes de lanzarlo y avisa si algo falla.

Actualizar a una versión nueva: vuelve a copiar el código y ejecuta `sudo bash deploy/install.sh` de nuevo (no pisa `.env` ni los datos).

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

### Comandos útiles

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
