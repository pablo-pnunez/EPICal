import { CalendarPlus, Check, ChevronDown, Link2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { downloadBlob, safeFilename } from "../lib/download";
import { ACTIVITY_LABEL, activityOf, type CalEvent } from "../lib/events";
import { toIcs } from "../lib/ics";
import { makeZip } from "../lib/zip";

type SplitMode = "none" | "subject" | "activity" | "group";

const SPLIT_OPTIONS: Array<[SplitMode, string]> = [
  ["none", "Un único calendario"],
  ["subject", "Uno por asignatura"],
  ["activity", "Uno por tipo (teoría, PA, PL…)"],
  ["group", "Uno por grupo"],
];

interface Props {
  classes: CalEvent[];
  holidays: CalEvent[];
  /** Nombre base de los ficheros. */
  baseName: string;
  /** Identificador estable del origen (para los UID del .ics). */
  source: string;
  nameOf: (subject: string) => string;
  disabledReason: string | null;
}

export function ExportPanel({ classes, holidays, baseName, source, nameOf, disabledReason }: Props) {
  const [includeHolidays, setIncludeHolidays] = useState(false);
  const [split, setSplit] = useState<SplitMode>("none");
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Cierra el menú al pulsar fuera o con Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function buildFiles(): Array<{ name: string; content: string }> {
    const files: Array<{ name: string; content: string }> = [];
    const make = (name: string, events: CalEvent[]) => files.push({ name: `${safeFilename(name)}.ics`, content: toIcs(events, { name, source: `${source}|${name}` }) });
    const withHolidays = (events: CalEvent[]) => (includeHolidays ? [...events, ...holidays].sort((a, b) => a.start.getTime() - b.start.getTime()) : events);

    if (split === "none") make(baseName, withHolidays(classes));
    else {
      const keyOf = (e: CalEvent) => (split === "subject" ? nameOf(e.subject) : split === "activity" ? ACTIVITY_LABEL[activityOf(e.group)] : `${nameOf(e.subject)} - ${e.group}`);
      const groups = new Map<string, CalEvent[]>();
      for (const e of classes) {
        const k = keyOf(e);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(e);
      }
      for (const [k, evs] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], "es", { numeric: true }))) make(k, evs);
      if (includeHolidays && holidays.length > 0) make("Festivos", holidays);
    }
    return files;
  }

  function download() {
    setOpen(false);
    const files = buildFiles();
    if (files.length === 1) downloadBlob(new Blob([files[0]!.content], { type: "text/calendar;charset=utf-8" }), files[0]!.name);
    else downloadBlob(makeZip(files), `${safeFilename(baseName)}.zip`);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copia este enlace:", window.location.href);
    }
  }

  const disabled = disabledReason !== null || classes.length === 0;
  const customized = includeHolidays || split !== "none";

  return (
    <div className="export-bar">
      <div className="split-button" ref={menuRef}>
        <button type="button" className="split-button__main" onClick={download} disabled={disabled} title={disabledReason ?? undefined}>
          <CalendarPlus size={16} aria-hidden /> Descargar .ics{split !== "none" ? " (.zip)" : ""}
        </button>
        <button type="button" className="split-button__toggle" onClick={() => setOpen((o) => !o)} aria-haspopup="true" aria-expanded={open} aria-label="Opciones de descarga" title="Opciones de descarga">
          <ChevronDown size={16} aria-hidden />
          {customized && <span className="split-button__dot" aria-hidden />}
        </button>
        {open && (
          <div className="popover" role="menu">
            <label className="check">
              <input type="checkbox" checked={includeHolidays} onChange={(e) => setIncludeHolidays(e.target.checked)} />
              Incluir festivos
            </label>
            <fieldset className="popover__group">
              <legend>Generar</legend>
              {SPLIT_OPTIONS.map(([value, label]) => (
                <label key={value} className="check">
                  <input type="radio" name="split" checked={split === value} onChange={() => setSplit(value)} />
                  {label}
                </label>
              ))}
            </fieldset>
            <p className="muted popover__hint">El .ics se importa en Google Calendar, Outlook, Apple Calendar o cualquier otra aplicación de calendario.</p>
          </div>
        )}
      </div>

      <button type="button" className="secondary icon-button" onClick={copyLink} aria-label="Copiar enlace con mi selección" title="Copiar enlace con mi selección">
        {copied ? <Check size={16} aria-hidden /> : <Link2 size={16} aria-hidden />}
        {copied && <span className="icon-button__label">Copiado</span>}
      </button>

      <span className="muted export-bar__count">{disabledReason ?? `${classes.length + (includeHolidays ? holidays.length : 0)} eventos`}</span>
    </div>
  );
}
