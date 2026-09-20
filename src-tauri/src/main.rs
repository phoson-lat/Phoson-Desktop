// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod native;

use std::path::{Path, PathBuf};

use bridge::BridgeState;
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

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

/// Ruta del intérprete del venv del engine según la plataforma.
fn dev_python(engine: &Path) -> PathBuf {
    if cfg!(windows) {
        engine.join(".venv/Scripts/python.exe")
    } else {
        engine.join(".venv/bin/python")
    }
}

/// Lanza el bridge: primero el **sidecar empaquetado**; si no está (desarrollo),
/// cae a `python -m phoson_bridge` usando el venv del engine.
fn spawn_bridge(app: &tauri::AppHandle) -> (tokio::sync::mpsc::Receiver<CommandEvent>, CommandChild) {
    match app.shell().sidecar("phoson-bridge").and_then(|c| c.spawn()) {
        Ok(pair) => pair,
        Err(err) => {
            let engine = dev_engine_dir();
            let bridge = dev_bridge_dir();
            let python = dev_python(&engine);
            eprintln!(
                "[bridge] sidecar no disponible ({err}); usando {} (engine: {})",
                python.display(),
                engine.display()
            );
            app.shell()
                .command(python.to_string_lossy().to_string())
                .args(["-m", "phoson_bridge"])
                .env("PYTHONPATH", bridge.to_string_lossy().to_string())
                .current_dir(engine.to_string_lossy().to_string())
                .spawn()
                .expect(
                    "no se pudo lanzar el bridge (ni sidecar ni python). \
                     Define PHOSON_ENGINE_DIR si tu engine no está en ../phoson-engine-minimal",
                )
        }
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .manage(BridgeState::default())
        .invoke_handler(tauri::generate_handler![bridge::rpc, native::app_info])
        .setup(|app| {
            let handle = app.handle().clone();
            let (rx, child) = spawn_bridge(&handle);
            {
                let state = handle.state::<BridgeState>();
                *state.child.lock().unwrap() = Some(child);
            }
            tauri::async_runtime::spawn(async move {
                bridge::pump(handle, rx).await;
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error al arrancar Phoson Desktop");
}
