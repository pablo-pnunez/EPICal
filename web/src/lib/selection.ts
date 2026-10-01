import { ACTIVITY_ORDER, activityOf } from "./events";

/** Asignatura -> grupos marcados. */
export type Selection = Record<string, string[]>;

/** Profesor: varios grupos por tipo de actividad. Alumno: como mucho uno por tipo (el suyo). */
export type Mode = "profesor" | "alumno";

/** Deja como mucho un grupo por tipo de actividad en cada asignatura (el primero, en orden). */
export function reducePerActivity(sel: Selection): Selection {
  const out: Selection = {};
  for (const [acr, groups] of Object.entries(sel)) {
    const seen = new Set<string>();
    const kept = sortGroups(groups).filter((g) => {
      const a = activityOf(g);
      if (seen.has(a)) return false;
      seen.add(a);
      return true;
    });
    if (kept.length > 0) out[acr] = kept;
  }
  return out;
}

/** "ACR~g1~g2,ACR2~g1" — cada pieza va con encodeURIComponent, así que ni "," ni "~" de los datos rompen el formato. */
export function serializeSelection(sel: Selection): string {
  return Object.entries(sel)
    .map(([subject, groups]) => [subject, ...groups].map(encodeURIComponent).join("~"))
    .join(",");
}

export function parseSelection(text: string | null): Selection {
  const out: Selection = {};
  if (!text) return out;
  for (const part of text.split(",")) {
    const [subject, ...groups] = part.split("~").map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
    if (subject) out[subject] = groups;
  }
  return out;
}

export function sortGroups(groups: string[]): string[] {
  return [...groups].sort((x, y) => ACTIVITY_ORDER.indexOf(activityOf(x)) - ACTIVITY_ORDER.indexOf(activityOf(y)) || x.localeCompare(y, "es", { numeric: true }));
}

export function normalizeAcronym(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase();
}
