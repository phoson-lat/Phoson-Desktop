# Bosquejo de prototipo — estado y TODO

Esqueleto del plan (`../PLAN.md`), **alcance M1+M2**. Decisiones aplicadas:
MVP M1+M2 (#1), binarios de GitHub (#2), reutilizar `PhosonRepl` (#3), sin LLM
local (#4), multi-sesión (#5).

## ✅ Validado contra el engine real (2026-09-19)

El sidecar se probó contra `phoson-engine-minimal` (Python 3.12.13) por stdio.
Detalle completo en `../PLAN.md §9`. Resumen:

- `initialize` → 15 tools visibles + 70 enmascaradas, 33 comandos, métricas. ✅
- Multi-sesión (`session.new/open/close`) con `PhosonRepl` por sesión. ✅
- `session.list` → 90 sesiones reales del `JsonlStorage`. ✅
- `planCompact` / `jumpCandidates` / `attachment.add`/`clear` / `model.set`. ✅
- Errores JSON-RPC correctos; **0 errores de framing** en stdout. ✅
- **Turno real end-to-end**: tokens reconstruidos = `"OK"`, `status:"done"`. ✅

Reproducir:

```bash
cd ../phoson-engine-minimal   # o cualquier venv con el engine instalado
PYTHONPATH=../Phoson-Desktop/bridge \
  .venv/bin/python ../Phoson-Desktop/bridge/tests/smoke.py
# añade --turn para hacer 1 llamada mínima al LLM (coste ~0)
```

## Qué ya está esbozado

- `bridge/` — sidecar Python (`phoson-bridge`):
  - `protocol.py` — normalizador de dataclasses/eventos a JSON (`type` = clase).
  - `sink.py` — `GuiSink` (`AgentEventSink`), enruta por `sessionId`, acumula
    reasoning (`.content`).
  - `confirmation.py` — `GuiConfirmation` (`ConfirmationService`).
  - `server.py` — `SessionManager` (un `PhosonRepl` por sesión) + loop JSON-RPC.
  - `__main__.py` — aísla stdout (protocolo) de los prints de plugins.
  - `tests/smoke.py` — arnés de validación NDJSON.
- `src-tauri/` — Rust: spawn del sidecar, relay NDJSON, `rpc()` con futures.
- `src/` — React: `bridge/client.ts`, `bridge/protocol.ts`, `stores/session.ts`
  (multi-sesión, coalescing de tokens por rAF), `App.tsx` mínimo.

## Flujo de un turno (validado)

```
Composer → useSession.send(text)
   → invoke('rpc', {method:'turn.run', params:{sessionId, text}})
      → Rust: línea JSON al stdin del sidecar
         → PhosonRepl._run_agent(text) → SessionController.run_turn
            → GuiSink.on_event(event) → notificación 'agent.event' {sessionId, event}
   ← Rust lee stdout, reemite 'phoson://message'
      ← useSession.handleEvent() actualiza la vista de esa sesión
   ← respuesta del request + 'session.assistant.done'
```

## TODO por hito

### M0 — Andamiaje + design system
- [x] Portado `Phoson-Web/frontend/app/globals.css` (695 líneas, tokens violeta +
      `dashboard-*` + CSS de chat) → `src/styles/globals.css`.
- [x] Portados **54 primitivas** shadcn (`src/components/ui/`), `lib/utils.ts`
      (`cn`), `hooks/use-mobile.ts` y `phoson-logo.tsx`.
- [x] `@` alias en Vite, fuente DM Sans por `<link>`, shim `src/styles/app.css`.
- [x] **Modo mock** del bridge (`pnpm dev` en navegador, sin Tauri ni Python).
- [x] UI real: sidebar de sesiones, header con HUD (modelo/contexto/tokens/coste),
      chat con burbujas + tool cards, welcome animado, composer.
- [x] `pnpm install` + `vite build` + `tsc --noEmit` → **0 errores**.
- [ ] Compilar `src-tauri` (`pnpm tauri dev`) contra el sidecar real.
- [ ] Renderer markdown completo (react-markdown + shiki + KaTeX) y panel de
      plugins/wakes (M4).

### M0.1 — "Phoson Quiet" (simplificación visual)
- [x] Pasada inspirada en Codex (OpenAI) y Claude (Anthropic): superficies
      **planas + hairlines**, fuera `blur(24px)`, sombras y glow; **un solo
      accent** (violeta) para selección/foco/envío; radios contenidos.
- [x] Conmutable en caliente (`src/styles/quiet.css` + `useUiStyle`, botón 🎨 en
      la cabecera; persiste en `localStorage`). Default: `quiet`.
- [x] **Opción B**: mensaje de usuario **sin burbuja** (bloque a la derecha, texto
      legible), solo el agente con tarjeta.
- [x] HUD rediseñado: `MetricsBar` (micro-labels `ctx`/`tok`/`$`, tabular-nums,
      separadores finos, sin iconos ni cajas) en lugar de 4 badges.
- [x] Badge quiet = chip limpio (pill + hairline, sin relleno).

### M0.2 — Tema único, claro/oscuro, móvil y selector de modelo
- [x] **Quiet horneado**: eliminado `quiet.css` + `useUiStyle` + toggle. Ahora
      `src/styles/theme.css` aplica las reglas **incondicionalmente** (fuente de
      tokens sigue siendo `globals.css`).
- [x] **Burbuja de usuario con hairline** (sin gradiente): `chat-bubble-user`
      redefinida como superficie plana + borde 1px.
- [x] **Modo claro**: `next-themes` (`attribute="class"`) en `main.tsx` +
      `ThemeToggle` en la cabecera; tokens `:root`/`.dark` en `theme.css`.
- [x] **Móvil**: `useIsMobile` + sidebar como cajón superpuesto (backdrop +
      `translate-x`), botón menú, header/composer adaptativos.
- [x] **Selector de modelo**: nuevo RPC `models.list` (envuelve
      `list_available_models` del engine) + `ModelPicker` (Popover + Command/cmdk,
      búsqueda fuzzy, contexto y precio). Validado: **446 modelos** de OpenRouter.
- [x] Tras `model.set`/`provider.set` el sidecar emite `session.metrics` → el HUD
      se actualiza sin round-trip extra.

### M0.3 — Barra lateral, centrado, configuración
- [x] **Selector de modelo con etiqueta** siempre visible (móvil incluido).
- [x] **Barra lateral con sombra** (`--phoson-sidebar-shadow`, única superficie
      elevada) y **colapsable** en escritorio (ancho animado + botón `PanelLeft`,
      persistido en `localStorage`).
- [x] **Thread vacío centrado**: el welcome se renderiza fuera del `ScrollArea`,
      en un contenedor `flex-1` centrado verticalmente.
- [x] **Panel de configuración** (`SettingsDialog`): proveedor, modelo, modelo de
      sub-agentes, esfuerzo de razonamiento, modo seguro, notificación, carpeta de
      sesiones y **claves de API (write-only)**.
- [x] RPC `config.get` / `config.set` en el sidecar (envuelve
      `save_config(only_fields=…)`); los secretos nunca se envían al renderer.
      Validado contra el engine real.
- [x] Corrección: `notify_on_completion` es **string** (`off`/`bell`/`desktop`),
      no booleano → Select en vez de Switch.

### M0.4 — Thread limpio (estilo ChatGPT)
- [x] **Bug corregido**: React StrictMode montaba dos veces y `init()` se
      suscribía dos veces → cada notificación se aplicaba por duplicado (texto
      repetido, tool cards x2). Ahora `attach()` tiene guard + `init()` memoizado
      con `bootPromise`.
- [x] Agente **sin tarjeta**: texto plano sobre el fondo (`MarkdownLite`
      reescrito, basado en líneas y robusto en streaming: fences sin cerrar,
      títulos, listas, inline `code`/**bold**/*italic*).
- [x] Bloque de código con etiqueta de lenguaje y contenedor neutro.
- [x] Tool calls como fila discreta expandible (sin relleno ni borde).
- [x] Burbuja de usuario más redonda y con el mismo tamaño de texto que el agente.
- [x] Más aire: `gap-6`, `py-8` en escritorio.
- [x] Barra lateral **sin logo/título** (solo el botón *Nueva sesión*); el logo
      Phoson aparece en el botón de colapsar de la cabecera.

### M1 — Puente
- [x] Framing NDJSON, spawn/relay en Rust, `rpc()`.
- [x] Aislar stdout del engine (logs a stderr).
- [ ] Probar el relay Rust en vivo (requiere compilar Tauri + node_modules).

### M2 — Sesión real
- [x] Sidecar con `PhosonRepl` + `GuiSink` + `run_turn` + multi-sesión.
- [x] `session.list` / `session.open` (replay vía `print_history`).
- [ ] UI de sidebar de sesiones + render de `session.history`.
- [ ] Verificar métricas: en el turno de prueba `cost=$0.0, tokens=0`
      (posible `UsageEvent` ausente o falta de `pricing`); revisar con respuesta
      larga.

### Backlog (M3+)
- `GuiCommandHost` + `CommandHandler` (los `/comandos`): instanciar
  `PhosonRepl` (ya se hace) y pasar un host de UI; implementar `command.execute`.
- Diálogo de permisos real, `ToolCallCard`, HUD, plugin UI, tray, updater.

## Notas / hallazgos

1. **`PhosonRepl` es reutilizable headless**: su `__init__` construye un `Renderer`
   de Rich pero **no** crea `PromptSession` (eso vive en `run()`). Se usa como
   motor de sesión; sus passthroughs son justo lo que los `/comandos` esperan.
2. **Un solo event loop**: todo vive en `asyncio.run()` del sidecar.
3. **Multi-sesión**: un `PhosonRepl`/controller por sesión (single-flight por
   instancia). Cada uno usa `copy.copy(config)` (el config trae un `mappingproxy`
   que rompe `deepcopy`).
4. **stdout = protocolo**: mitigado en `__main__.py`; validado (0 errores).
5. **Fail-closed**: el sidecar siempre inyecta `GuiConfirmation`.
