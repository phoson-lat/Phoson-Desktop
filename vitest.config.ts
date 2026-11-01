import path from "node:path";
import { defineConfig } from "vitest/config";

// Los tests unitarios corren en Node: las integraciones con Tauri se sustituyen
// por mocks y el protocolo real se cubre aparte en bridge/tests/smoke.py.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
  },
});
