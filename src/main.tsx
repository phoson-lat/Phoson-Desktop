import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "next-themes";

import App from "./App";
import { mark } from "@/lib/perf";
import "./styles/globals.css";
import "./styles/app.css";
import "./styles/theme.css";
import "katex/dist/katex.min.css";

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
