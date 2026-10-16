import { CalendarPlus, ExternalLink, FileText } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { AgendaView } from "../components/AgendaView";
import { CalendarMonthView } from "../components/CalendarMonthView";
import { EnglishMark } from "../components/EnglishMark";
import { ErrorBox, Loading } from "../components/Status";
import { getCatalog, getExamData, useAsync } from "../lib/api";
import { fold, pdfHref, shortCurso } from "../lib/catalog";
import { downloadBlob, safeFilename } from "../lib/download";
import { examEntryToEvent } from "../lib/events";
import { toIcs } from "../lib/ics";
import type { CatalogExamPdf, CatalogGrado, CatalogPdf, CatalogSemestre, ExamData, ExamEntry } from "../types";

const CURSO_ORDINAL = ["", "1º", "2º", "3º", "4º", "5º", "6º"];

const TIPO_LABEL: Record<string, string> = {
  teoria: "Teoría",
  practicas: "Prácticas",
  teoria_practicas: "Teoría y prácticas",
  problemas: "Problemas",
};

/** dd/mm/aaaa -> aaaa-mm-dd, para ordenar y para comparar fechas como texto. */
function dateKey(ddmmaaaa: string): string {
  const [d, m, y] = ddmmaaaa.split("/");
  return `${y}-${m}-${d}`;
}

function useExamsData(grado: CatalogGrado | undefined) {
  const ok = (grado?.examenesParsed ?? []).filter((e) => e.status === "ok");
  const key = ok.map((e) => e.id).join(",");
  return useAsync(async () => {
    // Un solo PDF inalcanzable (404, aún no regenerado tras una actualización...) no debe dejar
    // la pestaña entera colgada "Cargando…": se ignora ese PDF y se muestran los demás.
    const all = await Promise.all(ok.map(async (e) => ({ pdf: e, data: await getExamData(e.id).catch(() => null) })));
    return all.filter((x): x is { pdf: CatalogExamPdf; data: ExamData } => x.data !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/** "Semestre 1 (Mañanas*)" -> etiqueta «Semestre 1» y turno «Mañanas*». Los textos que no encajan se muestran tal cual. */
function parseSemestre(texto: string): { label: string; turno: string | null } {
  const m = /semestre\s*(\d+)/i.exec(texto);
  const turno = /\(([^)]*)\)/.exec(texto)?.[1]?.trim() || null;
  return m ? { label: `Semestre ${m[1]}`, turno } : { label: texto, turno: null };
}

type GradoTab = "horarios" | "examenes";
const GRADO_TABS: Array<[GradoTab, string]> = [
  ["horarios", "Horarios"],
  ["examenes", "Calendario de exámenes"],
];

export function GradoPage() {
  const { slug } = useParams();
  const [sp, setSp] = useSearchParams();
  const catalog = useAsync(getCatalog, []);
  const grado = catalog.data?.grados.find((g) => g.slug === slug);
  const exams = useExamsData(grado);

  useEffect(() => {
    if (!grado) return;
    const prev = document.title;
    document.title = `${grado.nombre} — Horarios · EPIcal`;
    return () => {
      document.title = prev;
    };
  }, [grado]);

  if (catalog.error) return <ErrorBox>{catalog.error}</ErrorBox>;
  if (!catalog.data) return <Loading />;
  if (!grado) {
    return (
      <ErrorBox>
        No existe ese grado. <Link to="/">Volver al inicio</Link>
      </ErrorBox>
    );
  }

  const total = grado.cursos.reduce((n, c) => n + c.semestres.reduce((m, s) => m + s.grupos.length, 0), 0);
  const tabParam = sp.get("tab");
  const tab: GradoTab = tabParam === "examenes" ? "examenes" : "horarios";
  const setTab = (t: GradoTab) =>
    setSp(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (t === "horarios") p.delete("tab");
        else p.set("tab", t);
        return p;
      },
      { replace: true }
    );

  return (
    <div>
      <nav className="crumbs" aria-label="Ruta">
        <Link to="/">Inicio</Link> / <span>{grado.rama}</span>
      </nav>
      <div className="grado-head">
        <h1>{grado.nombre}</h1>
        <div className="grado-head__meta">
          <span className="badge badge--accent">Curso {grado.cursoAcademico}</span>
          <span className="badge">{total} horarios</span>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {GRADO_TABS.map(([t, label]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "horarios" ? (
        <div className="grado-layout">
          <section className="curso-grid" aria-label="Horarios por curso y semestre">
            {grado.cursos.map((curso) => (
              <article key={curso.curso} className="curso-card">
                <header className="curso-card__head">
                  <span className="curso-card__num">{shortCurso(curso.curso)}</span>
                  <h2 className="curso-card__name">{curso.curso}</h2>
                </header>
                <CursoMatriz grado={grado} semestres={curso.semestres} />
              </article>
            ))}
          </section>

          <aside className="grado-aside">
            <div className="panel">
              <h2>En la web de la EPI</h2>
              <p className="muted aside-text">Ficha del grado, plan de estudios y más información.</p>
              <a href={grado.url} target="_blank" rel="noreferrer" className="aside-link">
                Abrir la ficha del grado <ExternalLink size={13} aria-hidden />
              </a>
            </div>
          </aside>
        </div>
      ) : (
        <ExamenesTab grado={grado} exams={exams.data} />
      )}
    </div>
  );
}

/** Enlaces a los PDF de examen que no se procesan (convocatoria extraordinaria adelantada, o fallos de extracción). */
function ExamenesDocList({ docs }: { docs: { url: string; descripcion: string }[] }) {
  if (docs.length === 0) return null;
  return (
    <ul className="doc-list">
      {docs.map((e) => (
        <li key={e.url}>
          <a href={e.url} target="_blank" rel="noreferrer">
            <FileText size={15} aria-hidden />
            <span>{e.descripcion}</span>
            <ExternalLink size={12} aria-hidden />
          </a>
        </li>
      ))}
    </ul>
  );
}

const EXAM_DOC_RE = /^calendario de ex[aá]menes/i;
type ExamView = "calendario" | "agenda" | "lista";
const EXAM_VIEWS: Array<[ExamView, string]> = [
  ["calendario", "Calendario"],
  ["agenda", "Agenda"],
  ["lista", "Lista"],
];

/** Lee/escribe los filtros del calendario de exámenes en la URL (`ac`, `curso`, `asig`, `v`): se pueden compartir o recargar sin perderlos. Cada uno se omite cuando vale lo mismo que por defecto, para no ensuciar la URL. */
function useExamFilters(defaultYear: string | null) {
  const [sp, setSp] = useSearchParams();

  const set = (key: string, value: string) =>
    setSp(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (!value) p.delete(key);
        else p.set(key, value);
        return p;
      },
      { replace: true }
    );

  const viewParam = sp.get("v");

  return {
    year: sp.get("ac") || defaultYear,
    setYear: (v: string) => set("ac", v === defaultYear ? "" : v),
    curso: sp.get("curso") ? Number(sp.get("curso")) : null,
    setCurso: (v: number | null) => set("curso", v ? String(v) : ""),
    subjectQuery: sp.get("asig") ?? "",
    setSubjectQuery: (v: string) => set("asig", v),
    view: (EXAM_VIEWS.some(([v]) => v === viewParam) ? viewParam : "calendario") as ExamView,
    setView: (v: ExamView) => set("v", v === "calendario" ? "" : v),
  };
}

function ExamenesTab({ grado, exams }: { grado: CatalogGrado; exams: { pdf: CatalogExamPdf; data: { exams: ExamEntry[] } }[] | null }) {
  const byYear = useMemo(
    () => (exams ?? []).slice().sort((a, b) => (b.pdf.academicYear ?? "").localeCompare(a.pdf.academicYear ?? "")),
    [exams]
  );
  // Por defecto, el curso académico más reciente (el primero de `byYear`, ya ordenado de más a menos reciente).
  const defaultYear = byYear[0]?.pdf.academicYear ?? null;
  const filters = useExamFilters(defaultYear);
  const selectedYear = filters.year && byYear.some((y) => y.pdf.academicYear === filters.year) ? filters.year : defaultYear;
  const current = byYear.find((y) => y.pdf.academicYear === selectedYear) ?? null;
  const allExams = current?.data.exams ?? [];
  // El PDF oficial del curso elegido, por si se quiere comprobar una fecha contra el original.
  const currentUrl = current ? grado.examenes.find((d) => d.descripcion === current.pdf.descripcion)?.url : undefined;

  const cursos = useMemo(() => [...new Set(allExams.map((e) => e.curso))].sort((a, b) => a - b), [allExams]);
  const curso = filters.curso !== null && cursos.includes(filters.curso) ? filters.curso : null;
  // La lista de asignaturas (para el combo) depende del curso elegido: no tiene sentido ofrecer una
  // asignatura de otro curso que luego no va a aparecer en ningún sitio.
  const subjects = useMemo(
    () => [...new Set(allExams.filter((e) => curso === null || e.curso === curso).map((e) => e.subjectRaw))].sort((a, b) => a.localeCompare(b, "es")),
    [allExams, curso]
  );
  const q = fold(filters.subjectQuery.trim());
  // Si el texto coincide EXACTO con una asignatura real (se escribió entera o se eligió del
  // desplegable), se filtra por esa asignatura y sólo esa: una búsqueda parcial por "contiene"
  // mezclaría "Aprend. Automático I" con "Aprend. Automático II" (el nombre completo del primero
  // es un prefijo literal del segundo).
  const exactSubject = q ? subjects.find((s) => fold(s) === q) : undefined;
  const filtered = useMemo(
    () =>
      allExams
        .filter((e) => curso === null || e.curso === curso)
        .filter((e) => !q || (exactSubject ? e.subjectRaw === exactSubject : fold(e.subjectRaw).includes(q)))
        .sort((a, b) => dateKey(a.date).localeCompare(dateKey(b.date)) || a.hourStart.localeCompare(b.hourStart)),
    [allExams, curso, q, exactSubject]
  );
  const calEvents = useMemo(() => filtered.map((e) => examEntryToEvent(e, `${CURSO_ORDINAL[e.curso] ?? e.curso} · ${e.subjectRaw}`)), [filtered]);
  const porConvocatoria = useMemo(() => groupByConvocatoria(filtered), [filtered]);

  // Nombre del calendario para el .ics: el grado y el curso académico, más el filtro activo si lo hay.
  const icsName = [
    `Exámenes ${grado.nombre.replace(/^Grado en /i, "")}`,
    selectedYear,
    curso ? CURSO_ORDINAL[curso] : null,
    exactSubject ?? (q ? filters.subjectQuery.trim() : null),
  ]
    .filter(Boolean)
    .join(" · ");
  function downloadIcs() {
    const ics = toIcs(calEvents, { name: icsName, source: `examenes-${grado.slug}-${selectedYear ?? ""}` });
    downloadBlob(new Blob([ics], { type: "text/calendar;charset=utf-8" }), `${safeFilename(icsName)}.ics`);
  }

  // `grado.examenesParsed` puede faltar un rato justo tras desplegar una versión nueva, si el
  // servidor aún no ha vuelto a generar el catálogo con este campo (hasta la próxima actualización
  // programada): se trata como "todavía sin nada" en vez de romper la página.
  const examenesParsed = grado.examenesParsed ?? [];
  const parsedDescs = new Set(examenesParsed.map((e) => e.descripcion));
  // Documentos que ni siquiera se intentan procesar (p.ej. la convocatoria extraordinaria adelantada): se enlazan tal cual.
  const sinProcesar = grado.examenes.filter((e) => !EXAM_DOC_RE.test(e.descripcion) || !parsedDescs.has(e.descripcion));
  const conError = examenesParsed.filter((e) => e.status === "error");
  const docsConError = conError.map((e) => grado.examenes.find((d) => d.descripcion === e.descripcion)).filter((d): d is NonNullable<typeof d> => !!d);

  if (exams === null) return <p className="muted">Cargando fechas…</p>;
  if (byYear.length === 0) {
    return (
      <div className="panel">
        <p className="muted aside-text">No se han podido extraer fechas de examen de este grado. PDF oficiales, tal cual los publica la escuela.</p>
        <ExamenesDocList docs={[...docsConError, ...sinProcesar]} />
      </div>
    );
  }

  return (
    <div className="schedule">
      <aside className="schedule__side">
        <div className="panel">
          <h2>Filtrar</h2>
          {byYear.length > 1 && (
            <div>
              <label htmlFor="exam-year">Curso académico</label>
              <select id="exam-year" value={selectedYear ?? ""} onChange={(e) => filters.setYear(e.target.value)}>
                {byYear.map(({ pdf }) => (
                  <option key={pdf.id} value={pdf.academicYear ?? ""}>
                    {pdf.academicYear ?? pdf.descripcion}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div style={{ marginTop: "0.6rem" }}>
            <label htmlFor="exam-curso">Curso</label>
            <select id="exam-curso" value={curso ?? ""} onChange={(e) => filters.setCurso(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Todos</option>
              {cursos.map((c) => (
                <option key={c} value={c}>
                  {CURSO_ORDINAL[c] ?? c}
                </option>
              ))}
            </select>
          </div>
          <div style={{ marginTop: "0.6rem" }}>
            <label htmlFor="exam-subject">Asignatura</label>
            {/* input + datalist: combo con las asignaturas del curso elegido, pero escribiendo se puede buscar por texto parcial (no hace falta que coincida exacto con ninguna de la lista). */}
            <input id="exam-subject" list="exam-subject-options" type="text" value={filters.subjectQuery} onChange={(e) => filters.setSubjectQuery(e.target.value)} placeholder="Todas las asignaturas" autoComplete="off" />
            <datalist id="exam-subject-options">
              {subjects.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
        </div>

        <div className="panel">
          <h2>PDF oficiales</h2>
          <p className="muted aside-text">Tal cual los publica la escuela, por si se quiere comprobar una fecha contra el original.</p>
          {conError.length > 0 && <p className="muted aside-text">No se pudieron extraer fechas de: {conError.map((e) => e.descripcion).join(", ")}.</p>}
          <ExamenesDocList docs={[...(currentUrl ? [{ url: currentUrl, descripcion: current?.pdf.academicYear ?? current?.pdf.descripcion ?? "" }] : []), ...docsConError, ...sinProcesar]} />
        </div>
      </aside>

      <section className="schedule__main">
        <div className="toolbar">
          <div className="export-bar">
            <button type="button" onClick={downloadIcs} disabled={filtered.length === 0} title={filtered.length === 0 ? "No hay exámenes que descargar con este filtro" : undefined}>
              <CalendarPlus size={16} aria-hidden /> Descargar .ics
            </button>
            <span className="muted export-bar__count">
              {filtered.length} examen{filtered.length === 1 ? "" : "es"}
            </span>
          </div>
        </div>

        <div className="panel">
          <div className="tabs" role="tablist">
            {EXAM_VIEWS.map(([v, label]) => (
              <button key={v} type="button" role="tab" aria-selected={filters.view === v} className={filters.view === v ? "active" : ""} onClick={() => filters.setView(v)}>
                {label}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <p className="muted">Ningún examen coincide con el filtro.</p>
          ) : filters.view === "calendario" ? (
            <CalendarMonthView events={calEvents} />
          ) : filters.view === "agenda" ? (
            <AgendaView events={calEvents} />
          ) : (
            <ExamFlatList porConvocatoria={porConvocatoria} />
          )}
        </div>
      </section>
    </div>
  );
}

/** "mayo 2026" -> "Mayo 2026" (solo la primera letra, el resto tal cual lo trae el PDF). */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Agrupa por convocatoria (tal como la nombra el propio PDF, p.ej. "diciembre-enero 2025/26",
 * "mayo 2026"), en orden cronológico, y dentro de cada una por fecha: así se ve de un vistazo qué
 * exámenes caen en cada convocatoria, que es como el alumnado piensa el calendario (ver la
 * cabecera "Convocatorias" de la EPI), no solo por orden de fecha suelto.
 */
function groupByConvocatoria(entries: ExamEntry[]): [string, [string, ExamEntry[]][]][] {
  const byConv = new Map<string, ExamEntry[]>();
  for (const e of entries) {
    const key = e.convocatoria ?? "Sin convocatoria";
    const list = byConv.get(key) ?? [];
    list.push(e);
    byConv.set(key, list);
  }
  const groups = [...byConv.entries()].map(([conv, items]) => {
    const sorted = items.slice().sort((a, b) => dateKey(a.date).localeCompare(dateKey(b.date)) || a.hourStart.localeCompare(b.hourStart));
    const porFecha = new Map<string, ExamEntry[]>();
    for (const e of sorted) {
      const list = porFecha.get(e.date) ?? [];
      list.push(e);
      porFecha.set(e.date, list);
    }
    return { conv, minDate: dateKey(sorted[0]!.date), porFecha: [...porFecha.entries()] as [string, ExamEntry[]][] };
  });
  groups.sort((a, b) => a.minDate.localeCompare(b.minDate));
  return groups.map((g): [string, [string, ExamEntry[]][]] => [g.conv, g.porFecha]);
}

/** Todos los exámenes filtrados, agrupados por convocatoria y luego por fecha, sin paginar por mes: para repasar el curso entero de un vistazo. */
function ExamFlatList({ porConvocatoria }: { porConvocatoria: [string, [string, ExamEntry[]][]][] }) {
  return (
    <div className="exam-convocatorias">
      {porConvocatoria.map(([conv, porFecha]) => (
        <section key={conv} className="exam-convocatoria">
          <h3 className="exam-convocatoria__title">{capitalize(conv)}</h3>
          <ul className="exam-list">
            {porFecha.map(([date, items]) => (
              <li key={date} className="exam-day">
                <span className="exam-day__date">{date}</span>
                <ul>
                  {items.map((e, i) => (
                    <li key={i} className="exam-entry">
                      <span className="badge badge--accent">{CURSO_ORDINAL[e.curso] ?? e.curso}</span>
                      <span className="exam-entry__subject">{e.subjectRaw}</span>
                      {e.tipo && TIPO_LABEL[e.tipo] && <span className="badge">{TIPO_LABEL[e.tipo]}</span>}
                      <span className="muted">{e.hourStart}h</span>
                      {e.location && <span className="muted">{e.location}</span>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

type GradoRef = Parameters<typeof pdfHref>[0];

/** Matriz turno (filas) x semestre (columnas): todas las tarjetas comparten la misma estructura aunque el curso tenga turnos distintos por semestre. */
function CursoMatriz({ grado, semestres }: { grado: GradoRef; semestres: CatalogSemestre[] }) {
  const parsed = semestres.map((s) => ({ ...parseSemestre(s.texto), grupos: s.grupos }));
  const columnas = [...new Set(parsed.map((p) => p.label))];
  const turnos = [...new Set(parsed.map((p) => p.turno ?? ""))];
  const hayTurnos = turnos.some((t) => t !== "");
  const style = { gridTemplateColumns: `${hayTurnos ? "auto " : ""}repeat(${columnas.length}, minmax(0, 1fr))` };

  return (
    <div className="matriz" style={style}>
      {hayTurnos && <span />}
      {columnas.map((c) => (
        <span key={c} className="matriz__col">
          {c}
        </span>
      ))}
      {turnos.map((turno, i) => (
        <MatrizFila key={turno} grado={grado} turno={turno} hayTurnos={hayTurnos} primera={i === 0} columnas={columnas} parsed={parsed} />
      ))}
    </div>
  );
}

function MatrizFila({
  grado,
  turno,
  hayTurnos,
  primera,
  columnas,
  parsed,
}: {
  grado: GradoRef;
  turno: string;
  hayTurnos: boolean;
  primera: boolean;
  columnas: string[];
  parsed: { label: string; turno: string | null; grupos: CatalogPdf[] }[];
}) {
  const sep = primera ? "" : " matriz__sep";
  return (
    <>
      {hayTurnos && <span className={`matriz__turno${sep}`}>{turno}</span>}
      {columnas.map((c) => {
        const grupos = parsed.filter((p) => p.label === c && (p.turno ?? "") === turno).flatMap((p) => p.grupos);
        return (
          <div key={c} className={`tile-row${sep}`}>
            {grupos.length === 0 ? (
              <span className="matriz__vacio" aria-label="Sin horario">
                —
              </span>
            ) : (
              grupos.map((p, i) => <GroupTile key={`${p.id}-${i}`} grado={grado} pdf={p} />)
            )}
          </div>
        );
      })}
    </>
  );
}

function GroupTile({ grado, pdf }: { grado: GradoRef; pdf: CatalogPdf }) {
  const label = pdf.etiqueta ?? "Ver horario";
  const body = (
    <>
      {label} {pdf.ingles && <EnglishMark />}
    </>
  );
  return pdf.status === "ok" ? (
    <Link to={pdfHref(grado, pdf)} className="tile" title={pdf.etiqueta ? `Grupo ${pdf.etiqueta}` : undefined}>
      {body}
    </Link>
  ) : (
    <a
      href={pdf.url}
      target="_blank"
      rel="noreferrer"
      className="tile tile--disabled"
      title={pdf.status === "error" ? `No se pudo procesar este PDF (${pdf.error ?? "error"}). Se abre el original.` : "Todavía no procesado; se abre el PDF original."}
    >
      {body} <ExternalLink size={12} aria-hidden />
    </a>
  );
}
