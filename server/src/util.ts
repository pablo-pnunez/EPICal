import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

/** Limita la concurrencia de una lista de tareas asíncronas (sin dependencias). */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return results;
}

export function sha256(buf: Buffer | string): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/** Escritura atómica: escribe a un temporal en la misma carpeta y renombra, para que nadie lea un fichero a medias. */
export async function writeFileAtomic(file: string, data: string | Buffer): Promise<void> {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

/** Escribe `file` y `file.gz` (el servidor estático sirve el .gz precomprimido si el cliente lo admite). */
export async function writeJsonPublic(file: string, value: unknown): Promise<void> {
  const text = JSON.stringify(value);
  await writeFileAtomic(file, text);
  await writeFileAtomic(`${file}.gz`, zlib.gzipSync(text, { level: 9 }));
}

export async function readJsonIfExists<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export function hoursSince(iso: string | undefined | null, now = Date.now()): number {
  if (!iso) return Infinity;
  return (now - new Date(iso).getTime()) / 3_600_000;
}
