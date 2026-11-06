//! Notificaciones nativas del sistema.
//!
//! Se envían desde Rust (no desde el front) porque cada plataforma necesita una
//! API distinta y porque el **clic en la notificación** debe traer la ventana al
//! frente, cosa que el webview no puede hacer por sí solo.
//!
//! - **macOS**: `UNUserNotificationCenter` a través de `mac-usernotifications`.
//!   El plugin oficial usa `notify-rust`, cuyo backend en macOS sigue siendo
//!   `NSUserNotificationCenter`: esa API está deprecada desde macOS 11 y en
//!   macOS 15+ ya no muestra banners (las notificaciones "desaparecían").
//!   Requiere que el binario esté empaquetado como `.app` con
//!   `CFBundleIdentifier` y firmado (basta firma ad-hoc). En `tauri dev` se
//!   ejecuta el binario suelto: solo en debug se recurre a `osascript` para
//!   poder ver el banner (sin acción de clic); la app empaquetada usa siempre
//!   la API moderna y recupera la ventana al pulsar la notificación.
//! - **Linux**: D-Bus `org.freedesktop.Notifications` con una acción
//!   `default`; al pulsarla se muestra la ventana.
//! - **Windows**: se mantiene el plugin oficial (toasts de WinRT, que sí
//!   funcionan y gestionan `AppUserModelID`).

use tauri::AppHandle;

/// Comando del front (`invoke("send_notification")`): aviso al terminar un
/// turno o al pedir confirmación. El texto llega ya traducido desde el webview.
#[tauri::command]
pub fn send_notification(app: AppHandle, title: String, body: Option<String>) -> bool {
    send(&app, &title, body.as_deref().unwrap_or_default())
}

/// Envía una notificación del sistema. Si el usuario la pulsa, se muestra la
/// ventana principal. No bloquea: el trabajo va en un hilo aparte. Devuelve si
/// la plataforma aceptó el envío, no una promesa de que el banner ya se pintó.
pub fn send(app: &AppHandle, title: &str, body: &str) -> bool {
    #[cfg(target_os = "macos")]
    return macos::send(app, title, body);

    #[cfg(target_os = "linux")]
    return linux::send(app, title, body);

    #[cfg(target_os = "windows")]
    return windows::send(app, title, body);

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = (app, title, body);
        false
    }
}

/// Deja lista la plataforma para notificar (hoy solo macOS: pedir permiso).
///
/// Se llama al arrancar y no bloquea: el diálogo de permiso del sistema puede
/// tardar en responder y no debe congelar el `setup`.
pub fn prepare() {
    #[cfg(target_os = "macos")]
    macos::prepare();
}

/* ── Windows: plugin oficial ──────────────────────────────────────────── */

#[cfg(target_os = "windows")]
mod windows {
    use super::*;
    use tauri_plugin_notification::NotificationExt;

    pub fn send(app: &AppHandle, title: &str, body: &str) -> bool {
        // El error se registra en vez de ignorarse: antes se descartaba con
        // `let _` y un fallo de entrega pasaba inadvertido.
        if let Err(err) = app.notification().builder().title(title).body(body).show() {
            eprintln!("[notify] no se pudo mostrar la notificación: {err}");
            return false;
        }
        true
    }
}

/* ── macOS: UNUserNotificationCenter ──────────────────────────────────── */

#[cfg(target_os = "macos")]
mod macos {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Duration;

    use mac_usernotifications::{block_on, AuthorizationStatus, Notification};

    use super::*;

    /// `false` cuando el proceso no está empaquetado (dev) o falta permiso: se
    /// avisa una sola vez y se dejan de encolar notificaciones.
    static ENABLED: AtomicBool = AtomicBool::new(true);

    /// Tiempo máximo esperando la interacción del usuario. Sin límite, el hilo
    /// que espera la respuesta no terminaría nunca si la notificación se queda
    /// olvidada en el Centro de notificaciones.
    const RESPONSE_TIMEOUT: Duration = Duration::from_secs(30 * 60);

    /// `UNUserNotificationCenter` exige una identidad de bundle. El binario
    /// suelto de `tauri dev` no la tiene; ahí se usa el fallback de desarrollo.
    fn has_bundle() -> bool {
        mac_usernotifications::check_bundle().is_ok()
    }

    pub fn prepare() {
        if !has_bundle() {
            #[cfg(debug_assertions)]
            eprintln!("[notify] sin bundle .app: usando osascript durante el desarrollo");
            #[cfg(not(debug_assertions))]
            warn_unavailable("UNUserNotificationCenter requires a valid .app bundle");
            return;
        }
        std::thread::spawn(|| match mac_usernotifications::blocking::get_notification_settings() {
            Ok(settings) => match settings.authorization_status {
                AuthorizationStatus::NotDetermined => {
                    // Primer arranque: se pide permiso en segundo plano.
                    match mac_usernotifications::blocking::request_auth() {
                        Ok(true) => ENABLED.store(true, Ordering::Relaxed),
                        Ok(false) => {
                            ENABLED.store(false, Ordering::Relaxed);
                            eprintln!("[notify] el usuario denegó las notificaciones");
                        }
                        Err(err) => warn_unavailable(&err.to_string()),
                    }
                }
                AuthorizationStatus::Denied => {
                    ENABLED.store(false, Ordering::Relaxed);
                    eprintln!("[notify] notificaciones denegadas en Ajustes del Sistema");
                }
                // Si la persona lo reactiva en Ajustes, el siguiente aviso ya
                // puede entregarse sin reiniciar la app.
                _ => ENABLED.store(true, Ordering::Relaxed),
            },
            Err(err) => warn_unavailable(&err.to_string()),
        });
    }

    fn warn_unavailable(reason: &str) {
        ENABLED.store(false, Ordering::Relaxed);
        eprintln!(
            "[notify] macOS no admite notificaciones desde este proceso ({reason}). \
             En desarrollo hay que usar un bundle (`pnpm tauri build --debug`)."
        );
    }

    /// Fallback exclusivo de desarrollo. AppleScript entrega el aviso a través
    /// del proceso firmado de `osascript`, por eso también funciona sin `.app`.
    /// Los argumentos viajan en `argv`, nunca interpolados en el script.
    #[cfg(debug_assertions)]
    fn send_unbundled(title: &str, body: &str) {
        let title = title.to_owned();
        let body = body.to_owned();
        std::thread::spawn(move || {
            let result = std::process::Command::new("osascript")
                .args([
                    "-e",
                    "on run argv",
                    "-e",
                    "display notification (item 2 of argv) with title (item 1 of argv)",
                    "-e",
                    "end run",
                    "--",
                ])
                .arg(title)
                .arg(body)
                .output();
            match result {
                Ok(output) if output.status.success() => {}
                Ok(output) => eprintln!(
                    "[notify] osascript rechazó el aviso: {}",
                    String::from_utf8_lossy(&output.stderr).trim()
                ),
                Err(err) => eprintln!("[notify] no se pudo ejecutar osascript: {err}"),
            }
        });
    }

    pub fn send(app: &AppHandle, title: &str, body: &str) -> bool {
        if !ENABLED.load(Ordering::Relaxed) {
            return false;
        }
        if !has_bundle() {
            #[cfg(debug_assertions)]
            {
                send_unbundled(title, body);
                return true;
            }
            #[cfg(not(debug_assertions))]
            {
                warn_unavailable("UNUserNotificationCenter requires a valid .app bundle");
                return false;
            }
        }
        let app = app.clone();
        let title = title.to_owned();
        let body = body.to_owned();

        std::thread::spawn(move || {
            let handle = match Notification::new()
                .title(&title)
                .message(&body)
                .default_sound()
                .timeout(RESPONSE_TIMEOUT)
                .send_blocking()
            {
                Ok(handle) => handle,
                Err(err) => {
                    warn_unavailable(&err.to_string());
                    return;
                }
            };

            // El callback del clic llega al run loop del hilo principal (lo
            // bombea Tauri); aquí solo se espera la respuesta.
            match block_on(handle.response()) {
                Ok(response) if response.is_default_action() => {
                    crate::native::show_main_window(&app);
                }
                Ok(_) => {}
                Err(err) => eprintln!("[notify] sin respuesta de la notificación: {err}"),
            }
        });
        true
    }
}

/* ── Linux: D-Bus + acción "default" ──────────────────────────────────── */

#[cfg(target_os = "linux")]
mod linux {
    use std::path::PathBuf;
    use std::sync::OnceLock;

    use notify_rust::{Notification, NotificationHandle};

    use super::*;

    /// Icono de la notificación. `notify-rust` espera una ruta absoluta en el
    /// hint `app_icon`, así que se extrae una vez a un archivo temporal.
    static ICON: OnceLock<Option<PathBuf>> = OnceLock::new();

    fn icon_path() -> Option<&'static PathBuf> {
        ICON.get_or_init(|| {
            let dir = std::env::temp_dir().join("phoson");
            std::fs::create_dir_all(&dir).ok()?;
            let path = dir.join("notification.png");
            std::fs::write(&path, include_bytes!("../icons/128x128.png")).ok()?;
            Some(path)
        })
        .as_ref()
    }

    pub fn send(app: &AppHandle, title: &str, body: &str) -> bool {
        let app = app.clone();
        let title = title.to_owned();
        let body = body.to_owned();
        // El texto de la acción lo pinta el daemon: se reutiliza la etiqueta
        // nativa ya traducida ("Mostrar Phoson").
        let action_label = crate::native::labels().tray_show;

        std::thread::spawn(move || {
            let mut notification = Notification::new();
            notification
                .appname("Phoson Desktop")
                .summary(&title)
                .body(&body)
                .action("default", &action_label);
            if let Some(path) = icon_path() {
                notification.icon(&path.to_string_lossy());
            }

            let handle: NotificationHandle = match notification.show() {
                Ok(handle) => handle,
                Err(err) => {
                    eprintln!("[notify] no se pudo mostrar la notificación: {err}");
                    return;
                }
            };

            // Bloquea hasta que el usuario actúa o el daemon cierra el aviso.
            handle.wait_for_action(|action| {
                if action == "default" {
                    crate::native::show_main_window(&app);
                }
            });
        });
        true
    }
}
