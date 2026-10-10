//! Integración nativa: metadatos, apertura de enlaces externos en el navegador
//! del sistema (la webview no debe navegar fuera de la app) y bandeja del
//! sistema (tray) en Windows.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

/// Si `true`, cerrar la ventana oculta a la bandeja en vez de salir.
/// Lo fija el front (`set_close_to_tray`) según la preferencia del usuario.
static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(true);

/// Aviso «sigue en la bandeja» solo la primera vez por ejecución.
static TRAY_HINT_SHOWN: AtomicBool = AtomicBool::new(false);

pub fn close_to_tray_enabled() -> bool {
    CLOSE_TO_TRAY.load(Ordering::Relaxed)
}

/// Muestra y enfoca la ventana principal (tray, comando del front).
pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Oculta la ventana y avisa, una sola vez, de que la app sigue viva en la bandeja.
pub fn hide_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    if !TRAY_HINT_SHOWN.swap(true, Ordering::Relaxed) {
        let _ = app
            .notification()
            .builder()
            .title("Phoson sigue en la bandeja")
            .body("El agente sigue ejecutándose. Haz clic en el icono de la bandeja para volver.")
            .show();
    }
}

/// Oculta la ventana a la bandeja (invocado desde el front: paleta de comandos,
/// ajustes…).
#[tauri::command]
pub fn hide_to_tray(app: AppHandle) {
    hide_main_window(&app);
}

/// Muestra la ventana principal (invocado desde el front).
#[tauri::command]
pub fn show_window(app: AppHandle) {
    show_main_window(&app);
}

/// Preferencia «cerrar minimiza a la bandeja» (localStorage del front).
#[tauri::command]
pub fn set_close_to_tray(enabled: bool) {
    CLOSE_TO_TRAY.store(enabled, Ordering::Relaxed);
}

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
