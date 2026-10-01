import { Clock, ExternalLink, Info, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link, Navigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import { CalendarMonthView } from "../components/CalendarMonthView";
import { EnglishMark } from "../components/EnglishMark";
import { ModeToggle } from "../components/ModeToggle";
import { ExportPanel } from "../components/ExportPanel";
import { HoursSummary } from "../components/HoursSummary";
import { PracticeGroupBalance } from "../components/PracticeGroupBalance";
import { ScheduleGapsPanel } from "../components/ScheduleGapsPanel";
import { ErrorBox, Loading } from "../components/Status";
import { SubjectPicker, type SubjectMeta } from "../components/SubjectPicker";
import { WeekView } from "../components/WeekView";
import { getAcademicCalendar, getCatalog, getSchedule, getStatus, requestExcel, useAsync } from "../lib/api";
import { findByPath, indexPdfs, pdfHref, pdfTitle, shortCurso, type PdfLocation } from "../lib/catalog";
import { downloadBlob } from "../lib/download";
import { buildEvents, isCourseCalendar, type CalEvent } from "../lib/events";
import { isPracticeGroup } from "../lib/practiceBalance";
import { findScheduleGaps } from "../lib/scheduleGaps";
import { normalizeAcronym, parseSelection, reducePerActivity, serializeSelection, sortGroups, type Mode, type Selection } from "../lib/selection";

type Tab = "calendario" | "semana" | "resumen" | "huecos" | "practicas";
const TABS: Array<[Tab, string]> = [
  ["calendario", "Calendario"],
  ["semana", "Semana"],
  ["resumen", "Horas"],
  ["huecos", "Huecos libres"],
  ["practicas", "Prácticas"],
];

function isTab(v: string | null): v is Tab {
  return TABS.some(([t]) => t === v);
}

/**
 * Resuelve la URL legible /grado/:slug/:year/:curso/:sem/:grupo (o el antiguo /horario/:id) a un horario del
 * catálogo vigente. Si el curso académico de la URL ya no es el vigente, redirige a la URL actual del mismo
 * curso/semestre/grupo: los marcadores siguen enseñando siempre la versión más reciente.
 */
export function SchedulePage() {
  const { id, slug = "", year = "", curso = "", sem = "", grupo = "" } = useParams();
  const [sp] = useSearchParams();
  const catalog = useAsync(getCatalog, []);

  if (catalog.error) return <ErrorBox>{catalog.error}</ErrorBox>;
  if (!catalog.data) return <Loading label="Cargando horario…" />;

  const search = sp.toString() ? `?${sp.toString()}` : "";
  if (id) {
    const legacy = indexPdfs(catalog.data).get(id);
    return legacy ? <Navigate to={pdfHref(legacy.grado, legacy.pdf) + search} replace /> : <NotFoundSchedule />;
  }

  const loc = findByPath(catalog.data, slug, curso, sem, grupo);
  if (!loc) return <NotFoundSchedule slug={slug} />;
  if (!loc.pdf.path.startsWith(`${year}/`)) {
    return <Navigate to={pdfHref(loc.grado, loc.pdf) + search} replace state={{ fromYear: year }} />;
  }
  const shared = indexPdfs(catalog.data).get(loc.pdf.id);
  loc.alsoIn = shared ? [shared.grado, ...shared.alsoIn].filter((g) => g.slug !== loc.grado.slug) : [];
  return <ScheduleView loc={loc} />;
}

function NotFoundSchedule({ slug }: { slug?: string }) {
  return (
    <ErrorBox>
      No existe ese horario. Puede que el grupo o el curso ya no se publiquen.{" "}
      <Link to={slug ? `/grado/${slug}` : "/"}>{slug ? "Ver los horarios de este grado" : "Volver al inicio"}</Link>
    </ErrorBox>
  );
}

const DATE_TIME_FMT = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Madrid" });

function relative(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 2) return "hace un momento";
  if (mins < 60) return `hace ${mins} min`;
  const h = Math.round(mins / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

const REPROGRAM_NOTE = "El horario vigente es siempre el del PDF original, y el profesorado puede reprogramar actividades a otras fechas, horas o aulas distintas de las del PDF; en ese caso lo comunica en clase o por el campus virtual.";

/**
 * Un único aviso compacto: cuándo se actualizó el horario (última vez que se descargó una versión distinta del PDF),
 * cuándo se comprobó por última vez, y la advertencia de reprogramaciones (el detalle va en el tooltip).
 */
function FreshnessNotice({ pdf, refreshHours }: { pdf: PdfLocation["pdf"]; refreshHours: number }) {
  const checkedAgoH = pdf.checkedAt ? (Date.now() - new Date(pdf.checkedAt).getTime()) / 3_600_000 : Infinity;
  const stale = checkedAgoH > refreshHours * 2 + 1;
  return (
    <div className={`notice-bar ${stale ? "notice-bar--stale" : ""}`} role="note">
      <span className="notice-bar__item" title="Fecha de la última vez que se descargó una versión distinta del PDF de la EPI">
        <Clock size={14} aria-hidden />
        {pdf.updatedAt ? <>Actualizado el <strong>{DATE_TIME_FMT.format(new Date(pdf.updatedAt))}</strong></> : <>Fecha de actualización desconocida</>}
        {pdf.checkedAt && <span className="muted"> · comprobado {relative(pdf.checkedAt)}</span>}
      </span>
      {stale && <span className="notice-bar__item notice-bar__warn">Hace tiempo que no se comprueba: verifica el PDF original.</span>}
      <span className="notice-bar__item notice-bar__warn" title={REPROGRAM_NOTE}>
        <TriangleAlert size={14} aria-hidden />
        Puede haber reprogramaciones: manda el PDF original.
      </span>
    </div>
  );
}

function ScheduleView({ loc }: { loc: PdfLocation }) {
  const id = loc.pdf.id;
  const location = useLocation();
  const fromYear = (location.state as { fromYear?: string } | null)?.fromYear;
  const [sp, setSp] = useSearchParams();
  const sched = useAsync(() => getSchedule(id), [id]);
  // Hueco de la barra superior donde se pinta el conmutador de modo.
  const [topbarSlot, setTopbarSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setTopbarSlot(document.getElementById("topbar-actions")), []);
  const status = useAsync(getStatus, []);
  const calendar = useAsync(getAcademicCalendar, []);
  const [excelBusy, setExcelBusy] = useState<string | null>(null);
  const [excelError, setExcelError] = useState<string | null>(null);
  const [balanceSubject, setBalanceSubject] = useState<string | null>(null);

  const data = sched.data;

  useEffect(() => {
    const prev = document.title;
    document.title = `${shortCurso(loc.curso.curso)} curso · ${loc.semestre.texto}${loc.pdf.etiqueta ? ` · ${loc.pdf.etiqueta}` : ""} — ${loc.grado.nombre.replace(/^Grado en /i, "")} · EPIcal`;
    return () => {
      document.title = prev;
    };
  }, [loc]);

  // ---- Metadatos de asignaturas (rejilla + leyenda del PDF) ----
  const legend = useMemo(() => new Map((data?.subjects ?? []).map((s) => [normalizeAcronym(s.acronym), s])), [data]);
  const nameOf = useCallback((acr: string) => legend.get(normalizeAcronym(acr))?.name || acr, [legend]);

  const subjects = useMemo<SubjectMeta[]>(() => {
    if (!data) return [];
    const map = new Map<string, { groups: Set<string>; section: number }>();
    for (const r of data.rows) {
      const cur = map.get(r.subject) ?? { groups: new Set<string>(), section: r.section };
      cur.groups.add(r.group);
      map.set(r.subject, cur);
    }
    return [...map.entries()]
      .map(([acronym, v]) => {
        const l = legend.get(normalizeAcronym(acronym));
        return { acronym, name: l?.name || acronym, curso: l?.curso ?? null, section: v.section, groups: sortGroups([...v.groups]), english: l?.english ?? false };
      })
      .sort((a, b) => a.section - b.section || (a.curso ?? 9) - (b.curso ?? 9) || a.name.localeCompare(b.name, "es"));
  }, [data, legend]);

  const meta = useMemo(() => new Map(subjects.map((s) => [s.acronym, s])), [subjects]);

  // ---- Selección y modo (viven en la URL: enlaces compartibles) ----
  const mode: Mode = sp.get("m") === "alumno" ? "alumno" : "profesor";
  const selection = useMemo<Selection>(() => {
    const raw = parseSelection(sp.get("s"));
    const out: Selection = {};
    for (const [acr, groups] of Object.entries(raw)) {
      const m = meta.get(acr);
      if (!m) continue;
      const valid = groups.length === 0 ? m.groups : groups.filter((g) => m.groups.includes(g));
      if (valid.length > 0) out[acr] = sortGroups(valid);
    }
    return mode === "alumno" ? reducePerActivity(out) : out;
  }, [sp, meta, mode]);

  const setSelection = useCallback(
    (next: Selection) => {
      setSp(
        (prev) => {
          const p = new URLSearchParams(prev);
          // Si están todos los grupos, la URL guarda sólo la asignatura (más corta; "sin grupos" = todos).
          const compact: Selection = {};
          for (const [acr, groups] of Object.entries(next)) compact[acr] = groups.length === (meta.get(acr)?.groups.length ?? -1) ? [] : groups;
          if (Object.keys(compact).length === 0) p.delete("s");
          else p.set("s", serializeSelection(compact));
          return p;
        },
        { replace: true }
      );
    },
    [setSp, meta]
  );

  const changeMode = useCallback(
    (next: Mode) => {
      setSp(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === "alumno") p.set("m", "alumno");
          else p.delete("m");
          // Al pasar a alumno se deja un único grupo por tipo y se escribe ya en la URL, para que todo sea coherente.
          if (next === "alumno") {
            const reduced = reducePerActivity(selection);
            if (Object.keys(reduced).length === 0) p.delete("s");
            else p.set("s", serializeSelection(reduced));
          }
          return p;
        },
        { replace: true }
      );
    },
    [setSp, selection]
  );

  const tab: Tab = isTab(sp.get("v")) ? (sp.get("v") as Tab) : "calendario";
  const setTab = (t: Tab) =>
    setSp(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (t === "calendario") p.delete("v");
        else p.set("v", t);
        return p;
      },
      { replace: true }
    );

  // ---- Eventos con fecha real ----
  const academicYear = loc?.grado.academicYear ?? null;
  const courseCal = academicYear && calendar.data ? calendar.data[academicYear] : undefined;
  const calOk = isCourseCalendar(courseCal) && !!(data && (data.cuatrimestre === 1 ? courseCal.q1 : courseCal.q2));

  const selectedRows = useMemo(() => (data ? data.rows.filter((r) => selection[r.subject]?.includes(r.group)) : []), [data, selection]);

  const built = useMemo(() => {
    if (!data || !calOk) return { classes: [] as CalEvent[], holidays: [] as CalEvent[], error: null as string | null };
    try {
      return { ...buildEvents(selectedRows, data.cuatrimestre, courseCal as Exclude<typeof courseCal, string | undefined>, { nameOf }), error: null };
    } catch (e) {
      return { classes: [], holidays: [], error: (e as Error).message };
    }
  }, [data, calOk, courseCal, selectedRows, nameOf]);

  const monthEvents = useMemo(() => [...built.classes, ...built.holidays].sort((a, b) => a.start.getTime() - b.start.getTime()), [built]);

  const gaps = useMemo(() => {
    if (tab !== "huecos" || !data || !calOk) return null;
    const all = buildEvents(data.rows, data.cuatrimestre, courseCal as Exclude<typeof courseCal, string | undefined>, { nameOf });
    return findScheduleGaps(all.classes, all.holidays);
  }, [tab, data, calOk, courseCal, nameOf]);

  const practiceSubjects = useMemo(() => subjects.filter((s) => s.groups.filter(isPracticeGroup).length >= 2), [subjects]);
  const activeBalance = balanceSubject && practiceSubjects.some((s) => s.acronym === balanceSubject) ? balanceSubject : (practiceSubjects.find((s) => selection[s.acronym])?.acronym ?? practiceSubjects[0]?.acronym ?? null);
  const balanceByGroup = useMemo(() => {
    if (tab !== "practicas" || !data || !calOk || !activeBalance) return null;
    const rows = data.rows.filter((r) => r.subject === activeBalance && isPracticeGroup(r.group));
    const ev = buildEvents(rows, data.cuatrimestre, courseCal as Exclude<typeof courseCal, string | undefined>, { nameOf });
    const map: Record<string, CalEvent[]> = {};
    for (const e of ev.classes) (map[e.group] ??= []).push(e);
    return map;
  }, [tab, data, calOk, courseCal, activeBalance, nameOf]);

  async function handleExcel(acronym: string) {
    if (!academicYear) return;
    setExcelBusy(acronym);
    setExcelError(null);
    try {
      const { blob, filename } = await requestExcel({ id, subject: acronym, groups: selection[acronym] ?? [], academicYear });
      downloadBlob(blob, filename);
    } catch (e) {
      setExcelError((e as Error).message);
    } finally {
      setExcelBusy(null);
    }
  }

  // ---- Render ----
  if (sched.error) {
    return (
      <ErrorBox>
        No se pudo cargar este horario ({sched.error}). <Link to="/">Volver al inicio</Link>
      </ErrorBox>
    );
  }
  if (!data) return <Loading label="Cargando horario…" />;

  const selectedAcrs = Object.keys(selection);
  const baseName = selectedAcrs.length === 1 ? nameOf(selectedAcrs[0]!) : loc ? `Horario ${loc.grado.nombre.replace(/^Grado en /i, "")} ${shortCurso(loc.curso.curso)} ${loc.semestre.texto.split(" ").slice(0, 2).join(" ")}` : "Horario EPI";
  const disabledReason = !calOk ? (academicYear ? `Faltan los festivos y fechas del curso ${academicYear}: aún no se pueden generar fechas.` : "No se pudo determinar el curso académico.") : selectedAcrs.length === 0 ? "Marca alguna asignatura." : null;

  return (
    <div>
      {topbarSlot && createPortal(<ModeToggle mode={mode} onChange={changeMode} />, topbarSlot)}
      <nav className="crumbs" aria-label="Ruta">
        <Link to="/">Inicio</Link>
        {loc && (
          <>
            {" / "}
            <Link to={`/grado/${loc.grado.slug}`}>{loc.grado.nombre}</Link>
          </>
        )}
      </nav>
      <h1>
        {loc ? (
          <>
            {shortCurso(loc.curso.curso)} curso · {loc.semestre.texto}
            {loc.pdf.etiqueta ? ` · Grupo ${loc.pdf.etiqueta}` : ""} {loc.pdf.ingles && <EnglishMark />}
          </>
        ) : (
          "Horario"
        )}
      </h1>
      <p className="muted">
        {loc ? pdfTitle(loc) : null}
        {loc && (
          <>
            {" · "}
            <a href={loc.pdf.url} target="_blank" rel="noreferrer">
              PDF original <ExternalLink size={12} aria-hidden />
            </a>
          </>
        )}
        {loc && loc.alsoIn.length > 0 && <> · Compartido con: {loc.alsoIn.map((g) => g.nombre).join(", ")}</>}
      </p>

      {fromYear && (
        <p className="notice notice--info">
          <Info size={14} aria-hidden /> Tu enlace era del curso {fromYear.slice(0, 2)}-{fromYear.slice(2)}; se muestra el horario vigente ({loc.grado.cursoAcademico}) del mismo curso, semestre y grupo.
        </p>
      )}
      <FreshnessNotice pdf={loc.pdf} refreshHours={status.data?.refreshHours ?? 24} />

      {!calOk && calendar.data && (
        <ErrorBox>
          {academicYear ? <>No hay festivos ni fechas de cuatrimestre configurados para el curso {academicYear}, así que de momento solo se puede consultar el listado de asignaturas y grupos.</> : <>No se pudo determinar el curso académico de este horario.</>}
        </ErrorBox>
      )}
      {built.error && <ErrorBox>{built.error}</ErrorBox>}

      <div className="schedule">
        <aside className="schedule__side panel">
          <h2>Asignaturas</h2>
          <p className="muted picker__intro">Marca las que cursas y elige tus grupos. Cuatrimestre {data.cuatrimestre}.</p>
          <SubjectPicker subjects={subjects} sections={data.sections} selection={selection} mode={mode} onChange={setSelection} onExcel={handleExcel} excelBusy={excelBusy} />
          {excelError && <ErrorBox>{excelError}</ErrorBox>}
        </aside>

        <section className="schedule__main">
          <div className="toolbar">
            <ExportPanel classes={built.classes} holidays={built.holidays} baseName={baseName} source={id} nameOf={nameOf} disabledReason={disabledReason} />
          </div>

          <div className="panel">
            <div className="tabs" role="tablist">
              {TABS.map(([t, label]) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
                  {label}
                </button>
              ))}
            </div>

            {!calOk ? null : tab === "calendario" ? (
              selectedAcrs.length === 0 ? (
                <p className="muted">Marca alguna asignatura de la izquierda para ver su calendario.</p>
              ) : (
                <CalendarMonthView events={monthEvents} colorBy="groupType" />
              )
            ) : tab === "semana" ? (
              selectedAcrs.length === 0 ? <p className="muted">Marca alguna asignatura para ver su semana.</p> : <WeekView classes={built.classes} holidays={built.holidays} />
            ) : tab === "resumen" ? (
              <HoursSummary classes={built.classes} nameOf={nameOf} />
            ) : tab === "huecos" ? (
              <div>
                <p className="muted">
                  Franjas en las que NINGUNA asignatura ni grupo de este horario tiene clase (todos los alumnos de este curso y grupo de teoría pueden asistir), útiles por ejemplo para fijar una tutoría o mover una clase sin choques. No depende de lo que hayas marcado.
                </p>
                {gaps ? <ScheduleGapsPanel result={gaps} /> : <p className="muted">Sin datos suficientes.</p>}
              </div>
            ) : (
              <div>
                {practiceSubjects.length === 0 ? (
                  <p className="muted">Ninguna asignatura de este horario tiene dos o más grupos de prácticas de laboratorio que comparar.</p>
                ) : (
                  <>
                    <label htmlFor="balance-subject">Asignatura</label>
                    <select id="balance-subject" value={activeBalance ?? ""} onChange={(e) => setBalanceSubject(e.target.value)}>
                      {practiceSubjects.map((s) => (
                        <option key={s.acronym} value={s.acronym}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <div style={{ marginTop: "0.75rem" }}>{balanceByGroup ? <PracticeGroupBalance eventsByGroup={balanceByGroup} /> : null}</div>
                  </>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
