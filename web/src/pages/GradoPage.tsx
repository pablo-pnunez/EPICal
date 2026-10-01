import { ExternalLink, FileText } from "lucide-react";
import { Fragment, useEffect, type CSSProperties } from "react";
import { Link, useParams } from "react-router-dom";
import { EnglishMark } from "../components/EnglishMark";
import { ErrorBox, Loading } from "../components/Status";
import { getCatalog, useAsync } from "../lib/api";
import { pdfHref, shortCurso } from "../lib/catalog";
import type { CatalogPdf, CatalogSemestre } from "../types";

interface Column {
  key: string;
  label: string;
}

/** "Semestre 1 (Mañanas*)" -> columna «Semestre 1» y turno «Mañanas*». Los textos que no encajan forman su propia columna. */
function parseSemestre(texto: string): { key: string; label: string; turno: string | null } {
  const m = /semestre\s*(\d+)/i.exec(texto);
  const turno = /\(([^)]*)\)/.exec(texto)?.[1]?.trim() || null;
  return m ? { key: m[1]!, label: `Semestre ${m[1]}`, turno } : { key: texto, label: texto, turno: null };
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

  // Columnas = semestres que existen en cualquier curso (normalmente 1 y 2), en orden numérico.
  const columns: Column[] = [];
  for (const c of grado.cursos) {
    for (const s of c.semestres) {
      const { key, label } = parseSemestre(s.texto);
      if (!columns.some((col) => col.key === key)) columns.push({ key, label });
    }
  }
  columns.sort((a, b) => Number(a.key) - Number(b.key) || a.label.localeCompare(b.label, "es"));

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
        <section className="matrix" style={{ "--cols": columns.length } as CSSProperties} aria-label="Horarios por curso y semestre">
          <div className="matrix__corner" aria-hidden />
          {columns.map((col) => (
            <div key={col.key} className="matrix__colhead">
              {col.label}
            </div>
          ))}

          {grado.cursos.map((curso) => (
            <Fragment key={curso.curso}>
              <div className="matrix__rowhead">
                <span className="matrix__num">{shortCurso(curso.curso)}</span>
                <span className="matrix__name">{curso.curso}</span>
              </div>
              {columns.map((col) => {
                const sems = curso.semestres.filter((s) => parseSemestre(s.texto).key === col.key);
                return (
                  <div key={col.key} className="matrix__cell">
                    <span className="matrix__caption">{col.label}</span>
                    {sems.length === 0 ? <span className="muted">—</span> : sems.map((s) => <SemestreCell key={s.texto} grado={grado} semestre={s} />)}
                  </div>
                );
              })}
            </Fragment>
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

function SemestreCell({ grado, semestre }: { grado: Parameters<typeof pdfHref>[0]; semestre: CatalogSemestre }) {
  const turno = parseSemestre(semestre.texto).turno;
  return (
    <div className="matrix__group">
      {turno && <span className="matrix__turno">{turno}</span>}
      <div className="tile-row">
        {semestre.grupos.map((p, i) => (
          <GroupTile key={`${p.id}-${i}`} grado={grado} pdf={p} />
        ))}
      </div>
    </div>
  );
}

function GroupTile({ grado, pdf }: { grado: Parameters<typeof pdfHref>[0]; pdf: CatalogPdf }) {
  const label = pdf.etiqueta ? `Grupo ${pdf.etiqueta}` : "Ver horario";
  const body = (
    <>
      {label} {pdf.ingles && <EnglishMark />}
    </>
  );
  return pdf.status === "ok" ? (
    <Link to={pdfHref(grado, pdf)} className="tile">
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
