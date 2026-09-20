/**
 * Contenido de la demo de renderizado.
 *
 * `DEMO_USER` es el prompt detonante; `DEMO_ASSISTANT` ejercita cada capacidad
 * del `MarkdownRenderer`: GFM (tablas, listas, tachado), KaTeX (inline y
 * display), shiki (código resaltado), mermaid (diagrama) y artifact HTML.
 */

export const DEMO_USER = "Muéstrame una demo de todo lo que sabes renderizar.";

export const DEMO_ASSISTANT = [
  "# Renderizado enriquecido",
  "",
  "Este bloque comprueba **negrita**, *cursiva*, ~~tachado~~, `código inline` y un [enlace](https://phoson.lat).",
  "",
  "## Código con resaltado (shiki)",
  "",
  "```ts",
  "const sink = new GuiSink(sessionKey, emit);",
  "const controller = new SessionController(config, sink);",
  "await controller.run_turn('hola');",
  "```",
  "",
  "## Diagrama (mermaid)",
  "",
  "```mermaid",
  "flowchart LR",
  "  UI[WebView] -->|rpc| R[Relay Rust]",
  "  R -->|stdin| Py[SessionController]",
  "  Py -->|agent.event| R",
  "  R -->|phoson://message| UI",
  "```",
  "",
  "## Matemáticas (KaTeX)",
  "",
  "Inline: $c = \\sum_i t_i \\cdot p_i$. Y en bloque:",
  "",
  "$$\\text{ctx}_{libre} = W - \\sum_{i=1}^{n} t_i$$",
  "",
  "## Tabla (GFM)",
  "",
  "| Pieza | Rol |",
  "|---|---|",
  "| `GuiSink` | Eventos del engine |",
  "| `GuiConfirmation` | Permisos |",
  "| `SessionManager` | Multi-sesión |",
  "",
  "## Lista de tareas",
  "",
  "- [x] Markdown GFM",
  "- [x] LaTeX",
  "- [x] Mermaid",
  "- [x] Artifacts HTML",
  "",
  "## Artifact HTML",
  "",
  "```html",
  "<div style='padding:14px;border-radius:12px;background:#5b2eff22;border:1px solid #5b2eff55'>",
  "  <strong>Artifact HTML</strong> — se renderiza aislado y sanitizado (sin scripts ni iframes).",
  "</div>",
  "```",
  "",
  "> Cita de ejemplo. Todo esto pasa por el mismo `AgentEventSink`.",
].join("\n");
