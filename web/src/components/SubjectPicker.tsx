import { ChevronDown, FileSpreadsheet, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { ACTIVITY_LABEL, ACTIVITY_ORDER, activityOf, isEnglishGroup, type Activity } from "../lib/events";
import { fold } from "../lib/catalog";
import { sortGroups, type Selection } from "../lib/selection";
import type { ScheduleSection } from "../types";
import { EnglishMark } from "./EnglishMark";

export interface SubjectMeta {
  acronym: string;
  name: string;
  curso: number | null;
  /** Índice de sección (tabla del PDF) donde aparece. */
  section: number;
  groups: string[];
  english: boolean;
}

interface Props {
  subjects: SubjectMeta[];
  sections: ScheduleSection[];
  selection: Selection;
  onChange: (next: Selection) => void;
  onExcel: (acronym: string) => void;
  excelBusy: string | null;
}

/** Con más asignaturas que esto se muestran el buscador y «Todas/Ninguna»; con menos sobran. */
const SEARCH_THRESHOLD = 10;

function groupsByActivity(groups: string[]): Array<[Activity, string[]]> {
  const map = new Map<Activity, string[]>();
  for (const g of sortGroups(groups)) {
    const a = activityOf(g);
    if (!map.has(a)) map.set(a, []);
    map.get(a)!.push(g);
  }
  return ACTIVITY_ORDER.filter((a) => map.has(a)).map((a) => [a, map.get(a)!]);
}

export function SubjectPicker({ subjects, sections, selection, onChange, onExcel, excelBusy }: Props) {
  const [filter, setFilter] = useState("");
  // Asignaturas con el detalle de grupos desplegado (por defecto todas colapsadas).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (acronym: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(acronym)) next.delete(acronym);
      else next.add(acronym);
      return next;
    });
  const f = fold(filter.trim());
  const meta = useMemo(() => new Map(subjects.map((s) => [s.acronym, s])), [subjects]);

  const visible = subjects.filter((s) => !f || fold(s.name).includes(f) || fold(s.acronym).includes(f));
  const selectedSubjects = Object.keys(selection).filter((a) => meta.has(a));
  const showTools = subjects.length > SEARCH_THRESHOLD;
  // Las insignias de curso sólo informan si hay varios cursos distintos; «EN» sólo si es la excepción.
  const cursos = new Set(subjects.map((s) => s.curso));
  const showCurso = cursos.size > 1;
  const englishCount = subjects.filter((s) => s.english).length;
  const showEnglish = englishCount > 0 && englishCount < subjects.length;

  /** Estado global de cada tipo de actividad sobre las asignaturas seleccionadas (sólo modo profesor). */
  const activityState = useMemo(() => {
    const res = new Map<Activity, { total: number; on: number }>();
    for (const a of selectedSubjects) {
      for (const g of meta.get(a)!.groups) {
        const act = activityOf(g);
        const cur = res.get(act) ?? { total: 0, on: 0 };
        cur.total++;
        if (selection[a]!.includes(g)) cur.on++;
        res.set(act, cur);
      }
    }
    return res;
  }, [selectedSubjects, meta, selection]);

  function toggleSubject(s: SubjectMeta) {
    const next = { ...selection };
    if (next[s.acronym]) {
      delete next[s.acronym];
      setExpanded((prev) => {
        const e = new Set(prev);
        e.delete(s.acronym);
        return e;
      });
    } else next[s.acronym] = sortGroups(s.groups);
    onChange(next);
  }

  function setGroups(acronym: string, groups: string[]) {
    const next = { ...selection };
    if (groups.length === 0) delete next[acronym];
    else next[acronym] = sortGroups(groups);
    onChange(next);
  }

  function toggleGroup(s: SubjectMeta, g: string) {
    const cur = selection[s.acronym] ?? [];
    setGroups(s.acronym, cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]);
  }

  function toggleActivityInSubject(s: SubjectMeta, groups: string[]) {
    const cur = selection[s.acronym] ?? [];
    const allOn = groups.every((g) => cur.includes(g));
    setGroups(s.acronym, allOn ? cur.filter((g) => !groups.includes(g)) : [...new Set([...cur, ...groups])]);
  }

  /** Activa/desactiva un tipo (p. ej. PL) en TODAS las asignaturas seleccionadas a la vez. */
  function toggleActivityGlobal(act: Activity) {
    const st = activityState.get(act);
    if (!st) return;
    const turnOn = st.on < st.total;
    const next: Selection = {};
    for (const a of selectedSubjects) {
      const ofAct = meta.get(a)!.groups.filter((g) => activityOf(g) === act);
      let cur = selection[a]!;
      cur = turnOn ? [...new Set([...cur, ...ofAct])] : cur.filter((g) => !ofAct.includes(g));
      if (cur.length > 0) next[a] = sortGroups(cur);
    }
    onChange(next);
  }

  function selectAll() {
    const next: Selection = {};
    for (const s of subjects) next[s.acronym] = sortGroups(s.groups);
    onChange(next);
  }

  const multiSection = sections.length > 1;

  return (
    <div className="picker">
      {showTools && (
        <div className="picker__tools">
          <div className="search-input">
            <Search size={16} aria-hidden className="search-input__icon" />
            <input type="text" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar asignaturas…" aria-label="Filtrar asignaturas" />
          </div>
          <div className="picker__buttons">
            <button type="button" className="secondary" onClick={selectAll}>
              Todas
            </button>
            <button type="button" className="secondary" onClick={() => onChange({})} disabled={selectedSubjects.length === 0}>
              Ninguna
            </button>
          </div>
        </div>
      )}

      {selectedSubjects.length > 0 && activityState.size > 1 && (
        <div className="picker__activities" role="group" aria-label="Mostrar u ocultar un tipo de actividad en todas las asignaturas seleccionadas">
          <span className="muted">Mostrar:</span>
          {ACTIVITY_ORDER.filter((a) => activityState.has(a)).map((a) => {
            const st = activityState.get(a)!;
            const state = st.on === st.total ? "on" : st.on === 0 ? "off" : "some";
            return (
              <button key={a} type="button" className={`toggle toggle--${state}`} aria-pressed={state === "on"} onClick={() => toggleActivityGlobal(a)} title={`${ACTIVITY_LABEL[a]}: ${st.on} de ${st.total} grupos marcados`}>
                {a}
              </button>
            );
          })}
        </div>
      )}

      {sections.map((section, si) => {
        const list = visible.filter((s) => s.section === si);
        if (list.length === 0) return null;
        return (
          <div key={si} className="picker__section">
            {multiSection && <h3 className="picker__section-title">{section.title.replace(/\s*\(v[\d.]+\)\s*$/, "")}</h3>}
            {list.map((s) => {
              const selected = !!selection[s.acronym];
              const cur = selection[s.acronym] ?? [];
              const isOpen = expanded.has(s.acronym);
              return (
                <div key={s.acronym} className={`subject ${selected ? "subject--on" : ""}`}>
                  <div className="subject__top">
                    <label className="subject__head">
                      <input type="checkbox" checked={selected} onChange={() => toggleSubject(s)} />
                      <span className="subject__name">
                        <strong>{s.name}</strong>
                        <small>
                          {s.name !== s.acronym && s.acronym}
                          {selected && !isOpen && <span className="subject__summary">{s.name !== s.acronym && " · "}{summarize(cur, s.groups.length)}</span>}
                        </small>
                      </span>
                      {showEnglish && s.english && <EnglishMark />}
                      {showCurso && s.curso && <span className="badge">{s.curso}º</span>}
                    </label>
                    {selected && (
                      <button type="button" className="subject__chevron" aria-expanded={isOpen} aria-label={isOpen ? `Ocultar grupos de ${s.name}` : `Elegir grupos de ${s.name}`} title={isOpen ? "Ocultar grupos" : "Elegir grupos"} onClick={() => toggleExpanded(s.acronym)}>
                        <ChevronDown size={18} aria-hidden className={isOpen ? "open" : ""} />
                      </button>
                    )}
                  </div>
                  {selected && isOpen && (
                    <div className="subject__body">
                      {groupsByActivity(s.groups).map(([act, groups]) => {
                        const allOn = groups.every((g) => cur.includes(g));
                        return (
                          <div key={act} className="act-row">
                            <button type="button" className={`act-row__label ${allOn ? "act-row__label--on" : ""}`} onClick={() => toggleActivityInSubject(s, groups)} title={`Marcar/desmarcar todos: ${ACTIVITY_LABEL[act]}`}>
                              {act}
                            </button>
                            <div className="chip-row">
                              {groups.map((g) => (
                                <button key={g} type="button" className={`chip ${cur.includes(g) ? "chip--on" : ""}`} aria-pressed={cur.includes(g)} onClick={() => toggleGroup(s, g)}>
                                  {g}
                                  {isEnglishGroup(g) && <span className="chip__en">EN</span>}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                      <ExcelButton s={s} onExcel={onExcel} excelBusy={excelBusy} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
      {visible.length === 0 && <p className="muted">Ninguna asignatura coincide.</p>}
    </div>
  );
}

/** Resumen de los grupos marcados, visible con la asignatura colapsada. */
function summarize(selected: string[], total: number): string {
  if (selected.length <= 4) return selected.join(" · ");
  return selected.length === total ? "todos los grupos" : `${selected.length} de ${total} grupos`;
}

function ExcelButton({ s, onExcel, excelBusy }: { s: SubjectMeta; onExcel: (acronym: string) => void; excelBusy: string | null }) {
  return (
    <button type="button" className="secondary subject__excel" onClick={() => onExcel(s.acronym)} disabled={excelBusy !== null}>
      <FileSpreadsheet size={14} aria-hidden /> {excelBusy === s.acronym ? "Generando…" : "Excel"}
    </button>
  );
}
