"""
Pruebas del parser de PDF (sin PDF reales: la parte de semanas) y, opcionalmente, de un PDF real.

    python engine/test_timetable.py                    # sólo las pruebas unitarias
    python engine/test_timetable.py ruta/al/horario.pdf  # además extrae ese PDF y comprueba lo básico
"""

import sys

from timetable import extract_pdf, parse_weeks


def test_weeks():
    assert parse_weeks("TODAS") == list(range(1, 53))
    assert parse_weeks("TODAS menos 3,4") == [w for w in range(1, 53) if w not in (3, 4)]
    # Regresión: el original leía dígito a dígito ("menos 10" -> 1 y 0).
    assert 10 not in parse_weeks("TODAS menos 10") and 1 in parse_weeks("TODAS menos 10")
    assert parse_weeks("4,5,7,10") == [4, 5, 7, 10]
    assert parse_weeks("4.5.7") == [4, 5, 7]
    assert parse_weeks("3-6") == [3, 4, 5, 6]
    assert parse_weeks("5") == [5]
    # Celda de semanas partida en dos líneas ("...,10,1" + "1,12,13,14") ya unida por el parser:
    assert parse_weeks("2,3,4,5,6,7,8,9,10,11,12,13,14")[-1] == 14
    for bad in ("", "TODAS2,3", "abc"):
        try:
            parse_weeks(bad)
        except ValueError:
            continue
        raise AssertionError(f"debería rechazar {bad!r}")


def test_pdf(path):
    d = extract_pdf(path)
    assert d["cuatrimestre"] in (1, 2)
    assert d["rows"], "sin filas"
    for r in d["rows"]:
        assert 0 <= r["day"] <= 4 and r["hourStart"] < r["hourEnd"] and r["subject"] and r["weeks"]
    print(f"{path}: {len(d['rows'])} filas, {len(d['sections'])} sección(es), {len(d['subjects'])} en leyenda, {len(d['warnings'])} aviso(s)")


if __name__ == "__main__":
    test_weeks()
    print("parse_weeks OK")
    for p in sys.argv[1:]:
        test_pdf(p)
