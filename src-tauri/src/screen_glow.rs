//! Glow morado en el borde de la pantalla mientras el agente controla el
//! escritorio (plugin computeruse).
//!
//! Una ventana por monitor: transparente, sin marco, siempre encima de todo y
//! **click-through** (`set_ignore_cursor_events`), de modo que el usuario VE
//! que Phoson está manejando la pantalla pero sus clics llegan a las apps de
//! debajo. El contenido es `cu-overlay.html`: CSS puro, sin JS ni permisos.
//!
//! El frontend lo enciende/apaga con `cu_screen_glow` siguiendo el flag
//! `active` del store de computer use; al recargar la ventana principal el
//! efecto vuelve a emitir el estado (apagado) y limpia glows huérfanos.

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

/// Prefijo de etiqueta de las ventanas de glow (una por monitor).
const LABEL_PREFIX: &str = "cu-glow";

/// Enciende o apaga el glow de borde de pantalla.
#[tauri::command]
pub fn cu_screen_glow(app: AppHandle, active: bool) -> Result<(), String> {
    if active {
        show(&app)
    } else {
        hide(&app);
        Ok(())
    }
}

fn show(app: &AppHandle) -> Result<(), String> {
    // Ya hay glow en pantalla: no duplicar ventanas.
    if app.webview_windows().keys().any(|l| l.starts_with(LABEL_PREFIX)) {
        return Ok(());
    }
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    for (i, monitor) in monitors.iter().enumerate() {
        let label = format!("{LABEL_PREFIX}-{i}");
        let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("cu-overlay.html".into()))
            .transparent(true)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .shadow(false)
            // No robar el foco: el agente está escribiendo/clicando en otras apps.
            .focused(false)
            .visible_on_all_workspaces(true)
            .build()
            .map_err(|e| e.to_string())?;
        // Cubrir el monitor exacto (coordenadas FÍSICAS: con Retina el tamaño
        // lógico no coincide y quedaría un hueco sin glow).
        let size = monitor.size();
        let pos = monitor.position();
        window
            .set_size(PhysicalSize::new(size.width, size.height))
            .map_err(|e| e.to_string())?;
        window
            .set_position(PhysicalPosition::new(pos.x, pos.y))
            .map_err(|e| e.to_string())?;
        window.set_ignore_cursor_events(true).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn hide(app: &AppHandle) {
    for (label, window) in app.webview_windows() {
        if label.starts_with(LABEL_PREFIX) {
            let _ = window.close();
        }
    }
}
