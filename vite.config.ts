import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Tauri: puerto fijo, sin auto-open. El alias `@/*` replica el de Phoson-Web
// para que los componentes shadcn portados resuelvan `@/lib/utils`.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    // OJO: `**/bridge/**` también ignoraría `src/bridge/` (el cliente TS del
    // frontend). Solo excluimos el sidecar raíz y el shell de Tauri.
    watch: { ignored: ["**/src-tauri/**", "bridge/**", "**/node_modules/**"] },
  },
  build: {
    target: "es2021",
    sourcemap: true,
  },
});
