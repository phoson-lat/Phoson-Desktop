// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod native;

use bridge::BridgeState;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .manage(BridgeState::default())
        .invoke_handler(tauri::generate_handler![bridge::rpc, native::app_info])
        .setup(|app| {
            let handle = app.handle().clone();

            // Spawnea el sidecar Python y arranca el bombeo de stdout.
            let sidecar = app
                .shell()
                .sidecar("phoson-bridge")
                .expect("sidecar phoson-bridge no encontrado");
            let (rx, child) = sidecar.spawn().expect("no se pudo lanzar el sidecar");

            let stdin = child.stdin.take();
            {
                let state = handle.state::<BridgeState>();
                *state.stdin.blocking_lock() = stdin;
            }

            tauri::async_runtime::spawn(async move {
                bridge::pump(handle, rx).await;
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error al arrancar Phoson Desktop");
}
