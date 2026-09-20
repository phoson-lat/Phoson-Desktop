//! Integración nativa: metadatos y apertura de enlaces externos en el navegador
//! del sistema (la webview no debe navegar fuera de la app).

use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub fn app_info() -> serde_json::Value {
    serde_json::json!({
        "name": "Phoson Desktop",
        "version": env!("CARGO_PKG_VERSION"),
    })
}

/// Abre una URL en el navegador del sistema.
///
/// Solo se permiten esquemas seguros: un enlace del modelo (`https://…`) o de un
/// mensaje no debe poder lanzar `file://` ni comandos arbitrarios.
#[tauri::command]
pub fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    let allowed = ["http://", "https://", "mailto:"];
    if !allowed.iter().any(|prefix| url.starts_with(prefix)) {
        return Err(format!("esquema no permitido: {url}"));
    }
    app.opener()
        .open_url(url, None::<String>)
        .map_err(|e| e.to_string())
}
