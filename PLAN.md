# Phoson Desktop — Plan de arquitectura y prototipo

> App de escritorio (Tauri) para el `phoson-cli`, construida sobre el runtime
> `phoson-engine-minimal` (Python) y reutilizando el design system de `Phoson-Web`.
>
> Estado: **plan + bosquejo de prototipo**. Ver `prototype/` para el esqueleto de código.

---

## 1. Qué tenemos (hallazgos)

### 1.1 `phoson-engine-minimal` (runtime Python ≥3.12)

Tres capas bien separadas:

- **`phoson_llm`** — adapters de proveedores LLM (~20), schemas y eventos.
- **`phoson_agent`** — `AgentEngine` (bucle ReAct), tools (`@tool`), middlewares,
  plugins, permisos, sesiones (`ConversationTree` ramificable + `JsonlStorage`).
  **Cero dependencia de UI.**
- **`phoson_cli`** — front-ends interactivos (REPL clásico y TUI) y, sobre todo,
  `SessionController`: el **runtime de sesión ya desacoplado de la terminal**.

**El punto clave para una GUI:** el core no conoce Rich ni prompt_toolkit; todo lo
que hay que *mostrar* pasa por protocolos inyectables. Un front-end nuevo es
**un sink, no un fork** (`phoson_cli/ui_protocols.py`).

Protocolos/clases reutilizables (puntos de integración):

| Abstracción | Ubicación | Rol en la GUI |
|---|---|---|
| `AgentEventSink` | `phoson_cli/ui_protocols.py` | Recibe **todos** los eventos de presentación (tokens, tools, notificaciones, subagentes, historial). Métodos **síncronos y no bloqueantes**. |
| `ConfirmationService` | `phoson_cli/ui_protocols.py` | Diálogos Yes/Always/No (bash en `safe_mode`, permisos). Sin él, los tools `ask` **fallan cerrado**. |
| `CommandHost` | `phoson_cli/command_host.py` | Presentación de los `/comandos`; `CommandHandler` (en `commands.py`) aporta la **semántica**. Se obtiene `/model`, `/sessions`, `/theme`… casi gratis. |
| `PluginUiService` | `phoson_agent/cli_extensions.py` | UI dirigida por plugins: `publish/replace/remove`, `confirm/select/form`, con `UiBlock` UI-neutros. |
| `SessionController` | `phoson_cli/controller.py` | El "motor": `run_turn`, `cancel_current`, `load_session`, `new_session`, `set_model/set_provider`, `compact_context`, `undo_last_turn`, `jump_to_user_turn`, `shutdown`. |
| `AgentEngine.stream()` | `phoson_agent/agent.py` | Nivel bajo: `AsyncIterator[AgentEvent]` puro. |
| `ConversationTree`/`SessionMeta`/`JsonlStorage` | `phoson_agent/sessions/` | Panel de sesiones y rewind. |
| `SessionMetrics`/`SessionState` | `phoson_cli/_session.py` | HUD (coste, tokens, pasos). |
| `PhosonConfig`/`build_chat` | `phoson_cli/config.py` | Config y fábrica del cliente LLM. |

Contratos relevantes:
- `SessionController(config, sink, confirmation=None)`.
- `await controller.run_turn(text) -> RunOutcome(status in {"done","error","cancelled"}, error_code, final_content)`.
- `await controller.load_session(id) -> LoadOutcome(ok, message)`.
- `AgentEventSink` (sync): `on_user_message`, `on_attachments`, `on_event`,
  `flush_line`, `capture_partial_reasoning`, `take_reasoning`, `set_session`,
  `print_history`, `notify`, `on_subagent_progress`.
- `ConfirmationService` (async): `confirm_bash(command)`, `confirm_bash_command(command, *, on_always=None)`.
- Stream de `AgentEvent`: `AgentStartEvent` → `AgentTokenEvent`* →
  `AgentReasoningEvent`* → `AgentToolComposingEvent`* → `AgentToolStartEvent` →
  `AgentToolDoneEvent` → `AgentStepDoneEvent` → `AgentDoneEvent`/`AgentErrorEvent`.

**Lo que NO existe:** no hay JSON-RPC, WebSocket, IPC ni "server mode". La
integración nativa es **in-proceso vía API Python** (un solo event loop asyncio).

### 1.2 `Phoson-Web` (frontend)

- **Next.js 16 (RSC) + React 19 + TypeScript**, **Tailwind v4 CSS-first** (sin
  `tailwind.config.js`), **shadcn/ui** (new-york, `lucide`), `next-themes`.
- **Design system real de Phoson** (portable 1:1):
  - Tokens en `app/globals.css`: violeta `--violet: #5b2eff`, `--violet-soft`,
    sistema glassmorphism **`dashboard-*`** (paneles `backdrop-filter: blur(24px)`),
    `grid-bg`, `glow-violet`, radius `0.75rem`, dark mode por clase.
  - **Chat ya diseñado**: `.chat-bubble-user`, `.chat-bubble-agent`,
    `.prose-chat`/`.chat-markdown`, `.animate-flow-token` (blur-in por bloques al
    hacer streaming), welcome-*, `.animate-composer-rise`, indicador de tipeo.
  - 56 primitivas `components/ui/*` (React puro, sin Next) + `lib/utils.ts` (`cn`).
  - `markdown-renderer.tsx` (react-markdown + GFM + KaTeX + shiki + **sanitización**
    de HTML de IA) y `artifact-block.tsx` — listos para respuestas de IA.
- **`local-ai-playground.tsx`**: chat con LLM 100% local (transformers.js,
  WebGPU→WASM). React puro, extraíble casi intacto.
- A adaptar al migrar de Next: routing/SEO (`app/`, `next/link`, `next/font`,
  analytics, middleware). Todo lo demás es portable a **Vite + React**.

### 1.3 Señal de intención

`Phoson-Desktop/` solo contiene `.agents/skills/tauri-development/SKILL.md`
(skill instalada). → El stack objetivo es **Tauri 2 + React + Tailwind + shadcn/ui**.

---

## 2. Decisión de arquitectura

Como el engine es **Python + asyncio** y la shell es **Tauri (Rust + WebView)**,
hay que cruzar el límite de proceso. Evaluación:

| Opción | Veredicto |
|---|---|
| **A. Python sidecar + JSON-RPC NDJSON por stdio** | ✅ **Elegida.** Proceso aislado, sin puertos abiertos, reutiliza TODO el engine y sus plugins, empaquetable con Tauri sidecar. |
| B. FastAPI local (HTTP/WebSocket) | ⚠️ Fallback. Útil para multi-dispositivo/remoto, pero añade puerto + superficie de auth + latencia. No es necesaria para escritorio. |
| C. Embeber CPython (pyo3) | ❌ GIL, asyncio, deps opcionales y packaging: complejidad desproporcionada. |
| D. Reescribir el core en Rust | ❌ Descarta 20 adapters LLM, plugins y tools. |

### Arquitectura elegida (3 procesos/2 lenguajes)

```
┌──────────────────────────── WebView (React + TS) ────────────────────────────┐
│  UI: Chat, Sessions, ToolCards, Permissions, Metrics, Settings               │
│  PhosonClient: invoke('rpc', …)  +  listen('phoson://message', …)            │
└───────────────▲───────────────────────────────────────────▲──────────────────┘
                │ Tauri IPC (invoke)                        │ Tauri events
┌───────────────┴───────────────────────────────────────────┴──────────────────┐
│  src-tauri (Rust)  — SOLO transporte + integración nativa                     │
│  · spawnea el sidecar (tauri-plugin-shell / sidecar)                          │
│  · lee stdout NDJSON → reenvía a la webview como evento                       │
│  · invoke('rpc') → escribe una línea JSON al stdin del sidecar                │
│  · HashMap<id, oneshot> para casar respuestas; notificaciones → eventos       │
│  · nativo: tray, notificaciones, dialog, global shortcuts, updater, fs        │
└───────────────▲───────────────────────────────────────────▲──────────────────┘
                │ stdin (requests JSON-RPC)                 │ stdout (NDJSON)
┌───────────────┴───────────────────────────────────────────┴──────────────────┐
│  phoson-bridge (Python, sidecar)                                              │
│  · Host de SessionController en UN loop asyncio                               │
│  · GuiSink(AgentEventSink)          → notificaciones de streaming             │
│  · GuiConfirmation(ConfirmationService) → confirm.request / confirm.respond   │
│  · GuiCommandHost(CommandHost)      → reutiliza CommandHandler                │
│  · GuiPluginUiService(PluginUiService) → bloques UI de plugins                │
│  · phoson-engine-minimal (pip) + plugins + extras                             │
└───────────────────────────────────────────────────────────────────────────────┘
```

Principio rector: **el front-end es un sink, no un fork**. La GUI implementa los
protocolos del engine y el sidecar los traduce a mensajes JSON. El core no cambia.

### Reglas de oro descubiertas en el análisis

1. **Un solo event loop.** El controller fija sus primitivas `asyncio` al loop en
   que se construye. Construcción **y** turnos deben correr en el mismo loop del
   sidecar (nada de `asyncio.run` por turno).
2. **`©AgentEventSink` es síncrono y no debe bloquear.** El sink solo encola en un
   `asyncio.Queue`; un writer task serializa a stdout (eso garantiza ordering).
3. **stdout del sidecar = protocolo.** Cualquier `print`/log de plugins debe ir a
   **stderr** o romperá el framing.
4. **Fails-closed.** Siempre inyectar un `ConfirmationService`; sin él los tools
   `ask` se rechazan.
5. **Single-flight.** Un `SessionController` no admite runs concurrentes;
   `run_turn` se serializa con un lock y los "wakes" autónomos reutilizan el mismo
   canal (`on_user_message`). La GUI los pinta igual que un turno tecleado.

---

## 3. Protocolo de la GUI (bridge JSON-RPC)

Framing: **NDJSON** (un objeto JSON por línea) sobre stdio. JSON-RPC 2.0.

### 3.1 Request/respuesta (frontend → sidecar)

Todas las operaciones **de sesión** reciben `sessionId` (clave del bridge). La
clave del bridge ≠ id del engine: `session.new`/`session.open` devuelven una clave;
el id del engine aparece en `session.info.engineSessionId`.

| Método | Params | Devuelve |
|---|---|---|
| `initialize` | `{}` | `{config, tools, commands, defaultSessionId, metrics}` |
| `session.new` | `{}` | `{sessionId}` (nueva clave de bridge) |
| `session.list` | `{}` | `{sessions:[SessionMeta…]}` (90 en el entorno real) |
| `session.open` | `{id}` | `{sessionId}` — crea sesión + `load_session` (replay) |
| `session.close` | `{sessionId}` | `{ok}` |
| `turn.run` | `{sessionId, text, attachments?}` | `{status, errorCode, finalContent}` (streaming por notificaciones) |
| `turn.cancel` | `{sessionId}` | `{cancelled}` |
| `session.undo` | `{sessionId}` | `{ok, message}` |
| `session.rewind` | `{sessionId, userNodeId}` | `{ok, message}` |
| `session.jumpCandidates` | `{sessionId}` | `{candidates:[{userNodeId, preview}]}` |
| `session.compact` | `{sessionId, profile?}` | `{ok, before, after}` |
| `session.planCompact` | `{sessionId, profile?}` | `CompactPlan` serializado |
| `model.set` | `{sessionId, model, provider?}` | `{ok, model}` |
| `models.list` | `{sessionId}` | `{current, models:[ModelOption…]}` (lista viva del proveedor, con contexto y precio) |
| `config.get` | `{sessionId}` | `ConfigView` (sin secretos: solo procedencia `file`/`env`/`default`) |
| `config.set` | `{sessionId, patch, secrets?}` | `{ok, path, config}` — persiste en `~/.phoson/config.toml` |
| `provider.set` | `{sessionId, provider}` | `{ok, provider}` |
| `attachment.add` | `{sessionId, path}` | `{attachments:[Attachment…]}` |
| `attachment.clear` | `{sessionId}` | `{attachments:[]}` |
| `confirm.respond` | `{sessionId, requestId, decision:"yes"\|"always"\|"no"}` | `{ok}` |
| `shutdown` | `{}` | `{ok}` |

Pendientes para M3 (aún **no** implementados): `command.execute`, `session.rename`,
`pluginUi.respond`.

### 3.2 Notificaciones (sidecar → frontend)

Todas incluyen `sessionId` (salvo las globales) para enrutar en multi-sesión.

| Notificación | Payload | Origen (sink/controller) |
|---|---|---|
| `session.turn.started` | `{sessionId, task}` | dispatch de `turn.run` |
| `session.user_message` | `{sessionId, text, message}` | `on_user_message` |
| `agent.event` | `{sessionId, event:{type, timestamp, …}}` | `on_event` (uno por `AgentEvent`) |
| `session.assistant.done` | `{sessionId, status, errorCode, finalContent}` | fin de `run_turn` |
| `session.metrics` | `{sessionId, costUsd, tokens, inputTokens, outputTokens, steps, contextTokens, contextWindow, model, provider, isRunning}` | props del controller |
| `session.info` | `{sessionId, engineSessionId}` | `set_session` |
| `session.history` | `{sessionId, messages:[…], timestamps:[…]}` | `print_history` (replay al cargar) |
| `subagent.progress` | `{sessionId, progress}` \| `null` | `on_subagent_progress` |
| `notify` | `{sessionId, kind, message}` | `notify` |
| `attachments.changed` | `{sessionId, sources:[…]}` | `on_attachments` |
| `confirm.request` | `{sessionId, requestId, command, kind:"bash", actions:[…]}` | `ConfirmationService` |

`agent.event` se serializa con un normalizador de dataclasses que añade
`type = type(Evento).__name__` (ver `bridge/phoson_bridge/protocol.py`). Campos
reales (verificados): `AgentTokenEvent.content`, `AgentReasoningEvent.content`,
`AgentToolStartEvent.{tool_call_id,tool_name,args}`, `AgentToolDoneEvent.{result,error,duration_ms}`.
El streaming de tokens se **coalesce** en el store React (flush por rAF).

---

## 4. Estructura propuesta del repo `Phoson-Desktop/`

```
Phoson-Desktop/
├── PLAN.md                      # este documento
├── package.json                 # Vite + React 19 + Tailwind v4 + shadcn
├── vite.config.ts               # @tailwindcss/vite + @vitejs/plugin-react
├── tsconfig.json
├── components.json              # shadcn (new-york, cssVariables, lucide)
├── index.html
├── src/                         # ── Frontend React ──
│   ├── main.tsx / App.tsx
│   ├── styles/globals.css       # PORTADO de Phoson-Web (tokens + chat CSS)
│   ├── components/ui/           # 56 primitivas shadcn PORTADAS
│   ├── features/
│   │   ├── chat/                # ChatView, MessageList, StreamingMessage, Composer
│   │   ├── sessions/            # SessionSidebar, ConversationTree, RewindPicker
│   │   ├── tools/               # ToolCallCard (+ ToolRenderRegistry de plugins)
│   │   ├── permissions/         # PermissionDialog (Yes/Always/No)
│   │   ├── metrics/             # MetricsHUD (coste, tokens, contexto)
│   │   ├── plugins/             # PluginPanel (UiBlock), SubagentPanel
│   │   └── settings/            # SettingsDialog (providers, keys, models)
│   ├── bridge/                  # PhosonClient, protocol.ts, useBridge hooks
│   ├── stores/                  # zustand (session, chat, ui)
│   └── lib/                     # cn(), utils portados
├── src-tauri/                   # ── Shell Rust ──
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/default.json
│   ├── binaries/                # phoson-bridge-<target-triple> (sidecar)
│   └── src/
│       ├── main.rs
│       ├── bridge.rs            # spawn sidecar + relay NDJSON + RPC futures
│       └── native.rs            # tray, notifications, dialogs, updater
├── bridge/                      # ── Python sidecar ──
│   ├── pyproject.toml           # deps: phoson-engine-minimal + extras elegidos
│   └── phoson_bridge/
│       ├── __main__.py
│       ├── server.py            # loop JSON-RPC, dispatch, queue writer
│       ├── protocol.py          # serialización de AgentEvent / dataclasses
│       ├── sink.py              # GuiSink(AgentEventSink)
│       ├── confirmation.py      # GuiConfirmation(ConfirmationService)
│       ├── command_host.py      # GuiCommandHost(CommandHost)
│       └── plugin_ui.py         # GuiPluginUiService(PluginUiService)
└── docs/
    └── PROTOCOL.md              # de la tabla §3 (referencia p/ ambos lados)
```

---

## 5. Roadmap — alcance acordado: **M1 + M2**

> Decisión #1: el MVP se limita a **M1 (puente funcionando) + M2 (sesión real con
> streaming)**. M3–M5 quedan como backlog, no entran en esta fase.

- **M0 — Andamiaje + design system.** Vite+React+Tailwind v4+shadcn; portar
  `globals.css` (tokens violeta + `dashboard-*` + CSS de chat) y `components/ui/*`;
  `cn()`. Ventana Tauri vacía con la shell visual. *Sin Python.*
- **M1 — Bridge "hello world".** Sidecar que ejecuta una tarea y emite tokens por
  `agent.event`. Prueba de extremo a extremo del stdio + Rust relay + `listen` en
  la webview. *Sin sesiones.* (En la práctica, el sidecar ya cubre M1 y M2.)
- **M2 — Sesión real.** `PhosonRepl` + `GuiSink` + `run_turn`; chat con streaming,
  persistencia (`JsonlStorage`), sidebar de sesiones, `load_session` (replay con
  `print_history`), `new_session`, y **multi-sesión** (un `PhosonRepl` por sesión).
  **Hito "usable".**

### Backlog (fuera de esta fase)

- **M3** — `GuiConfirmation` (dialog Yes/Always/No en UI), `ToolCallCard`,
  `CommandHost` + `CommandHandler` (`/model`, `/sessions`, `/compact`, …),
  picker de modelo/proveedor, `MetricsHUD`, cancel/stop.
  *(El bridge ya expone `confirm.request/respond`, `model.set`, `provider.set`,
  `session.compact`, `session.rewind`… solo falta la UI.)*
- **M4** — `GuiPluginUiService`, subagentes (panel live), wakes, notificaciones
  nativas + tray, attachments (drag&drop), árbol de conversación.
- **M5** — Firma/notarización, auto-update, CI multiplataforma, keychain. *(El
  empaquetado del sidecar ya está resuelto vía binarios de GitHub, ver §9.)*


---

## 6. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Empaquetar Python en cada OS | **Binarios prebuilt publicados en el repo de GitHub** (decisión #2): CI compila el sidecar por plataforma (PyInstaller one-file) y Tauri lo descarga a `src-tauri/binaries/<triple>`. En dev, fallback a un venv con `PYTHONPATH` al engine. |
| `print` de plugins contamina stdout | Redirigir `sys.stdout` a stderr en el sidecar; usar solo un writer dedicado para el protocolo. Logging a stderr. **Validado**: 0 errores de framing. |
| Puenteo de event loop | Todo el controller vive en el loop del sidecar; el sink encola (sync); el writer es async. Nunca crear el controller fuera de ese loop. |
| Saturación por tokens | Coalescing de `AgentTokenEvent` (flush por rAF) en el store React. |
| Extras opcionales (mcp, ssh, computeruse, memory, stt) | Instalar en el venv del sidecar solo los elegidos; los plugins rotos degradan a warning (comportamiento del engine). |
| `ConfirmationService` ausente ⇒ tools `ask` bloqueados | Siempre inyectar `GuiConfirmation`. |
| Multi-sesión (N controllers en un loop) | Decisión #5: un `PhosonRepl` por sesión. Cada controller es single-flight, así que la concurrencia sale de tener N instancias; vigilar memoria (cada una construye su engine). |
| Deriva del engine (v0.42.0) | El bridge solo usa protocolos estables (`AgentEventSink`, `ConfirmationService`, `PhosonRepl`); pinear versión y cubrir con tests del protocolo. |

---

## 7. Decisiones (resueltas)

1. **Alcance del MVP**: **M1 + M2** únicamente. M3–M5 → backlog (§5).
2. **Runtime Python**: **binarios prebuilt del repo de GitHub** (no PyInstaller
   local). Dev puede usar `PYTHONPATH` al engine.
3. **Reutilizar `PhosonRepl`**: sí, como motor de sesión headless (§2 y §9). No se
   usa su capa prompt_toolkit; se aprovechan sus passthroughs para que los
   `/comandos` funcionen en M3 con un `GuiCommandHost`.
4. **Playground de LLM local**: **fuera de alcance**.
5. **Multi-sesión concurrente**: **sí**. `SessionManager` mantiene un `PhosonRepl`
   por sesión (§9.2).
6. **Sync con la web**: pendiente; por defecto la app es 100% local.

---

## 8. Referencias en el repo (verificado)

- Protocolos: `phoson_cli/ui_protocols.py`, `phoson_cli/command_host.py`.
- Runtime: `phoson_cli/controller.py` (`SessionController`, `RunOutcome`, `LoadOutcome`).
- Front-end reutilizado: `phoson_cli/repl.py` (`PhosonRepl`, construible headless).
- Patrón de referencia no-terminal: `phoson_cli/fullscreen/sink.py` (`FullScreenSink`)
  y `phoson_cli/fullscreen/app.py`.
- Agencia: `phoson_agent/agent.py` (`AgentEngine.stream`), `_loop.py`, `_tool_runner.py`.
- Plugins/UI neutra: `phoson_agent/cli_extensions.py`, `phoson_cli/plugin_ui.py`.
- Design system: `Phoson-Web/frontend/app/globals.css`, `components/ui/*`,
  `components/markdown-renderer.tsx`.

---

## 9. Validación contra el engine real (hecha)

Entorno: ventana del engine `.venv` (Python 3.12.13, engine importable),
sidecar lanzado con `PYTHONPATH=<Phoson-Desktop>/bridge python -m phoson_bridge`,
driver hablando NDJSON por stdio.

### 9.1 Correcciones aplicadas tras la validación

La API real difería de los supuestos iniciales y se corrigió el sidecar:

| Supuesto inicial | API real |
|---|---|
| `AgentTokenEvent.text` / `AgentReasoningEvent.text` | **`.content`** |
| `AgentToolStartEvent.arguments` | **`.args`** |
| `SessionMetrics.total_tokens` | **`total_input_tokens` + `total_output_tokens`** |
| `AttachmentManager.add/remove/sources` | **`attach(path)` / `clear()` / `list_pending()`** |
| `CommandSpec.name` | **`.names`** (tupla) |
| `copy.deepcopy(config)` | falla por `mappingproxy` en `_secret_sources` → usar `copy.copy` |

### 9.2 Resultados

- **`initialize`** → modelo real, **15 tools visibles + 70 enmascaradas**, **33
  comandos**, `defaultSessionId`, métricas. ✅
- **Multi-sesión** → `session.new` devuelve clave distinta a la default;
  `session.close` cierra solo esa sesión; docs de sesión desconocida → error. ✅
- **`session.list`** → **90 sesiones** guardadas leídas del `JsonlStorage` real. ✅
- **`session.planCompact` / `jumpCandidates` / `attachment.add`/`clear` /
  `model.set`** → OK. ✅
- **Errores**: método desconocido → JSON-RPC `-32601`; sesión desconocida →
  `-32000`. El bridge no se cae. ✅
- **Framing NDJSON**: **0 errores** en stdout, pese a que el engine MCP y los
  plugins escriben logs a stderr. ✅
- **Turno real end-to-end**: `turn.run` → `status:"done"`, `finalContent:"OK"`;
  eventos `AgentStartEvent` → `AgentTokenEvent` → `AgentStepDoneEvent` →
  `AgentDoneEvent` → `session.assistant.done`; tokens reconstruidos = `"OK"`. ✅
- **Observación a revisar en M2**: en ese turno `session.metrics` reportó
  `tokens=0, cost=$0.0` (probablemente el `UsageEvent` del proveedor no llegó en
  la ruta rápida, o falta entrada de `pricing` para el modelo). Verificar el
  cálculo de métricas con una respuesta más larga.

**Conclusión**: el sidecar funciona contra el engine real para todo el contrato de
M1+M2 (control-plane + streaming). Los únicos pendientes son de UI (M0/M2) y los
métodos de M3.
