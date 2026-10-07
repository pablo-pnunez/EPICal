import { useEffect, useState } from "react";
import type { Catalog, ChangeLog, ParsedSchedule } from "../types";
import type { AcademicCalendar } from "./events";

export interface SubjectIndexEntry {
  p: string;
  a: string;
  n: string;
  c: number | null;
}

export interface SiteStatus {
  lastSuccessAt: string | null;
  refreshHours: number;
  missingAcademicYears: string[];
}

const cache = new Map<string, Promise<unknown>>();

/** GET JSON con caché en memoria por sesión (el navegador además revalida por ETag). Un fallo no se cachea. */
function getJson<T>(url: string): Promise<T> {
  let p = cache.get(url) as Promise<T> | undefined;
  if (!p) {
    p = fetch(url).then(async (res) => {
      if (!res.ok) throw new Error(res.status === 404 ? "No encontrado" : `Error ${res.status} al cargar ${url}`);
      return (await res.json()) as T;
    });
    cache.set(url, p);
    p.catch(() => cache.delete(url));
  }
  return p;
}

export const getCatalog = () => getJson<Catalog>("/data/catalog.json");
export const getSchedule = (id: string) => getJson<ParsedSchedule>(`/data/schedules/${encodeURIComponent(id)}.json`);
export const getAcademicCalendar = () => getJson<AcademicCalendar>("/api/academic-calendar");
export const getSubjectIndex = () => getJson<SubjectIndexEntry[]>("/data/subjects-index.json");
export const getStatus = () => getJson<SiteStatus>("/data/status.json");
/** Sin fichero (aún no se ha registrado ninguna actualización) equivale a un registro vacío. */
export const getChanges = () => getJson<ChangeLog>("/data/changes.json").catch((): ChangeLog => ({ version: 1, entries: [] }));

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: null, error: null, loading: true });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ data: s.data, error: null, loading: true }));
    load().then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (err: Error) => alive && setState({ data: null, error: err.message, loading: false })
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

export async function requestExcel(body: { id: string; subject: string; groups: string[]; academicYear: string }): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch("/api/excel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* cuerpo no JSON */
    }
    throw new Error(res.status === 429 ? "Demasiadas peticiones; espera un minuto e inténtalo de nuevo." : msg);
  }
  const cd = res.headers.get("Content-Disposition") ?? "";
  const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
  return { blob: await res.blob(), filename: m ? decodeURIComponent(m[1]!) : "horario.xlsx" };
}
