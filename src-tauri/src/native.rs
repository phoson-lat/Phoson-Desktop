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

/// Abre una ruta local en el visor/aplicación por defecto del sistema.
///
/// Solo se permiten **archivos** con ruta **absoluta**: evita que un enlace del
/// modelo abra directorios o rutas relativas arbitrarias.
#[tauri::command]
pub fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    use std::path::Path as StdPath;
    let candidate = StdPath::new(&path);
    if !candidate.is_absolute() || !candidate.is_file() {
        return Err(format!("ruta no válida: {path}"));
    }
    app.opener()
        .open_path(path, None::<String>)
        .map_err(|e| e.to_string())
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
