import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ACTIVITY_HUE, activityOf, type CalEvent } from "../lib/events";

const DAY_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];
const ROW_PX = 46;
const DATE_FMT = new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", timeZone: "UTC" });

function mondayOf(dateStr: string, weekday: number): Date {
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - weekday));
}

interface Placed {
  ev: CalEvent;
  lane: number;
  lanes: number;
}

/** Reparte en "carriles" los eventos que se solapan dentro de un mismo día para pintarlos uno junto a otro. */
function placeEvents(events: CalEvent[]): Placed[] {
  const sorted = [...events].sort((a, b) => a.startHour - b.startHour || b.hours - a.hours);
  const out: Placed[] = [];
  let cluster: Placed[] = [];
  let clusterEnd = -1;
  const laneEnds: number[] = [];
  const closeCluster = () => {
    for (const p of cluster) p.lanes = laneEnds.length;
    out.push(...cluster);
    cluster = [];
    laneEnds.length = 0;
  };
  for (const ev of sorted) {
    if (cluster.length > 0 && ev.startHour >= clusterEnd) closeCluster();
    let lane = laneEnds.findIndex((end) => end <= ev.startHour);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = ev.startHour + ev.hours;
    clusterEnd = Math.max(clusterEnd, ev.startHour + ev.hours);
    cluster.push({ ev, lane, lanes: 1 });
  }
  closeCluster();
  return out;
}

export function WeekView({ classes, holidays }: { classes: CalEvent[]; holidays: CalEvent[] }) {
  const weeks = useMemo(() => {
    const map = new Map<number, { monday: Date; classes: CalEvent[]; holidays: CalEvent[] }>();
    const ensure = (ev: CalEvent) => {
      let w = map.get(ev.week);
      if (!w) {
        w = { monday: mondayOf(ev.date, ev.weekday), classes: [], holidays: [] };
        map.set(ev.week, w);
      }
      return w;
    };
    for (const ev of classes) ensure(ev).classes.push(ev);
    for (const ev of holidays) ensure(ev).holidays.push(ev);
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [classes, holidays]);

  const initial = useMemo(() => {
    const today = Date.now() - 6 * 86_400_000;
    const idx = weeks.findIndex(([, w]) => w.monday.getTime() >= today);
    return idx === -1 ? Math.max(0, weeks.length - 1) : idx;
  }, [weeks]);
  const [idx, setIdx] = useState(initial);
  useEffect(() => setIdx(initial), [initial]);

  const [minH, maxH] = useMemo(() => {
    if (classes.length === 0) return [9, 15];
    return [Math.min(...classes.map((e) => e.startHour)), Math.max(...classes.map((e) => e.startHour + e.hours))];
  }, [classes]);

  if (weeks.length === 0) return <p className="muted">No hay eventos en el cuatrimestre.</p>;
  const [weekNo, week] = weeks[Math.min(idx, weeks.length - 1)]!;
  const sunday = new Date(week.monday.getTime() + 4 * 86_400_000);
  const hours = Array.from({ length: maxH - minH }, (_, i) => minH + i);

  return (
    <div className="week">
      <div className="week__nav">
        <button type="button" className="secondary" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0} aria-label="Semana anterior">
          <ChevronLeft size={16} aria-hidden />
        </button>
        <select value={idx} onChange={(e) => setIdx(Number(e.target.value))} aria-label="Semana">
          {weeks.map(([n, w], i) => (
            <option key={n} value={i}>
              Semana {n} · {DATE_FMT.format(w.monday)} – {DATE_FMT.format(new Date(w.monday.getTime() + 4 * 86_400_000))}
            </option>
          ))}
        </select>
        <button type="button" className="secondary" onClick={() => setIdx((i) => Math.min(weeks.length - 1, i + 1))} disabled={idx >= weeks.length - 1} aria-label="Semana siguiente">
          <ChevronRight size={16} aria-hidden />
        </button>
      </div>
      <p className="muted week__range">
        Semana {weekNo} del curso: {DATE_FMT.format(week.monday)} – {DATE_FMT.format(sunday)}
      </p>

      <div className="week__grid" style={{ "--rows": hours.length, "--row-px": `${ROW_PX}px` } as CSSProperties}>
        <div className="week__corner" />
        {DAY_NAMES.map((name, d) => {
          const date = new Date(week.monday.getTime() + d * 86_400_000);
          const holiday = week.holidays.find((h) => h.weekday === d);
          return (
            <div key={name} className={`week__dayhead ${holiday ? "week__dayhead--holiday" : ""}`}>
              {name} <span className="muted">{DATE_FMT.format(date)}</span>
              {holiday && <div className="week__holiday">Festivo</div>}
            </div>
          );
        })}
        <div className="week__hours">
          {hours.map((h) => (
            <div key={h} className="week__hour" style={{ height: ROW_PX }}>
              {String(h).padStart(2, "0")}:00
            </div>
          ))}
        </div>
        {DAY_NAMES.map((name, d) => {
          const placed = placeEvents(week.classes.filter((e) => e.weekday === d));
          return (
            <div key={name} className="week__col" style={{ height: hours.length * ROW_PX }}>
              {hours.map((h) => (
                <div key={h} className="week__line" style={{ top: (h - minH) * ROW_PX }} />
              ))}
              {placed.map(({ ev, lane, lanes }, i) => {
                const act = activityOf(ev.group);
                const [subject] = ev.summary.split(" [");
                return (
                  <div
                    key={i}
                    className="week__ev"
                    style={{ top: (ev.startHour - minH) * ROW_PX + 1, height: ev.hours * ROW_PX - 2, left: `${(lane / lanes) * 100}%`, width: `${100 / lanes}%`, "--ev-hue": ACTIVITY_HUE[act] } as CSSProperties}
                    title={`${ev.summary}${ev.location ? ` · ${ev.location}` : ""}`}
                  >
                    <strong>{subject}</strong>
                    <span>
                      {ev.group}
                      {ev.location ? ` · ${ev.location}` : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
