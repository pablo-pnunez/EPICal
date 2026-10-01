import { CalendarRange, Info, Plus, Search, Trash2, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AgendaView } from "../components/AgendaView";
import { CalendarMonthView } from "../components/CalendarMonthView";
import { ExportPanel } from "../components/ExportPanel";
import { HoursSummary } from "../components/HoursSummary";
import { ErrorBox, Loading } from "../components/Status";
import { groupsByActivity } from "../components/SubjectPicker";
import { WeekView } from "../components/WeekView";
import { getAcademicCalendar, getCatalog, getSchedule, getSubjectIndex, useAsync } from "../lib/api";
import { findByPath, fold, indexPdfs, pdfTitle, type PdfLocation } from "../lib/catalog";
import { ACTIVITY_LABEL, buildEvents, isCourseCalendar, isEnglishGroup, type CalEvent } from "../lib/events";
import { loadStoredMine, mergeEntries, mineSearch, parseMine, pdfKey, saveStoredMine, type MyEntry } from "../lib/myschedule";
import { normalizeAcronym, sortGroups } from "../lib/selection";
import type { Catalog, ParsedSchedule } from "../types";

type Tab = "agenda" | "calendario" | "semana" | "resumen";
const TABS: Array<[Tab, string]> = [
  ["agenda", "Agenda"],
  ["calendario", "Calendario"],
  ["semana", "Semana"],
  ["resumen", "Horas"],
];
const MAX_HITS = 30;

function locOf(catalog: Catalog, key: string): PdfLocation | null {
  const [slug, curso, sem, grupo] = key.split("/");
  return slug && curso && sem && grupo ? findByPath(catalog, slug, curso, sem, grupo) : null;
}

export function MySchedulePage() {
  const catalog = useAsync(getCatalog, []);
  if (catalog.error) return <ErrorBox>{catalog.error}</ErrorBox>;
  if (!catalog.data) return <Loading label="Cargando horarios…" />;
  return <MyScheduleView catalog={catalog.data} />;
}

interface Resolved {
  entry: MyEntry;
  loc: PdfLocation | null;
  sched: ParsedSchedule | null;
  /** Nombre real de la asignatura (leyenda del PDF) y todos sus grupos en ese PDF. */
  name: string;
  groups: string[];
  /** Semanas del cuatrimestre (1, 2, 3…) con clase de cada grupo, para poder quedarse con parte de ellas. */
  allWeeks: Record<string, number[]>;
  /** Fecha (corta) del lunes de una semana del cuatrimestre. */
  dateOfWeek: (week: number) => string | undefined;
  /** Semana de curso del PDF = semana del cuatrimestre + weekOffset. */
  weekOffset: number;
}

const WEEK_DATE = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone: "UTC" });

function MyScheduleView({ catalog }: { catalog: Catalog }) {
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const index = useAsync(getSubjectIndex, []);
  const calendar = useAsync(getAcademicCalendar, []);
  const [query, setQuery] = useState("");

  const urlM = sp.get("m");
  const entries = useMemo(() => parseMine(urlM), [urlM]);

  // Sin `m` en la URL se recupera la última selección guardada en este navegador (no se pisa nunca desde un enlace ajeno).
  useEffect(() => {
    if (urlM !== null) return;
    const stored = loadStoredMine();
    if (stored.length > 0) navigate({ search: mineSearch(stored, sp) }, { replace: true });
  }, [urlM, sp, navigate]);

  const setEntries = useCallback(
    (next: MyEntry[]) => {
      saveStoredMine(next);
      navigate({ search: mineSearch(next, sp) }, { replace: true });
    },
    [navigate, sp]
  );

  const pdfs = useMemo(() => indexPdfs(catalog), [catalog]);
  const locs = useMemo(() => entries.map((e) => locOf(catalog, e.key)), [entries, catalog]);

  const ids = useMemo(() => [...new Set(locs.filter((l): l is PdfLocation => !!l).map((l) => l.pdf.id))].sort(), [locs]);
  const schedules = useAsync(
    () =>
      Promise.all(ids.map((id) => getSchedule(id).catch(() => null))).then((list) => new Map(ids.map((id, i) => [id, list[i] ?? null] as const))),
    [ids.join("|")]
  );

  const resolved = useMemo<Resolved[]>(
    () =>
      entries.map((entry, i) => {
        const loc = locs[i] ?? null;
        const sched = (loc && schedules.data?.get(loc.pdf.id)) || null;
        const acr = sched?.rows.find((r) => normalizeAcronym(r.subject) === normalizeAcronym(entry.subject))?.subject ?? entry.subject;
        const groups = sched ? sortGroups([...new Set(sched.rows.filter((r) => r.subject === acr).map((r) => r.group))]) : [];
        const name = sched?.subjects.find((s) => normalizeAcronym(s.acronym) === normalizeAcronym(acr))?.name || acr;
        const cal = loc?.grado.academicYear && calendar.data ? calendar.data[loc.grado.academicYear] : undefined;
        const q = sched && isCourseCalendar(cal) ? (sched.cuatrimestre === 1 ? cal.q1 : cal.q2) : undefined;
        const dmy = (s: string) => {
          const [d, m, y] = s.split("/").map(Number);
          return Date.UTC(y!, m! - 1, d!);
        };
        const DAY = 86_400_000;
        const firstUtc = q ? dmy(q.start) : 0;
        const lastUtc = q ? dmy(q.end) : 0;
        const firstMonday = firstUtc - ((new Date(firstUtc).getUTCDay() + 6) % 7) * DAY;
        const festivos = new Set(isCourseCalendar(cal) ? cal.festivos.map(dmy) : []);
        // Semanas del cuatrimestre (1, 2, 3…, no las del curso entero) en las que el grupo tiene clase de verdad:
        // el PDF lista semanas de todo el año y hay semanas con festivo.
        const allWeeks: Record<string, number[]> = {};
        if (q) {
          for (const row of sched?.rows ?? []) {
            if (row.subject !== acr) continue;
            for (const w of row.weeks) {
              const date = firstMonday + (w - q.first_week) * 7 * DAY + row.day * DAY;
              if (date < firstUtc || date > lastUtc || festivos.has(date)) continue;
              (allWeeks[row.group] ??= []).push(w - q.first_week + 1);
            }
          }
          for (const g of Object.keys(allWeeks)) allWeeks[g] = [...new Set(allWeeks[g])].sort((a, b) => a - b);
        }
        const dateOfWeek = (week: number) => (q ? WEEK_DATE.format(new Date(firstMonday + (week - 1) * 7 * DAY)) : undefined);
        return { entry: { ...entry, subject: acr }, loc, sched, name, groups, allWeeks, dateOfWeek, weekOffset: q ? q.first_week - 1 : 0 };
      }),
    [entries, locs, schedules.data, calendar.data]
  );

  const nameOf = useCallback(
    (acr: string) => resolved.find((r) => r.entry.subject === acr)?.name ?? acr,
    [resolved]
  );

  // ---- Eventos ----
  const built = useMemo(() => {
    const classes = new Map<string, CalEvent>();
    const holidays = new Map<string, CalEvent>();
    let error: string | null = null;
    for (const r of resolved) {
      if (!r.loc || !r.sched || r.groups.length === 0) continue;
      const year = r.loc.grado.academicYear;
      const cal = year && calendar.data ? calendar.data[year] : undefined;
      if (!isCourseCalendar(cal) || !(r.sched.cuatrimestre === 1 ? cal.q1 : cal.q2)) continue;
      const chosen = r.entry.groups.length === 0 ? r.groups : r.entry.groups;
      try {
        const rows = r.sched.rows
          .filter((x) => x.subject === r.entry.subject && chosen.includes(x.group))
          .map((x) => {
            const only = r.entry.weeks?.[x.group];
            return only ? { ...x, weeks: x.weeks.filter((w) => only.includes(w - r.weekOffset)) } : x;
          });
        const ev = buildEvents(rows, r.sched.cuatrimestre, cal, { nameOf: () => r.name });
        // Una misma clase en dos PDF (dobles grados) no se duplica.
        for (const e of ev.classes) classes.set(`${e.summary}|${e.start.getTime()}|${e.end.getTime()}`, e);
        for (const h of ev.holidays) holidays.set(`${h.date}|${h.summary}`, h);
      } catch (e) {
        error = (e as Error).message;
      }
    }
    const byStart = (a: CalEvent, b: CalEvent) => a.start.getTime() - b.start.getTime() || a.summary.localeCompare(b.summary);
    return { classes: [...classes.values()].sort(byStart), holidays: [...holidays.values()].sort(byStart), error };
  }, [resolved, calendar.data]);

  const monthEvents = useMemo(() => [...built.classes, ...built.holidays].sort((a, b) => a.start.getTime() - b.start.getTime()), [built]);

  // ---- Pestañas ----
  const [narrow] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 700px)").matches);
  const defaultTab: Tab = narrow ? "agenda" : "calendario";
  const v = sp.get("v");
  const tab: Tab = TABS.some(([t]) => t === v) ? (v as Tab) : defaultTab;
  const setTab = (t: Tab) =>
    setSp(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (t === defaultTab) p.delete("v");
        else p.set("v", t);
        return p;
      },
      { replace: true }
    );

  // ---- Búsqueda para añadir ----
  const q = fold(query.trim());
  const have = useMemo(() => new Set(entries.map((e) => `${e.key}|${normalizeAcronym(e.subject)}`)), [entries]);
  const hits = useMemo(() => {
    if (q.length < 2 || !index.data) return [];
    const out: Array<{ loc: PdfLocation; acr: string; name: string; key: string }> = [];
    for (const s of index.data) {
      if (!(fold(s.n).includes(q) || fold(s.a).includes(q))) continue;
      const loc = pdfs.get(s.p);
      if (!loc) continue;
      out.push({ loc, acr: s.a, name: s.n, key: pdfKey(loc) });
      if (out.length >= MAX_HITS) break;
    }
    return out;
  }, [q, index.data, pdfs]);

  function add(key: string, subject: string) {
    setEntries(mergeEntries(entries, [{ key, subject, groups: [] }]));
  }
  function remove(entry: MyEntry) {
    setEntries(entries.filter((e) => !(e.key === entry.key && e.subject === entry.subject)));
  }
  function update(r: Resolved, patch: (e: MyEntry) => MyEntry) {
    setEntries(entries.map((e) => (e.key === r.entry.key && normalizeAcronym(e.subject) === normalizeAcronym(r.entry.subject) ? patch(e) : e)));
  }
  /** Guarda grupos y semanas; "todos los grupos" sólo se abrevia si no hay semanas limitadas (necesitan el grupo explícito). */
  function store(r: Resolved, e: MyEntry, groups: string[], weeks: Record<string, number[]>): MyEntry {
    const kept = Object.fromEntries(Object.entries(weeks).filter(([g]) => groups.includes(g)));
    const hasWeeks = Object.keys(kept).length > 0;
    const { weeks: _old, ...rest } = e;
    return { ...rest, groups: groups.length === r.groups.length && !hasWeeks ? [] : sortGroups(groups), ...(hasWeeks ? { weeks: kept } : {}) };
  }
  function setGroups(r: Resolved, groups: string[]) {
    if (groups.length === 0) return remove(r.entry);
    update(r, (e) => store(r, e, groups, e.weeks ?? {}));
  }
  /** Limita un grupo a ciertas semanas; null = todas. */
  function setWeeks(r: Resolved, cur: string[], group: string, weeks: number[] | null) {
    const total = r.allWeeks[group]?.length ?? 0;
    update(r, (e) => {
      const next = { ...(e.weeks ?? {}) };
      if (!weeks || weeks.length === 0 || weeks.length >= total) delete next[group];
      else next[group] = weeks;
      return store(r, e, cur, next);
    });
  }

  const loadingSched = schedules.loading && !schedules.data;
  const calMissing = calendar.data && built.classes.length === 0 && resolved.some((r) => r.sched && r.groups.length > 0);
  const disabledReason = entries.length === 0 ? "Añade alguna asignatura." : null;

  return (
    <div>
      <nav className="crumbs" aria-label="Ruta">
        <Link to="/">Inicio</Link>
      </nav>
      <h1>Mi horario</h1>
      <p className="muted">Reúne asignaturas de distintos grados y elige sólo los grupos que te interesan (teoría, PA, PL…). Todo queda en la dirección de esta página: cópiala para compartirla o guárdala en marcadores.</p>
      <p className="notice notice--info">
        <Info size={14} aria-hidden /> La selección también se recuerda en este navegador y se recupera al abrir «Mi horario» sin parámetros.
      </p>
      {built.error && <ErrorBox>{built.error}</ErrorBox>}
      {calMissing && <ErrorBox>Faltan los festivos o fechas del cuatrimestre de algún curso: no se pueden generar las fechas de esas asignaturas.</ErrorBox>}

      <div className="schedule">
        <aside className="schedule__side panel">
          <h2>Asignaturas</h2>

          <div className="search-input" style={{ marginBottom: "0.6rem" }}>
            <Search size={16} aria-hidden className="search-input__icon" />
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar asignatura para añadir…" aria-label="Buscar asignatura para añadir" />
            {query && (
              <button type="button" className="search-input__clear" onClick={() => setQuery("")} aria-label="Vaciar búsqueda">
                <X size={16} aria-hidden />
              </button>
            )}
          </div>

          {q.length >= 2 && (
            <div className="my-hits">
              {index.loading && <Loading />}
              {index.data && hits.length === 0 && <p className="muted">Sin resultados.</p>}
              {hits.map((h) => {
                const already = have.has(`${h.key}|${normalizeAcronym(h.acr)}`);
                return (
                  <div key={`${h.key}|${h.acr}`} className="my-hit">
                    <div className="my-hit__text">
                      <strong>{h.name}</strong>
                      <small className="muted">{pdfTitle(h.loc)}</small>
                    </div>
                    <button type="button" className="secondary icon-button" disabled={already} onClick={() => add(h.key, h.acr)} aria-label={already ? "Ya añadida" : `Añadir ${h.name}`} title={already ? "Ya añadida" : "Añadir"}>
                      <Plus size={16} aria-hidden />
                    </button>
                  </div>
                );
              })}
              {hits.length === MAX_HITS && <p className="muted">Mostrando las primeras {MAX_HITS}; afina la búsqueda.</p>}
            </div>
          )}

          {entries.length === 0 && q.length < 2 && <p className="muted">Busca una asignatura y pulsa «+». Desde la página de cualquier horario también puedes enviar tu selección con «Añadir a Mi horario».</p>}
          {loadingSched && <Loading label="Cargando horarios…" />}

          {resolved.map((r) => {
            const cur = r.entry.groups.length === 0 ? r.groups : r.entry.groups;
            const unavailable = !r.loc || (!!schedules.data && (!r.sched || r.groups.length === 0));
            return (
              <div key={`${r.entry.key}|${r.entry.subject}`} className="subject subject--on">
                <div className="subject__top my-subject__head">
                  <span className="subject__name">
                    <strong title={r.entry.subject}>{r.name}</strong>
                    <small>{r.loc ? pdfTitle(r.loc) : r.entry.key}</small>
                  </span>
                  <button type="button" className="secondary icon-button" onClick={() => remove(r.entry)} aria-label={`Quitar ${r.name}`} title="Quitar">
                    <Trash2 size={15} aria-hidden />
                  </button>
                </div>
                {unavailable ? (
                  <p className="muted my-subject__warn">
                    <TriangleAlert size={13} aria-hidden /> Ya no está en el horario publicado.
                  </p>
                ) : (
                  <div className="subject__body my-subject__body">
                    {groupsByActivity(r.groups).map(([act, groups]) => {
                      const allOn = groups.every((g) => cur.includes(g));
                      return (
                        <div key={act} className="act-row">
                          <button type="button" className={`act-row__label ${allOn ? "act-row__label--on" : ""}`} onClick={() => setGroups(r, allOn ? cur.filter((g) => !groups.includes(g)) : [...new Set([...cur, ...groups])])} title={`Marcar/desmarcar todos: ${ACTIVITY_LABEL[act]}`}>
                            {act}
                          </button>
                          <div className="chip-row">
                            {groups.map((g) => (
                              <button key={g} type="button" className={`chip ${cur.includes(g) ? "chip--on" : ""}`} aria-pressed={cur.includes(g)} onClick={() => setGroups(r, cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g])}>
                                {g}
                                {isEnglishGroup(g) && <span className="chip__en">EN</span>}
                                {r.entry.weeks?.[g] && cur.includes(g) && (
                                  <span className="chip__weeks">
                                    {r.entry.weeks[g]!.length}/{r.allWeeks[g]?.length}
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    <WeeksControl r={r} cur={cur} onChange={(g, w) => setWeeks(r, cur, g, w)} />
                  </div>
                )}
              </div>
            );
          })}
        </aside>

        <section className="schedule__main" id="schedule-results">
          <div className="toolbar">
            <ExportPanel classes={built.classes} holidays={built.holidays} baseName="Mi horario" source="mi-horario" nameOf={nameOf} disabledReason={disabledReason} />
          </div>

          <div className="panel">
            <div className="tabs" role="tablist">
              {TABS.map(([t, label]) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
                  {label}
                </button>
              ))}
            </div>

            {entries.length === 0 ? (
              <p className="muted">Añade asignaturas para ver tu horario.</p>
            ) : tab === "agenda" ? (
              <AgendaView events={monthEvents} />
            ) : tab === "calendario" ? (
              <CalendarMonthView events={monthEvents} colorBy="groupType" />
            ) : tab === "semana" ? (
              <WeekView classes={built.classes} holidays={built.holidays} />
            ) : (
              <HoursSummary classes={built.classes} nameOf={nameOf} />
            )}
          </div>

          <p className="warning" role="note">
            <TriangleAlert size={15} aria-hidden />
            <span>El horario vigente es siempre el del PDF original. El profesorado puede reprogramar actividades a otras fechas, horas o aulas distintas de las del PDF.</span>
          </p>
        </section>
      </div>
    </div>
  );
}

/**
 * Caso excepcional (dar sólo parte de las clases de un grupo): oculto tras un enlace discreto. Elige un grupo y marca
 * las semanas de curso en que das clase; sin tocar nada se imparten todas.
 */
function WeeksControl({ r, cur, onChange }: { r: Resolved; cur: string[]; onChange: (group: string, weeks: number[] | null) => void }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const limited = cur.some((g) => r.entry.weeks?.[g]);
  const group = picked && cur.includes(picked) ? picked : (cur.find((g) => r.entry.weeks?.[g]) ?? cur[0] ?? null);
  const all = group ? (r.allWeeks[group] ?? []) : [];
  const chosen = group ? (r.entry.weeks?.[group] ?? all) : [];
  const half = Math.ceil(all.length / 2);

  return (
    <div className="weeks">
      <button type="button" className={`weeks__toggle ${limited ? "weeks__toggle--on" : ""}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <CalendarRange size={13} aria-hidden /> {limited ? "Semanas limitadas" : "Sólo algunas semanas…"}
      </button>
      {open && group && (
        <div className="weeks__panel">
          {cur.length > 1 && (
            <select value={group} onChange={(e) => setPicked(e.target.value)} aria-label="Grupo">
              {cur.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          )}
          <div className="chip-row">
            {all.map((w) => {
              const on = chosen.includes(w);
              const date = r.dateOfWeek(w);
              return (
                <button key={w} type="button" className={`chip ${on ? "chip--on" : ""}`} aria-pressed={on} title={date ? `Semana del ${date}` : undefined} onClick={() => onChange(group, on ? chosen.filter((x) => x !== w) : [...chosen, w])}>
                  {w}
                </button>
              );
            })}
          </div>
          <div className="weeks__shortcuts">
            <button type="button" onClick={() => onChange(group, null)}>
              Todas
            </button>
            <button type="button" onClick={() => onChange(group, all.slice(0, half))}>
              1.ª mitad
            </button>
            <button type="button" onClick={() => onChange(group, all.slice(half))}>
              2.ª mitad
            </button>
            <button type="button" onClick={() => onChange(group, all.filter((_, i) => i % 2 === 0))}>
              Alternas
            </button>
            <button type="button" onClick={() => onChange(group, all.filter((_, i) => i % 2 === 1))}>
              Alternas (2.ª)
            </button>
          </div>
          <small className="muted">Semanas del cuatrimestre (sin festivos); pasa el ratón para ver la fecha.</small>
        </div>
      )}
    </div>
  );
}
