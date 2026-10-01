import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// En desarrollo, Vite hace de proxy al servidor Node (que sirve /data y /api) para ver un único origen.
const BACKEND = "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/data": BACKEND, "/api": BACKEND } },
  build: { sourcemap: false },
});
