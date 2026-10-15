"""
Pruebas del extractor de exámenes (engine/exams.py).

    python engine/test_exams.py                      # unitarias (sin PDF)
    python engine/test_exams.py ruta/al/examenes.pdf   # además, extrae ese PDF real
"""

import sys

from exams import _classify_type, _extract_hour_override, _month_from_name, _split_line, extract_exams


def test_classify_type():
    assert _classify_type("Estructuras de Datos (teoría) AN-A") == ("teoria", "Estructuras de Datos AN-A")
    assert _classify_type("Seguridad (prácticas) AN-B8") == ("practicas", "Seguridad AN-B8")
    assert _classify_type("Redes de Computadores (teoría y prácticas) AN-D") == ("teoria_practicas", "Redes de Computadores AN-D")
    assert _classify_type("Empresa EP-EXAM2") == (None, "Empresa EP-EXAM2")


def test_extract_hour_override():
    assert _extract_hour_override("Gestión Tec. de la Información (9:30) AN-E") == ((9, 30), "Gestión Tec. de la Información AN-E")
    assert _extract_hour_override("Empresa EP-EXAM2") == (None, "Empresa EP-EXAM2")


def test_split_line():
    # Asignatura + aula en la misma línea (caso más común).
    assert _split_line("Sistemas de Información AN-E") == ("Sistemas de Información", "AN-E")
    # Sin aula todavía asignada (curso publicado con antelación).
    assert _split_line("Autómatas y Matemáticas") == ("Autómatas y Matemáticas", "")
    # Varios códigos de aula sueltos.
    assert _split_line("AN-B7, AN-B8") == ("", "AN-B7, AN-B8")
    # "EM" es parte del nombre (Ondas y Electromagnetismo abreviado), no un código de aula.
    assert _split_line("Ondas y EM") == ("Ondas y EM", "")


def test_month_from_name():
    assert _month_from_name("diciembre") == 12
    assert _month_from_name("Enero") == 1
    assert _month_from_name("mayo") == 5
    assert _month_from_name("inventado") is None


def test_pdf(path, academic_year_hint=None):
    data = extract_exams(path, academic_year_hint=academic_year_hint)
    assert data["academicYear"]
    assert len(data["exams"]) >= 10, f"solo {len(data['exams'])} exámenes extraídos: ¿cambió el formato?"
    for e in data["exams"]:
        assert 1 <= e["curso"] <= 6
        assert e["semestre"] in (1, 2)
        assert e["subjectRaw"]
        assert e["date"].count("/") == 2
        assert e["hourStart"].count(":") == 1
    ratio = len(data["warnings"]) / len(data["exams"])
    print(f"{path}: curso {data['academicYear']}, {len(data['exams'])} exámenes, {len(data['warnings'])} avisos ({ratio:.0%})")
    if ratio > 0.3:
        print("  AVISO: proporción de avisos alta, revisar el formato del PDF")


if __name__ == "__main__":
    test_classify_type()
    test_extract_hour_override()
    test_split_line()
    test_month_from_name()
    print("exams OK")
    for p in sys.argv[1:]:
        test_pdf(p)
