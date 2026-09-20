//! Integración nativa (no relacionada con el agente): metadatos, notificaciones,
//! diálogos de archivo, tray, updater… Aquí solo el esqueleto.

use tauri::command;

#[command]
pub fn app_info() -> serde_json::Value {
    serde_json::json!({
        "name": "Phoson Desktop",
        "version": env!("CARGO_PKG_VERSION"),
    })
}
