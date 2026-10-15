"""
Extracción de los PDF "Calendario de exámenes AAAA-AA" de la EPI Gijón (uno por grado y curso
académico, enlazados aparte de los PDF de horario — nunca se habían procesado, solo enlazado).

Estructura real (inspeccionada en PDF de 2025-26 y 2026-27 de varios grados), muy distinta de la
tabla ASIGNATURA/GRUPO/AULA/SEMANAS del horario:
  - cada página trae un título "Curso AAAA-AAAA" y uno o varios bloques "Convocatoria de <mes(es)
    AAAA>" (diciembre-enero, mayo, junio/julio...);
  - cada bloque tiene su propia rejilla semanal: cabecera "Hora <Día dd de mes> Aula ..." (un grupo
    de columnas por día, normalmente de lunes a viernes) y filas ancladas por una hora "HH:MM"
    (normalmente solo 9:00 y 15:00);
  - cada celda (día x hora) puede traer VARIOS exámenes a la vez, cada uno empezando por el
    prefijo "<curso>-S<semestre>-<asignatura>" (p.ej. "2-S1-Estructuras de Datos (teoría) AN-A");
  - tras el nombre de asignatura puede venir un paréntesis de tipo ("(teoría)", "(prácticas)",
    "(teoría y prácticas)") y, si ya está asignada, el aula (uno o varios códigos sueltos como
    "AN-E", "EP-EXAM2", "AN-B7, B8", a veces en líneas adicionales);
  - cuando el PDF se publica con antelación (próximo curso) el aula aún no existe: no hay que
    exigirla.

El aula se extrae con la mejor heuristica posible pero NO es crítica: lo que importa de verdad
(fecha, hora, asignatura) se extrae por separado y con más cuidado. El texto que no se logra
clasificar como aula se deja en `location` tal cual, en vez de perderlo o fallar: mejor un dato
incompleto visible que uno corrupto en silencio.
"""

import re
from datetime import date

import pdfplumber

LINE_TOL = 3.0
TITLE_RE = re.compile(r"Curso\s+(\d{4})\s*-\s*(\d{4})")
CONVOCATORIA_RE = re.compile(r"Convocatoria de (.+)", re.IGNORECASE)
HEADER_DATE_RE = re.compile(r"^(Lunes|Martes|Mi[ée]rcoles|Jueves|Viernes|S[áa]bado|Domingo)\s+(\d{1,2})\s+de\s+([A-Za-zá-ú]+)", re.IGNORECASE)
DAY_WORD_RE = re.compile(r"^(Lunes|Martes|Mi[ée]rcoles|Jueves|Viernes|S[áa]bado|Domingo)$", re.IGNORECASE)
TIME_RE = re.compile(r"^(\d{1,2}):(\d{2})$")
ENTRY_RE = re.compile(r"(\d)\s*-?\s*[Ss](\d)\s*-\s*")
TYPE_PAREN_RE = re.compile(r"\(([^()]*?(?:te[oó]r[ií]a|pr[áa]ct|problem|examen)[^()]*?)\)", re.IGNORECASE)
HOUR_PAREN_RE = re.compile(r"\((\d{1,2}):(\d{2})\)")
ROOM_TOKEN_RE = re.compile(r"^(?:[A-Z]{1,4}-[A-Z0-9.]{1,8}|[A-Z]{1,3}\d{1,4})$")

MONTHS = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6,
    "julio": 7, "agosto": 8, "septiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12,
}

DEFAULT_DURATION_MIN = 180  # si el PDF no trae hora de fin (nunca la trae): 3h, igual que la app anterior.


class ExamError(Exception):
    pass


def _words(page):
    return page.extract_words(x_tolerance=1.5, y_tolerance=2)


def _lines(words, tol=LINE_TOL):
    out = []
    for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
        if out and abs(w["top"] - out[-1][0]) <= tol:
            out[-1][1].append(w)
        else:
            out.append([w["top"], [w]])
    return [sorted(ws, key=lambda w: w["x0"]) for _, ws in out]


def _line_text(line):
    return " ".join(w["text"] for w in line).strip()


def _squeeze(text):
    return re.sub(r"\s+", " ", text).strip()


def _classify_type(text):
    m = TYPE_PAREN_RE.search(text)
    if not m:
        return None, text
    raw = m.group(1).lower()
    has_teo = "te" in raw and ("or" in raw)
    has_prac = "pr" in raw and "ct" in raw
    has_prob = "problem" in raw
    if has_teo and has_prac:
        tipo = "teoria_practicas"
    elif has_teo:
        tipo = "teoria"
    elif has_prac:
        tipo = "practicas"
    elif has_prob:
        tipo = "problemas"
    else:
        tipo = "examen"
    return tipo, _squeeze(text[: m.start()] + " " + text[m.end() :])


def _extract_hour_override(text):
    m = HOUR_PAREN_RE.search(text)
    if not m:
        return None, text
    return (int(m.group(1)), int(m.group(2))), _squeeze(text[: m.start()] + " " + text[m.end() :])


def _split_line(line):
    """De una línea física separa (palabras de asignatura, palabras de aula): el aula empieza en
    el primer token con pinta de código de aula (letras+dígitos/guion) y llega hasta el final de
    ESA línea; lo anterior en la misma línea sigue siendo nombre de asignatura (puede venir partido
    en varias líneas, p.ej. "Autómatas y Matemáticas" / "Discretas")."""
    toks = line.split()
    split_at = next((i for i, t in enumerate(toks) if ROOM_TOKEN_RE.match(t.rstrip(","))), len(toks))
    return " ".join(toks[:split_at]), " ".join(toks[split_at:])


def _split_subject_and_location(first_line_rest, extra_lines):
    """Heurística, no perfecta: ver docstring del módulo."""
    subject_parts, location_parts = [], []
    for line in [first_line_rest, *extra_lines]:
        subj, loc = _split_line(line)
        if subj:
            subject_parts.append(subj)
        if loc:
            location_parts.append(loc)

    subject = " ".join(p for p in subject_parts if p).strip()
    location = ", ".join(p.strip(" ,") for p in location_parts if p.strip(" ,"))
    return subject, location or None


def _entries_from_cell(cell_lines, row_hour, warnings, ctx):
    """
    cell_lines: líneas físicas (texto ya unido) de una celda día x hora. -> (entradas, texto_previo).

    El prefijo "<curso>-S<semestre>-" puede aparecer en mitad de una línea física (varias
    asignaturas comparten línea cuando los nombres son cortos), así que la celda se trocea por
    TODAS las apariciones del prefijo en el texto completo (como hacía la app anterior), no línea
    a línea; los saltos de línea originales se conservan (como "\\n") para poder seguir separando
    asignatura/aula por línea dentro de cada trozo.

    `texto_previo` es lo que aparece ANTES del primer examen reconocido (incluida la celda entera
    si no se reconoce ninguno): casi siempre es la cola (desbordada hacia abajo) del último examen
    de la FILA ANTERIOR de esta misma columna, no algo de esta fila — quien llama decide qué hacer
    con ello (pegarlo a la fila anterior) en vez de avisar aquí a ciegas.
    """
    blob = "\n".join(ln for ln in cell_lines if ln.strip())
    matches = list(ENTRY_RE.finditer(blob))
    if not matches:
        return [], blob.strip()

    leading = blob[: matches[0].start()].strip()

    out = []
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(blob)
        raw = blob[m.end() : end]
        curso, semestre = int(m.group(1)), int(m.group(2))

        tipo, _ = _classify_type(raw)
        override, _ = _extract_hour_override(raw)
        # Se quita el paréntesis de tipo/hora del texto COMPLETO (no línea a línea): a veces se
        # parte en dos líneas físicas, p.ej. "(teoría y" / "prácticas)", y línea a línea no
        # coincidiría con ninguna de las dos por separado.
        cleaned = raw
        for paren_re in (TYPE_PAREN_RE, HOUR_PAREN_RE):
            cleaned = paren_re.sub(" ", cleaned)
        lines = [ln.strip() for ln in cleaned.split("\n") if ln.strip()]
        if not lines:
            warnings.append(f"{ctx}: entrada sin nombre de asignatura (curso {curso}, sem {semestre})")
            continue
        subject, location = _split_subject_and_location(lines[0], lines[1:])
        if not subject:
            warnings.append(f"{ctx}: entrada sin nombre de asignatura (curso {curso}, sem {semestre})")
            continue
        hour = override or row_hour
        out.append(
            {
                "curso": curso,
                "semestre": semestre,
                "subjectRaw": subject,
                "tipo": tipo,
                "hourStart": f"{hour[0]:02d}:{hour[1]:02d}",
                "location": location,
            }
        )
    return out, leading


def _col_of(xs, x):
    for i in range(len(xs) - 1, -1, -1):
        if x >= xs[i]:
            return i
    return None


def _month_from_name(name):
    key = name.lower()
    key = key.replace("é", "e").replace("á", "a").replace("í", "i").replace("ó", "o").replace("ú", "u")
    return MONTHS.get(key)


def _resolve_year(month, academic_start_year):
    return academic_start_year if month >= 9 else academic_start_year + 1


def _column_starts(body_lines, header_x0s):
    """
    Posición real de inicio de cada columna de día, UNA por elemento de `header_x0s` (mismo orden,
    de izquierda a derecha). Se mide por dónde empiezan de verdad las entradas ("<curso>-S<sem>-...")
    del propio bloque, no por la posición de la etiqueta del día en la cabecera (que puede estar
    desplazada varias columnas respecto al contenido, según el PDF). Si una columna no tiene ninguna
    entrada en todo el bloque, se usa su etiqueta de cabecera tal cual (no hay nada que clasificar
    mal ahí de todas formas).
    """
    gap = (header_x0s[1] - header_x0s[0]) / 2 if len(header_x0s) > 1 else 50
    entry_x0s = sorted(w["x0"] for ln in body_lines for w in ln if ENTRY_RE.match(w["text"]))
    starts = []
    for x0 in header_x0s:
        near = [x for x in entry_x0s if abs(x - x0) < gap]
        starts.append(min(near) if near else x0)
    return starts


def _parse_block(header_line, body_lines, academic_start_year, warnings, page_no):
    """
    Un bloque = una cabecera 'Hora <día> Aula ...' + sus filas, hasta la siguiente cabecera o el
    fin de página. `body_lines` ya viene recortado a las líneas de este bloque (ver extract_exams).

    Las celdas se alinean ABAJO (igual que en el PDF de horario, ver CLAUDE.md): el contenido de
    una celda que no cabe en una línea aparece ENCIMA de la línea de la hora ("9:00"/"15:00"), y a
    veces también se desborda DEBAJO cuando la hora viene seguida en la misma línea del primer
    examen. Por eso se acumulan fragmentos "pendientes" por columna hasta la siguiente hora
    (mismo patrón que `_parse_table_page` de timetable.py) y, al final del bloque, lo que queda
    sin hora siguiente se pega a la ÚLTIMA fila de su columna en vez de perderse.
    """
    day_words = [w for w in header_line if DAY_WORD_RE.match(w["text"])]
    hora_words = [w for w in header_line if w["text"] == "Hora"]
    aula_words = sorted((w for w in header_line if w["text"] == "Aula"), key=lambda w: w["x0"])
    if not day_words or not hora_words:
        return []

    sorted_days = sorted(day_words, key=lambda w: w["x0"])
    # El contenido de cada celda empieza bastante a la izquierda de la etiqueta del día de la
    # cabecera (p.ej. "Lunes"): el desfase varía según el PDF (y no es el mismo en todos los
    # grados), así que ni pegarse a la cabecera ni usar un margen fijo vale siempre. Se mide el
    # desfase real por columna a partir de dónde empiezan de verdad las entradas en ESTE bloque
    # (el principio "<curso>-S<semestre>-" de una entrada SIEMPRE está alineado a la izquierda de
    # su columna; lo que se desplaza hacia la derecha son las aulas y los nombres largos que
    # desbordan, nunca el principio de una entrada nueva).
    #
    # El aula, en cambio, NO sigue el mismo desfase que la asignatura: cada día tiene su propia
    # sub-columna "Aula" (la propia cabecera la marca, bastante a la derecha de la etiqueta del
    # día), así que puede acabar más cerca de la columna SIGUIENTE que del principio de la suya
    # propia. Por eso la frontera entre una columna y la siguiente no se traza en mitad de sus
    # asignaturas, sino entre el "Aula" de la columna actual y el principio de la asignatura de la
    # siguiente: dentro de ese hueco cabe todo el aula sin invadir la columna de al lado.
    starts = _column_starts(body_lines, [w["x0"] for w in sorted_days])
    hora_x0 = min(w["x0"] for w in hora_words)
    if len(aula_words) == len(sorted_days):
        lefts = [hora_x0] + [w["x0"] for w in aula_words[:-1]]
    else:
        lefts = [hora_x0] + starts[:-1]
    xs = [0.0] + [(lefts[i] + starts[i]) / 2 for i in range(len(starts))]
    headers = {}  # col index (1..N) -> (year, month, day)
    for i, dw in enumerate(sorted_days):
        col_line = [w for w in header_line if abs(w["top"] - dw["top"]) < 2 and w["x0"] >= dw["x0"] - 1]
        text = _line_text(col_line)
        m = HEADER_DATE_RE.match(text)
        if not m:
            warnings.append(f"p.{page_no}: no se pudo leer la fecha de la columna {i + 1} de la cabecera: {text!r}")
            continue
        day_num = int(m.group(2))
        month = _month_from_name(m.group(3))
        if month is None:
            warnings.append(f"p.{page_no}: mes no reconocido en la cabecera: {m.group(3)!r}")
            continue
        headers[i + 1] = (_resolve_year(month, academic_start_year), month, day_num)
    if not headers:
        return []

    pending = {c: [] for c in headers}  # líneas de texto sin hora todavía asignada, por columna
    col_rows = {c: [] for c in headers}  # una lista de entradas por fila ya cerrada
    col_meta = {c: [] for c in headers}  # (cell_lines, hour, ctx, fecha) paralelo a col_rows, para el ajuste final

    def cell_text(line, col):
        ws = sorted((w for w in line if _col_of(xs, (w["x0"] + w["x1"]) / 2) == col), key=lambda w: w["x0"])
        return _line_text(ws)

    def flush(c, cell_lines, hour, ctx, fecha):
        """
        Procesa la celda y cierra la fila. El texto que quede ANTES del primer examen reconocido
        casi siempre es la cola (desbordada hacia abajo) del último examen de la fila ANTERIOR de
        esta columna (la celda se alinea abajo, ver docstring de la función), así que se le pega
        y esa fila anterior se recalcula — no se avisa a ciegas de "texto suelto" cuando en
        realidad sólo estaba mal repartido entre dos filas consecutivas.
        """
        entries, leading = _entries_from_cell(cell_lines, hour, warnings, ctx)
        if leading and col_meta[c]:
            prev_lines, prev_hour, prev_ctx, prev_fecha = col_meta[c][-1]
            prev_entries, still_leading = _entries_from_cell(prev_lines + [leading], prev_hour, warnings, prev_ctx)
            for e in prev_entries:
                e["date"] = f"{prev_fecha.day:02d}/{prev_fecha.month:02d}/{prev_fecha.year}"
            col_rows[c][-1] = prev_entries
            col_meta[c][-1] = (prev_lines + [leading], prev_hour, prev_ctx, prev_fecha)
            if still_leading:
                warnings.append(f"{prev_ctx}: texto suelto sin examen asociado: {still_leading!r}")
        elif leading:
            warnings.append(f"{ctx}: texto suelto antes del primer examen de la celda: {leading!r}")
        for e in entries:
            e["date"] = f"{fecha.day:02d}/{fecha.month:02d}/{fecha.year}"
        col_rows[c].append(entries)
        col_meta[c].append((cell_lines, hour, ctx, fecha))

    for line in body_lines:
        label = cell_text(line, 0)
        m = TIME_RE.match(label)
        if not m:
            for c in headers:
                txt = cell_text(line, c)
                if txt:
                    pending[c].append(txt)
            continue

        hour = (int(m.group(1)), int(m.group(2)))
        for c, ymd in headers.items():
            txt = cell_text(line, c)
            cell_lines = pending[c] + ([txt] if txt else [])
            pending[c] = []
            if not cell_lines:
                continue
            try:
                fecha = date(*ymd)
            except ValueError:
                warnings.append(f"p.{page_no}: fecha inválida {ymd}")
                continue
            flush(c, cell_lines, hour, f"p.{page_no} {fecha.isoformat()}", fecha)

    # Fragmentos tras la última hora del bloque (sin hora siguiente): se añaden a la última fila de su columna.
    for c, extra_lines in pending.items():
        if not extra_lines:
            continue
        if not col_meta[c]:
            warnings.append(f"p.{page_no}: texto suelto sin examen asociado: {' / '.join(extra_lines)!r}")
            continue
        cell_lines, hour, ctx, fecha = col_meta[c][-1]
        entries, leading = _entries_from_cell(cell_lines + extra_lines, hour, warnings, ctx)
        if leading:
            warnings.append(f"{ctx}: texto suelto sin examen asociado: {leading!r}")
        for e in entries:
            e["date"] = f"{fecha.day:02d}/{fecha.month:02d}/{fecha.year}"
        col_rows[c][-1] = entries

    return [e for rows in col_rows.values() for row in rows for e in row]


def extract_exams(path, academic_year_hint=None):
    """
    Extrae el calendario de exámenes de un PDF "Calendario de exámenes AAAA-AA" de un grado.
    Devuelve {"academicYear": "AAAA-AAAA", "exams": [...], "warnings": [...]}.
    Lanza ExamError si el PDF no tiene pinta de ser este tipo de documento o no se extrae nada.
    """
    warnings = []
    exams = []
    academic_year = None

    with pdfplumber.open(path) as pdf:
        for i, page in enumerate(pdf.pages):
            page_no = i + 1
            text = page.extract_text() or ""
            m = TITLE_RE.search(text)
            if m and academic_year is None:
                y1, y2 = int(m.group(1)), int(m.group(2))
                if y2 == y1 + 1:
                    academic_year = y1

            words = _words(page)
            lines = _lines(words)
            header_idx = [idx for idx, ln in enumerate(lines) if any(w["text"] == "Hora" for w in ln) and any(DAY_WORD_RE.match(w["text"]) for w in ln)]
            if not header_idx:
                continue

            convocatoria = next((CONVOCATORIA_RE.search(_line_text(ln)) for ln in lines if CONVOCATORIA_RE.search(_line_text(ln))), None)
            conv_label = convocatoria.group(1).strip() if convocatoria else None

            start_year = academic_year
            if start_year is None and academic_year_hint:
                start_year = int(str(academic_year_hint).split("-")[0])
            if start_year is None:
                raise ExamError(f"p.{page_no}: no se encontró el título 'Curso AAAA-AAAA' ni se dio un curso académico de referencia")

            for bi, idx in enumerate(header_idx):
                header_line = lines[idx]
                header_top = min(w["top"] for w in header_line)
                next_header_top = min(w["top"] for w in lines[header_idx[bi + 1]]) if bi + 1 < len(header_idx) else None
                body_lines = [
                    [w for w in ln if w["top"] >= header_top + 1]
                    for ln in lines[idx:]
                    if (next_header_top is None or min(w["top"] for w in ln) < next_header_top) and min(w["top"] for w in ln) >= header_top + 1
                ]
                block_entries = _parse_block(header_line, body_lines, start_year, warnings, page_no)
                for e in block_entries:
                    e["convocatoria"] = conv_label
                exams.extend(block_entries)

    if academic_year is None:
        if academic_year_hint is None:
            raise ExamError("No se encontró ningún título 'Curso AAAA-AAAA' en el PDF")
        academic_year = int(str(academic_year_hint).split("-")[0])
    if not exams:
        raise ExamError("No se pudo extraer ningún examen del PDF (¿cambió el formato?)")

    return {"academicYear": f"{academic_year}-{academic_year + 1}", "exams": exams, "warnings": warnings}
