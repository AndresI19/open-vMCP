import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The dashboard's tests need a DOM (Carbon renders real elements) and JSX (the components are TSX).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
