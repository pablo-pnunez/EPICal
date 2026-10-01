"""
CLI: genera el Excel formateado de una asignatura a partir de las filas ya extraídas del PDF.

Uso: python generate_excel.py <ruta-al-json-de-peticion>
Variable de entorno EPICAL_ACADEMIC_CALENDAR: ruta a academic-calendar.json.

Petición:
{
  "rows": [...],              // filas de la rejilla (formato de parse_batch.py)
  "cuatrimestre": 1,
  "academicYear": "2026-2027",
  "subjectName": "SIS_INTELIG",   // acrónimo tal cual aparece en rows[].subject
  "displayName": "Sistemas Inteligentes",  // opcional, título del fichero
  "groups": ["A", "PL1"]      // opcional; vacío = todos
}
Salida (stdout): {"filename": "...", "contentBase64": "..."} o {"error": "..."} con exit code 1.
"""

import base64
import json
import os
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd
from dateutil import tz

from excel import create_subject_excel
from schedule import HOLIDAY, subject_to_events


def fail(msg: str) -> int:
    sys.stdout.write(json.dumps({"error": msg}, ensure_ascii=False))
    return 1


def get_date(date_str: str) -> datetime:
    d, m, y = date_str.split("/")
    return datetime(int(y), int(m), int(d), tzinfo=tz.tzlocal())


def safe_filename(name: str) -> str:
    return "".join(c if c.isalnum() or c in " ._-()" else "_" for c in name).strip() or "horario"


def main() -> int:
    if len(sys.argv) < 2:
        return fail("Falta la ruta al JSON de la petición (argv[1]).")
    try:
        payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
        academic_year = payload["academicYear"]
        cuatrimestre = int(payload["cuatrimestre"])
        subject_name = payload["subjectName"]
        rows = payload["rows"]
    except (OSError, json.JSONDecodeError, KeyError) as e:
        return fail(f"Petición inválida: {e}")

    cal_path = os.environ.get("EPICAL_ACADEMIC_CALENDAR")
    if not cal_path:
        return fail("Falta EPICAL_ACADEMIC_CALENDAR.")
    calendar = json.loads(Path(cal_path).read_text(encoding="utf-8"))
    course = calendar.get(academic_year)
    if course is None:
        return fail(f"No hay festivos/cuatrimestres configurados para el curso '{academic_year}'.")
    q = course.get("q1" if cuatrimestre == 1 else "q2")
    if q is None:
        return fail(f"El curso '{academic_year}' no tiene configurado el cuatrimestre {cuatrimestre}.")

    festivos = [get_date(d) for d in course["festivos"]]
    first_day, last_day, fcw = get_date(q["start"]), get_date(q["end"]), q["first_week"]

    df = pd.DataFrame(rows).rename(columns={"hourStart": "hour_s", "hourEnd": "hour_e"})
    subject_data = df.loc[df.subject == subject_name].copy()
    if subject_data.empty:
        return fail(f"No hay clases de '{subject_name}' en el horario.")

    try:
        events = subject_to_events(subject_data, first_day=first_day, last_day=last_day, fcw=fcw, festivos=festivos)
    except Exception as e:
        return fail(f"No se pudieron generar los eventos: {e}")

    groups = payload.get("groups") or subject_data["group"].unique().tolist()
    events = events.loc[events.group.isin(list(groups) + [HOLIDAY])]
    if events.empty:
        return fail("No hay ningún evento para la asignatura/grupos seleccionados.")

    title = payload.get("displayName") or subject_name
    try:
        xlsx = create_subject_excel(events, subject_name=title, holiday=HOLIDAY)
    except Exception as e:
        return fail(f"No se pudo generar el Excel: {e}")

    sys.stdout.write(json.dumps({"filename": f"{safe_filename(title)}.xlsx", "contentBase64": base64.b64encode(xlsx).decode("ascii")}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
