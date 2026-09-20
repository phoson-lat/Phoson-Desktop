//! Puente Rust <-> sidecar Python.
//!
//! Responsabilidad ÚNICA: transporte. Rust no conoce el dominio del agente.
//!  - spawnea `phoson-bridge` (sidecar) y guarda su `CommandChild`.
//!  - parte el stdout en líneas NDJSON.
//!  - si la línea es una respuesta (tiene `id` y hay un oneshot pendiente):
//!    resuelve la promesa del `invoke('rpc')`.
//!  - si es una notificación: la reemite a la webview como `phoson://message`.
//!
//! NOTA: `tauri_plugin_shell::process::CommandChild` no expone su stdin; se
//! escribe con `CommandChild::write(&mut self, &[u8])` (API verificada de
//! tauri-plugin-shell 2.3).

use std::sync::atomic::{AtomicU64, Ordering};
use std::collections::HashMap;
use std::sync::Mutex;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::process::CommandChild;
use tokio::sync::oneshot;

#[derive(Default)]
pub struct BridgeState {
    /// Proceso del sidecar (su `write` envía al stdin del bridge Python).
    pub child: Mutex<Option<CommandChild>>,
    /// Respuestas pendientes, casadas por `id` de JSON-RPC.
    pub pending: Mutex<HashMap<u64, oneshot::Sender<Value>>>,
    pub next_id: AtomicU64,
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

/// Comando expuesto al frontend: `invoke('rpc', { method, params })`.
#[tauri::command]
pub async fn rpc(
    state: State<'_, BridgeState>,
    method: String,
    params: Option<Value>,
) -> Result<Value, String> {
    let id = state.next_id.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = oneshot::channel::<Value>();
    state.pending.lock().unwrap().insert(id, tx);

    let line = json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params.unwrap_or(json!({})),
    })
    .to_string();

    {
        // El guard no cruza el `.await`: se libera al salir del bloque.
        let mut guard = state.child.lock().unwrap();
        let child = guard.as_mut().ok_or("sidecar no iniciado")?;
        child
            .write(format!("{line}\n").as_bytes())
            .map_err(|e| e.to_string())?;
    }

    rx.await.map_err(|_| "el sidecar terminó sin responder".to_string())
}

/// Bucle de lectura del stdout del sidecar. Llamar una vez desde `setup`.
pub async fn pump(
    app: AppHandle,
    mut rx: tokio::sync::mpsc::Receiver<tauri_plugin_shell::process::CommandEvent>,
) {
    use tauri_plugin_shell::process::CommandEvent;

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
                        dispatch_line(&app, &line);
                    }
                }
            }
            CommandEvent::Stderr(chunk) => {
                eprintln!("[bridge] {}", String::from_utf8_lossy(&chunk));
            }
            CommandEvent::Error(err) => {
                eprintln!("[bridge] error del proceso: {err}");
            }
            CommandEvent::Terminated(payload) => {
                let _ = app.emit("phoson://terminated", payload.code);
                break;
            }
            _ => {}
        }
    }
}

fn dispatch_line(app: &AppHandle, line: &str) {
    let Ok(message) = serde_json::from_str::<RpcMessage>(line) else {
        eprintln!("[bridge] JSON inválido: {line}");
        return;
    };

    // Respuesta a un request pendiente.
    if let Some(id) = message.id {
        let payload = message.result.or(message.error).unwrap_or(Value::Null);
        let state = app.state::<BridgeState>();
        if let Some(tx) = state.pending.lock().unwrap().remove(&id) {
            let _ = tx.send(payload);
        }
        return;
    }

    // Notificación -> evento para la webview.
    let _ = app.emit(
        "phoson://message",
        json!({ "method": message.method, "params": message.params }),
    );
}
