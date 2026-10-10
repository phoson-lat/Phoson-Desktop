# Registro de acciones (telemetría local)

Phoson Desktop registra cada acción relevante en un archivo **JSONL rotativo**
en el equipo del usuario. Sirve para analizar calidad: qué se usa, cuánto tarda,
qué falla. **Nada se envía a ningún sitio.**

## Dónde se guarda

- Windows: `%APPDATA%\com.phoson.desktop\logs\phoson-desktop.jsonl`
- macOS: `~/Library/Logs/com.phoson.desktop/phoson-desktop.jsonl`
- Linux: `~/.config/com.phoson.desktop/logs/phoson-desktop.jsonl`

El archivo activo rota a los **8 MiB** y se conservan **4** archivos rotados
(`phoson-desktop.<timestamp>.jsonl`).

En la app: **Ajustes → Acerca de → Registro de acciones → Abrir carpeta**.

## Formato

Una línea por evento:

```json
{"ts":1759190000000,"iso":"2026-09-29T…Z","level":"info","src":"rpc",
 "event":"rpc","up":1234,"session":"abc","workspace":"C:\\proj",
 "data":{"method":"session.prompt","ok":true,"ms":18,"params":{…}}}
```

| campo     | descripción                                            |
| --------- | ------------------------------------------------------ |
| `ts`/`iso`| instante del evento                                     |
| `level`   | `debug` \| `info` \| `warn` \| `error`                  |
| `src`     | `app` \| `dom` \| `rpc` \| `engine` \| `error`          |
| `event`   | nombre estable del evento (tabla abajo)                 |
| `up`      | ms desde el arranque de la webview                      |
| `session`/`workspace` | contexto activo                            |
| `data`    | carga útil específica (texto **truncado** a ~240 chars) |

### Eventos

| evento                        | src    | cuándo                                     |
| ----------------------------- | ------ | ------------------------------------------ |
| `app.start` / `app.ready`     | app    | arranque y app lista                       |
| `ui.click` / `ui.key`         | dom    | interacción del usuario (nivel `debug`)    |
| `ui.change`                   | dom    | cambio en un input (valor truncado)        |
| `ui.section`                  | app    | cambio de sección (chat/swarm)             |
| `attach.drop` / `attach.add`  | app    | arrastrar/adjuntar archivos                |
| `turn.send` / `turn.done`     | app/engine | turno enviado y terminado (con duración y tools) |
| `turn.cancel` / `turn.regenerate` | app | control del turno                       |
| `tool.start` / `tool.done`    | engine | invocación de herramientas                 |
| `engine.ready` / `engine.terminated` | engine | ciclo de vida del sidecar           |
| `engine.spawn` / `engine.stderr` / `engine.process-error` | engine | proceso del sidecar |
| `engine.notify` / `confirm.request` | engine | avisos y peticiones de confirmación |
| `session.new` / `session.open` / `session.close` / `session.activate` | app | sesiones |
| `workspace.set`               | app    | cambio de espacio de trabajo               |
| `rpc`                         | rpc    | **cada** RPC al sidecar (método, ms, ok/error, params) |
| `error.window` / `error.unhandled-rejection` | error | errores globales          |

## Privacidad

- Los textos se **truncan** (~240 chars) y las estructuras se sanean (profundidad ≤ 3, arrays ≤ 12).
- Los campos `password` se **omiten**.
- No hay envío a red: solo escritura local vía el comando Rust `log_append`.

## Desde la consola (DevTools) — `phosonLog`

```js
phosonLog.tail(50)      // últimos 50 eventos
phosonLog.summary()     // conteo por evento (+ errores)
phosonLog.flush()       // fuerza el volcado a disco
phosonLog.path()        // ruta del archivo activo
phosonLog.openFolder()  // abre la carpeta de logs
phosonLog.download()    // descarga el buffer (útil en modo navegador)
phosonLog.clear()       // vacía el buffer en memoria
```

## Analizar (jq)

```bash
# RPC más lentas
jq -rc 'select(.event=="rpc") | [.data.ms,.data.method] | @tsv' phoson-desktop.jsonl \
  | sort -rn | head -20

# Errores por tipo
jq -rc 'select(.level=="error") | .event' phoson-desktop.jsonl | sort | uniq -c | sort -rn

# Turnos: duración y herramientas usadas
jq -rc 'select(.event=="turn.done") | [.data.ms, (.data.tools|join(","))] | @tsv' phoson-desktop.jsonl
```

## Implementación

- Frontend: `src/lib/log.ts` (buffer en memoria + captura DOM + errores globales).
- Punto de RPC: `src/bridge/client.ts`.
- Rust: `src-tauri/src/logging.rs` (escritura JSONL rotativa) y trazas del
  sidecar en `src-tauri/src/bridge.rs`.
