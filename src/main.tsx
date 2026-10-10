import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "next-themes";

import App from "./App";
import { installLogger } from "@/lib/log";
import { mark } from "@/lib/perf";
import "./styles/globals.css";
import "./styles/app.css";
import "./styles/theme.css";
import "katex/dist/katex.min.css";

// Instrumentación de acciones: lo antes posible para no perder el arranque.
installLogger();

// Tiempo desde que la webview empieza a ejecutar el bundle.
mark("ui:main-eval");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
mark("ui:render-queued");
