"""
CLI: procesa varios PDF (de horarios o de exámenes) en UN solo proceso (importar
pandas/pdfplumber cuesta más que parsear cada PDF, así que se evita arrancar Python por fichero).

Uso: python parse_batch.py <manifiesto.json>
Manifiesto: {"items": [{"id", "pdf", "out", "kind": "horario"|"exam" (def. "horario"),
                         "cuatrimestreHint": 1|2|null (solo horario), "academicYearHint": "AAAA-AAAA"|null (solo exam"}]}
Escribe cada resultado en su "out" y, a stdout, un JSON {"results": [{"id","ok","error"?,"warnings"?,...}]}.
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from academic import extract_calendar
from exams import extract_exams
from timetable import extract_pdf


def _process_horario(item: dict) -> dict:
    data = extract_pdf(item["pdf"], item.get("cuatrimestreHint"))
    data["id"] = item["id"]
    data["parsedAt"] = datetime.now(timezone.utc).isoformat()
    Path(item["out"]).write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # Calendario académico de la hoja "CALENDARIO SEMANAL": un fallo aquí no invalida el horario.
    calendar, calendar_error = None, None
    try:
        calendar = extract_calendar(item["pdf"])
    except Exception as e:
        calendar_error = f"{type(e).__name__}: {e}"
    return {
        "id": item["id"],
        "ok": True,
        "calendar": calendar,
        "calendarError": calendar_error,
        "cuatrimestre": data["cuatrimestre"],
        "subjects": len({r["subject"] for r in data["rows"]}),
        "rows": len(data["rows"]),
        "warnings": data["warnings"],
    }


def _process_exam(item: dict) -> dict:
    data = extract_exams(item["pdf"], academic_year_hint=item.get("academicYearHint"))
    data["id"] = item["id"]
    data["parsedAt"] = datetime.now(timezone.utc).isoformat()
    Path(item["out"]).write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return {"id": item["id"], "ok": True, "exams": len(data["exams"]), "warnings": data["warnings"]}


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Falta la ruta al manifiesto (argv[1])."}))
        return 1
    manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    results = []
    for item in manifest["items"]:
        try:
            if item.get("kind") == "exam":
                results.append(_process_exam(item))
            else:
                results.append(_process_horario(item))
        except Exception as e:  # un PDF roto no debe tumbar el lote
            results.append({"id": item["id"], "ok": False, "error": f"{type(e).__name__}: {e}"})
    sys.stdout.write(json.dumps({"results": results}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
