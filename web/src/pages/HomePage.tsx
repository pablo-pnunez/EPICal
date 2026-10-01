import { ArrowRight, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EnglishMark } from "../components/EnglishMark";
import { ErrorBox, Loading } from "../components/Status";
import { getCatalog, getSubjectIndex, useAsync } from "../lib/api";
import { fold, indexPdfs, pdfHref, pdfTitle } from "../lib/catalog";
import type { CatalogGrado } from "../types";

const MAX_SUBJECT_HITS = 40;

function countHorarios(g: CatalogGrado): number {
  return g.cursos.reduce((n, c) => n + c.semestres.reduce((m, s) => m + s.grupos.length, 0), 0);
}

/** «Grado en Ingeniería Mecánica» -> «Ingeniería Mecánica»; el tipo (grado / doble grado) ya lo dice la etiqueta de la tarjeta. */
function shortName(g: CatalogGrado): string {
  return g.nombre.replace(/^(Doble )?Grado en /i, "");
}

export function HomePage() {
  const catalog = useAsync(getCatalog, []);
  const index = useAsync(getSubjectIndex, []);
  const [query, setQuery] = useState("");
  const [rama, setRama] = useState<string | null>(null);

  const pdfs = useMemo(() => (catalog.data ? indexPdfs(catalog.data) : null), [catalog.data]);
  const q = fold(query.trim());

  const ramas = useMemo(() => [...new Set((catalog.data?.grados ?? []).map((g) => g.rama))], [catalog.data]);
  const totals = useMemo(() => {
    const grados = catalog.data?.grados ?? [];
    return { grados: grados.length, horarios: new Set([...(pdfs?.keys() ?? [])]).size, year: grados[0]?.cursoAcademico ?? "" };
  }, [catalog.data, pdfs]);

  const shown = useMemo(() => (catalog.data?.grados ?? []).filter((g) => !rama || g.rama === rama), [catalog.data, rama]);
  const gradoHits = useMemo(() => (q.length >= 2 ? (catalog.data?.grados ?? []).filter((g) => fold(g.nombre).includes(q)) : []), [catalog.data, q]);

  const subjectHits = useMemo(() => {
    if (q.length < 2 || !index.data || !pdfs) return [];
    return index.data.filter((s) => (fold(s.n).includes(q) || fold(s.a).includes(q)) && pdfs.has(s.p)).slice(0, MAX_SUBJECT_HITS);
  }, [index.data, pdfs, q]);

  if (catalog.error) {
    return <ErrorBox>No se pudo cargar el catálogo de horarios: {catalog.error}. Si es la primera vez que se arranca el servidor, espera a que termine la primera descarga.</ErrorBox>;
  }
  if (!catalog.data) return <Loading label="Cargando horarios…" />;

  const searching = q.length >= 2;

  return (
    <div>
      <section className="hero">
        <div className="hero__text">
          <h1>Horarios de la EPI Gijón</h1>
          <p className="muted">Elige tu grado, marca tus asignaturas y grupos y llévate el calendario (.ics) o un Excel.</p>
        </div>
        <div className="hero__facts" aria-label="Resumen">
          {totals.year && <span className="badge badge--accent">Curso {totals.year}</span>}
          <span className="badge">{totals.grados} grados</span>
          <span className="badge">{totals.horarios} horarios</span>
        </div>
        <div className="search-input hero__search">
          <Search size={18} aria-hidden className="search-input__icon" />
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Busca un grado o una asignatura (p. ej. Sistemas Inteligentes)" aria-label="Buscar grado o asignatura" autoFocus />
          {query && (
            <button type="button" className="search-input__clear" onClick={() => setQuery("")} aria-label="Vaciar búsqueda">
              <X size={16} aria-hidden />
            </button>
          )}
        </div>
      </section>

      {searching ? (
        <section className="results">
          {gradoHits.length > 0 && (
            <div className="panel">
              <h2>Grados</h2>
              <ul className="plain-list">
                {gradoHits.map((g) => (
                  <li key={g.slug}>
                    <Link to={`/grado/${g.slug}`}>{g.nombre}</Link> <span className="muted">· {g.rama}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="panel">
            <h2>Asignaturas</h2>
            {index.error && <p className="muted">El buscador de asignaturas no está disponible todavía.</p>}
            {index.loading && <Loading />}
            {index.data && subjectHits.length === 0 && <p className="muted">Sin resultados.</p>}
            <ul className="plain-list">
              {subjectHits.map((s) => {
                const loc = pdfs!.get(s.p)!;
                return (
                  <li key={`${s.p}|${s.a}`} className="hit">
                    <Link to={`${pdfHref(loc.grado, loc.pdf)}?s=${encodeURIComponent(s.a)}`}>
                      <strong>{s.n}</strong>
                    </Link>{" "}
                    {loc.pdf.ingles && <EnglishMark />}
                    <div className="muted hit__where">{pdfTitle(loc)}</div>
                  </li>
                );
              })}
            </ul>
            {subjectHits.length === MAX_SUBJECT_HITS && <p className="muted">Mostrando los primeros {MAX_SUBJECT_HITS}; afina la búsqueda.</p>}
          </div>
        </section>
      ) : (
        <section>
          {ramas.length > 1 && (
            <div className="filter-row" role="group" aria-label="Filtrar por rama">
              <button type="button" className={`filter ${rama === null ? "on" : ""}`} aria-pressed={rama === null} onClick={() => setRama(null)}>
                Todos
              </button>
              {ramas.map((r) => (
                <button key={r} type="button" className={`filter ${rama === r ? "on" : ""}`} aria-pressed={rama === r} onClick={() => setRama(rama === r ? null : r)}>
                  {r}
                </button>
              ))}
            </div>
          )}
          <div className="grado-grid">
            {shown.map((g) => (
              <Link key={g.slug} to={`/grado/${g.slug}`} className="grado-card" title={g.nombre}>
                <span className="grado-card__tag">{/^Doble/i.test(g.nombre) ? "Doble grado" : g.rama}</span>
                <span className="grado-card__title">{shortName(g)}</span>
                <span className="grado-card__foot">
                  <span className="muted">{countHorarios(g)} horarios</span>
                  <ArrowRight size={16} aria-hidden />
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
