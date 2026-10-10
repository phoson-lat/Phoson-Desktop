//! Puente Rust <-> sidecar(es) Python.
//!
//! Responsabilidad ÚNICA: transporte. Rust no conoce el dominio del agente.
//!  - spawnea **un sidecar por workspace** (para que cada proyecto tenga su
//!    propio `cwd` de proceso y puedan coexistir sin pisarse) y guarda los
//!    `CommandChild` en un mapa.
//!  - parte el stdout de cada sidecar en líneas NDJSON.
//!  - si la línea es una respuesta (tiene `id` y hay un oneshot pendiente):
//!    resuelve la promesa del `invoke('rpc')`.
//!  - si es una notificación: la reemite a la webview como `phoson://message`,
//!    **etiquetada con su workspace** para que el frontend pueda enrutarla.
//!
//! NOTA: `tauri_plugin_shell::process::CommandChild` no expone su stdin; se
//! escribe con `CommandChild::write(&mut self, &[u8])` (API verificada de
//! tauri-plugin-shell 2.3).

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::collections::HashMap;
use std::sync::Mutex;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::mpsc::Receiver;
use tokio::sync::oneshot;

#[derive(Default)]
pub struct BridgeState {
    /// Un sidecar por workspace. Clave = ruta del workspace; `""` = el sidecar
    /// por defecto (arranca en el cwd de desarrollo/instalación).
    pub children: Mutex<HashMap<String, CommandChild>>,
    /// Respuestas pendientes, casadas por `id` de JSON-RPC. Los `id` son
    /// globales (tirados del mismo contador), así que un solo mapa basta aunque
    /// haya varios sidecars. Cada entrada recuerda su `workspace` para poder
    /// **fallar solo las RPC de ese workspace** si su sidecar muere.
    /// El `Err` viaja como rechazo del `invoke` en el frontend.
    pub pending: Mutex<HashMap<u64, (String, oneshot::Sender<Result<Value, String>>)>>,
    pub next_id: AtomicU64,
}

/// Directorio del sidecar Python en el repo (`<repo>/bridge`).
fn dev_bridge_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../bridge")
}

/// Directorio del engine (venv con `phoson_engine_minimal` instalado).
///
/// Configurable con `PHOSON_ENGINE_DIR`; por defecto, el repo hermano.
fn dev_engine_dir() -> PathBuf {
    std::env::var_os("PHOSON_ENGINE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("../../phoson-engine-minimal"))
}

/// cwd con el que arranca el sidecar de un workspace. Es también su
/// identidad: dos rutas que apuntan a la misma carpeta deben dar el MISMO
/// sidecar, no dos procesos con engines distintos.
fn effective_cwd(workspace: Option<&str>) -> PathBuf {
    match workspace {
        Some(ws) if !ws.is_empty() && Path::new(ws).is_dir() => PathBuf::from(ws),
        // Sin workspace: el engine en desarrollo, el cwd del proceso en release
        // (igual que hace `spawn_bridge` con el sidecar empaquetado).
        _ => {
            if cfg!(debug_assertions) {
                dev_engine_dir()
            } else {
                std::env::current_dir().unwrap_or_else(|_| dev_engine_dir())
            }
        }
    }
}

/// Clave normalizada de un workspace para el mapa de sidecars.
///
/// Sin normalizar, la misma carpeta llegaba como claves distintas — la ruta sin
/// resolver de `main.rs` (`src-tauri/../../phoson-engine-minimal`) y la
/// resuelta que manda el front (`C:\...\phoson-engine-minimal`) — y se
/// levantaban dos sidecars: doble `bridge.init`, doble RAM y sesiones que "no
/// existen" en el otro (`sesión desconocida`).
pub fn workspace_key(workspace: Option<&str>) -> String {
    let cwd = effective_cwd(workspace);
    let canonical = std::fs::canonicalize(&cwd).unwrap_or(cwd);
    let mut key = canonical.to_string_lossy().to_string();
    // Windows añade el prefijo `\\?\` al canonicalizar; no debe formar parte de
    // la clave (rompería la comparación con la ruta "de siempre").
    if let Some(rest) = key.strip_prefix(r"\\?\") {
        key = rest.to_string();
    }
    key
}

/// Ruta del intérprete del venv del engine según la plataforma.
fn dev_python(engine: &Path) -> PathBuf {
    if cfg!(windows) {
        engine.join(".venv/Scripts/python.exe")
    } else {
        engine.join(".venv/bin/python")
    }
}

/// Lanza un sidecar. `workspace` es el `cwd` del proceso del sidecar (el que ven
/// los tools del engine): cada proyecto distinto obtiene su propio proceso.
///
/// Primero intenta el **sidecar empaquetado**; si no está (desarrollo), cae a
/// `python -m phoson_bridge` usando el venv del engine.
pub fn spawn_bridge(
    app: &AppHandle,
    workspace: Option<&str>,
) -> Result<(Receiver<CommandEvent>, CommandChild), String> {
    // Un workspace inexistente (p. ej. recordado tras mover/borrar la carpeta) no
    // debe impedir arrancar: `effective_cwd` cae al directorio por defecto.
    let cwd = effective_cwd(workspace);
    let cwd_str = cwd.to_string_lossy().to_string();

    // 1) Sidecar empaquetado (PyInstaller), arrancado en el workspace pedido.
    if let Ok(command) = app.shell().sidecar("phoson-bridge") {
        if let Ok(pair) = command.current_dir(cwd_str.clone()).spawn() {
            return Ok(pair);
        }
    }

    // 2) Fallback de desarrollo: venv del engine.
    let engine = dev_engine_dir();
    let bridge = dev_bridge_dir();
    let python = dev_python(&engine);
    eprintln!(
        "[bridge] usando {} (engine: {}, workspace: {})",
        python.display(),
        engine.display(),
        cwd.display()
    );
    app.shell()
        .command(python.to_string_lossy().to_string())
        .args(["-m", "phoson_bridge"])
        .env("PYTHONPATH", bridge.to_string_lossy().to_string())
        .current_dir(cwd_str)
        .spawn()
        .map_err(|e| e.to_string())
}

/// Comando expuesto al frontend: `invoke('rpc', { method, params, workspace })`.
///
/// `workspace` enruta la llamada a un sidecar distinto (uno por proyecto). Si se
/// omite, usa el sidecar por defecto.
#[tauri::command]
pub async fn rpc(
    app: AppHandle,
    state: State<'_, BridgeState>,
    method: String,
    params: Option<Value>,
    workspace: Option<String>,
) -> Result<Value, String> {
    // Clave normalizada: la misma carpeta por dos rutas distintas debe dar el
    // MISMO sidecar (ver `workspace_key`).
    let key = workspace_key(workspace.as_deref());

    // Spawn on demand del sidecar del workspace, serializado bajo el mismo lock
    // para que dos llamadas concurrentes no arranquen dos procesos.
    {
        let mut children = state.children.lock().unwrap();
        if !children.contains_key(&key) {
            let (event_rx, child) = spawn_bridge(&app, workspace.as_deref())?;
            children.insert(key.clone(), child);
            drop(children);
            let handle = app.clone();
            let ws = key.clone();
            tauri::async_runtime::spawn(async move {
                pump(handle, event_rx, ws).await;
            });
        }
    }

    let id = state.next_id.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = oneshot::channel::<Result<Value, String>>();
    state
        .pending
        .lock()
        .unwrap()
        .insert(id, (key.clone(), tx));

    let line = json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params.unwrap_or(json!({})),
    })
    .to_string();

    {
        // El guard no cruza el `.await`: se libera al salir del bloque.
        let mut guard = state.children.lock().unwrap();
        let Some(child) = guard.get_mut(&key) else {
            // Sin sidecar: no dejamos la entrada pendiente colgada.
            state.pending.lock().unwrap().remove(&id);
            return Err("sidecar no iniciado".to_string());
        };
        if let Err(err) = child.write(format!("{line}\n").as_bytes()) {
            // Escritura rota (pipe muerto): limpiamos el pendiente para no filtrar
            // un sender que nunca se resolvería.
            state.pending.lock().unwrap().remove(&id);
            return Err(err.to_string());
        }
    }

    rx.await
        .map_err(|_| "el sidecar terminó sin responder".to_string())?
}

/// Comando expuesto al frontend: `invoke('kill_sidecar', { workspace })`.
///
/// Cierra el sidecar de un workspace (p. ej. "reiniciar motor"): lo mata, lo saca
/// del mapa (se respawnea al volver a usarlo) y falla sus RPC en vuelo.
#[tauri::command]
pub async fn kill_sidecar(
    state: State<'_, BridgeState>,
    workspace: Option<String>,
) -> Result<bool, String> {
    let key = workspace_key(workspace.as_deref());
    let child = state.children.lock().unwrap().remove(&key);
    let doomed: Vec<u64> = {
        let pending = state.pending.lock().unwrap();
        pending
            .iter()
            .filter(|(_, (ws, _))| ws == &key)
            .map(|(id, _)| *id)
            .collect()
    };
    for id in doomed {
        if let Some((_, tx)) = state.pending.lock().unwrap().remove(&id) {
            let _ = tx.send(Err("sidecar cerrado".to_string()));
        }
    }
    match child {
        Some(c) => {
            c.kill().map_err(|e| e.to_string())?;
            Ok(true)
        }
        None => Ok(false),
    }
}

/// Mata **todos** los sidecars y falla sus RPC en vuelo. Se llama al salir de la
/// app (cualquier vía: bandeja, cerrar ventana, relaunch del updater): sin esto
/// los procesos Python quedarían huérfanos en Windows.
pub fn kill_all(app: &AppHandle) {
    let state = app.state::<BridgeState>();
    let children: Vec<CommandChild> = {
        let mut guard = state.children.lock().unwrap();
        guard.drain().map(|(_, child)| child).collect()
    };
    let doomed: Vec<oneshot::Sender<Result<Value, String>>> = {
        let mut pending = state.pending.lock().unwrap();
        pending.drain().map(|(_, (_, tx))| tx).collect()
    };
    for tx in doomed {
        let _ = tx.send(Err("la aplicación se cerró".to_string()));
    }
    for child in children {
        let _ = child.kill();
    }
}

/// Bucle de lectura del stdout de un sidecar. Llama una vez por proceso.
pub async fn pump(
    app: AppHandle,
    mut rx: tokio::sync::mpsc::Receiver<CommandEvent>,
    workspace: String,
) {
    let mut buffer = String::new();
    while let Some(event) = rx.recv().await {
        match event {
            // Por defecto llega línea a línea; igualmente acumulamos por si acaso.
            CommandEvent::Stdout(chunk) => {
                buffer.push_str(&String::from_utf8_lossy(&chunk));
                while let Some(pos) = buffer.find('\n') {
                    let line = buffer[..pos].trim().to_string();
                    buffer.drain(..=pos);
                    if !line.is_empty() {
                        dispatch_line(&app, &line, &workspace);
                    }
                }
            }
            CommandEvent::Stderr(chunk) => {
                eprintln!("[bridge {workspace}] {}", String::from_utf8_lossy(&chunk));
            }
            CommandEvent::Error(err) => {
                eprintln!("[bridge {workspace}] error del proceso: {err}");
            }
            CommandEvent::Terminated(payload) => {
                let state = app.state::<BridgeState>();
                // 1) Quita el child muerto: la próxima `rpc` de este workspace lo
                //    respawnea (si no, todas las siguientes escribirían a un stdin
                //    muerto y el workspace quedaría inservible hasta reiniciar).
                state.children.lock().unwrap().remove(&workspace);
                // 2) Falla SOLO las RPC en vuelo de este workspace (no las de otros)
                //    para que no queden colgadas esperando una respuesta que no
                //    llegará.
                let doomed: Vec<u64> = {
                    let pending = state.pending.lock().unwrap();
                    pending
                        .iter()
                        .filter(|(_, (ws, _))| ws == &workspace)
                        .map(|(id, _)| *id)
                        .collect()
                };
                for id in doomed {
                    if let Some((_, tx)) = state.pending.lock().unwrap().remove(&id) {
                        let _ = tx.send(Err(format!(
                            "el sidecar del workspace {workspace:?} terminó (código {:?})",
                            payload.code
                        )));
                    }
                }
                let _ = app.emit(
                    "phoson://terminated",
                    json!({ "workspace": workspace, "code": payload.code }),
                );
                break;
            }
            _ => {}
        }
    }
}

fn dispatch_line(app: &AppHandle, line: &str, workspace: &str) {
    let Ok(message) = serde_json::from_str::<RpcMessage>(line) else {
        eprintln!("[bridge] JSON inválido: {line}");
        return;
    };

    // Respuesta a un request pendiente: el error se propaga como rechazo para que
    // el frontend pueda mostrarlo (antes se devolvía como respuesta válida).
    if let Some(id) = message.id {
        let outcome = match message.error {
            Some(err) => Err(err
                .get("message")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| err.to_string())),
            None => Ok(message.result.unwrap_or(Value::Null)),
        };
        let state = app.state::<BridgeState>();
        if let Some((_workspace, tx)) = state.pending.lock().unwrap().remove(&id) {
            let _ = tx.send(outcome);
        }
        return;
    }

    // Notificación -> evento para la webview, etiquetada con su workspace.
    let _ = app.emit(
        "phoson://message",
        json!({
            "method": message.method,
            "params": message.params,
            "workspace": workspace,
        }),
    );
}

#[derive(Deserialize)]
struct RpcMessage {
    id: Option<u64>,
    method: Option<String>,
    #[serde(default)]
    params: Value,
    result: Option<Value>,
    error: Option<Value>,
}
