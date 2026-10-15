# Rendimiento — método y línea base (alpha)

> Objetivo de la primera alpha: entender **arranque**, **tiempo de cada acción**
> y **consumo de RAM/CPU**, y fijar presupuestos. Este doc describe cómo medir y
> deja una línea base reproducible.

---

## 1. Qué se puede medir (instrumentación ya en el código)

### Frontend — `window.phosonPerf`

Módulo `src/lib/perf.ts` (ligero, sin red). Desde la **consola del webview**
(DevTools de la app):

```js
phosonPerf.summary()   // tabla agregada por nombre (count/avg/max/last/total)
phosonPerf.slowest(20) // las 20 muestras más lentas
phosonPerf.snapshot()  // crudo: { marks, samples, uptimeMs }
phosonPerf.marks()     // hitos de arranque
phosonPerf.reset()
```

Hitos de arranque (`marks`), en ms desde el *time origin* de la webview:

| Mark | Cuándo |
|---|---|
| `ui:main-eval` | La webview empieza a ejecutar el bundle. |
| `ui:render-queued` | Se pide el primer render de React. |
| `ui:app-mounted` | `App` montado (efecto). |

Muestras (`samples`):

| Sample | Qué mide |
|---|---|
| `app:ready` | ms desde el arranque hasta `initialize` OK (= app usable). |
| `rpc:<método>` | Duración de **cada** llamada al sidecar (todas pasan por `TauriBridge.rpc`). |

### Sidecar (Python) — logs `[perf]` + RPC `perf`

- `bridge/phoson_bridge/server.py` escribe en **stderr**:
  - `[perf] bridge.init <ms>` — construcción del `PhosonRepl` inicial.
  - `[perf] <método> <ms>` — siempre `initialize`/`turn.run`; el resto solo si ≥50 ms.
- RPC `perf` → `{ pid, rssBytes, cpuUserSec, cpuSystemSec, uptimeSec }`.
  Desde el frontend: `phoson.perf()`.

### Procesos (RAM/CPU del sistema) — `scripts/perf-sample.sh`

```bash
scripts/perf-sample.sh 30                 # 30 s, patrón "phoson"
scripts/perf-sample.sh 20 phoson-bridge   # solo el sidecar
```

Muestrea RSS y CPU por segundo de los procesos que casan con el patrón y da un
resumen (RSS pico, CPU media). En la app conviven: proceso Tauri, webview(s) y el
sidecar.

---

## 2. Cómo medir arranque (pasos)

1. Arranca la app: `pnpm tauri dev` (o el binario de release).
2. Abre DevTools → consola:
   - `phosonPerf.marks()` → descomposición del arranque.
   - `phosonPerf.summary()` → coste de las RPC iniciales.
3. En paralelo, en otra terminal: `scripts/perf-sample.sh 30`.
4. Anota: `app:ready`, `ui:main-eval`, RSS pico, CPU media.

Repite **3 veces en frío** (cerrando el proceso entre medias) y quédate con la
mediana.

---

## 3. Línea base (2026-10-04, Linux, dev)

Medido sin GUI (bundle + engine); los tiempos de la app se rellenan al ejecutar
el paso §2.

| Métrica | Valor | Nota |
|---|---|---|
| Bundle de entrada `index-*.js` | **~1.35 MB** (426 KB gzip) | React + shadcn + código de la app |
| `mermaid.core` (chunk aparte) | 683 KB (169 KB gzip) | carga diferida |
| `cytoscape` (chunk aparte) | 443 KB (142 KB gzip) | carga diferida |
| CSS | 178 KB (32 KB gzip) | |
| Build `vite build` | ~13–20 s | dev local |
| Import `phoson_cli.repl` (cold) | **~0.33 s · 44 MB RSS** | coste de importar el engine |
| Import base engine+swarm | ~0.13 s · 23 MB RSS | |
| `app:ready` (cold start) | _pendiente de medir con GUI_ | usar §2 |
| RSS total en reposo | _pendiente_ | usar §1 |
| CPU en reposo | _pendiente_ | usar §1 |

> Efecto secundario de dejar swarm en «próximamente»: al no importarse desde
> `App`, `@xyflow/react` salió del bundle de entrada y este bajó ~1.6 MB → ~1.35 MB.

---

## 4. Hallazgos del primer run real (2026-10-04, `pnpm tauri dev`)

Del log de `[perf]` del sidecar:

| Llamada | Tiempo | Comentario |
|---|---|---|
| `session.list` | **3294 / 3245 / 3298 / 3255 / 1763 / 1381 / 1387 / 620 ms** | **el gran problema**: se llama en ráfaga (welcome + sidebar + palette + cambios de workspace) y cada una re-lee los 144 `.jsonl` |
| `bridge.init` | ~1264–1388 ms | construcción del `PhosonRepl` inicial (1 por workspace) |
| `turn.run` | 2187 ms | red (LLM), esperado |
| `stt.status` | 163 / 125 ms | sondeo del motor de voz |
| `models.list` / `model.set` | 438 / 414 ms | red (openrouter) |
| `session.open` | 360 ms | |
| `initialize` | 1 ms | |

Medido aparte: `list_session_metas` sobre los 144 ficheros (48 252 líneas) = **~608 ms en caliente**; los ~3.2 s son frío + varios sidecars escaneando a la vez.

### Fix aplicado (app-side, `bridge/phoson_bridge/server.py`)
- **Caché de `session.list`** con TTL de 4 s, **invalidada** al mutar (`turn.run`, `session.delete/new/undo/rewind/compact`). Las ráfagas del frontend comparten una sola lectura.
- **Caché de `stt.status`** (TTL 5 s).

### Pendiente (engine-side, el fix de raíz)
`list_session_metas` **parsea cada línea** de cada `.jsonl` para contar mensajes / `created_at`. Con historiales grandes es O(nº de líneas). Propuestas para el equipo del engine:
- persistir un **fichero `.meta.json`** por sesión (o un índice) que evite el escaneo completo;
- o sacar `message_count`/`created_at` de un registro `session_meta` al final del fichero leyendo solo la cola.

### Levers restantes (medir antes/después)
- `models.list` (red, ~430 ms): cachear la lista de modelos por proveedor (p. ej. 5 min).
- `bridge.init` (~1.3 s por workspace): diferir la construcción del `PhosonRepl` hasta el primer `turn.run`, o compartir una instancia si el engine lo permite.

---

## 5. Presupuestos para la alpha (objetivo)

| Métrica | Objetivo | Tope duro |
|---|---|---|
| Cold start (`app:ready`, release) | ≤ 2.5 s | 4 s |
| `initialize` (bridge) | ≤ 1.5 s | 3 s |
| Primera acción tras ready (p. ej. `session.list`, en caliente) | ≤ 300 ms | 800 ms |
| `session.list` en frío (1ª vez) | ≤ 1.5 s | 3 s |
| RSS total en reposo | ≤ 450 MB | 700 MB |
| CPU en reposo | ≤ 3 % | 8 % |

> Medir el cold start en el **build de release** (no en `dev`, que es más lento
> por StrictMode y sin minificar). Método en §2.

---

## 6. Arranque del sidecar congelado: causa raíz y fix (2026-10-15, macOS arm64)

**Síntoma**: la app abre la ventana en ~1–2 s, pero el primer `initialize` al
sidecar empaquetado (PyInstaller onefile, 58 MB) tardaba **~10.5 s** en cada
arranque. En dev (`python -m phoson_bridge`) el mismo arranque cuesta ~0.7 s.

**Diagnóstico** (con `sample` sobre el proceso hijo del bootloader):

- Extracción onefile: ~240 ms (no era el problema).
- El resto (~10 s) se iba en `dlopen → dyld mapSegments → fcntl`: el kernel de
  macOS **validando la firma de cada `.so`** (91 libs + Python.framework).
- El onefile re-extrae copias **nuevas** en `${TMPDIR}/_MEI…` en cada arranque:
  vnodes nuevos → el kernel revalida todas las firmas cada vez. El trabajo real
  de importar es ~0.2 s (comprobado: onedir en caliente arranca en 0.19 s).
- Un onefile mínimo ("hello") tarda ~2.5 s fijos; un onefile de 58 MB con 50 MB
  de datos inerte, lo mismo: el coste escala con el **número de `.so`**, no con
  el tamaño del binario.

**Fix**: migrar el sidecar de onefile a **onedir**, empaquetado como
`bundle.resources` (antes `externalBin`, que exigía un único binario). Los
archivos quedan dentro del bundle y el kernel cachea la validación por vnode:
solo el **primer** arranque tras instalar paga el coste.

**Verificación del bundle real** (2026-10-15, `.app` construido con
`pnpm tauri build --config src-tauri/tauri.release.conf.json`, firma ad-hoc):

| Escenario | `initialize` (spawn → respuesta) |
|---|---|
| onefile, cada arranque | ~10.2 s |
| **onedir, 1.er arranque** (máquina ya "caliente") | ~1.1 s |
| **onedir, arranques siguientes** | **~0.45 s** |
| onedir, desde la `.app` real (RPC del front) | ~0.33 s |
| onedir, app instalada vía updater (`/Applications`) | **~0.45 s** |
| dev (venv del engine) | ~0.7 s |

> El 1.er arranque medido (~1.1 s) es optimista: esta máquina ya había validado
> vnodes equivalentes de builds anteriores. En una instalación limpia el primer
> arranque paga la validación de firmas una única vez (del orden de segundos);
> todos los siguientes quedan en ~0.4–0.5 s.

**Nota de build (gotcha local)**: si una build anterior de la era onefile dejó
`src-tauri/target/release/phoson-bridge` como *archivo* (el sidecar onefile de
`externalBin`), la nueva build falla en `tauri-build` con
`Not a directory (os error 20)` al copiar los recursos (el árbol onedir quiere
crear el *directorio* `phoson-bridge/` en esa misma ruta). Solución: borrar ese
archivo (o `cargo clean`). No ocurre en CI, que siempre parte de un `target/`
limpio.

Idle del sidecar (engine construido, sin actividad): **178 MB RSS, 0 % CPU**
(60 s de muestreo) — referencia para valorar alternativas tipo daemon.

## 5.b Estado de las mejoras de rendimiento

- ✅ `session.list`: caché + single-flight (bridge) → de ~3.2 s × N a ~0 salvo la
  primera lectura.
- ✅ `stt.status`: cacheado.
- ✅ `models.list`: caché por proveedor + single-flight (5 min; los fallos de red
  no se cachean).
- ✅ Coalescido de tokens (bridge): el motor emitía un `agent.event` POR token
  (cientos de IPC/segundo); ahora se acumulan 30 ms por sesión y salen como una
  sola notificación (`_TOKEN_BATCH_SECONDS`, pruebas en
  `bridge/tests/test_token_batch.py`). El orden se conserva: cualquier evento
  no-token de la misma sesión vuelca el buffer antes de sí mismo.
- ✅ Code-splitting de ventanas/dialogos (`SettingsDialog`, `CodeViewer`,
  `FileExplorer`, `Onboarding` con `React.lazy`): la entrada baja de ~1.41 MB a
  ~1.33 MB (min) y shiki core/temas dejan de ser críticos. `CommandPalette`
  queda eager: registra el atajo Ctrl+K aunque esté cerrado.
- ✅ `fs.read` parcial: antes cargaba el archivo COMPLETO en memoria antes de
  rebanar a 512 KB (un log de 2 GB congelaba el sidecar); ahora lee solo los
  primeros bytes y el corte a mitad de un carácter UTF-8 ya no marca el archivo
  como binario (decodificador incremental).
- ✅ Reaper de sidecars inactivos (Rust): cierra el sidecar de un workspace sin
  actividad 30 min (`PHOSON_BRIDGE_IDLE_SECS`), salvo el más recientemente
  usado y los que tienen RPC en vuelo. Terminación silenciosa (`idle: true` en
  `phoson://terminated`): el sidecar se respawnea al volver a usarlo.
  **Verificado en vivo** (release, `PHOSON_BRIDGE_IDLE_SECS=180`): expulsión
  del sidecar idle a los 235 s, nivel `info` en los tres logs (reaper, pump,
  front), sin toast; el sidecar activo sobrevivió un `turn.run` de 8.9 min.
  Frente a la build instalada (sin reaper): esta retiene ~3 sidecars
  (~230 MB de Python) para siempre; con reaper queda solo el activo.
- ✅ Logger sin `setInterval`: el volcado es perezoso (timer solo cuando hay
  eventos pendientes) + `visibilitychange`.
- ⏳ Root fix engine-side del listado (`.meta.json` por sesión) — pendiente.
- ⏳ `manualChunks` para vendor — pendiente.

### 5.c Mediciones release vs instalada (2026-10-12, misma sesión)

| Métrica | Instalada (29/09) | Nueva (repo) |
|---|---|---|
| Main exe (Rust) | 58.5 MB | **30.5 MB** |
| Renderer webview | 257.8 MB (2h25m de uso) | **137.7 MB** (11 min) |
| Sidecars vivos (2 workspaces + default) | 3 árboles, ~230 MB retenidos | **1 árbol** tras expulsión del idle |
| Entry chunk | 1,414.94 kB (gzip 443.74) | **1,332.47 kB** (gzip 418.96) |
| `initialize` (bridge, arranque) | — | 3.9–4.2 s (venv dev; empaquetado difiere) |
| Cold start a página cargada | — | < 0.4 s (assets embebidos) |

> Ojo al medir: `cargo build` a secas produce un binario **dev** que pide
> `localhost:1420` (ERR_CONNECTION_REFUSED). Para probar release fuera del CLI
> hay que compilar con `--features tauri/custom-protocol` y el `dist/` recién
> construido; mejor aún `pnpm tauri build`.


---

## 6. Palancas de optimización (candidatas, medir antes/después)

1. **Code-splitting de vistas pesadas**: `CodeViewer`, `SettingsDialog`,
   `CommandPalette`, `FileExplorer`, `Onboarding` y el render de *artifacts*
   (mermaid) con `React.lazy` + `Suspense`. La entrada es 1.35 MB; mover esto
   reduce el arranque.
2. **`manualChunks` en Vite** para separar vendor (react, radix, lucide).
3. **Iconos**: `lucide-react` importa por icono, pero conviene revisar imports
   estrella; un plugin de tree-shaking de iconos ayuda.
4. **Sidecar**: el `bridge.init` construye un `PhosonRepl` antes de responder;
   medir y, si pesa, diferir la construcción hasta el primer `turn.run`.
5. **StrictMode** solo afecta a dev (doble render); no penaliza release.
6. **Shiki**: ya carga lenguajes/temas bajo demanda; mantener así.

---

## 7. Cómo verificar una mejora

1. Guarda la línea base (`phosonPerf.snapshot()` a JSON + resumen del sampler).
2. Aplica el cambio.
3. Repite §2 (misma máquina, mismo nº de repeticiones).
4. Compara `app:ready`, RSS pico y CPU media contra §4.
