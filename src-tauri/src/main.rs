// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod logging;
mod native;
mod notify;

use bridge::BridgeState;
use tauri::image::Image;
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
#[cfg(target_os = "windows")]
use tauri::tray::{MouseButton, MouseButtonState};
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
            logging::log_append,
            logging::log_path,
            logging::log_open_dir,
            native::app_info,
            native::open_path,
            native::open_url,
            native::open_folder,
            native::list_editors,
            native::open_in_editor,
            native::file_manager,
            native::git_status,
            native::git_stamp,
            native::git_diff,
            native::git_action,
            native::git_branches,
            native::git_checkout,
            native::open_terminal,
            native::hide_to_tray,
            native::app_in_foreground,
            notify::send_notification,
            native::show_window,
            native::set_close_to_tray,
            native::system_locale,
            native::set_native_labels
        ])
        .setup(|app| {
            setup_tray(app.handle())?;
            // Permiso de notificaciones del sistema (en macOS hay que pedirlo).
            notify::prepare();

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

            // Recolector de sidecars inactivos: cierra los de workspaces que
            // nadie usa (la app puede vivir en la bandeja durante horas).
            let reaper = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                bridge::idle_reaper(reaper).await;
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

/// Icono de la bandeja, adaptado a cada plataforma (ver
/// `scripts/gen-tray-icons.py`, que genera ambos PNG).
///
/// - **macOS**: template image monocroma (negro + alfa). El sistema la
///   recolorea según el tema y el estado del ítem; si se usa el icono a color
///   de la app, la barra de menús lo muestra como un cuadrado claro. El PNG es
///   de 36x36 px porque `tray-icon` fija la altura a 18 pt (36 px a 2x).
/// - **Windows/Linux**: glifo de 32x32 px sobre disco blanco. Es el tamaño al
///   que dibujan la bandeja y no se reescala el icono de 512 px de la app.
fn tray_icon() -> Option<Image<'static>> {
    #[cfg(target_os = "macos")]
    const BYTES: &[u8] = include_bytes!("../icons/tray/tray-template.png");
    #[cfg(not(target_os = "macos"))]
    const BYTES: &[u8] = include_bytes!("../icons/tray/tray.png");

    match Image::from_bytes(BYTES) {
        Ok(icon) => Some(icon),
        Err(err) => {
            eprintln!("[tray] no se pudo decodificar el icono de la bandeja: {err}");
            None
        }
    }
}

/// Eventos del icono de bandeja con el comportamiento nativo de cada sistema:
/// en Windows el clic izquierdo debe mostrar la ventana (el menú va con clic
/// derecho); en macOS el clic izquierdo abre el menú, como en cualquier ítem de
/// la barra de menús, y "Mostrar Phoson" está en el propio menú. En Linux
/// (AppIndicator) el panel abre el menú y no emite estos eventos.
fn handle_tray_event(tray: &tauri::tray::TrayIcon, event: TrayIconEvent) {
    #[cfg(target_os = "windows")]
    {
        if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        } = event
        {
            native::show_main_window(tray.app_handle());
            return;
        }
    }

    let _ = (tray, event);
}

/// Icono de la bandeja del sistema con su menú: mostrar, enviar a la bandeja
/// y salir. El comportamiento del clic depende de la plataforma (ver
/// `handle_tray_event`).
///
/// El menú se construye con `native::build_tray_menu` para que el front pueda
/// reconstruirlo traducido al cambiar de idioma (`set_native_labels`).
fn setup_tray(handle: &tauri::AppHandle) -> tauri::Result<()> {
    let labels = native::labels();
    let menu = native::build_tray_menu(handle, &labels)?;

    let mut builder = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .tooltip(labels.tooltip.clone())
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => native::show_main_window(app),
            "hide" => native::hide_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(handle_tray_event);

    // Windows: el menú se abre con clic derecho y el izquierdo muestra la
    // ventana. En macOS/Linux se deja el default (el clic abre el menú).
    #[cfg(target_os = "windows")]
    {
        builder = builder.show_menu_on_left_click(false);
    }

    match tray_icon() {
        Some(icon) => {
            builder = builder.icon(icon);
            // Solo tiene sentido con el glifo monocromo: aplicado al icono a
            // color lo convertiría en una silueta negra del cuadrado.
            #[cfg(target_os = "macos")]
            {
                builder = builder.icon_as_template(true);
            }
        }
        // Fallback improbable (PNG corrupto): icono de la app.
        None => {
            if let Some(icon) = handle.default_window_icon() {
                builder = builder.icon(icon.clone());
            }
        }
    }

    builder.build(handle)?;
    Ok(())
}
