import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies gateway routes to the backend on :8001 so the SPA and API
// share an origin. In prod the backend serves web/dist directly.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8001",
      "/auth": "http://localhost:8001",
      "/health": "http://localhost:8001",
    },
  },
  build: { outDir: "dist" },
});
