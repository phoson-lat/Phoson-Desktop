// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod native;

use bridge::BridgeState;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(BridgeState::default())
        .invoke_handler(tauri::generate_handler![
            bridge::rpc,
            bridge::kill_sidecar,
            native::app_info,
            native::open_path,
            native::open_url
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            // Sidecar por defecto (workspace ""). Los demás se arrancan bajo
            // demanda, uno por proyecto, en `bridge::rpc`.
            let (rx, child) = bridge::spawn_bridge(&handle, None).expect(
                "no se pudo lanzar el bridge (ni sidecar ni python). \
                 Define PHOSON_ENGINE_DIR si tu engine no está en ../phoson-engine-minimal",
            );
            {
                let state = handle.state::<BridgeState>();
                state.children.lock().unwrap().insert(String::new(), child);
            }
            tauri::async_runtime::spawn(async move {
                bridge::pump(handle, rx, String::new()).await;
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error al arrancar Phoson Desktop");
}
