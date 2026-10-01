import { ExternalLink, FileText } from "lucide-react";
import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { EnglishMark } from "../components/EnglishMark";
import { ErrorBox, Loading } from "../components/Status";
import { getCatalog, useAsync } from "../lib/api";
import { pdfHref, shortCurso } from "../lib/catalog";
import type { CatalogPdf, CatalogSemestre } from "../types";

/** "Semestre 1 (Mañanas*)" -> etiqueta «Semestre 1» y turno «Mañanas*». Los textos que no encajan se muestran tal cual. */
function parseSemestre(texto: string): { label: string; turno: string | null } {
  const m = /semestre\s*(\d+)/i.exec(texto);
  const turno = /\(([^)]*)\)/.exec(texto)?.[1]?.trim() || null;
  return m ? { label: `Semestre ${m[1]}`, turno } : { label: texto, turno: null };
}

export function GradoPage() {
  const { slug } = useParams();
  const catalog = useAsync(getCatalog, []);
  const grado = catalog.data?.grados.find((g) => g.slug === slug);

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

          {grado.examenes.length > 0 && (
            <div className="panel">
              <h2>Calendarios de exámenes</h2>
              <p className="muted aside-text">PDF oficiales, tal cual los publica la escuela.</p>
              <ul className="doc-list">
                {grado.examenes.map((e) => (
                  <li key={e.url}>
                    <a href={e.url} target="_blank" rel="noreferrer">
                      <FileText size={15} aria-hidden />
                      <span>{e.descripcion}</span>
                      <ExternalLink size={12} aria-hidden />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
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
