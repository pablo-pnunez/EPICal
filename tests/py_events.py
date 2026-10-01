"""
Oráculo para el test de equivalencia de web/src/lib/events.ts: calcula con el motor Python original
(engine/schedule.py#subject_to_events, ya validado en producción) los eventos de
varias asignaturas reales y los vuelca a JSON. Lo compara después tests/run-events-test.mjs.

Uso: python tests/py_events.py <DATA_DIR> <salida.json>
"""

import json
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd
from dateutil import tz

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "engine"))
from schedule import HOLIDAY, _to_madrid_wallclock, subject_to_events  # noqa: E402

MAX_PDFS = 40
MAX_SUBJECTS_PER_PDF = 3


def gd(s: str) -> datetime:
    d, m, y = s.split("/")
    return datetime(int(y), int(m), int(d), tzinfo=tz.tzlocal())


def main() -> int:
    data_dir = Path(sys.argv[1])
    # Calendario extraído de los PDF (state.json), el mismo que usa la web.
    calendars = json.loads((data_dir / "state.json").read_text(encoding="utf-8"))["calendars"]
    cal = calendars[sorted(calendars)[-1]]["data"]
    out = {}
    for f in sorted((data_dir / "public" / "schedules").glob("*.json"))[:MAX_PDFS]:
        s = json.loads(f.read_text(encoding="utf-8"))
        q = cal["q1" if s["cuatrimestre"] == 1 else "q2"]
        df = pd.DataFrame(s["rows"]).rename(columns={"hourStart": "hour_s", "hourEnd": "hour_e"})
        for subj in sorted(df.subject.unique())[:MAX_SUBJECTS_PER_PDF]:
            ev = subject_to_events(df[df.subject == subj].copy(), gd(q["start"]), gd(q["end"]), q["first_week"], [gd(x) for x in cal["festivos"]])
            ev = _to_madrid_wallclock(ev)
            out[f"{s['id']}|{subj}"] = sorted(
                [str(r.start.date()), r.start.hour, r.end.hour, r.group, r.room, int(r.week)] for r in ev.itertuples() if r.group != HOLIDAY
            )
    Path(sys.argv[2]).write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print(f"{len(out)} combinaciones asignatura/PDF")
    return 0


if __name__ == "__main__":
    sys.exit(main())
