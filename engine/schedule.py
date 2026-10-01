"""
Cálculo de eventos con fecha real y rejilla semanal para el EXCEL de una asignatura.

Algoritmo heredado de una app anterior de generación de calendarios, ya validado con PDF reales.
Aquí ya NO está la extracción del PDF (ver `timetable.py`) ni la generación de .ics (se hace en el
navegador, `web/src/lib/events.ts`): sólo lo que necesita `excel.py`.
"""

from datetime import timedelta
from dateutil import tz
import pandas as pd

HOLIDAY = "FIESTA"


def subject_to_events(subject_data, first_day, last_day, fcw, festivos):
    """
    Expande la rejilla semanal (día de la semana + nº de semana de impartición) a eventos con
    fecha real, dentro del rango [first_day, last_day].

    `subject_data` conserva la columna `subject` de principio a fin (se incluye en la clave de
    fusión de tramos consecutivos junto a `group`), aunque el uso habitual (una única asignatura
    ya filtrada) tenga siempre el mismo valor ahí — así una llamada con la rejilla de VARIAS
    asignaturas a la vez (calendario combinado "TODAS", ver generate_ical.py) no fusiona por error
    dos clases de asignaturas distintas que compartan letra de grupo (p.ej. ambas con grupo "A").
    """
    subject_data = subject_data.copy()
    week_diff = fcw - first_day.isocalendar().week
    min_hour = subject_data.hour_s.min()
    max_hour = subject_data.hour_e.max()

    week_data = []
    while first_day != last_day + timedelta(days=1):
        curse_week_val = first_day.isocalendar()[1] + week_diff
        festivo = first_day in festivos

        if festivo:
            min_dt = pd.Timestamp(year=first_day.year, month=first_day.month, day=first_day.day, hour=min_hour, minute=0, second=0, tzinfo=tz.tzlocal())
            max_dt = pd.Timestamp(year=first_day.year, month=first_day.month, day=first_day.day, hour=max_hour, minute=0, second=0, tzinfo=tz.tzlocal())
            week_data.append((curse_week_val, first_day.weekday(), min_dt, max_dt, HOLIDAY, "", ""))
        else:
            subject_data["esta_semana"] = subject_data["weeks"].apply(lambda x: curse_week_val in x)
            day_data = subject_data.loc[(subject_data.day == first_day.weekday()) & (subject_data["esta_semana"])].copy()

            if len(day_data) > 0:
                day_data["week"] = curse_week_val
                day_data["start"] = day_data.apply(
                    lambda x: pd.Timestamp(year=first_day.year, month=first_day.month, day=first_day.day, hour=x.hour_s, minute=0, second=0, tzinfo=tz.tzlocal()),
                    axis=1,
                )
                day_data["end"] = day_data.apply(
                    lambda x: pd.Timestamp(year=first_day.year, month=first_day.month, day=first_day.day, hour=x.hour_e, minute=0, second=0, tzinfo=tz.tzlocal()),
                    axis=1,
                )
                week_data.extend(day_data[["week", "day", "start", "end", "group", "room", "subject"]].values.tolist())

        first_day = first_day + timedelta(days=1)

    events = pd.DataFrame(week_data, columns=["week", "day", "start", "end", "group", "room", "subject"])

    ret = []
    for _, ev in events.groupby(["week", "day", "subject", "group"]):
        if len(ev) > 1:  # fusionar tramos consecutivos de la misma clase
            ev = ev.copy()
            ev["consecutive"] = (ev["start"] == ev["end"].shift(1)).astype(int)
            ev["consecutive_grp"] = ev["consecutive"].eq(0).cumsum()
            ev = ev.groupby("consecutive_grp").agg({"week": "min", "day": "min", "start": "min", "end": "max", "group": "first", "room": "first", "subject": "first"}).reset_index(drop=True)
            ret.extend(ev.values.tolist())
        else:
            ret.append(ev.values.tolist()[0])

    return pd.DataFrame(ret, columns=["week", "day", "start", "end", "group", "room", "subject"])


def _to_madrid_wallclock(subject_events):
    """
    Reconstruye `start`/`end` como hora de pared de Madrid EXPLÍCITA, en vez
    de dejar el tzinfo que trae `subject_to_events` (`tz.tzlocal()`, el del
    sistema que ejecuta este proceso). Así el horario generado (tanto el
    .ics como el .xlsx) es correcto sin importar en qué huso horario esté
    configurado el servidor (p.ej. un servidor en UTC): las clases son
    siempre a la hora de pared de Madrid, no a la del reloj del servidor.
    Usado por `to_ical` y `print_subject` — antes cada uno hacía su propia
    conversión (y `print_subject`, en la app original, ni siquiera la
    hacía — sólo era correcto porque la app se ejecutaba siempre en un PC
    ya puesto en hora de Madrid).
    """
    events = subject_events.copy()
    date = events["start"].dt.date.astype(str)
    start_hour = events["start"].dt.hour.astype(str)
    end_hour = events["end"].dt.hour.astype(str)
    events["start"] = pd.to_datetime(date + " " + start_hour + ":00:00").dt.tz_localize("Europe/Madrid")
    events["end"] = pd.to_datetime(date + " " + end_hour + ":00:00").dt.tz_localize("Europe/Madrid")
    return events


def day_calendar(week, day, day_data=None, min_h=9, max_h=20, column="group"):
    """Una fila por hora (`min_h`..`max_h` inclusive) de un día concreto — `evento` es el texto que va en esa celda de la rejilla (usado por `print_week`/`create_subject_excel`)."""
    ret = []
    for h in range(min_h, max_h + 1):
        evento = ""
        date_str = day.strftime("%d/%m")
        if day_data is None:
            ret.append((week, date_str, h, h + 1, evento))
        else:
            hour_data = day_data.loc[(h >= day_data.start) & (h < day_data.end)]
            if HOLIDAY in day_data[column].values:
                evento = "-"
            elif len(hour_data) > 0:
                evento = " / ".join(hour_data[column])
            ret.append((week, date_str, h, h + 1, evento))
    return ret


def print_week(list_days, min_h=8, max_h=20, weekend=False):
    """Una semana como rejilla de filas [hora_inicio, hora_fin, evento_lun, evento_mar, ...] con una fila de cabecera [nº_semana, "", fecha_lun, fecha_mar, ...] — la unidad básica que compone la hoja "Horario" del Excel."""
    list_days = pd.DataFrame(list_days, columns=["week", "day", "h_i", "h_f", "eve"])
    printed_lines = []

    if not weekend:
        list_days = list_days.iloc[: (len(list_days) // 7) * 5, :]

    header = [list_days.week.max(), ""] + list_days.day.unique().tolist()
    printed_lines.append(header)

    for h in range(min_h, max_h):
        hour_data = list_days.loc[list_days.h_i == h]
        hour_events = [h, h + 1] + hour_data.eve.tolist()
        printed_lines.append(hour_events)

    return printed_lines


def print_subject(subject_events, column="group", min_h=None, max_h=None, weekend=False):
    """
    Expande los eventos ya generados (`subject_to_events`) a la rejilla
    semana-a-semana usada por el Excel: `(printed_lines, subject_calendar)`
    donde `printed_lines` es una lista de semanas (cada una, la rejilla de
    `print_week`) y `subject_calendar` son los mismos eventos con `date`
    (fecha) y `start`/`end` como HORA (entero), en vez de `Timestamp`
    completo — la forma que necesita `create_subject_excel` para la hoja de
    resumen y la de eventos.
    """
    subject_calendar = _to_madrid_wallclock(subject_events)
    subject_calendar["date"] = subject_calendar["start"].dt.date
    subject_calendar["start"] = subject_calendar["start"].dt.hour
    subject_calendar["end"] = subject_calendar["end"].dt.hour

    first_day = subject_calendar["date"].min()
    if first_day.weekday() > 0:
        first_day = first_day - timedelta(days=first_day.weekday())
    last_day = subject_calendar["date"].max()
    if last_day.weekday() < 6:
        last_day = last_day + timedelta(days=6 - last_day.weekday())

    if min_h is None:
        min_h = int(subject_calendar.start.min())
    if max_h is None:
        max_h = int(subject_calendar.end.max())

    week_data = []
    printed_lines = []
    week_no = subject_calendar.week.min()

    for _ in range((last_day - first_day).days + 1):
        day_events = subject_calendar.loc[subject_calendar.date == first_day]

        if len(week_data) > 0 and first_day.weekday() == 0:  # cambio de semana: cerrar la anterior
            printed_lines.append(print_week(week_data, min_h=min_h, max_h=max_h, weekend=weekend))
            week_data = []

        if len(day_events) > 0:
            week_no = day_events.week.values[0]
            day_data = day_calendar(week_no, first_day, day_data=day_events, min_h=min_h, max_h=max_h, column=column)
        else:
            day_data = day_calendar(week_no, first_day, day_data=None, min_h=min_h, max_h=max_h, column=column)
        week_data.extend(day_data)

        first_day += timedelta(days=1)

    printed_lines.append(print_week(week_data, min_h=min_h, max_h=max_h, weekend=weekend))
    return printed_lines, subject_calendar
