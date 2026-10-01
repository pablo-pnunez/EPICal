export function log(scope: string, msg: string, extra?: unknown): void {
  const ts = new Date().toISOString();
  if (extra !== undefined) console.log(`${ts} [${scope}] ${msg}`, extra);
  else console.log(`${ts} [${scope}] ${msg}`);
}
