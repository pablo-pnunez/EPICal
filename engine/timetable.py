"""
Extracción de los PDF de horarios de la EPI Gijón.

Cada PDF mezcla varios tipos de página (descubiertos inspeccionando los ~110 PDF reales):
  - páginas de HORARIO: tabla de 5 días x (ASIGNATURA, GRUPO, AULA, SEMANAS). Puede haber
    varias en un mismo PDF (itinerarios "M1/M2/M3", "OPTATIVAS COMUNES"...) y la tabla puede
    DESBORDARSE a una página siguiente sin cabecera;
  - página(s) de LEYENDA: acrónimo -> nombre real de la asignatura (+ curso, ¿en inglés?);
  - calendario semanal e instrucciones (se ignoran).

La tabla se lee por POSICIÓN de las palabras (columnas = líneas verticales dibujadas en el PDF,
filas = líneas de texto) en vez de forzar filas equiespaciadas: un mismo tramo horario puede
tener varias filas apiladas (actividades simultáneas) y las filas no tienen altura uniforme.
"""

import bisect
import re

import pdfplumber
from unidecode import unidecode

HOUR_RE = re.compile(r"^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$")
LINE_TOL = 3.0  # pt: palabras con 'top' a menos de esto pertenecen a la misma línea de texto
V_TOL = 3.0  # pt: líneas verticales más cercanas que esto se consideran la misma
N_DAYS = 5
N_COLS = 1 + 4 * N_DAYS  # hora + 4 subcolumnas x 5 días
MAX_WEEK = 52
DAY_LETTERS = ["L", "M", "X", "J", "V"]


class PdfLayoutError(Exception):
    pass


def _words(page):
    return page.extract_words(x_tolerance=1.5, y_tolerance=2)


def _cluster_lines(words, tol=LINE_TOL):
    """Agrupa palabras en líneas de texto por su coordenada vertical."""
    lines = []
    for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
        if lines and w["top"] - lines[-1][0] <= tol:
            lines[-1][1].append(w)
        else:
            lines.append((w["top"], [w]))
    return [sorted(ws, key=lambda w: w["x0"]) for _, ws in lines]


def _find_header(words):
    """Devuelve (top, bottom) de la fila de cabecera ASIGNATURA/GRUPO/AULA/SEMANAS, o None si la página no es de horario."""
    asig = sorted((w for w in words if w["text"] == "ASIGNATURA"), key=lambda w: w["top"])
    for w in asig:
        same = [a for a in asig if abs(a["top"] - w["top"]) < 2]
        if len(same) >= N_DAYS:
            header_words = [h for h in words if abs(h["top"] - w["top"]) < 2 and h["text"] in ("ASIGNATURA", "GRUPO", "AULA", "SEMANAS")]
            return w["top"], max(h["bottom"] for h in header_words)
    return None


def _vertical_edges(page):
    xs = sorted({e["x0"] for e in page.edges if e["orientation"] == "v"})
    out = []
    for x in xs:
        if not out or x - out[-1] > V_TOL:
            out.append(x)
    return out


def _columns_from_header(words, header_top):
    """Respaldo cuando las líneas verticales del PDF no son las esperadas: fronteras a partir de las posiciones de la cabecera."""
    hdr = [w for w in words if abs(w["top"] - header_top) < 2]
    cols = {name: sorted((w for w in hdr if w["text"] == name), key=lambda w: w["x0"]) for name in ("ASIGNATURA", "GRUPO", "AULA", "SEMANAS")}
    if any(len(v) < N_DAYS for v in cols.values()):
        raise PdfLayoutError("La cabecera del horario no tiene las 5 columnas por día esperadas")
    xs = [max(0.0, cols["ASIGNATURA"][0]["x0"] - 40)]
    for d in range(N_DAYS):
        a, g, au, s = (cols[n][d] for n in ("ASIGNATURA", "GRUPO", "AULA", "SEMANAS"))
        xs += [a["x0"] - 2, g["x0"] - 8, au["x0"] - 3, s["x0"] - 10]
    xs.append(cols["SEMANAS"][-1]["x1"] + 30)
    return xs


def parse_weeks(text):
    """'TODAS' | 'TODAS menos 3,4' | '4,5,7' | '4.5.7' | '3-6' | '5'  ->  lista de nº de semana."""
    s = re.sub(r"\s+", " ", text.strip())
    if not s:
        raise ValueError("semanas vacías")
    up = s.upper()
    if up.startswith("TODAS"):
        rest = s[5:]
        nums = {int(n) for n in re.findall(r"\d+", rest)}
        if "MENOS" in up:
            return sorted(set(range(1, MAX_WEEK + 1)) - nums)
        if not rest.strip():
            return list(range(1, MAX_WEEK + 1))
        raise ValueError(f"formato de semanas no reconocido: {text!r}")
    weeks = set()
    for part in re.split(r"[,.;\s]+", s):
        if not part:
            continue
        m = re.fullmatch(r"(\d+)-(\d+)", part)
        if m:
            weeks.update(range(int(m.group(1)), int(m.group(2)) + 1))
        elif part.isdigit():
            weeks.add(int(part))
        else:
            raise ValueError(f"formato de semanas no reconocido: {text!r}")
    return sorted(weeks)


def _col_of(xs, x):
    idx = bisect.bisect_right(xs, x) - 1
    return idx if 0 <= idx < N_COLS else None


def _parse_table_page(words, xs, body_top, rows_out, section_idx, warnings, page_no):
    """
    Lee las filas de una página (con o sin cabecera) y añade las clases a rows_out.

    Las celdas se alinean ABAJO (alineación por defecto de Excel): cuando el contenido de una
    celda no cabe en una línea (típicamente la lista de semanas), las líneas sobrantes aparecen
    ENCIMA de la línea principal de su fila. Por eso un fragmento "huérfano" (sin asignatura) se
    antepone al SIGUIENTE evento de su columna; si no hay ninguno después, se pega al anterior.
    """
    body = [w for w in words if w["top"] >= body_top - 0.5]
    last = [None] * N_DAYS  # última clase creada por día
    empty = lambda: {"subj": [], "grp": [], "room": [], "weeks": []}
    pending = [empty() for _ in range(N_DAYS)]  # fragmentos huérfanos por día

    for line in _cluster_lines(body):
        cells = [[] for _ in range(N_COLS)]
        for w in line:
            c = _col_of(xs, (w["x0"] + w["x1"]) / 2)
            if c is not None:
                cells[c].append(w["text"])
        label = " ".join(cells[0]).strip()
        m = HOUR_RE.match(label) if label else None
        hour = (int(m.group(1)), int(m.group(3))) if m else None

        for d in range(N_DAYS):
            base = 1 + 4 * d
            subj = " ".join(cells[base]).strip()
            grp = " ".join(cells[base + 1]).strip()
            room = " ".join(cells[base + 2]).strip()
            weeks = "".join(cells[base + 3]).strip()
            if subj and hour:
                pend = pending[d]
                ev = {
                    "section": section_idx,
                    "day": d,
                    "hourStart": hour[0],
                    "hourEnd": hour[1],
                    "subject": " ".join(pend["subj"] + [subj]),
                    "group": " ".join(pend["grp"] + [grp]).strip(),
                    "room": " ".join(pend["room"] + [room]).strip(),
                    "_weeks": "".join(pend["weeks"]) + weeks,
                }
                pending[d] = empty()
                rows_out.append(ev)
                last[d] = ev
            elif subj or grp or room or weeks:
                pend = pending[d]
                if subj:
                    pend["subj"].append(subj)
                if grp:
                    pend["grp"].append(grp)
                if room:
                    pend["room"].append(room)
                if weeks:
                    pend["weeks"].append(weeks)

    # Fragmentos que quedaron sin evento posterior: continúan al último evento de su columna.
    for d in range(N_DAYS):
        pend = pending[d]
        if not any(pend.values()):
            continue
        ev = last[d]
        if ev is None:
            warnings.append(f"p.{page_no}: texto suelto sin clase asociada ({DAY_LETTERS[d]}): {' '.join(sum(pend.values(), []))}")
            continue
        if pend["subj"]:
            ev["subject"] += " " + " ".join(pend["subj"])
        if pend["grp"]:
            ev["group"] = (ev["group"] + " " + " ".join(pend["grp"])).strip()
        if pend["room"]:
            ev["room"] = (ev["room"] + " " + " ".join(pend["room"])).strip()
        if pend["weeks"]:
            ev["_weeks"] += "".join(pend["weeks"])


def _first_line(page):
    text = page.extract_text() or ""
    return text.split("\n")[0].strip() if text else ""


def parse_legend(page):
    """Leyenda 'Curso | Nombre (es) | Course name (en) | Acronyms for Timetables | Taught in English?' -> lista de dicts."""
    words = _words(page)
    lines = _cluster_lines(words)
    header = next((ln for ln in lines if any(w["text"].startswith("Acronyms") for w in ln)), None)
    if header is None:
        return []
    h = {w["text"]: w for w in header}
    courses = [w for w in header if w["text"] == "Course"]
    if "Nombre" not in h or len(courses) < 2 or "Acronyms" not in h or "Taught" not in h:
        return []
    x_es, x_en, x_acr, x_tau = h["Nombre"]["x0"] - 3, courses[1]["x0"] - 3, h["Acronyms"]["x0"] - 3, h["Taught"]["x0"] - 3

    out = []
    seen_header = False
    for ln in lines:
        if ln is header:
            seen_header = True
            continue
        if not seen_header:
            continue
        pre = [w["text"] for w in ln if w["x0"] < x_es]
        es = " ".join(w["text"] for w in ln if x_es <= w["x0"] < x_en)
        en = " ".join(w["text"] for w in ln if x_en <= w["x0"] < x_acr)
        acr = " ".join(w["text"] for w in ln if x_acr <= w["x0"] < x_tau)
        tau = " ".join(w["text"] for w in ln if w["x0"] >= x_tau).strip().upper()
        if not acr or not pre:
            continue
        curso = next((int(t) for t in reversed(pre) if t.isdigit() and len(t) == 1), None)
        sid = next((t for t in pre if not t.isdigit()), None)
        out.append(
            {
                "acronym": acr,
                "name": es.strip(),
                "nameEn": en.strip() or None,
                "curso": curso,
                "english": True if tau.startswith("YES") else False if tau.startswith("NO") else None,
                "id": sid.replace("‐", "-") if sid else None,
            }
        )
    return out


def extract_pdf(path, cuatrimestre_hint=None):
    """
    Extrae un PDF de horarios completo. Devuelve:
      {"cuatrimestre": 1|2, "sections": [{"title", "pages"}], "rows": [...], "subjects": [...], "warnings": [...]}
    Lanza PdfLayoutError si no hay ninguna página de horario reconocible.
    """
    rows, sections, subjects, warnings = [], [], [], []
    cuatri = None
    prev_xs = None
    in_table = False

    with pdfplumber.open(path) as pdf:
        for i, page in enumerate(pdf.pages):
            page_no = i + 1
            words = _words(page)
            header = _find_header(words)
            text = page.extract_text() or ""

            if header is not None:
                header_top, header_bottom = header
                xs = _vertical_edges(page)
                if len(xs) != N_COLS + 1:
                    try:
                        found = len(xs)
                        xs = _columns_from_header(words, header_top)
                        warnings.append(f"p.{page_no}: columnas deducidas de la cabecera (el PDF traía {found} líneas verticales)")
                    except PdfLayoutError as e:
                        warnings.append(f"p.{page_no}: {e}")
                        continue
                prev_xs = xs
                sections.append({"title": _first_line(page), "pages": [page_no]})
                m = re.search(r"CUATRIMESTRE\s*(\d)", text)
                if m and cuatri is None:
                    cuatri = int(m.group(1))
                _parse_table_page(words, xs, header_bottom, rows, len(sections) - 1, warnings, page_no)
                in_table = True
                continue

            if "Acronyms for Timetables" in text:
                subjects.extend(parse_legend(page))
                in_table = False
                continue

            hours = [w for w in words if HOUR_RE.match(w["text"]) and w["x0"] < 60]
            if in_table and hours and prev_xs is not None:
                # Continuación de la tabla anterior (sin cabecera): mismas columnas que la página previa.
                sections[-1]["pages"].append(page_no)
                _parse_table_page(words, prev_xs, 0, rows, len(sections) - 1, warnings, page_no)
                continue

            in_table = False  # calendario, instrucciones, etc.

    if not sections:
        raise PdfLayoutError("No se encontró ninguna tabla de horario en el PDF")

    # Semanas -> lista (filas con semanas ilegibles se descartan CON aviso, nunca en silencio).
    clean = []
    for r in rows:
        try:
            r["weeks"] = parse_weeks(r.pop("_weeks"))
        except ValueError as e:
            warnings.append(f"{r['subject']} {r['group']}: {e}")
            continue
        clean.append(r)

    if cuatri is None:
        cuatri = cuatrimestre_hint
    if cuatri is None:
        all_weeks = [w for r in clean for w in r["weeks"] if len(r["weeks"]) < MAX_WEEK]
        if not all_weeks:
            raise PdfLayoutError("No se pudo determinar el cuatrimestre (ni en el PDF ni en la web)")
        cuatri = 1 if min(all_weeks) < 15 else 2
        warnings.append("cuatrimestre inferido por las semanas de impartición")

    # Aviso de cobertura de la leyenda (acrónimos en la rejilla sin entrada en la leyenda).
    known = {unidecode(s["acronym"]).upper() for s in subjects}
    missing = sorted({r["subject"] for r in clean if unidecode(r["subject"]).upper() not in known})
    if subjects and missing:
        warnings.append(f"acrónimos sin entrada en la leyenda: {', '.join(missing)}")

    return {"cuatrimestre": cuatri, "sections": sections, "rows": clean, "subjects": subjects, "warnings": warnings}
