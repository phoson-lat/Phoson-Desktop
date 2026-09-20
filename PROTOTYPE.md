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

### M0.5 — Render enriquecido en el thread
- [x] Portados `markdown-renderer.tsx` + `artifact-block.tsx` de Phoson-Web.
- [x] **Markdown completo**: `react-markdown` + `remark-gfm` (tablas, listas,
      tachado) + `remark-math`/`rehype-katex` (**LaTeX**).
- [x] **Código con resaltado** (`shiki`, temas github-dark/light según tema,
      detección de lenguaje, botón copiar).
- [x] **Mermaid**: fences ```mermaid → diagrama renderizado (import dinámico,
      tema claro/oscuro, toggle Diagrama/Código).
- [x] **Artifacts HTML**: fences ```html → tarjeta con vista aislada en diálogo.
- [x] Seguridad: `rehype-sanitize` con esquema extendido (MathML de KaTeX);
      sin scripts, iframes ni `javascript:`.
- [x] CSP de Tauri ampliado (`font-src 'self' data:`, `img-src … blob:`).
- [x] Mock actualizado para demostrar las 4 capacidades al enviar un mensaje.
- [ ] Optimizar bundle: shiki trae el bundle completo (1.2 MB en el chunk
      principal). Migrar a `shiki/bundle/web` o lenguajes explícitos.

### M0.6 — Demo de renderizado con streaming
- [x] `src/lib/demo-content.ts`: `DEMO_USER` (prompt detonante) + `DEMO_ASSISTANT`
      que ejercita GFM, KaTeX, shiki, mermaid y artifact HTML.
- [x] Enviar `Muéstrame una demo de todo lo que sabes renderizar.` (chip del
      welcome) → el mock **streamea** la demo token a token por el camino normal
      (`send` → `turn.run` → `agent.event`), no aparece de golpe.
- [x] Deep-link `?demo=1` para lanzar la demo automáticamente (útil para capturas
      y verificación).
- [x] **Bug corregido en `vite.config.ts`**: `ignored: ["**/bridge/**"]` también
      ignoraba `src/bridge/**`, así que los cambios en `client.ts`/`protocol.ts`
      **no recargaban** (HMR roto silenciosamente). Ahora es `"bridge/**"`
      (root-relative).
- [x] Verificado con Chromium headless (Playwright sobre los binarios cacheados):
      - Crecimiento del texto del agente: `0→55→112→183→314→…→813` (15 incrementos).
      - KaTeX aparece a mitad del stream; shiki y mermaid se finalizan al cerrar el
        turno (durante el stream se saltan por diseño).
      - Conteos finales: `h1` 1, shiki 1, mermaid SVG 1, katex 2, table 1,
        checkboxes 4, blockquote 1, link 1, artifact HTML presente. 0 errores de red.

### M0.7 — Correcciones de layout, scroll y animación
- [x] **El composer desaparecía y no se podía scrollear**: `<main>` y el
      contenedor de scroll necesitaban `min-h-0` (un flex item no puede encogerse
      por debajo de su contenido → el thread empujaba el composer fuera de la
      pantalla, recortado por el `overflow-hidden` del shell).
- [x] **`ScrollArea` de Radix sustituido** por un `div` con `overflow-y-auto`
      (`min-h-0 flex-1 overscroll-contain`). El Viewport de Radix reportaba
      `scrollHeight == clientHeight` y recortaba el contenido (`display: table`).
      Verificado: `scrollHeight 1406 > clientHeight 704`, auto-scroll al fondo.
- [x] **Animación al construir mermaid**: el hueco entre "termina el stream" y
      "mermaid listo" mostraba un `Rendering…` estático. Ahora reutiliza
      `MermaidBuilding` (skeleton animado + barrido `phoson-shimmer` + puntos
      `phoson-dots`), tanto durante el stream como mientras carga el chunk.
- [x] **Artifact HTML en tema oscuro**: el lienzo de un iframe usa el color por
      defecto del documento (`Canvas`, blanco), no el fondo del elemento → la
      preview salía blanca. Se inyecta el fondo del tema en el `srcDoc`. Verificado
      por píxel: `(17,17,18)`.
- [x] Alto de la preview 220 → 170 px.
- [x] `favicon.ico` 404 → `public/icon.svg` (isotipo de Phoson) declarado en
      `index.html`.

### M0.8 — Barra lateral estilo ChatGPT
- [x] **Rail al colapsar** (56 px, `w-14`) en vez de ocultarse: isotipo arriba
      (clic = expandir), iconos centrados (nueva sesión, buscar), y "cuenta"
      abajo. Replica el patrón de ChatGPT colapsado.
- [x] **Cabecera de la barra**: título "Phoson Desktop" + buscar + colapsar
      (`PanelLeft`). Se movió el control de colapso desde la cabecera principal
      (el logo sigue siendo el botón de expandir en el rail).
- [x] **Fila primaria** "Nueva sesión" (icono `SquarePen`), como "Nuevo chat".
- [x] **Secciones** en minúscula y tono muted: "Abiertas" / "Guardadas"
      (antes ABIERTAS/GUARDADAS en mayúsculas con tracking).
- [x] **Búsqueda** integrada: icono en cabecera → input que filtra sesiones
      abiertas y guardadas.
- [x] **Pie de cuenta** (modelo/proveedor + isotipo) **clicable → Ajustes**.
- [x] Verificado: rail `56px`, sin errores de consola.

### M0.9 — Onboarding de primera instalación
- [x] Backend: `initialize` ahora devuelve `{needed, providers}` usando
      `has_configured_provider` + `_provider_status` (nunca expone claves).
      Validado contra el engine real: `{needed:false, providers:[…]}`.
- [x] Wizard de 5 pasos (`features/onboarding.tsx`), pantalla completa:
      1. **Bienvenida** (qué es Phoson, qué se guarda en `~/.phoson`).
      2. **Proveedor + API key**: 16 proveedores con estado (✓ si ya hay clave),
         enlace "obtener" a la consola del proveedor, campo write-only.
      3. **Modelo**: lista viva vía `models.list` con búsqueda + entrada manual,
         útil si el proveedor no lista.
      4. **Preferencias**: tema (claro/oscuro/sistema vía next-themes) + modo seguro.
      5. **Listo**: resumen (proveedor/modelo/tema/modo seguro).
- [x] Persistencia: todo por `config.set` (mismo `config.toml` que el CLI) y flag
      `phoson.onboarded` en localStorage para no repetirlo.
- [x] Se muestra solo si `onboarding.needed` y no se ha completado; deep-link
      `?onboarding=1` para probarlo.
- [x] Verificado con Playwright recorriendo los 5 pasos: `onboardingGone:true`,
      composer presente, `flag=1`, 0 errores de consola.

### M0.10 — Onboarding: animaciones y diseño limpio
- [x] **Sin cajitas**: fuera el panel con borde; el wizard ocupa la pantalla
      completa (`max-w-7xl`, `min-h-full`). Los pasos 1 y 2 pasan a **dos
      columnas** (proveedores/modelos a la izquierda, formulario a la derecha
      separado por un hairline). Inputs **subrayados** (sin caja) en vez del
      `Input` con borde; el resumen final usa hairlines (`divide-y`), no un card.
- [x] **Textos animados**: `.phoson-text-in` (fade + subida + blur) con retardos
      escalonados por elemento (`at(ms)`); listas con `.phoson-stagger`; logo con
      `.phoson-pop`; puntos de progreso con `.phoson-dot-fill`. `key={step}`
      re-dispara las animaciones al cambiar de paso.
- [x] `prefers-reduced-motion` sigue cubierto por el override global de
      `globals.css`.
- [x] Estilo: selección con punto violeta + texto, hover sutil; sin bordes ni
      rellenos de tarjeta.

### M0.11 — Logos de proveedor (LobeHub Icons)
- [x] Fuentes evaluadas: **svgl.app** (`https://api.svgl.app?search=…` devuelve
      JSON con SVG light/dark) y **icons.lobehub.com**. Se eligió **LobeHub Icons**
      porque ya mapea por clave de proveedor y tiene los 16 que usamos.
- [x] Descartado `@lobehub/icons` (React): arrastra **antd + @lobehub/ui** como
      peers. Se usa `@lobehub/icons-static-svg` como **devDependency**.
- [x] `scripts/gen-provider-icons.mjs` (`pnpm gen:icons`) genera
      `src/components/provider-logos.ts` con los SVG inline. Los monocromo usan
      `fill="currentColor"` → heredan el color del texto (tema claro/oscuro y
      estado seleccionado) sin filtros ni variantes.
- [x] `components/provider-logo.tsx` (`<ProviderLogo id size>`): 16 proveedores,
      con fallback silencioso si no hay logo (p.ej. OmniRoute).
- [x] Integrado en: onboarding (lista de proveedores; el seleccionado se pinta en
      violeta), Ajustes (claves) y el trigger del selector de modelo.
- [x] Licencia: LobeHub Icons es MIT; atribución en la cabecera del archivo
      generado.

### M0.12 — Los 20 proveedores + `base_url`
- [x] Validado contra el engine: los 20 existen. Faltaban **Ollama, GitHub Models,
      LM Studio, AWS Bedrock**.
- [x] Modelo de proveedor en el bridge basado en el engine:
      `_PROVIDERS = {id: {key, base_url}}`. Hallazgos del engine:
      - `NO_CREDENTIAL_PROVIDERS` = `lmstudio, bedrock, omniroute, ollama, aws, vllm`.
      - Solo 4 tienen `*_base_url`: **ollama, lmstudio, vllm, omniroute**.
      - **GitHub Models** usa `github_token` (no `*_api_key`).
      - **AWS Bedrock** no tiene campo: usa la cadena de credenciales de AWS.
- [x] `_provider_status` devuelve `supportsKey`, `supportsBaseUrl` y el valor de
      `baseUrl` (no secreta). `config.set` acepta `base_urls` y persiste el campo
      correcto; reconstruye el cliente también al cambiar una URL.
- [x] Onboarding: los **20 en el orden pedido**, con logo, y formulario
      contextual → clave (si aplica) + **Base URL** (con default local:
      ollama `:11434`, lmstudio `:1234/v1`, vllm `:8000/v1`, omniroute `:3000/v1`);
      Bedrock muestra la nota de credenciales AWS.
- [x] Ajustes: "Claves de API" solo para proveedores con clave + nueva sección
      **Servidores locales** con los 4 `base_url`.
- [x] Verificado: `initialize.onboarding.providers` → **20/20** con flags correctos
      y leyendo tus `base_url` reales (vLLM `:8383/v1`, OmniRoute `192.168.1.178`).
      UI: vLLM key+url, Ollama solo url, Bedrock solo nota. 0 errores.

### M0.13 — Selector de sub-agente en el onboarding
- [x] Los íconos que faltaban: el generador solo mapeaba 16 ids → añadidos
      **github, lmstudio, bedrock** (19 en total). **OmniRoute** no existe en
      LobeHub → `ProviderLogo` usa un glifo de respaldo (`Route` de lucide) para
      que ninguna fila quede sin icono.
- [x] Paso "Modelo" ahora es **"Elige los modelos"** con un **conmutador de
      objetivo**: dos tarjetas (Modelo principal / Modelo de sub-agentes) que
      muestran su valor; el listado y el campo manual editan el objetivo activo.
- [x] Se precargan ambos desde `config.get` (`model` / `subagentModel`).
- [x] `config.set` guarda `model` y `subagent_model` por separado (ambos ya
      estaban en `_SAFE_FIELDS`).
- [x] Resumen final con las dos filas.
- [x] Verificado: selección independiente
      (`principal=deepseek-v4.1-flash`, `sub-agentes=gpt-5.2-codex`) y resumen con
      ambos. 0 errores.

### M0.14 — Selector de modelo en el composer + esfuerzo tipo "brillo"
- [x] El **selector de modelo se movió del header al composer** (junto al clip),
      como en ChatGPT: `[📎] [logo proveedor + modelo ▼] [esfuerzo] … [enviar]`.
      El header conserva el HUD (ctx/tok/$), Ajustes y tema.
- [x] **Esfuerzo de razonamiento** como control de brillo/volumen
      (`features/reasoning-effort.tsx`):
      - Trigger con **barras de nivel** que se encienden y ganan glow al subir,
        + etiqueta ("Bajo/Medio/Alto/Muy alto/Máximo/Auto").
      - Popover con **Slider** (Radix) de 5 pasos + etiquetas y opción **Auto**
        (usa el perfil del modelo).
      - Escribe `config.reasoning_effort`; el engine lo consulta en vivo
        (`make_live_scheduler`), así que aplica sin reiniciar.
- [x] Valores tomados del engine: `phoson_llm.schemas.REASONING_EFFORTS`
      = `low, medium, high, xhigh, max` → `src/lib/reasoning.ts` (fuente única).
- [x] **Corrección**: Ajustes ofrecía `"off"`, que no es un valor del engine
      (el "off" del CLI equivale a `None`). Ahora usa la misma lista + **Auto**.
- [x] Verificado con Playwright: modelo dentro del composer y ausente del header;
      esfuerzo `Medio → Máximo` (tecla End) `→ Muy alto` (ArrowLeft). 0 errores.

### M0.15 — Animación de velocidad (partículas)
- [x] **Partículas de velocidad** en el control de esfuerzo
      (`SpeedParticles`): estelas violetas que cruzan el medidor; el **nivel
      escala densidad, velocidad, longitud de estela y glow**:
      - 7 partículas @ 1.98 s (medio) → **13 @ 0.72 s** (máximo).
      - Desvanecido en el borde derecho; `animationDelay` negativo para que
        arranquen repartidas (no todas a la vez).
- [x] **Barrido del composer** mientras el agente trabaja: `phoson-sending`
      pinta una línea de gradiente violeta que recorre el borde superior
      (`phoson-sweep`), como señal de "en marcha".
- [x] React: se usan propiedades largas (`animationName`/`Duration`/`Delay`) en
      vez del shorthand para evitar el warning de colisión de estilos.
- [x] `prefers-reduced-motion` sigue neutralizando todo (override global).
- [x] Verificado: 0 errores de consola; capturas `/tmp/pop-max.png` y
      `/tmp/composer-sending.png`.

### M0.16 — Color por nivel + relleno del medidor
- [x] **Espectro frío → caliente** por nivel (`EFFORT_COLORS` en
      `src/lib/reasoning.ts`): `low #38bdf8` (cielo) · `medium #5b2eff` (brand) ·
      `high #a855f7` · `xhigh #f59e0b` · `max #ef4444`; `auto` → neutro.
- [x] El color tiñe todo el control: gauge, barras, partículas, etiqueta y el
      **Slider** (`.effort-scope` sobreescribe `[data-slot=slider-range]` y
      `slider-thumb` con `--effort-color`).
- [x] El medidor ahora se **rellena**: la pista llena de izquierda a derecha
      (20% → 100%) con degradado del color del nivel y un **borde luminoso** en
      el punto de relleno. Transición suave de 300 ms.
- [x] Verificado nivel a nivel:
      `fill 20/40/60/80/100%` y `particle·range = #38bdf8 → #5b2eff → #a855f7 →
      #f59e0b → #ef4444`. 0 errores. Capturas `/tmp/effort-0.png` … `-4.png`.

### M0.17 — Medidor de contexto (loader) + acciones en la barra
- [x] **`ContextMeter`** (sustituye a `MetricsBar`): **anillo de progreso**
      estilo loader con el % de contexto usado; el color del anillo escala
      (violeta → ámbar ≥70% → rojo ≥90%) y **gira mientras el agente trabaja**
      (`isRunning`).
- [x] **Al hacer hover se despliega** un `HoverCard` con el detalle: barra de
      consumo, en uso/disponible/ventana, tokens (in/out), coste, pasos, modelo,
      proveedor y estado.
- [x] **Ajustes y tema movidos del header a la barra lateral**: en el pie
      (identidad modelo/proveedor + ☀ tema + ⚙ ajustes) y también en el rail
      colapsado. El header queda con título + medidor.
- [x] Verificado: `meterInHeader:true`, `settingsInHeader:false`,
      `themeInHeader:false`, `settingsInSidebar:true`, `themeInSidebar:true`;
      el hover despliega el detalle y Ajustes abre desde la barra. 0 errores.

### M0.18 — Modal de configuración por secciones
- [x] **Dos paneles**: nav lateral con 5 secciones + contenido con scroll propio
      (modal a 768px; el `sm:max-w-lg` de shadcn requería `sm:max-w-3xl`).
- [x] Secciones: **Modelos** (proveedor activo, modelo principal, sub-agentes,
      esfuerzo) · **Proveedores** (claves) · **Servidores locales** (base_url) ·
      **Agente y sesiones** (modo seguro, notificación, carpeta) · **Apariencia**
      (tema claro/oscuro/sistema).
- [x] Metadatos de proveedor extraídos a `src/lib/providers.ts`
      (`PROVIDER_META`, `BASE_URL_DEFAULTS`, `providerLabel`) y compartidos con el
      onboarding (antes duplicados).
- [x] En Proveedores: logo + etiqueta + procedencia + **enlace "obtener"** +
      input write-only. Nota de AWS Bedrock al pie.
- [x] Verificado: 5 secciones con sus controles (Modelos: 2 inputs/2 selects;
      Proveedores: 16 claves; Locales: 4 URLs; Agente: switch+select+input;
      Apariencia: 3 botones). 0 errores.

### M0.19 — Mini explorador de archivos (workspace)
- [x] Hallazgo del engine: `tree.cwd` se fija al crear la sesión desde
      `Path.cwd()` y **los tools resuelven rutas relativas contra el cwd del
      proceso** → en escritorio el cwd del sidecar es el *workspace* real.
- [x] RPC nuevos: `fs.cwd`, `fs.list {path}` (dirs primero, omite
      `.git`/`node_modules`/`__pycache__`/`.venv`/caches, cap 400 entradas) y
      `fs.setCwd {path}` (hace `os.chdir` y actualiza `tree.cwd` de la sesión
      por defecto). Validado contra el engine: 38 entradas, error claro en
      carpeta inválida.
- [x] `FileExplorer`: panel lateral con **espacio de trabajo**, **migas de pan**
      clicables, navegación (carpetas) y tamaños de archivo. Botón "Usar esta
      carpeta" cuando el directorio navegado no es el workspace.
- [x] El **header** muestra el workspace (chip `📁 proyecto · listo`) que abre el
      explorador; al fijar otro workspace se actualiza y avisa con un toast.
- [x] FS virtual en el mock para que funcione en el navegador sin sidecar.
- [x] Verificado: chip `proyecto`, navegación a `src`, `Usar esta carpeta` →
      chip `src` + toast. 0 errores.

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
