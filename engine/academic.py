"""
Extracción del calendario académico (fechas de cada cuatrimestre y festivos) de la hoja
"CALENDARIO SEMANAL EPI-GIJON AAAA-AAAA" que lleva cada PDF de horarios.

Fuentes dentro de esa hoja, contrastadas entre sí:
  - La REJILLA de meses: cada día es un rectángulo con color (azul = lectivo, morado = exámenes,
    naranja = no lectivo; la leyenda de la propia hoja da el color exacto de cada categoría) y la
    columna "Sem" da el número de semana de curso de cada fila.
  - La LISTA de festivos de debajo (con nombres y rangos tipo "22/03 al 28/03 Semana Santa").

Los cuatrimestres salen de la rejilla: empiezan en el primer día lectivo y terminan en el último
día lectivo anterior al primer día de exámenes. (Tras los exámenes de junio la rejilla vuelve a
pintar días "lectivos" sin clase, por eso no vale simplemente "el último día azul".)
"""

import re
from datetime import date, timedelta

import pdfplumber

MONTHS = {"ene": 1, "feb": 2, "mar": 3, "abr": 4, "may": 5, "jun": 6, "jul": 7, "ago": 8, "sep": 9, "oct": 10, "nov": 11, "dic": 12}
MONTH_LABEL_RE = re.compile(r"^([a-z]{3})(?:/([a-z]{3}))?-(\d{2})$")
DATE_TOKEN_RE = re.compile(r"^(\d{1,2})/(\d{1,2})$")
TITLE_RE = re.compile(r"CALENDARIO SEMANAL.*?(\d{4})\s*-\s*(\d{4})")
LINE_TOL = 3.0

# Respaldo si no se encuentra la leyenda de colores (valores del PDF 2026-27).
FALLBACK_COLORS = {"exam": (0.438, 0.188, 0.629)}


class CalendarError(Exception):
    pass


def _close(a, b, tol=0.03):
    return a is not None and b is not None and len(a) == len(b) and all(abs(x - y) <= tol for x, y in zip(a, b))


def _color(c):
    if isinstance(c, (list, tuple)) and len(c) == 3:
        return tuple(float(x) for x in c)
    return None


def _classify(rect_color, ref):
    """-> 'nolective' | 'exam' | 'lective' | 'empty'"""
    c = _color(rect_color)
    if c is None:
        return "empty"
    if _close(c, ref["exam"]):
        return "exam"
    r, g, b = c
    if r > 0.9 and 0.4 < g < 0.85 and b < 0.25:
        return "nolective"  # naranja: festivos, vacaciones y fines de semana comparten familia de color
    if b >= r and b > 0.6 and not (r > 0.95 and g > 0.95):
        return "lective"
    return "empty"


def _legend_colors(page, words):
    """Color de la muestra 'Exámenes' de la leyenda (el resto de categorías se reconocen por familia de color)."""
    ref = dict(FALLBACK_COLORS)

    def swatch_before(first_word):
        near = [
            r
            for r in page.rects
            if _color(r["non_stroking_color"]) and abs((r["top"] + r["bottom"]) / 2 - (first_word["top"] + first_word["bottom"]) / 2) < 8 and 0 < first_word["x0"] - r["x1"] < 25 and (r["x1"] - r["x0"]) > 10
        ]
        return _color(near[0]["non_stroking_color"]) if near else None

    for w in words:
        if w["text"].startswith("Ex") and "menes" in w["text"]:
            c = swatch_before(w)
            if c:
                ref["exam"] = c
    return ref


def _lines(words, tol=LINE_TOL):
    out = []
    for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
        if out and abs(w["top"] - out[-1][0]) <= tol:
            out[-1][1].append(w)
        else:
            out.append([w["top"], [w]])
    return [sorted(ws, key=lambda w: w["x0"]) for _, ws in out]


def _smallest_rect_containing(rects, w):
    cx, cy = (w["x0"] + w["x1"]) / 2, (w["top"] + w["bottom"]) / 2
    best, best_area = None, None
    for r in rects:
        if r["x0"] - 0.5 <= cx <= r["x1"] + 0.5 and r["top"] - 0.5 <= cy <= r["bottom"] + 0.5:
            area = (r["x1"] - r["x0"]) * (r["bottom"] - r["top"])
            if best is None or area < best_area:
                best, best_area = r, area
    return best


def _academic_start_year(text):
    m = TITLE_RE.search(text)
    if not m:
        raise CalendarError("No se encontró el título 'CALENDARIO SEMANAL … AAAA-AAAA'")
    y1, y2 = int(m.group(1)), int(m.group(2))
    if y2 != y1 + 1:
        raise CalendarError(f"Curso académico inesperado: {y1}-{y2}")
    return y1


def _parse_grid(page, words, ref, year):
    """Devuelve {side: {date: {"week": int|None, "kind": str}}}."""
    sems = sorted((w for w in words if w["text"] == "Sem"), key=lambda w: (w["top"], w["x0"]))
    if not sems:
        raise CalendarError("No se encontraron los bloques de meses de la rejilla")
    # Las dos mitades de la hoja (1er y 2º cuatrimestre) se distinguen por dónde empieza la columna "Sem" de la derecha.
    mid = max(w["x0"] for w in sems) - 5
    labels = [w for w in words if MONTH_LABEL_RE.match(w["text"])]
    if not sems or not labels:
        raise CalendarError("No se encontraron los bloques de meses de la rejilla")
    fills = [r for r in page.rects if _color(r["non_stroking_color"]) and (r["x1"] - r["x0"]) < page.width * 0.9]

    blocks = []
    for s in sems:
        side = 0 if s["x0"] < mid else 1
        above = [l for l in labels if (0 if l["x0"] < mid else 1) == side and l["top"] < s["top"]]
        if not above:
            continue
        label = max(above, key=lambda l: l["top"])
        header_line = [w for w in words if abs(w["top"] - s["top"]) < 2 and (0 if w["x0"] < mid else 1) == side]
        days = {w["text"]: w for w in header_line if w["text"] in ("Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom")}
        if len(days) < 7:
            continue
        blocks.append({"sem": s, "label": label, "side": side, "days": days})
    if not blocks:
        raise CalendarError("No se pudo reconstruir ningún bloque mensual")

    out = {0: {}, 1: {}}
    for side in (0, 1):
        side_blocks = sorted((b for b in blocks if b["side"] == side), key=lambda b: b["sem"]["top"])
        for i, b in enumerate(side_blocks):
            top = b["sem"]["bottom"] - 0.5
            bottom = side_blocks[i + 1]["label"]["top"] - 1 if i + 1 < len(side_blocks) else page.height
            m = MONTH_LABEL_RE.match(b["label"]["text"])
            months = [MONTHS[m.group(1)]] + ([MONTHS[m.group(2)]] if m.group(2) else [])
            yy = 2000 + int(m.group(3))
            day_x = {name: (w["x0"] + w["x1"]) / 2 for name, w in b["days"].items()}
            first_day_x0 = min(w["x0"] for w in b["days"].values())
            sem_x0 = b["sem"]["x0"]
            region = [w for w in words if top <= w["top"] < bottom and (0 if w["x0"] < mid else 1) == side and w["x0"] >= sem_x0 - 4]
            month_idx, prev = 0, 0
            for line in _lines(region):
                week = None
                for w in line:
                    if w["x1"] < first_day_x0 - 1 and w["text"].isdigit():
                        week = int(w["text"])
                for w in sorted(line, key=lambda w: w["x0"]):
                    if w["x1"] < first_day_x0 - 1 or not w["text"].isdigit():
                        continue
                    day = int(w["text"])
                    if not 1 <= day <= 31:
                        continue
                    if day < prev and month_idx + 1 < len(months):
                        month_idx += 1
                    prev = day
                    cx = (w["x0"] + w["x1"]) / 2
                    col = min(day_x, key=lambda n: abs(day_x[n] - cx))
                    try:
                        d = date(yy, months[month_idx], day)
                    except ValueError:
                        continue
                    r = _smallest_rect_containing(fills, w)
                    kind = _classify(r["non_stroking_color"], ref) if r else "empty"
                    out[side].setdefault(d, {"week": week, "kind": kind, "col": col})
    return out


def _quarter(days, name):
    """Cuatrimestre a partir de la rejilla de un lado de la hoja."""
    ds = sorted(days)
    lective = [d for d in ds if d.weekday() < 5 and days[d]["kind"] == "lective"]
    if not lective:
        raise CalendarError(f"{name}: no hay ningún día lectivo en la rejilla")
    start = lective[0]
    end = start
    for d in ds:
        if d < start or d.weekday() >= 5:
            continue
        kind = days[d]["kind"]
        if kind == "exam":
            break
        if kind == "lective":
            end = d
    week = days[start]["week"]
    if week is None:
        raise CalendarError(f"{name}: la fila del primer día lectivo no tiene número de semana")
    return {"start": start, "end": end, "first_week": week}


def _parse_holiday_list(page, words, year):
    """Lista de festivos de debajo de la leyenda: {date: nombre}. Admite rangos 'dd/mm al dd/mm'."""
    anchor = [w for w in words if w["text"] == "Normal"]
    if not anchor:
        return {}
    top = max(w["bottom"] for w in anchor) + 4
    area = [w for w in words if w["top"] > top]
    result = {}

    def to_date(dd, mm):
        month = int(mm)
        y = year if month >= 9 else year + 1
        try:
            return date(y, month, int(dd))
        except ValueError:
            return None

    # Cada línea puede traer dos festivos (dos columnas): se recorre de izquierda a derecha y cada
    # fecha abre un elemento cuyo nombre llega hasta la siguiente fecha.
    for line in _lines(area):
        toks = [w["text"] for w in line]
        i = 0
        while i < len(toks):
            m = DATE_TOKEN_RE.match(toks[i])
            if not m:
                i += 1
                continue
            d1 = to_date(m.group(1), m.group(2))
            j = i + 1
            d2 = d1
            if j + 1 < len(toks) and toks[j].lower() == "al" and DATE_TOKEN_RE.match(toks[j + 1]):
                m2 = DATE_TOKEN_RE.match(toks[j + 1])
                d2 = to_date(m2.group(1), m2.group(2))
                j += 2
            name = []
            while j < len(toks) and not DATE_TOKEN_RE.match(toks[j]):
                name.append(toks[j])
                j += 1
            if d1 and d2 and d2 >= d1:
                label = " ".join(name).strip()
                d = d1
                while d <= d2:
                    result[d] = label
                    d += timedelta(days=1)
            i = j
    return result


def _validate(year, q1, q2):
    """Cordura: si la hoja cambia de formato y el extractor lee basura, mejor fallar que publicar fechas absurdas."""
    if not (q1["start"] < q1["end"] < q2["start"] < q2["end"]):
        raise CalendarError(f"cuatrimestres desordenados: {q1['start']}–{q1['end']} / {q2['start']}–{q2['end']}")
    for name, q in (("1er", q1), ("2º", q2)):
        weeks = (q["end"] - q["start"]).days / 7
        if not 8 <= weeks <= 22:
            raise CalendarError(f"{name} cuatrimestre de {weeks:.0f} semanas: no es plausible")
    if not (date(year, 8, 1) <= q1["start"] <= date(year, 11, 1) and date(year + 1, 3, 1) <= q2["end"] <= date(year + 1, 8, 31)):
        raise CalendarError("las fechas no caen dentro del curso académico indicado en el título")
    if not (1 <= q1["first_week"] <= 5 and q1["first_week"] < q2["first_week"] <= 60):
        raise CalendarError(f"semanas de inicio no plausibles: {q1['first_week']} / {q2['first_week']}")


def _fmt(d):
    return f"{d.day:02d}/{d.month:02d}/{d.year}"


def extract_calendar(path):
    """
    Extrae el calendario académico de un PDF de horarios. Devuelve:
      {"academicYear": "2026-2027", "q1": {...}, "q2": {...}, "festivos": [...], "nombres": {...}, "warnings": [...]}
    (fechas como dd/mm/aaaa, el formato de academic-calendar.json). Lanza CalendarError si la hoja no existe o no se entiende.
    """
    with pdfplumber.open(path) as pdf:
        page = next((p for p in pdf.pages if "CALENDARIO SEMANAL" in (p.extract_text() or "")), None)
        if page is None:
            raise CalendarError("El PDF no tiene la hoja 'CALENDARIO SEMANAL'")
        words = page.extract_words(x_tolerance=1.5, y_tolerance=2)
        year = _academic_start_year(page.extract_text() or "")
        ref = _legend_colors(page, words)
        grid = _parse_grid(page, words, ref, year)
        listed = _parse_holiday_list(page, words, year)

    q1 = _quarter(grid[0], "1er cuatrimestre")
    q2 = _quarter(grid[1], "2º cuatrimestre")
    warnings = []
    _validate(year, q1, q2)

    # Festivos = unión de la lista y de los días laborables pintados como no lectivos DENTRO de un cuatrimestre
    # (fuera de ellos —vacaciones de Navidad, exámenes— da igual: no hay clases).
    in_quarter = lambda d: d.weekday() < 5 and (q1["start"] <= d <= q1["end"] or q2["start"] <= d <= q2["end"])  # noqa: E731
    colored = {d for side in grid.values() for d, v in side.items() if v["kind"] == "nolective" and in_quarter(d)}
    only_list = sorted(d for d in listed if in_quarter(d) and d not in colored)
    only_grid = sorted(d for d in colored if d not in listed)
    if only_list:
        warnings.append("festivos de la lista que la rejilla no pinta como no lectivos: " + ", ".join(_fmt(d) for d in only_list))
    if only_grid:
        warnings.append("días pintados como no lectivos que no están en la lista: " + ", ".join(_fmt(d) for d in only_grid))
    if not listed and not colored:
        warnings.append("no se encontró ningún festivo")

    all_h = sorted(set(listed) | colored)
    return {
        "academicYear": f"{year}-{year + 1}",
        "q1": {"start": _fmt(q1["start"]), "end": _fmt(q1["end"]), "first_week": q1["first_week"]},
        "q2": {"start": _fmt(q2["start"]), "end": _fmt(q2["end"]), "first_week": q2["first_week"]},
        "festivos": [_fmt(d) for d in all_h],
        "nombres": {_fmt(d): listed[d] for d in all_h if listed.get(d)},
        "warnings": warnings,
    }
