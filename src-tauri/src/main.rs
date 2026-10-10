// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod native;

use bridge::BridgeState;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WindowEvent};

fn main() {
    let app = tauri::Builder::default()
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
            native::open_url,
            native::hide_to_tray,
            native::show_window,
            native::set_close_to_tray
        ])
        .setup(|app| {
            setup_tray(app.handle())?;

            // Cerrar la ventana manda a la bandeja en vez de salir: el sidecar
            // (y los turnos en curso) siguen vivos. Salir es explícito, por el
            // menú de la bandeja.
            if let Some(window) = app.get_webview_window("main") {
                let window_app = app.handle().clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        if native::close_to_tray_enabled() {
                            api.prevent_close();
                            native::hide_main_window(&window_app);
                        }
                    }
                });
            }

            let handle = app.handle().clone();
            // Sidecar por defecto. Los demás se arrancan bajo demanda, uno por
            // proyecto, en `bridge::rpc`. La clave es la MISMA que usaría `rpc`
            // para ese workspace: si no, el front que pida esa carpeta por su
            // ruta levantaría un segundo sidecar para el mismo proyecto.
            let key = bridge::workspace_key(None);
            let (rx, child) = bridge::spawn_bridge(&handle, None).expect(
                "no se pudo lanzar el bridge (ni sidecar ni python). \
                 Define PHOSON_ENGINE_DIR si tu engine no está en ../phoson-engine-minimal",
            );
            {
                let state = handle.state::<BridgeState>();
                state.children.lock().unwrap().insert(key.clone(), child);
            }
            tauri::async_runtime::spawn(async move {
                bridge::pump(handle, rx, key).await;
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error al arrancar Phoson Desktop");

    app.run(|handle, event| {
        // Cierre real de la app (bandeja → Salir, cerrar ventana sin bandeja,
        // relaunch del updater): los sidecars no deben quedar huérfanos.
        if let tauri::RunEvent::Exit = event {
            bridge::kill_all(handle);
        }
    });
}

/// Icono de la bandeja del sistema con su menú: mostrar, enviar a la bandeja
/// y salir. Clic izquierdo = mostrar (comportamiento esperado en Windows).
fn setup_tray(handle: &tauri::AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(handle, "show", "Mostrar Phoson", true, None::<&str>)?;
    let hide = MenuItem::with_id(handle, "hide", "Enviar a la bandeja", true, None::<&str>)?;
    let quit = MenuItem::with_id(handle, "quit", "Salir de Phoson", true, None::<&str>)?;
    let menu = Menu::with_items(handle, &[&show, &hide, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .tooltip("Phoson Desktop")
        // El clic izquierdo muestra la ventana; el menú va con clic derecho.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => native::show_main_window(app),
            "hide" => native::hide_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                native::show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = handle.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(handle)?;
    Ok(())
}
