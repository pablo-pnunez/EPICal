import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ACTIVITY_HUE, activityOf, type CalEvent } from "../lib/events";

const TIME_FMT = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });
const DAY_FMT = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const MONTH_FMT = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric", timeZone: "UTC" });

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function utcDate(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

/** "Sistemas Inteligentes [PL3]" -> { name, group } */
function splitSummary(summary: string): { name: string; group: string | null } {
  const m = /^(.*) \[([^\]]+)\]$/.exec(summary);
  return m ? { name: m[1]!, group: m[2]! } : { name: summary, group: null };
}

/**
 * Lista cronológica de las clases de un mes, agrupadas por día. Pensada para pantallas estrechas, donde una
 * rejilla de 5 columnas no deja sitio para leer el nombre de la asignatura.
 */
export function AgendaView({ events }: { events: CalEvent[] }) {
  const months = useMemo(() => [...new Set(events.map((e) => e.date.slice(0, 7)))].sort(), [events]);

  const initial = useMemo(() => {
    const today = new Date().toISOString().slice(0, 7);
    const idx = months.findIndex((m) => m >= today);
    return idx === -1 ? Math.max(0, months.length - 1) : idx;
  }, [months]);
  const [idx, setIdx] = useState(initial);
  useEffect(() => setIdx(initial), [initial]);

  const month = months[Math.min(idx, months.length - 1)];
  const days = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const e of events) {
      if (e.date.slice(0, 7) !== month) continue;
      if (!map.has(e.date)) map.set(e.date, []);
      map.get(e.date)!.push(e);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [events, month]);

  if (months.length === 0 || !month) return <p className="muted">No hay eventos en el cuatrimestre.</p>;

  return (
    <div className="agenda">
      <div className="agenda__nav">
        <button type="button" className="secondary icon-button" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0} aria-label="Mes anterior">
          <ChevronLeft size={18} aria-hidden />
        </button>
        <strong>{capitalize(MONTH_FMT.format(utcDate(`${month}-01`)))}</strong>
        <button type="button" className="secondary icon-button" onClick={() => setIdx((i) => Math.min(months.length - 1, i + 1))} disabled={idx >= months.length - 1} aria-label="Mes siguiente">
          <ChevronRight size={18} aria-hidden />
        </button>
      </div>

      {days.map(([date, evs]) => (
        <section key={date} className="agenda__day">
          <h3 className="agenda__date">{capitalize(DAY_FMT.format(utcDate(date)))}</h3>
          {evs
            .slice()
            .sort((a, b) => a.start.getTime() - b.start.getTime())
            .map((ev, i) => {
              if (ev.allDay) {
                return (
                  <div key={i} className="agenda__item agenda__item--holiday">
                    <span className="agenda__time">Todo el día</span>
                    <span className="agenda__title">{ev.summary}</span>
                  </div>
                );
              }
              const { name, group } = splitSummary(ev.summary);
              return (
                <div key={i} className="agenda__item" style={{ "--ev-hue": ACTIVITY_HUE[activityOf(ev.group)] } as CSSProperties}>
                  <span className="agenda__time">
                    {TIME_FMT.format(ev.start)}
                    <small>{TIME_FMT.format(ev.end)}</small>
                  </span>
                  <span className="agenda__body">
                    <span className="agenda__title">{name}</span>
                    <span className="agenda__meta">
                      {group}
                      {ev.location ? ` · ${ev.location}` : ""}
                    </span>
                  </span>
                </div>
              );
            })}
        </section>
      ))}
      {days.length === 0 && <p className="muted">Sin clases este mes.</p>}
    </div>
  );
}
