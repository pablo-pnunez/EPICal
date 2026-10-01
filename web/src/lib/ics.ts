/**
 * Generación de ficheros iCalendar (.ics) en el navegador a partir de los eventos ya calculados.
 * Las horas se escriben en UTC (sufijo Z): cualquier cliente (Google, Outlook, Apple...) las
 * convierte a la hora local del usuario, y así no hace falta incluir un VTIMEZONE.
 */

import type { CalEvent } from "./events";

/** Forma mínima que usan los componentes de calendario; `CalEvent` la cumple. */
export interface IcsEvent {
  summary: string;
  location: string;
  start: Date;
  end: Date;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function utcStamp(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Pliega líneas largas a 75 octetos como exige RFC 5545 (sin partir caracteres multibyte). */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (curBytes + b > limit) {
      out.push(cur);
      cur = "";
      curBytes = 0;
      limit = 74; // las líneas de continuación empiezan por un espacio
    }
    cur += ch;
    curBytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

/** Hash FNV-1a: UID estable para que reimportar el mismo calendario actualice los eventos en vez de duplicarlos. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export interface IcsOptions {
  /** Nombre del calendario (lo muestran Apple/Google al importar). */
  name: string;
  /** Identificador estable del origen (p.ej. id del PDF) para componer los UID. */
  source: string;
}

export function toIcs(events: CalEvent[], opts: IcsOptions): string {
  const stamp = utcStamp(new Date());
  const lines: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//EPIcal//Horarios EPI Gijon//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${escapeText(opts.name)}`, "X-WR-TIMEZONE:Europe/Madrid"];

  for (const ev of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${hash(`${opts.source}|${ev.subject}|${ev.group}|${ev.start.toISOString()}`)}-${hash(ev.summary)}@epical`);
    lines.push(`DTSTAMP:${stamp}`);
    if (ev.allDay) {
      // Festivo: evento de día completo (fecha de calendario en Madrid), que no bloquea la agenda.
      const [y, m, d] = ev.date.split("-").map(Number) as [number, number, number];
      const next = new Date(Date.UTC(y, m - 1, d + 1));
      lines.push(`DTSTART;VALUE=DATE:${y}${pad(m)}${pad(d)}`);
      lines.push(`DTEND;VALUE=DATE:${next.getUTCFullYear()}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}`);
      lines.push("TRANSP:TRANSPARENT");
    } else {
      lines.push(`DTSTART:${utcStamp(ev.start)}`);
      lines.push(`DTEND:${utcStamp(ev.end)}`);
    }
    lines.push(`SUMMARY:${escapeText(ev.summary)}`);
    if (ev.location) lines.push(`LOCATION:${escapeText(ev.location)}`);
    if (!ev.allDay) lines.push(`DESCRIPTION:${escapeText(`Semana ${ev.week} del curso`)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
