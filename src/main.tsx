import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "next-themes";

import App from "./App";
import { initI18n } from "@/lib/i18n";
import { installNativeLabels } from "@/lib/native-labels";
import { installLogger } from "@/lib/log";
import { mark } from "@/lib/perf";
import "./styles/globals.css";
import "./styles/app.css";
import "./styles/theme.css";
import "katex/dist/katex.min.css";

/**
 * Arranque en dos pasos: primero el idioma, luego el render.
 *
 * El idioma del sistema lo da Rust (`system_locale`), así que hay un viaje de
 * ida y vuelta antes de poder pintar nada. Se resuelve **antes** del primer
 * render a propósito: si no, la app abriría en el idioma de la webview (que en
 * macOS no es el del sistema) y parpadearía al correcto, justo en la pantalla
 * de bienvenida que es lo primero que ve alguien nuevo.
 */
async function bootstrap(): Promise<void> {
  // Instrumentación de acciones: lo antes posible para no perder el arranque.
  installLogger();
  // Tiempo desde que la webview empieza a ejecutar el bundle.
  mark("ui:main-eval");

  await initI18n();
  // La bandeja la pinta Rust: necesita sus etiquetas ya traducidas.
  installNativeLabels();

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
        <App />
      </ThemeProvider>
    </React.StrictMode>,
  );
  mark("ui:render-queued");
}

void bootstrap();
