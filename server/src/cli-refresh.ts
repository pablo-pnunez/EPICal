import { refresh } from "./pipeline/refresh.js";

/** `npm run refresh`: una actualización inmediata sin levantar el servidor web (útil para la primera carga y para depurar). */
const stats = await refresh("manual");
console.log(JSON.stringify(stats, null, 2));
process.exit(stats.errors.length > 0 && stats.pdfsSeen === 0 ? 1 : 0);
