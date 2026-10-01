"""
Pruebas del extractor de calendario académico (engine/academic.py).

    python engine/test_academic.py                     # unitarias (sin PDF)
    python engine/test_academic.py ruta/al/horario.pdf   # además, extrae ese PDF real
"""

import sys
from datetime import date

from academic import CalendarError, _parse_holiday_list, _validate, extract_calendar


class FakePage:
    width = 595


def word(text, x, top):
    return {"text": text, "x0": x, "x1": x + 5 * len(text), "top": top, "bottom": top + 8}


def test_holiday_list():
    # Una línea con dos columnas, un rango "dd/mm al dd/mm" y una fecha que cae en el año siguiente.
    words = [word("Normal", 380, 650)]
    row1 = [("12/10", 115), ("Fiesta", 140), ("Nacional", 170), ("29/01", 360), ("Sto.", 390), ("Tomás", 410)]
    row2 = [("22/03", 360), ("al", 395), ("28/03", 430), ("Semana", 470), ("Santa", 510)]
    words += [word(t, x, 689) for t, x in row1] + [word(t, x, 700) for t, x in row2]
    got = _parse_holiday_list(FakePage(), words, 2026)
    assert got[date(2026, 10, 12)] == "Fiesta Nacional"
    assert got[date(2027, 1, 29)] == "Sto. Tomás"  # enero pertenece al segundo año del curso
    assert [d for d in got if d.month == 3] == [date(2027, 3, d) for d in range(22, 29)]  # el rango se expande
    assert got[date(2027, 3, 25)] == "Semana Santa"


def test_validation():
    ok_q1 = {"start": date(2026, 9, 10), "end": date(2026, 12, 16), "first_week": 1}
    ok_q2 = {"start": date(2027, 1, 26), "end": date(2027, 5, 7), "first_week": 21}
    _validate(2026, ok_q1, ok_q2)  # no lanza
    bad = [
        (ok_q2, ok_q1),  # desordenados
        ({**ok_q1, "end": date(2026, 9, 20)}, ok_q2),  # cuatrimestre de 1 semana
        ({**ok_q1, "start": date(2026, 2, 1), "end": date(2026, 6, 1)}, ok_q2),  # fuera del curso
        (ok_q1, {**ok_q2, "first_week": 0}),  # semanas absurdas
    ]
    for q1, q2 in bad:
        try:
            _validate(2026, q1, q2)
        except CalendarError:
            continue
        raise AssertionError(f"debería rechazar {q1} {q2}")


def test_pdf(path):
    c = extract_calendar(path)
    assert c["academicYear"] and c["q1"]["first_week"] < c["q2"]["first_week"]
    assert c["festivos"] and not c["warnings"], c["warnings"]
    print(f"{path}: curso {c['academicYear']}, q1 {c['q1']}, q2 {c['q2']}, {len(c['festivos'])} festivos")


if __name__ == "__main__":
    test_holiday_list()
    test_validation()
    print("academic OK")
    for p in sys.argv[1:]:
        test_pdf(p)
