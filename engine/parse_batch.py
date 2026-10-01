"""
CLI: procesa varios PDF de horarios en UN solo proceso (importar pandas/pdfplumber cuesta más
que parsear cada PDF, así que se evita arrancar Python por fichero).

Uso: python parse_batch.py <manifiesto.json>
Manifiesto: {"items": [{"id": "...", "pdf": "ruta.pdf", "out": "ruta.json", "cuatrimestreHint": 1|2|null}, ...]}
Escribe cada resultado en su "out" y, a stdout, un JSON {"results": [{"id","ok","error"?,"warnings"?,...}]}.
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from academic import extract_calendar
from timetable import extract_pdf


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Falta la ruta al manifiesto (argv[1])."}))
        return 1
    manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    results = []
    for item in manifest["items"]:
        try:
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
            results.append(
                {
                    "id": item["id"],
                    "ok": True,
                    "calendar": calendar,
                    "calendarError": calendar_error,
                    "cuatrimestre": data["cuatrimestre"],
                    "subjects": len({r["subject"] for r in data["rows"]}),
                    "rows": len(data["rows"]),
                    "warnings": data["warnings"],
                }
            )
        except Exception as e:  # un PDF roto no debe tumbar el lote
            results.append({"id": item["id"], "ok": False, "error": f"{type(e).__name__}: {e}"})
    sys.stdout.write(json.dumps({"results": results}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
