import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dashboard is served under the /vmcp/ prefix (behind the platform reverse proxy). `base`
// bakes that into asset URLs + import.meta.env.BASE_URL; the backend mounts the same prefix.
// Dev server proxies the gateway's data routes to the backend on :8001 (forwarding the prefix,
// which the backend now serves); Vite itself serves the SPA + assets at /vmcp/.
export default defineConfig({
  base: "/vmcp/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/vmcp/api": "http://localhost:8001",
      "/vmcp/auth": "http://localhost:8001",
      "/mcp": "http://localhost:8001",
      "/health": "http://localhost:8001",
    },
  },
  build: { outDir: "dist" },
});
