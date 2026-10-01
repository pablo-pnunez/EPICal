// Compara buildEvents (navegador) con el oráculo Python. Se lanza vía `npm run test:events` (tests/run-events-test.mjs).
import fs from "node:fs";
import path from "node:path";
import { buildEvents, isCourseCalendar } from "./events";
import type { ParsedSchedule } from "../types";

const root = path.resolve(import.meta.dirname, "..", "..", "..");
const dataDir = process.env.EPICAL_DATA_DIR ?? path.join(root, "data");
const oracle = process.env.EPICAL_ORACLE;
if (!oracle) throw new Error("Falta EPICAL_ORACLE: ejecuta este test con `npm run test:events`");

// Calendario extraído de los PDF (state.json), el mismo que usa la web.
const calendars = (JSON.parse(fs.readFileSync(path.join(dataDir, "state.json"), "utf-8")) as { calendars: Record<string, { data: unknown }> }).calendars;
const course = calendars[Object.keys(calendars).sort().at(-1)!]!.data as Parameters<typeof buildEvents>[2];
const py = JSON.parse(fs.readFileSync(oracle, "utf-8")) as Record<string, Array<[string, number, number, string, string, number]>>;
const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" });
const hourFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", hourCycle: "h23" });

if (!isCourseCalendar(course)) throw new Error("state.json no tiene calendarios: ejecuta npm run refresh");

let ok = 0;
let bad = 0;
for (const [key, expected] of Object.entries(py)) {
  const [id, subject] = key.split("|") as [string, string];
  const s = JSON.parse(fs.readFileSync(path.join(dataDir, "public", "schedules", `${id}.json`), "utf-8")) as ParsedSchedule;
  const { classes } = buildEvents(
    s.rows.filter((r) => r.subject === subject),
    s.cuatrimestre,
    course,
    { nameOf: (x) => x }
  );
  const got = classes.map((e) => [dateFmt.format(e.start), Number(hourFmt.format(e.start)), Number(hourFmt.format(e.end)), e.group, e.location, e.week]);
  const sortFn = (a: unknown[], b: unknown[]) => JSON.stringify(a).localeCompare(JSON.stringify(b));
  if (JSON.stringify(got.sort(sortFn)) === JSON.stringify([...expected].sort(sortFn))) ok++;
  else {
    bad++;
    if (bad <= 3) console.log("DIFERENCIA", key, "ts:", got.length, "py:", expected.length);
  }
}
console.log(`[TZ=${process.env.TZ ?? "sistema"}] equivalentes con el motor Python: ${ok}/${ok + bad}`);
process.exit(bad ? 1 : 0);
