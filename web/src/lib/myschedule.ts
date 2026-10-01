import type { PdfLocation } from "./catalog";

/**
 * «Mi horario»: asignaturas de varios horarios (PDF) con los grupos elegidos de cada una.
 * `key` identifica el PDF sin el curso académico ("informatica/tercero/s2/a", igual que la URL /grado/…), así el
 * enlace sigue valiendo cuando la EPI publica el curso siguiente. `groups` vacío = todos los grupos.
 */
export interface MyEntry {
  key: string;
  subject: string;
  groups: string[];
  /** Grupo -> semanas de curso en las que se da clase (ausente = todas las semanas del grupo). */
  weeks?: Record<string, number[]>;
}

/** [1,2,3,4,5,6,7,9] -> "1-7.9" */
export function weeksToText(weeks: number[]): string {
  const w = [...new Set(weeks)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < w.length; ) {
    let j = i;
    while (j + 1 < w.length && w[j + 1] === w[j]! + 1) j++;
    out.push(j > i ? `${w[i]}-${w[j]}` : String(w[i]));
    i = j + 1;
  }
  return out.join(".");
}

export function textToWeeks(text: string): number[] {
  const out: number[] = [];
  for (const part of text.split(".")) {
    const [a, b] = part.split("-").map(Number);
    if (!a || a < 0) continue;
    for (let n = a; n <= (b && b >= a && b - a < 60 ? b : a); n++) out.push(n);
  }
  return out;
}

const STORAGE_KEY = "epical.mihorario";

/** Clave estable de un PDF: grado + curso + semestre + grupo (sin el "2627" inicial del path). */
export function pdfKey(loc: Pick<PdfLocation, "grado" | "pdf">): string {
  return `${loc.grado.slug}/${loc.pdf.path.split("/").slice(1).join("/")}`;
}

/** "slug/curso/sem/grupo/ACR~g1~g2@1-7.9,…" — los trozos de asignatura/grupos van con encodeURIComponent; "@" separa las semanas de un grupo. */
export function serializeMine(entries: MyEntry[]): string {
  const group = (e: MyEntry, g: string) => encodeURIComponent(g) + (e.weeks?.[g]?.length ? `@${weeksToText(e.weeks[g]!)}` : "");
  return entries.map((e) => `${e.key}/${[encodeURIComponent(e.subject), ...e.groups.map((g) => group(e, g))].join("~")}`).join(",");
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function parseMine(text: string | null): MyEntry[] {
  const out: MyEntry[] = [];
  if (!text) return out;
  for (const part of text.split(",")) {
    const seg = part.split("/");
    if (seg.length !== 5 || seg.slice(0, 4).some((s) => !s)) continue;
    const [subject, ...pieces] = seg[4]!.split("~");
    if (!subject) continue;
    const groups: string[] = [];
    const weeks: Record<string, number[]> = {};
    for (const piece of pieces) {
      const at = piece.indexOf("@");
      const g = safeDecode(at < 0 ? piece : piece.slice(0, at));
      groups.push(g);
      const w = at < 0 ? [] : textToWeeks(piece.slice(at + 1));
      if (w.length > 0) weeks[g] = w;
    }
    out.push({ key: seg.slice(0, 4).join("/"), subject: safeDecode(subject), groups, ...(Object.keys(weeks).length > 0 ? { weeks } : {}) });
  }
  return out;
}

/** Añade o sustituye entradas (misma asignatura en el mismo PDF). */
export function mergeEntries(base: MyEntry[], add: MyEntry[]): MyEntry[] {
  const id = (e: MyEntry) => `${e.key}|${e.subject}`;
  const added = new Map(add.map((e) => [id(e), e]));
  return [...base.filter((e) => !added.has(id(e))), ...add];
}

/** Query string con `m` legible (sin %2F ni %2C) y el resto de parámetros intactos. */
export function mineSearch(entries: MyEntry[], rest?: URLSearchParams): string {
  const p = new URLSearchParams(rest);
  p.delete("m");
  const tail = p.toString();
  return `?m=${serializeMine(entries)}${tail ? `&${tail}` : ""}`;
}

export function loadStoredMine(): MyEntry[] {
  try {
    return parseMine(localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

export function saveStoredMine(entries: MyEntry[]): void {
  try {
    if (entries.length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, serializeMine(entries));
  } catch {
    /* almacenamiento bloqueado: la URL sigue siendo la fuente de verdad */
  }
}
